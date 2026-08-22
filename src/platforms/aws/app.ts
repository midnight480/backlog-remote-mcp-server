// platforms/aws/app.ts
// AWS Lambda 向けの HTTP アプリ本体 (Express)。
//
// MCP SDK の OAuth 認可サーバ実装 (mcpAuthRouter) が Express 前提のため、
// AWS 側は Express で組む。認可サーバを自前実装すると PKCE・トークン交換・
// 動的クライアント登録まで自作することになり、correctness リスクが高い。
//
// Durable Object 相当の仕組みが無いため MCP はステートレスで動かす。
// 現状の全ツールはリクエスト/レスポンス型でサーバ発の push を使っていない。

import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import express, { type Request, type Response } from "express";
import { createMcpServer, SERVER_NAME, SERVER_VERSION } from "../../core/create-server";
import type { DynamoOAuthProvider } from "./auth/provider";
import { toWebRequest, writeWebResponse } from "./web-bridge";

export interface AppConfig {
	provider: DynamoOAuthProvider;
	/** このサーバの公開 URL (issuer)。例: https://xxx.lambda-url.ap-northeast-1.on.aws */
	issuerUrl: URL;
	/** BACKLOG_SPACES_CONFIG の生の値 */
	spacesConfig: string;
	/** ALLOWED_EMAILS の生の値 */
	allowedEmails?: string;
}

export function createApp(config: AppConfig) {
	const app = express();
	app.use(express.json({ limit: "4mb" }));
	app.use(express.urlencoded({ extended: false }));

	app.get("/health", (_req, res) => {
		res.json({ status: "ok", server: SERVER_NAME, version: SERVER_VERSION });
	});

	// /authorize /token /register /revoke /.well-known/* を提供する
	app.use(
		mcpAuthRouter({
			provider: config.provider,
			issuerUrl: config.issuerUrl,
			resourceServerUrl: new URL("/mcp", config.issuerUrl),
			resourceName: SERVER_NAME,
			scopesSupported: ["openid"],
		}),
	);

	// 上流 IdP (Cognito) からのコールバック
	app.get("/callback", async (req: Request, res: Response) => {
		const { code, state, error, error_description } = req.query;
		if (typeof error === "string") {
			res
				.status(400)
				.json({ error, error_description: String(error_description ?? "") });
			return;
		}
		if (typeof code !== "string" || typeof state !== "string") {
			res.status(400).json({ error: "invalid_request", error_description: "Missing code or state" });
			return;
		}
		try {
			const redirectTo = await config.provider.handleUpstreamCallback(code, state);
			res.redirect(redirectTo);
		} catch (e) {
			console.error("callback failed:", e);
			res.status(400).json({
				error: "invalid_request",
				error_description: e instanceof Error ? e.message : "Callback failed",
			});
		}
	});

	const requireAuth = requireBearerAuth({ verifier: config.provider });

	app.all("/mcp", requireAuth, async (req: Request, res: Response) => {
		// requireBearerAuth が検証済みの情報を req.auth に載せる
		const userEmail = (req.auth?.extra?.userEmail as string | undefined) ?? "";

		const server = createMcpServer({
			spacesConfig: config.spacesConfig,
			allowedEmails: config.allowedEmails,
			userEmail,
		});
		// sessionIdGenerator: undefined でステートレスモードになる
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
		});

		res.on("close", () => {
			transport.close().catch(() => {});
			server.close().catch(() => {});
		});

		try {
			await server.connect(transport);
			const webReq = toWebRequest(req, config.issuerUrl.origin);
			const webRes = await transport.handleRequest(webReq);
			await writeWebResponse(res, webRes);
		} catch (e) {
			console.error("mcp request failed:", e);
			if (!res.headersSent) {
				res.status(500).json({
					jsonrpc: "2.0",
					error: { code: -32603, message: "Internal server error" },
					id: null,
				});
			}
		}
	});

	return app;
}
