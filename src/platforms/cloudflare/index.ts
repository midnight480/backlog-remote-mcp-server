// platforms/cloudflare/index.ts
// Cloudflare Workers 向けエントリポイント。
//
// このファイルの責務は「Workers 固有の配線」に限る:
//   - OAuthProvider (workers-oauth-provider) のセットアップ
//   - Backlog の資格情報を OAuthProvider に渡さないための出し入れ
//   - env / props / ヘッダから設定値を取り出して core へ渡す
// ツールの実装と認可判定は src/core/create-server.ts にある。
//
// なぜ Durable Object (McpAgent) を使わないか:
//   McpAgent はセッションごとに DO を持ち、init() で一度だけツールを登録する。
//   その際 props を ctx.storage へ書き込んで永続化するため、利用者本人の
//   Backlog API キーを props 経由で渡すと DO のストレージに残ってしまう。
//   このサーバは Backlog の資格情報を保存しない方針なので、リクエストごとに
//   サーバを組み立てる createMcpHandler を使う。現状の全ツールはリクエスト/
//   レスポンス型でサーバ発の push を使っておらず、セッション状態を必要としない。
//   結果として AWS / Google Cloud / Azure 版 (src/oauth/app.ts) と同じ形になる。
//
// なぜ OAuthProvider を包むか:
//   OAuthProvider はトークンの形式を握っており、認可に紐づけたデータ (props) は
//   必ず暗号化して KV に保存する。OAuth のトークン自体を保存するのは構わないが、
//   Backlog のキーは保存したくない。そこで、キーを封じた「封筒」を
//   OAuthProvider には一切渡さず、その手前で出し入れする:
//     /token ... 要求から封筒を外して委譲し、発行されたトークンに付け直す
//     /mcp   ... Authorization ヘッダから外して委譲し、中身は apiHandler へ渡す
//   これにより KV に載るのは OAuth の情報だけになる。
//   封筒の運び方そのものは src/core/credential-envelope.ts を参照。

import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp";
import { createMcpServer } from "../../core/create-server";
import {
	attachEnvelopeToTokenResponse,
	INTERNAL_ENVELOPE_HEADER,
	moveEnvelopeToInternalHeader,
	openCredentials,
	stripEnvelopeFromTokenRequest,
} from "../../core/credential-envelope";
import {
	API_KEY_HEADER,
	API_KEYS_HEADER,
	InvalidCredentialError,
	parseApiKeyHeaders,
	type UserApiKeys,
} from "../../core/credentials";
import { handleAccessRequest } from "./access-handler";
import type { Props } from "./workers-oauth-utils";

const mcpHandler = {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		// OAuthProvider は検証済みの認可情報を ctx.props に載せて渡してくる
		const props = ctx.props as Props | undefined;

		// 運搬経路は2つある。ヘッダを送れるクライアントはヘッダで、
		// 送れない GUI クライアントはトークンに封じた封筒で運ぶ。
		// 両方あるときは、接続ごとに明示されるヘッダを優先する。
		const sealed = request.headers.get(INTERNAL_ENVELOPE_HEADER);
		const fromToken: UserApiKeys = sealed
			? ((await openCredentials(sealed, env.COOKIE_ENCRYPTION_KEY)) ?? {})
			: {};

		let server: ReturnType<typeof createMcpServer>;
		try {
			const fromHeaders = parseApiKeyHeaders(
				request.headers.get(API_KEY_HEADER) ?? undefined,
				request.headers.get(API_KEYS_HEADER) ?? undefined,
			);
			server = createMcpServer({
				spacesConfig: env.BACKLOG_SPACES_CONFIG,
				allowedEmails: env.ALLOWED_EMAILS,
				userEmail: props?.email,
				userKeys: [fromToken, fromHeaders],
			});
		} catch (e) {
			// 設定ミスは利用者が直せるものなので、そのまま伝える。
			// キーの値は載せない (InvalidCredentialError は位置しか報告しない)。
			if (e instanceof InvalidCredentialError) {
				return Response.json(
					{ jsonrpc: "2.0", error: { code: -32602, message: e.message }, id: null },
					{ status: 400 },
				);
			}
			throw e;
		}

		try {
			return await createMcpHandler(server, {
				route: "/mcp",
				// sessionIdGenerator: undefined でステートレスモードになる。
				// 応答も SSE ではなく単発の JSON にする (src/oauth/app.ts と同じ理由)。
				sessionIdGenerator: undefined,
				enableJsonResponse: true,
			})(request, env, ctx);
		} finally {
			// リクエストごとに作ったサーバは明示的に閉じる。
			await server.close().catch(() => {});
		}
	},
};

const provider = new OAuthProvider({
	apiRoute: "/mcp",
	apiHandler: mcpHandler,
	defaultHandler: { fetch: handleAccessRequest as any },
	authorizeEndpoint: "/authorize",
	tokenEndpoint: "/token",
	clientRegistrationEndpoint: "/register",
});

/** Content-Length は本文を作り替えると合わなくなるので落とす */
function headersWithoutLength(source: Headers): Headers {
	const headers = new Headers(source);
	headers.delete("content-length");
	return headers;
}

/**
 * /token: 要求から封筒を外して OAuthProvider に委譲し、
 * 発行されたトークンへ付け直す。OAuthProvider は封筒を一度も見ない。
 */
export async function handleTokenRequest(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	if (request.method !== "POST") return provider.fetch(request, env, ctx);

	let form: FormData;
	try {
		form = await request.clone().formData();
	} catch {
		// 形式が違えば OAuthProvider 側でエラーにさせる
		return provider.fetch(request, env, ctx);
	}

	const sealed = stripEnvelopeFromTokenRequest(form);
	if (!sealed) return provider.fetch(request, env, ctx);

	const body = new URLSearchParams();
	for (const [key, value] of form) body.set(key, String(value));

	const response = await provider.fetch(
		new Request(request.url, {
			method: "POST",
			headers: headersWithoutLength(request.headers),
			body,
		}),
		env,
		ctx,
	);
	if (!response.ok) return response;

	let issued: Record<string, unknown>;
	try {
		issued = (await response.clone().json()) as Record<string, unknown>;
	} catch {
		return response;
	}
	return new Response(JSON.stringify(attachEnvelopeToTokenResponse(issued, sealed)), {
		status: response.status,
		headers: headersWithoutLength(response.headers),
	});
}

/**
 * /mcp: Authorization ヘッダから封筒を外して OAuthProvider に委譲する。
 * OAuthProvider には識別子だけが渡り、封筒は内部ヘッダで apiHandler へ回す。
 */
export function handleApiRequest(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	const headers = new Headers(request.headers);
	moveEnvelopeToInternalHeader(headers);
	return provider.fetch(new Request(request, { headers }), env, ctx);
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const { pathname } = new URL(request.url);
		if (pathname === "/token") return handleTokenRequest(request, env, ctx);
		if (pathname === "/mcp") return handleApiRequest(request, env, ctx);
		return provider.fetch(request, env, ctx);
	},
};
