// platforms/aws/handler.ts
// Lambda Function URL のエントリポイント。
// 設定は環境変数から読む (SAM テンプレートが注入する)。

import serverlessExpress from "serverless-http";
import { createApp } from "./app";
import { DynamoOAuthProvider } from "./auth/provider";
import { DynamoAuthStore } from "./auth/store";
import { createUpstreamClient } from "./auth/upstream";

function required(name: string): string {
	const v = process.env[name];
	if (!v) throw new Error(`Environment variable ${name} is required`);
	return v;
}

const issuerUrl = new URL(required("ISSUER_URL"));
const store = new DynamoAuthStore(required("AUTH_TABLE_NAME"));

const provider = new DynamoOAuthProvider({
	store,
	allowedEmails: process.env.ALLOWED_EMAILS,
	upstream: createUpstreamClient({
		domain: required("UPSTREAM_DOMAIN"),
		clientId: required("UPSTREAM_CLIENT_ID"),
		clientSecret: process.env.UPSTREAM_CLIENT_SECRET || undefined,
		issuer: required("UPSTREAM_ISSUER"),
		redirectUri: new URL("/callback", issuerUrl).toString(),
	}),
});

const app = createApp({
	provider,
	issuerUrl,
	spacesConfig: process.env.BACKLOG_SPACES_CONFIG ?? "",
	allowedEmails: process.env.ALLOWED_EMAILS,
});

export const handler = serverlessExpress(app);
