// ヘッダを送れない GUI クライアント向けの「封筒」経路を検証する。
//
// この経路の要点は 1 つだけで、それは「サーバ側の保存先に Backlog のキーが
// 一度も現れないこと」である。同意画面 → Cookie → 認可コード → トークン、と
// 運ばれる間、AuthStore に入るのは常に識別子だけでなければならない。
//
// ここでは本物の AuthStore の代わりに、書き込まれた内容を全部覚えておく
// スパイを差し込み、最後に「キーの文字列がどこにも書かれていない」ことを見る。
//   npm run test:envelope

import {
  attach, attachEnvelopeToTokenResponse, clearEnvelopeCookie, detach, envelopeCookie,
  INTERNAL_ENVELOPE_HEADER, moveEnvelopeToInternalHeader, openCredentials,
  readEnvelopeCookie, sealCredentials, stripEnvelopeFromTokenRequest,
} from "../src/core/credential-envelope.ts";
import { McpOAuthProvider } from "../src/oauth/provider.ts";
import type { AuthStore } from "../src/oauth/store.ts";
import { CREDENTIAL_FIELD_PREFIX, renderApprovalDialog } from "../src/oauth/consent.ts";

const SECRET = "test-envelope-secret-0123456789abcdef";
const USER_KEY = "backlog-key-do-not-store-me";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { console.log(`  ${c ? "OK " : "NG "} ${n}${e}`); c ? pass++ : fail++; };

console.log("封をする / 開ける:");
{
  const sealed = await sealCredentials({ work: USER_KEY }, SECRET);
  ok("封筒に平文が現れない", !sealed.includes(USER_KEY));
  ok("同じ鍵で開ける", (await openCredentials(sealed, SECRET))?.work === USER_KEY);
  ok("違う鍵では開かない", (await openCredentials(sealed, "another-secret-0123456789abcdef")) === undefined);
  ok("毎回異なる暗号文", (await sealCredentials({ work: USER_KEY }, SECRET)) !== sealed);

  // AES-GCM の認証タグが効いているか。1 文字変えたら開かない。
  const flipped = sealed.slice(0, -2) + (sealed.slice(-2, -1) === "A" ? "B" : "A") + sealed.slice(-1);
  ok("改竄した封筒は開かない", (await openCredentials(flipped, SECRET)) === undefined);
  ok("壊れた入力でも例外を投げない", (await openCredentials("not-base64url!!", SECRET)) === undefined);
  ok("空文字でも例外を投げない", (await openCredentials("", SECRET)) === undefined);
}

console.log("識別子と封筒の連結:");
{
  const sealed = await sealCredentials({ work: USER_KEY }, SECRET);
  const token = attach("abc123", sealed);
  ok("識別子を取り出せる", detach(token).id === "abc123");
  ok("封筒を取り出せる", detach(token).sealed === sealed);
  ok("封筒なしでもそのまま", detach(attach("abc123", undefined)).id === "abc123");
  ok("封筒なしなら sealed は undefined", detach("abc123").sealed === undefined);
  // 区切りは base64url に出てこない文字なので、識別子の切り出しは常に一意
  ok("識別子に区切りが混ざらない", !"abc123".includes("~") && !sealed.includes("~"));
}

console.log("Cookie:");
{
  const c = envelopeCookie("sealed-value");
  ok("__Host- 接頭辞", c.startsWith("__Host-BACKLOG_CREDENTIALS="));
  ok("HttpOnly/Secure/SameSite", c.includes("HttpOnly") && c.includes("Secure") && c.includes("SameSite=Lax"));
  ok("寿命は短い", /Max-Age=600\b/.test(c));
  ok("破棄用は Max-Age=0", /Max-Age=0\b/.test(clearEnvelopeCookie));
  ok("Cookie から読める",
    readEnvelopeCookie("__Host-BACKLOG_CREDENTIALS=sealed-value") === "sealed-value");
  ok("他の Cookie に混ざっていても読める",
    readEnvelopeCookie("a=1; __Host-BACKLOG_CREDENTIALS=sealed-value; b=2") === "sealed-value");
  ok("無ければ undefined", readEnvelopeCookie("a=1") === undefined);
  ok("ヘッダ自体が無くても undefined", readEnvelopeCookie(undefined) === undefined);
}

console.log("同意画面の入力欄:");
{
  const html = (spaces?: string[]) => {
    let out = "";
    const res = {
      status: () => res, type: () => res, setHeader() {},
      send: (b: string) => { out = b; },
    } as any;
    renderApprovalDialog(res, {
      serverName: "S", clientName: "C", redirectUri: "https://ok.example/cb",
      params: {}, csrfToken: "t", actionPath: "/authorize", credentialSpaces: spaces,
    });
    return out;
  };
  ok("スペースごとに欄が出る", html(["WORK", "SHARED"]).includes(`name="${CREDENTIAL_FIELD_PREFIX}WORK"`));
  ok("入力は伏字", html(["WORK"]).includes('type="password"'));
  ok("保存しない旨を明示", html(["WORK"]).includes("does not store"));
  ok("未指定なら欄を出さない", !html(undefined).includes(CREDENTIAL_FIELD_PREFIX));
  ok("空配列でも欄を出さない", !html([]).includes(CREDENTIAL_FIELD_PREFIX));
  // スペース名は設定由来だが、エスケープの回帰を防ぐ
  ok("スペース名をエスケープ", html(['<img src=x>']).includes("&lt;img src=x&gt;"));
}

// --- 保存先に何が書かれるかを全部覚えておくスパイ ---
function spyStore() {
  const writes: string[] = [];
  const codes = new Map<string, any>();
  const tokens = new Map<string, any>();
  const states = new Map<string, any>();
  const record = (v: unknown) => { writes.push(JSON.stringify(v)); };
  const store: AuthStore = {
    async getClient() { return { client_id: "client-A", redirect_uris: ["https://ok.example/cb"] } as any; },
    async putClient(c) { record(c); },
    async putUpstreamState(r) { record(r); states.set(r.state, r); },
    async takeUpstreamState(s) { const r = states.get(s); states.delete(s); return r; },
    async putAuthCode(r) { record(r); codes.set(r.code, r); },
    async peekAuthCode(c) { return codes.get(c); },
    async takeAuthCode(c) { const r = codes.get(c); codes.delete(c); return r; },
    async putToken(r) { record(r); tokens.set(r.token, r); },
    async getToken(t) { return tokens.get(t); },
    async deleteToken(t) { tokens.delete(t); },
  };
  return { store, writes, tokens };
}

console.log("認可サーバの手前での出し入れ (Cloudflare 版のラッパ):");
{
  const sealed = await sealCredentials({ work: USER_KEY }, SECRET);

  // トークン要求: code から封筒を外し、他のフィールドは触らない
  const form = new FormData();
  form.set("grant_type", "authorization_code");
  form.set("code", attach("code-id", sealed));
  form.set("code_verifier", "verifier-value");
  ok("code から封筒を外す", stripEnvelopeFromTokenRequest(form) === sealed);
  ok("code は識別子だけになる", form.get("code") === "code-id");
  ok("他のフィールドは残る",
    form.get("grant_type") === "authorization_code" && form.get("code_verifier") === "verifier-value");

  // リフレッシュ要求でも拾う
  const refreshForm = new FormData();
  refreshForm.set("refresh_token", attach("refresh-id", sealed));
  ok("refresh_token からも外す", stripEnvelopeFromTokenRequest(refreshForm) === sealed);
  ok("refresh_token も識別子だけ", refreshForm.get("refresh_token") === "refresh-id");

  // 封筒が無いときは何も変えない
  const plain = new FormData();
  plain.set("code", "plain-code");
  ok("封筒が無ければ undefined", stripEnvelopeFromTokenRequest(plain) === undefined);
  ok("封筒が無ければ書き換えない", plain.get("code") === "plain-code");

  // 発行された両トークンに付け直す
  const issued = attachEnvelopeToTokenResponse(
    { access_token: "at", refresh_token: "rt", token_type: "bearer", expires_in: 3600 },
    sealed,
  );
  ok("アクセストークンに付け直す", detach(issued.access_token as string).sealed === sealed);
  ok("リフレッシュトークンにも付け直す", detach(issued.refresh_token as string).sealed === sealed);
  ok("他のフィールドは触らない", issued.token_type === "bearer" && issued.expires_in === 3600);

  // Authorization ヘッダから内部ヘッダへ移し替える
  const headers = new Headers({ authorization: `Bearer ${attach("token-id", sealed)}` });
  moveEnvelopeToInternalHeader(headers);
  ok("認可サーバには識別子だけ渡る", headers.get("authorization") === "Bearer token-id");
  ok("封筒は内部ヘッダへ", headers.get(INTERNAL_ENVELOPE_HEADER) === sealed);

  // クライアントが内部ヘッダを詐称してきても必ず捨てる
  const spoofed = new Headers({
    authorization: "Bearer plain-token",
    [INTERNAL_ENVELOPE_HEADER]: "attacker-supplied",
  });
  moveEnvelopeToInternalHeader(spoofed);
  ok("詐称された内部ヘッダを捨てる", spoofed.get(INTERNAL_ENVELOPE_HEADER) === null);
  ok("封筒なしの認可ヘッダは素通し", spoofed.get("authorization") === "Bearer plain-token");

  // 封筒付きトークンと詐称ヘッダが同時に来ても、勝つのはトークン側
  const both = new Headers({
    authorization: `Bearer ${attach("token-id", sealed)}`,
    [INTERNAL_ENVELOPE_HEADER]: "attacker-supplied",
  });
  moveEnvelopeToInternalHeader(both);
  ok("内部ヘッダはトークン由来の値で上書き", both.get(INTERNAL_ENVELOPE_HEADER) === sealed);

  // Bearer 以外は触らない
  const basic = new Headers({ authorization: "Basic dXNlcjpwYXNz" });
  moveEnvelopeToInternalHeader(basic);
  ok("Bearer 以外は素通し", basic.get("authorization") === "Basic dXNlcjpwYXNz");
}

console.log("認可フロー全体でキーが保存されないか:");
{
  const spy = spyStore();
  const provider = new McpOAuthProvider({
    store: spy.store,
    allowedEmails: JSON.stringify(["user@example.com"]),
    cookieSecret: SECRET,
    envelopeSecret: SECRET,
    credentialSpaces: ["WORK"],
    serverName: "test",
    upstream: {
      buildAuthorizeUrl: () => "https://idp.example/authorize",
      async exchangeCode() { return { id_token: "stub" } as any; },
      async verifyIdToken() { return { email: "user@example.com", sub: "user-1" }; },
    } as any,
  });

  // 同意画面で入力された想定の封筒を Cookie から受け取り、認可コードへ載せる
  const sealed = await sealCredentials({ work: USER_KEY }, SECRET);
  await spy.store.putUpstreamState({
    state: "state-1", clientId: "client-A", redirectUri: "https://ok.example/cb",
    codeChallenge: "chal", scopes: [], upstreamCodeVerifier: "ver",
    expiresAt: Math.floor(Date.now() / 1000) + 600,
  });
  const redirect = await provider.handleUpstreamCallback("upstream-code", "state-1", sealed);
  const code = new URL(redirect).searchParams.get("code") ?? "";
  ok("認可コードが封筒を運ぶ", detach(code).sealed === sealed);

  // コードをトークンに交換する
  const client = { client_id: "client-A" } as any;
  const issued = await provider.exchangeAuthorizationCode(client, code);
  ok("アクセストークンが封筒を運ぶ", detach(issued.access_token).sealed === sealed);
  ok("リフレッシュトークンも運ぶ", detach(issued.refresh_token ?? "").sealed === sealed);

  // 検証時に開けて、そのリクエストの分だけ取り出せる
  const auth = await provider.verifyAccessToken(issued.access_token);
  ok("検証で本人のキーが取れる", (auth.extra?.userKeys as any)?.work === USER_KEY);
  ok("メールも従来どおり取れる", auth.extra?.userEmail === "user@example.com");

  // リフレッシュしても封筒は引き継がれる
  const refreshed = await provider.exchangeRefreshToken(client, issued.refresh_token ?? "");
  ok("リフレッシュ後も封筒が残る", detach(refreshed.access_token).sealed === sealed);
  const auth2 = await provider.verifyAccessToken(refreshed.access_token);
  ok("リフレッシュ後も開ける", (auth2.extra?.userKeys as any)?.work === USER_KEY);

  // ここが本題。保存先に書かれた全内容にキーも封筒も現れてはならない。
  const everythingWritten = spy.writes.join("\n");
  ok("保存内容にキーの平文が無い", !everythingWritten.includes(USER_KEY));
  ok("保存内容に封筒も無い", !everythingWritten.includes(sealed));
  ok("保存されたトークンは識別子のみ",
    [...spy.tokens.keys()].every((t) => !t.includes("~")), ` (${[...spy.tokens.keys()].length} 件)`);

  // 封筒を落としたトークンでも、識別子が正しければ認証自体は通る
  // (キーが無いだけで、その状態は list_spaces が missing として報告する)
  const stripped = await provider.verifyAccessToken(detach(refreshed.access_token).id);
  ok("封筒なしでも認証は通る", stripped.extra?.userEmail === "user@example.com");
  ok("封筒なしならキーは無い", stripped.extra?.userKeys === undefined);
}

console.log("封筒の経路を無効にした構成:");
{
  const spy = spyStore();
  const provider = new McpOAuthProvider({
    store: spy.store,
    cookieSecret: SECRET,
    serverName: "test",
    // envelopeSecret を渡さない = 封筒の経路は使わない
    upstream: {
      buildAuthorizeUrl: () => "https://idp.example/authorize",
      async exchangeCode() { return { id_token: "stub" } as any; },
      async verifyIdToken() { return { email: "user@example.com", sub: "user-1" }; },
    } as any,
  });
  await spy.store.putUpstreamState({
    state: "state-2", clientId: "client-A", redirectUri: "https://ok.example/cb",
    codeChallenge: "chal", scopes: [], upstreamCodeVerifier: "ver",
    expiresAt: Math.floor(Date.now() / 1000) + 600,
  });
  const redirect = await provider.handleUpstreamCallback("upstream-code", "state-2", "some-sealed-blob");
  const code = new URL(redirect).searchParams.get("code") ?? "";
  ok("封筒を載せない", detach(code).sealed === undefined);
}

console.log("\n" + (fail ? "NG" : "OK") + ` pass=${pass} fail=${fail}`);
if (fail) process.exit(1);
