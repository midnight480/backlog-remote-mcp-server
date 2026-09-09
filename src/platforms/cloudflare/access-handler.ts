// access-handler.ts
// Handles Cloudflare Access OAuth flow with email allowlist enforcement

import { Buffer } from "node:buffer";
import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import {
	collectCredentialFields,
	envelopeCookie,
	readEnvelopeCookie,
	sealCredentials,
	clearEnvelopeCookie,
	attach,
} from "../../core/credential-envelope";
import { spacesNeedingUserKey } from "../../core/credentials";
import {
	addApprovedClient,
	CREDENTIAL_FIELD_PREFIX,
	createOAuthState,
	fetchUpstreamAuthToken,
	generateCSRFProtection,
	getUpstreamAuthorizeUrl,
	isClientApproved,
	OAuthError,
	type Props,
	renderApprovalDialog,
	validateCSRFToken,
	validateOAuthState,
} from "./workers-oauth-utils";

type EnvWithOauth = Env & { OAUTH_PROVIDER: OAuthHelpers };

/**
 * 同意画面で本人のキーを受け取るスペース名。共有キーを持たないものだけ。
 * 設定が壊れている場合は入力欄を出さない (別の経路でエラーになる)。
 */
function getCredentialSpaces(env: Env): string[] {
	try {
		return spacesNeedingUserKey(env.BACKLOG_SPACES_CONFIG);
	} catch {
		return [];
	}
}

function getAllowedEmails(env: Env): Set<string> {
	try {
		const emails = JSON.parse(env.ALLOWED_EMAILS || "[]");
		return new Set(emails.map((e: string) => e.toLowerCase()));
	} catch {
		return new Set();
	}
}

export async function handleAccessRequest(
	request: Request,
	env: EnvWithOauth,
	_ctx: ExecutionContext,
) {
	const { pathname, searchParams } = new URL(request.url);

	if (request.method === "GET" && pathname === "/authorize") {
		const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
		const { clientId } = oauthReqInfo;
		if (!clientId) {
			return new Response("Invalid request", { status: 400 });
		}

		const credentialSpaces = getCredentialSpaces(env);
		// キーを入力してもらう構成では、承認済みでも同意画面を飛ばせない。
		// キーはサーバに残らないため、認可のたびに本人から受け取る必要がある。
		if (
			credentialSpaces.length === 0 &&
			(await isClientApproved(request, clientId, env.COOKIE_ENCRYPTION_KEY))
		) {
			const { stateToken, codeChallenge } = await createOAuthState(
				oauthReqInfo,
				env.OAUTH_KV,
				env.COOKIE_ENCRYPTION_KEY,
			);
			return redirectToAccess(request, env, stateToken, codeChallenge);
		}

		const { token: csrfToken, setCookie } = generateCSRFProtection();

		return renderApprovalDialog(request, {
			client: await env.OAUTH_PROVIDER.lookupClient(clientId),
			csrfToken,
			server: {
				name: "Backlog Remote MCP Server",
				description:
					"A remote MCP server for Backlog. Only authorized users can access this server.",
			},
			setCookie,
			state: { oauthReqInfo },
			credentialSpaces,
		});
	}

	if (request.method === "POST" && pathname === "/authorize") {
		try {
			const formData = await request.formData();
			const csrfResult = validateCSRFToken(formData, request);

			const encodedState = formData.get("state");
			if (!encodedState || typeof encodedState !== "string") {
				return new Response("Missing state in form data", { status: 400 });
			}

			let state: { oauthReqInfo?: AuthRequest };
			try {
				state = JSON.parse(atob(encodedState));
			} catch {
				return new Response("Invalid state data", { status: 400 });
			}

			if (!state.oauthReqInfo || !state.oauthReqInfo.clientId) {
				return new Response("Invalid request", { status: 400 });
			}

			const approvedClientCookie = await addApprovedClient(
				request,
				state.oauthReqInfo.clientId,
				env.COOKIE_ENCRYPTION_KEY,
			);

			const { stateToken, codeChallenge } = await createOAuthState(
				state.oauthReqInfo,
				env.OAUTH_KV,
				env.COOKIE_ENCRYPTION_KEY,
			);

			const redirectHeaders = new Headers();
			redirectHeaders.append("Set-Cookie", approvedClientCookie);
			redirectHeaders.append("Set-Cookie", csrfResult.clearCookie);

			// 入力されたキーを封じ、ブラウザに預けて上流 IdP を往復させる。
			// サーバ側にも workers-oauth-provider にも渡さない。
			const entered = collectCredentialFields(
				(field) => {
					const value = formData.get(field);
					return typeof value === "string" ? value : undefined;
				},
				getCredentialSpaces(env),
				CREDENTIAL_FIELD_PREFIX,
			);
			if (Object.keys(entered).length > 0) {
				redirectHeaders.append(
					"Set-Cookie",
					envelopeCookie(await sealCredentials(entered, env.COOKIE_ENCRYPTION_KEY)),
				);
			}

			return redirectToAccess(request, env, stateToken, codeChallenge, redirectHeaders);
		} catch (error: any) {
			console.error("POST /authorize error:", error);
			if (error instanceof OAuthError) {
				return error.toResponse();
			}
			return new Response(`Internal server error: ${error.message}`, { status: 500 });
		}
	}

	if (request.method === "GET" && pathname === "/callback") {
		let oauthReqInfo: AuthRequest;
		let codeVerifier: string;

		try {
			const result = await validateOAuthState(request, env.OAUTH_KV, env.COOKIE_ENCRYPTION_KEY);
			oauthReqInfo = result.oauthReqInfo;
			codeVerifier = result.codeVerifier;
		} catch (error: any) {
			if (error instanceof OAuthError) {
				return error.toResponse();
			}
			return new Response("Internal server error", { status: 500 });
		}

		if (!oauthReqInfo.clientId) {
			return new Response("Invalid OAuth request data", { status: 400 });
		}

		const [accessToken, idToken, errResponse] = await fetchUpstreamAuthToken({
			client_id: env.ACCESS_CLIENT_ID,
			client_secret: env.ACCESS_CLIENT_SECRET,
			code: searchParams.get("code") ?? undefined,
			redirect_uri: new URL("/callback", request.url).href,
			upstream_url: env.ACCESS_TOKEN_URL,
			code_verifier: codeVerifier,
		});
		if (errResponse) {
			return errResponse;
		}

		const idTokenClaims = await verifyToken(env, idToken);
		const userEmail = (idTokenClaims.email as string || "").toLowerCase();

		// Enforce email allowlist
		const allowedEmails = getAllowedEmails(env);
		if (allowedEmails.size > 0 && !allowedEmails.has(userEmail)) {
			return new Response(
				JSON.stringify({
					error: "access_denied",
					error_description: `User ${userEmail} is not authorized to use this MCP server.`,
				}),
				{ status: 403, headers: { "Content-Type": "application/json" } },
			);
		}

		const user = {
			email: userEmail,
			name: (idTokenClaims.name as string) || userEmail,
			sub: idTokenClaims.sub as string,
		};

		// 同意画面で預かった封筒はここで取り出し、認可コードへ載せ替える。
		// completeAuthorization には渡さない (渡すと KV に保存されてしまう)。
		const sealed = readEnvelopeCookie(request.headers.get("cookie"));

		const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
			metadata: { label: user.name },
			props: {
				accessToken,
				email: user.email,
				login: user.sub,
				name: user.name,
			} as Props,
			request: oauthReqInfo,
			scope: oauthReqInfo.scope,
			userId: user.sub,
		});

		// 保存されたのは OAuth の認可情報だけ。封筒はコード文字列に載せて
		// クライアントへ渡す。ブラウザに残す理由はないので捨てる。
		const target = new URL(redirectTo);
		const issuedCode = target.searchParams.get("code");
		if (sealed && issuedCode) {
			target.searchParams.set("code", attach(issuedCode, sealed));
		}
		return new Response(null, {
			status: 302,
			headers: { location: target.toString(), "Set-Cookie": clearEnvelopeCookie },
		});
	}

	return new Response("Not Found", { status: 404 });
}

function redirectToAccess(
	request: Request,
	env: Env,
	stateToken: string,
	codeChallenge: string,
	extraHeaders: Headers = new Headers(),
) {
	const headers = new Headers(extraHeaders);
	headers.set(
		"location",
		getUpstreamAuthorizeUrl({
			client_id: env.ACCESS_CLIENT_ID,
			code_challenge: codeChallenge,
			redirect_uri: new URL("/callback", request.url).href,
			scope: "openid email profile",
			state: stateToken,
			upstream_url: env.ACCESS_AUTHORIZATION_URL,
		}),
	);
	return new Response(null, { headers, status: 302 });
}

async function fetchAccessPublicKey(env: Env, kid: string) {
	if (!env.ACCESS_JWKS_URL) {
		throw new Error("ACCESS_JWKS_URL not configured");
	}
	const resp = await fetch(env.ACCESS_JWKS_URL);
	const keys = (await resp.json()) as { keys: (JsonWebKey & { kid: string })[] };
	const jwk = keys.keys.find((key) => key.kid === kid);
	if (!jwk) {
		throw new Error(`Key with kid ${kid} not found`);
	}
	return crypto.subtle.importKey(
		"jwk",
		jwk,
		{ hash: "SHA-256", name: "RSASSA-PKCS1-v1_5" },
		false,
		["verify"],
	);
}

function parseJWT(token: string) {
	const tokenParts = token.split(".");
	if (tokenParts.length !== 3) {
		throw new Error("token must have 3 parts");
	}
	return {
		data: `${tokenParts[0]}.${tokenParts[1]}`,
		header: JSON.parse(Buffer.from(tokenParts[0], "base64url").toString()),
		payload: JSON.parse(Buffer.from(tokenParts[1], "base64url").toString()),
		signature: tokenParts[2],
	};
}

async function verifyToken(env: Env, token: string) {
	const jwt = parseJWT(token);
	const key = await fetchAccessPublicKey(env, jwt.header.kid);

	const verified = await crypto.subtle.verify(
		"RSASSA-PKCS1-v1_5",
		key,
		Buffer.from(jwt.signature, "base64url"),
		Buffer.from(jwt.data),
	);

	if (!verified) {
		throw new Error("Failed to verify token");
	}

	const claims = jwt.payload;
	const now = Math.floor(Date.now() / 1000);
	if (claims.exp < now) {
		throw new Error("Expired token");
	}

	return claims;
}
