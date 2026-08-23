// oauth/upstream.ts
// 上流 OIDC プロバイダとの連携 (AWS では Cognito、Azure なら Entra ID など)。
// Cloudflare 版の access-handler.ts が Cloudflare Access に対して行っていることの AWS 版。
//
// Cognito は動的クライアント登録 (RFC 7591) に対応しないため、認可サーバとしては
// 使えない。ここでは「ユーザー認証だけを担う上流 IdP」として扱い、MCP クライアント
// 向けの認可サーバは自前 (MCP SDK の mcpAuthRouter) で提供する。

import { Buffer } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

export interface UpstreamConfig {
	/** 例: https://<domain>.auth.ap-northeast-1.amazoncognito.com */
	domain: string;
	clientId: string;
	clientSecret?: string;
	/** ID トークン検証用。例: https://cognito-idp.<region>.amazonaws.com/<userPoolId> */
	issuer: string;
	/** このサーバ自身の /callback の絶対 URL */
	redirectUri: string;
	scopes?: string[];
}

export const b64url = (b: Buffer) => b.toString("base64url");

export function createPkcePair(): { verifier: string; challenge: string } {
	const verifier = b64url(randomBytes(32));
	const challenge = b64url(createHash("sha256").update(verifier).digest());
	return { verifier, challenge };
}

export function buildAuthorizeUrl(cfg: UpstreamConfig, state: string, challenge: string): string {
	const url = new URL("/oauth2/authorize", cfg.domain);
	url.search = new URLSearchParams({
		response_type: "code",
		client_id: cfg.clientId,
		redirect_uri: cfg.redirectUri,
		scope: (cfg.scopes ?? ["openid", "email", "profile"]).join(" "),
		state,
		code_challenge: challenge,
		code_challenge_method: "S256",
	}).toString();
	return url.toString();
}

export interface UpstreamTokens {
	access_token: string;
	id_token: string;
	refresh_token?: string;
}

export async function exchangeUpstreamCode(
	cfg: UpstreamConfig,
	code: string,
	codeVerifier: string,
): Promise<UpstreamTokens> {
	const body = new URLSearchParams({
		grant_type: "authorization_code",
		client_id: cfg.clientId,
		code,
		redirect_uri: cfg.redirectUri,
		code_verifier: codeVerifier,
	});

	const headers: Record<string, string> = {
		"Content-Type": "application/x-www-form-urlencoded",
	};
	// Cognito のアプリクライアントに secret がある場合は Basic 認証で送る
	if (cfg.clientSecret) {
		const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
		headers.Authorization = `Basic ${basic}`;
	}

	const res = await fetch(new URL("/oauth2/token", cfg.domain), {
		method: "POST",
		headers,
		body,
	});
	if (!res.ok) {
		throw new Error(`Upstream token exchange failed (${res.status}): ${await res.text()}`);
	}
	const tokens = (await res.json()) as UpstreamTokens;
	if (!tokens.id_token) {
		throw new Error("Upstream did not return an id_token");
	}
	return tokens;
}

export interface UpstreamIdentity {
	email: string;
	name?: string;
	sub: string;
}

// JWKS は取得結果がキャッシュされるため、実行環境が再利用される Lambda では
// モジュールスコープで保持したほうが効率がよい。
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwksFor(issuer: string) {
	let jwks = jwksCache.get(issuer);
	if (!jwks) {
		jwks = createRemoteJWKSet(new URL(`${issuer.replace(/\/$/, "")}/.well-known/jwks.json`), {
			// jose の既定は AbortSignal.timeout(5000)。この 5 秒タイマーは fetch 完了後も
			// イベントループに残り、Lambda が応答を返した後に保留状態で凍結されるため、
			// ランタイムが Runtime.NodeJsExit として検出する。
			// タイムアウト自体は必要なので短くして滞留時間を詰める。
			timeoutDuration: 2000,
			// JWKS は 10 分キャッシュする。実行環境が再利用される間は取得自体が起きない。
			cacheMaxAge: 600_000,
			cooldownDuration: 30_000,
		});
		jwksCache.set(issuer, jwks);
	}
	return jwks;
}

/** ID トークンを検証し、メールアドレスを取り出す。署名・issuer・audience・有効期限を確認する。 */
export async function verifyIdToken(
	cfg: UpstreamConfig,
	idToken: string,
): Promise<UpstreamIdentity> {
	const { payload } = await jwtVerify(idToken, jwksFor(cfg.issuer), {
		issuer: cfg.issuer,
		audience: cfg.clientId,
	});

	const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
	if (!email) {
		throw new Error("Upstream id_token has no email claim");
	}
	// email_verified が明示的に false の場合は信頼しない
	if (payload.email_verified === false) {
		throw new Error(`Upstream email is not verified: ${email}`);
	}
	return {
		email,
		name: typeof payload.name === "string" ? payload.name : undefined,
		sub: String(payload.sub ?? email),
	};
}

/**
 * 上流 IdP とのやりとりをまとめたインターフェース。
 * 実装を差し替えられるようにしておくことで、IdP の変更やテストが容易になる。
 */
export interface UpstreamClient {
	buildAuthorizeUrl(state: string, challenge: string): string;
	exchangeCode(code: string, codeVerifier: string): Promise<UpstreamTokens>;
	verifyIdToken(idToken: string): Promise<UpstreamIdentity>;
}

export function createUpstreamClient(cfg: UpstreamConfig): UpstreamClient {
	return {
		buildAuthorizeUrl: (state, challenge) => buildAuthorizeUrl(cfg, state, challenge),
		exchangeCode: (code, verifier) => exchangeUpstreamCode(cfg, code, verifier),
		verifyIdToken: (idToken) => verifyIdToken(cfg, idToken),
	};
}
