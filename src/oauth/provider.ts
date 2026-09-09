// oauth/provider.ts
// MCP SDK の OAuthServerProvider 実装。
//
// 永続化は AuthStore 越しに行うためプラットフォームに依存しない。
// Node が動く実行環境 (AWS Lambda / Cloud Run / Container Apps など) で共有する。
//
// フローの全体像:
//   1. MCP クライアント → /authorize    ... authorize() が上流 IdP へリダイレクト
//   2. ユーザーが上流 IdP でログイン
//   3. 上流 IdP → /callback             ... handleUpstreamCallback() が ID トークンを
//                                           検証し、許可メールか判定して認可コードを発行
//   4. MCP クライアント → /token        ... exchangeAuthorizationCode() が PKCE を
//                                           検証してアクセストークンを発行

import { Buffer } from "node:buffer";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Response } from "express";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
	AuthorizationParams,
	OAuthServerProvider,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type {
	OAuthClientInformationFull,
	OAuthTokenRevocationRequest,
	OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { parseAllowedEmails, isAccessDenied } from "../core/create-server";
import {
	approvalKey,
	approvedClientsCookie,
	clearCsrfCookie,
	CREDENTIAL_FIELD_PREFIX,
	isClientApproved,
	issueCsrfToken,
	renderApprovalDialog,
	validateCsrfToken,
} from "./consent";
import {
	attach,
	collectCredentialFields,
	detach,
	envelopeCookie,
	openCredentials,
	sealCredentials,
} from "../core/credential-envelope";
import type { UserApiKeys } from "../core/credentials";
import type { AuthStore } from "./store";
import { createPkcePair, type UpstreamClient } from "./upstream";

const AUTH_CODE_TTL_SEC = 60 * 5;
const ACCESS_TOKEN_TTL_SEC = 60 * 60;
const REFRESH_TOKEN_TTL_SEC = 60 * 60 * 24 * 30;
const UPSTREAM_STATE_TTL_SEC = 60 * 10;

const now = () => Math.floor(Date.now() / 1000);
const randomToken = () => randomBytes(32).toString("base64url");

/** 長さが違う場合も含めて一定時間で比較する */
function safeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	if (ab.length !== bb.length) return false;
	return timingSafeEqual(ab, bb);
}

export interface ProviderConfig {
	store: AuthStore;
	upstream: UpstreamClient;
	/** ALLOWED_EMAILS の生の値。空なら制限なし */
	allowedEmails?: string;
	/** 同意画面の CSRF / 承認済みクライアント Cookie に使う署名鍵 */
	cookieSecret: string;
	/** 同意画面に表示するサーバ名 */
	serverName: string;
	/**
	 * 本人の Backlog API キーを同意画面で受け取るスペース名。
	 * ヘッダを送れない GUI クライアント向けの経路。空なら入力欄を出さない。
	 */
	credentialSpaces?: string[];
	/**
	 * 封筒の暗号化に使う鍵。キーはこの鍵でしか開けない形でトークンに載る。
	 * 未設定なら封筒の経路自体を無効にする。
	 */
	envelopeSecret?: string;
}

class RegisteredClientsStore implements OAuthRegisteredClientsStore {
	constructor(private readonly store: AuthStore) {}

	async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
		return this.store.getClient(clientId);
	}

	async registerClient(
		client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">,
	): Promise<OAuthClientInformationFull> {
		const full: OAuthClientInformationFull = {
			...client,
			client_id: randomBytes(16).toString("base64url"),
			client_id_issued_at: now(),
		};
		await this.store.putClient(full);
		return full;
	}
}

export class McpOAuthProvider implements OAuthServerProvider {
	readonly clientsStore: OAuthRegisteredClientsStore;

	constructor(private readonly config: ProviderConfig) {
		this.clientsStore = new RegisteredClientsStore(config.store);
	}

	/**
	 * 手順1: 同意を取ってから上流 IdP へリダイレクトする。
	 *
	 * SDK は client_id と redirect_uri を検証したうえでこのメソッドを呼ぶため、
	 * ここで表示する値は検証済み。未承認なら同意画面を出し、フォームは同じ
	 * /authorize へ POST し直す (SDK は POST も受け付け、req.body から
	 * パラメータを読む)。2 周目は CSRF を検証して承認 Cookie を発行し、
	 * そのまま上流へ進む。
	 */
	async authorize(
		client: OAuthClientInformationFull,
		params: AuthorizationParams,
		res: Response,
	): Promise<void> {
		const req = res.req;
		const key = approvalKey(client.client_id, params.redirectUri);
		const extraHeaders: string[] = [];
		const credentialSpaces = this.envelopeEnabled() ? (this.config.credentialSpaces ?? []) : [];

		// キーを入力してもらう構成では、承認済みでも同意画面を飛ばせない。
		// キーはサーバに残らないため、認可のたびに本人から受け取る必要がある。
		const mustAskForKeys = credentialSpaces.length > 0;
		if (mustAskForKeys || !isClientApproved(req, key, this.config.cookieSecret)) {
			if (req.method === "POST") {
				// 同意画面からの POST。CSRF を検証して承認を記録する。
				if (!validateCsrfToken(req)) {
					res.status(400).json({
						error: "invalid_request",
						error_description: "CSRF token missing or mismatched",
					});
					return;
				}
				extraHeaders.push(
					approvedClientsCookie(req, key, this.config.cookieSecret),
					clearCsrfCookie,
				);
				// 入力されたキーを封じ、ブラウザに預けて上流 IdP を往復させる。
				// サーバ側には保存しない。
				const entered = collectCredentialFields(
					(field) => {
						const body = req.body as Record<string, unknown> | undefined;
						const value = body?.[field];
						return typeof value === "string" ? value : undefined;
					},
					credentialSpaces,
					CREDENTIAL_FIELD_PREFIX,
				);
				if (Object.keys(entered).length > 0) {
					extraHeaders.push(
						envelopeCookie(
							await sealCredentials(entered, this.config.envelopeSecret as string),
						),
					);
				}
			} else {
				// 未承認の GET。同意画面を出して終わる (上流へは進まない)。
				const { token, setCookie } = issueCsrfToken();
				res.setHeader("Set-Cookie", setCookie);
				res.setHeader("X-Frame-Options", "DENY");
				res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
				renderApprovalDialog(res, {
					serverName: this.config.serverName,
					clientName: client.client_name,
					redirectUri: params.redirectUri,
					// 元のクエリをそのまま hidden で持ち回す。SDK が POST 側でも
					// 同じ検証を行うため、ここで値を作り替えない。
					params: Object.fromEntries(
						Object.entries(req.query).filter(
							(e): e is [string, string] => typeof e[1] === "string",
						),
					),
					csrfToken: token,
					actionPath: req.originalUrl.split("?")[0],
					credentialSpaces,
				});
				return;
			}
		}

		const state = randomToken();
		const { verifier, challenge } = createPkcePair();

		await this.config.store.putUpstreamState({
			state,
			clientId: client.client_id,
			redirectUri: params.redirectUri,
			codeChallenge: params.codeChallenge,
			scopes: params.scopes ?? [],
			mcpState: params.state,
			resource: params.resource?.toString(),
			upstreamCodeVerifier: verifier,
			expiresAt: now() + UPSTREAM_STATE_TTL_SEC,
		});

		if (extraHeaders.length > 0) {
			res.setHeader("Set-Cookie", extraHeaders);
		}
		res.redirect(this.config.upstream.buildAuthorizeUrl(state, challenge));
	}

	/**
	 * 手順3: 上流 IdP からのコールバック。
	 * 戻り値は MCP クライアントへリダイレクトすべき URL。
	 */
	async handleUpstreamCallback(code: string, state: string, sealed?: string): Promise<string> {
		const pending = await this.config.store.takeUpstreamState(state);
		if (!pending) {
			throw new Error("Unknown or expired state");
		}

		const tokens = await this.config.upstream.exchangeCode(code, pending.upstreamCodeVerifier);
		const identity = await this.config.upstream.verifyIdToken(tokens.id_token);

		// 許可リストの判定は core と同じロジックを使う
		const allowed = parseAllowedEmails(this.config.allowedEmails);
		if (isAccessDenied(allowed, identity.email)) {
			const denied = new URL(pending.redirectUri);
			denied.searchParams.set("error", "access_denied");
			denied.searchParams.set(
				"error_description",
				`User ${identity.email} is not authorized to use this MCP server.`,
			);
			if (pending.mcpState) denied.searchParams.set("state", pending.mcpState);
			return denied.toString();
		}

		const authCode = randomToken();
		await this.config.store.putAuthCode({
			code: authCode,
			clientId: pending.clientId,
			redirectUri: pending.redirectUri,
			codeChallenge: pending.codeChallenge,
			scopes: pending.scopes,
			userEmail: identity.email,
			userId: identity.sub,
			resource: pending.resource,
			expiresAt: now() + AUTH_CODE_TTL_SEC,
		});

		// 保存したのは識別子だけ。封筒はコード文字列に載せてクライアントへ渡す。
		const redirect = new URL(pending.redirectUri);
		redirect.searchParams.set("code", attach(authCode, this.envelopeEnabled() ? sealed : undefined));
		if (pending.mcpState) redirect.searchParams.set("state", pending.mcpState);
		return redirect.toString();
	}

	/** SDK が PKCE 検証のために呼ぶ */
	async challengeForAuthorizationCode(
		client: OAuthClientInformationFull,
		authorizationCode: string,
	): Promise<string> {
		const rec = await this.config.store.peekAuthCode(detach(authorizationCode).id);
		if (!rec || rec.clientId !== client.client_id) {
			throw new Error("Invalid authorization code");
		}
		return rec.codeChallenge;
	}

	/** 手順4: 認可コードをトークンに交換する */
	async exchangeAuthorizationCode(
		client: OAuthClientInformationFull,
		authorizationCode: string,
		codeVerifier?: string,
		redirectUri?: string,
	): Promise<OAuthTokens> {
		const { id, sealed } = detach(authorizationCode);
		const rec = await this.config.store.takeAuthCode(id);
		if (!rec || rec.clientId !== client.client_id) {
			throw new Error("Invalid authorization code");
		}
		if (redirectUri !== undefined && !safeEqual(redirectUri, rec.redirectUri)) {
			throw new Error("redirect_uri does not match the authorization request");
		}
		// SDK 側でも PKCE を検証するが、skipLocalPkceValidation を将来変えても
		// 破綻しないようここでも確認する
		if (codeVerifier !== undefined) {
			const challenge = createHash("sha256").update(codeVerifier).digest("base64url");
			if (!safeEqual(challenge, rec.codeChallenge)) {
				throw new Error("code_verifier does not match code_challenge");
			}
		}
		return this.issueTokens(rec.clientId, rec.scopes, rec.userEmail, rec.userId, rec.resource, sealed);
	}

	async exchangeRefreshToken(
		client: OAuthClientInformationFull,
		refreshToken: string,
		scopes?: string[],
	): Promise<OAuthTokens> {
		const { id, sealed } = detach(refreshToken);
		const rec = await this.config.store.getToken(id);
		if (!rec || rec.kind !== "refresh" || rec.clientId !== client.client_id) {
			throw new Error("Invalid refresh token");
		}
		// リフレッシュトークンは使い捨てにする (ローテーション)
		await this.config.store.deleteToken(id);

		// スコープの拡大は認めない
		const requested = scopes ?? rec.scopes;
		const widened = requested.filter((s) => !rec.scopes.includes(s));
		if (widened.length > 0) {
			throw new Error(`Cannot widen scope: ${widened.join(", ")}`);
		}
		// 封筒は新しいトークンへ引き継ぐ。ここで落とすと、GUI クライアントは
		// リフレッシュのたびにキーを再入力する羽目になる。
		return this.issueTokens(rec.clientId, requested, rec.userEmail, rec.userId, rec.resource, sealed);
	}

	async verifyAccessToken(token: string): Promise<AuthInfo> {
		const { id, sealed } = detach(token);
		const rec = await this.config.store.getToken(id);
		if (!rec || rec.kind !== "access") {
			throw new Error("Invalid or expired access token");
		}
		// 封筒はこのリクエストの間だけ開く。開いた中身は保存しない。
		const userKeys =
			sealed && this.envelopeEnabled()
				? await openCredentials(sealed, this.config.envelopeSecret as string)
				: undefined;
		return {
			token,
			clientId: rec.clientId,
			scopes: rec.scopes,
			expiresAt: rec.expiresAt,
			extra: { userEmail: rec.userEmail, userId: rec.userId, userKeys },
		};
	}

	async revokeToken(
		client: OAuthClientInformationFull,
		request: OAuthTokenRevocationRequest,
	): Promise<void> {
		const id = detach(request.token).id;
		const rec = await this.config.store.getToken(id);
		// 他クライアントのトークンは失効させない
		if (rec && rec.clientId === client.client_id) {
			await this.config.store.deleteToken(id);
		}
	}

	/** 封筒の経路が使える構成か */
	private envelopeEnabled(): boolean {
		return Boolean(this.config.envelopeSecret);
	}

	private async issueTokens(
		clientId: string,
		scopes: string[],
		userEmail: string,
		userId: string,
		resource?: string,
		sealed?: string,
	): Promise<OAuthTokens> {
		const accessToken = randomToken();
		const refreshToken = randomToken();
		const issuedAt = now();

		// 保存するのは識別子のみ。封筒はクライアントが持つトークン文字列にだけ載る。
		await this.config.store.putToken({
			token: accessToken,
			kind: "access",
			clientId,
			scopes,
			userEmail,
			userId,
			resource,
			expiresAt: issuedAt + ACCESS_TOKEN_TTL_SEC,
		});
		await this.config.store.putToken({
			token: refreshToken,
			kind: "refresh",
			clientId,
			scopes,
			userEmail,
			userId,
			resource,
			expiresAt: issuedAt + REFRESH_TOKEN_TTL_SEC,
		});

		const carry = this.envelopeEnabled() ? sealed : undefined;
		return {
			access_token: attach(accessToken, carry),
			token_type: "bearer",
			expires_in: ACCESS_TOKEN_TTL_SEC,
			refresh_token: attach(refreshToken, carry),
			scope: scopes.join(" "),
		};
	}
}
