// 利用者本人のキーが、ツール呼び出しを通って実際に Backlog への発信リクエストへ
// 乗るところまでを通しで検証する。
//
// credentials.test.mts が見ているのは解析と重ね合わせまでで、「MCP のツールを
// 実際に呼んだとき、そのリクエストで指定したキーが Backlog に届くか」は
// 組み立て側の問題として残る。ここではその 1 本を確かめる。
//
// ここで組み立てる server + transport は、各プラットフォームの入口
// (src/oauth/app.ts と src/platforms/cloudflare/index.ts) がリクエストごとに
// 作っているものと同じ。ヘッダから UserApiKeys への変換だけが実行環境側にあり、
// それは credentials.test.mts が見ている。
//   npm run test:user-keys

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "../src/core/create-server.ts";
import { parseApiKeyHeaders, parseClientSpaces } from "../src/core/credentials.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { console.log(`  ${c ? "OK " : "NG "} ${n}${e}`); c ? pass++ : fail++; };

const SPACES = JSON.stringify({
  spaces: [
    { name: "WORK", domain: "work.backlog.com" },
    { name: "SHARED", domain: "shared.backlog.jp", apiKey: "server-shared-key" },
  ],
  defaultSpace: "WORK",
});
const ALLOWED = JSON.stringify(["user@example.com"]);

/** Backlog への発信を捕まえ、実際には飛ばさない */
function stubBacklog() {
  const urls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    urls.push(typeof input === "string" ? input : input.url);
    return new Response(JSON.stringify({ spaceKey: "stub" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { urls, restore: () => { globalThis.fetch = original; } };
}

/**
 * 各プラットフォームの /mcp と同じ手順でツールを 1 回呼ぶ。
 * 戻り値は捕まえた Backlog への URL と、MCP の応答。
 */
async function callTool(opts: {
  headers?: { single?: string; list?: string; spaces?: string };
  userEmail?: string;
  args?: Record<string, unknown>;
  spacesConfig?: string;
}) {
  const server = createMcpServer({
    spacesConfig: opts.spacesConfig ?? SPACES,
    allowedEmails: ALLOWED,
    userEmail: opts.userEmail ?? "user@example.com",
    userKeys: parseApiKeyHeaders(opts.headers?.single, opts.headers?.list),
    clientSpaces: opts.headers?.spaces ? parseClientSpaces(opts.headers.spaces) : undefined,
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);

  const stub = stubBacklog();
  try {
    const res = await transport.handleRequest(
      new Request("https://mcp.example.com/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "get_space", arguments: opts.args ?? {} },
        }),
      }),
    );
    const body: any = await res.json();
    return { urls: stub.urls, body, status: res.status };
  } finally {
    stub.restore();
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

const bodyText = (body: any) => JSON.stringify(body);
const apiKeyOf = (urls: string[]) =>
  urls.length ? new URL(urls[0]).searchParams.get("apiKey") : null;

console.log("ヘッダのキーが Backlog まで届くか:");
{
  const r = await callTool({ headers: { single: "my-own-key" }, args: { space: "WORK" } });
  ok("Backlog を 1 回呼ぶ", r.urls.length === 1, ` (${r.urls.length} 回)`);
  ok("宛先はそのスペース", r.urls[0]?.startsWith("https://work.backlog.com/api/v2/space"), ` (${r.urls[0]})`);
  ok("本人のキーが渡る", apiKeyOf(r.urls) === "my-own-key", ` (${apiKeyOf(r.urls)})`);
}

console.log("複数スペース指定:");
{
  const r = await callTool({ headers: { list: "SHARED=shared-own-key" }, args: { space: "SHARED" } });
  ok("共有キーより本人のキーが優先", apiKeyOf(r.urls) === "shared-own-key", ` (${apiKeyOf(r.urls)})`);
}

console.log("ヘッダを送らない場合:");
{
  const r = await callTool({ args: { space: "SHARED" } });
  ok("設定の共有キーを使う", apiKeyOf(r.urls) === "server-shared-key", ` (${apiKeyOf(r.urls)})`);
}

console.log("キーがどこにも無いスペース:");
{
  const r = await callTool({ args: { space: "WORK" } });
  ok("Backlog を呼ばない", r.urls.length === 0, ` (${r.urls.length} 回)`);
  ok("設定方法を案内する", bodyText(r.body).includes("X-Backlog-Api-Key"),
    ` ${bodyText(r.body).slice(0, 140)}`);
}

console.log("キーは応答に漏れないか:");
{
  const server = createMcpServer({
    spacesConfig: SPACES,
    allowedEmails: ALLOWED,
    userEmail: "user@example.com",
    userKeys: parseApiKeyHeaders("my-own-key", undefined),
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const res = await transport.handleRequest(
    new Request("https://mcp.example.com/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "tools/call",
        params: { name: "list_spaces", arguments: {} },
      }),
    }),
  );
  const body = JSON.stringify(await res.json());
  await transport.close().catch(() => {});
  await server.close().catch(() => {});

  // 単一キーヘッダはデフォルトスペース (WORK) に当たるので WORK=user、
  // 設定に共有キーを持つ SHARED=server になる。
  const spaces: any[] = JSON.parse(JSON.parse(body).result.content[0].text);
  const credOf = (name: string) => spaces.find((s) => s.name === name)?.credential;
  ok("list_spaces にキーの値が出ない", !body.includes("my-own-key"));
  ok("本人のキーは user と報告", credOf("WORK") === "user", ` (${credOf("WORK")})`);
  ok("共有キーは server と報告", credOf("SHARED") === "server", ` (${credOf("SHARED")})`);
}

console.log("キーがどこにも無いスペースの表示:");
{
  const r = await callTool({ args: {} });  // ヘッダなし。WORK は共有キーも持たない
  // get_space は WORK で失敗するが、list_spaces の表示だけ別途確かめる
  const server = createMcpServer({ spacesConfig: SPACES, allowedEmails: ALLOWED, userEmail: "user@example.com" });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, enableJsonResponse: true,
  });
  await server.connect(transport);
  const res = await transport.handleRequest(
    new Request("https://mcp.example.com/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_spaces", arguments: {} } }),
    }),
  );
  const spaces: any[] = JSON.parse((await res.json() as any).result.content[0].text);
  await transport.close().catch(() => {});
  await server.close().catch(() => {});
  ok("キーが無ければ missing", spaces.find((s) => s.name === "WORK")?.credential === "missing",
    ` (${spaces.find((s) => s.name === "WORK")?.credential})`);
  ok("呼び出しは失敗している", r.urls.length === 0);
}

console.log("クライアントが宣言したスペース:");
{
  const BYO = JSON.stringify({ spaces: [], allowClientSpaces: true });
  const r = await callTool({
    spacesConfig: BYO,
    headers: { spaces: "MINE=mine.backlog.jp", list: "MINE=my-key" },
    args: { space: "MINE" },
  });
  ok("宣言したホストへ飛ぶ", r.urls[0]?.startsWith("https://mine.backlog.jp/api/v2/space"), ` (${r.urls[0]})`);
  ok("本人のキーが渡る", apiKeyOf(r.urls) === "my-key", ` (${apiKeyOf(r.urls)})`);
}
{
  // 許可外ドメインはサーバの組み立て時点で弾かれる。ツール呼び出しまで到達せず、
  // 各プラットフォームの入口が InvalidCredentialError を 400 に変換する。
  const BYO = JSON.stringify({ spaces: [], allowClientSpaces: true });
  const stub = stubBacklog();
  let message = "";
  try {
    await callTool({
      spacesConfig: BYO,
      headers: { spaces: "MINE=169.254.169.254", list: "MINE=my-key" },
      args: { space: "MINE" },
    });
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  } finally {
    stub.restore();
  }
  ok("許可外ホストは組み立て時点で拒否", message.length > 0);
  ok("Backlog へは 1 回も出さない", stub.urls.length === 0, ` (${stub.urls.length} 回)`);
  ok("理由を伝える", message.includes("169.254.169.254"), ` ${message.slice(0, 100)}`);
}

console.log("認可されていない利用者:");
{
  const r = await callTool({ headers: { single: "my-own-key" }, userEmail: "intruder@example.com" });
  // 許可リスト外にはツールを登録しないため、キーを送っても Backlog へは届かない
  ok("Backlog を呼ばない", r.urls.length === 0, ` (${r.urls.length} 回)`);
  ok("get_space を実行できない", !bodyText(r.body).includes("stub"), ` ${bodyText(r.body).slice(0, 140)}`);
}

console.log("\n" + (fail ? "NG" : "OK") + ` pass=${pass} fail=${fail}`);
if (fail) process.exit(1);
