// クライアントが自分の Backlog スペースを宣言する経路を検証する。
//
// この経路の危険は 1 点に尽きる。宛先ホストをクライアントが決められるため、
// 素通しするとサーバが任意ホストへリクエストを出す踏み台になる (SSRF)。
// サーバは VPC の内側など、クライアントからは直接届かない位置にいることが
// あるので、「本人のキーを渡すだけだから無害」では済まない。
//
// したがってここでの主眼は、ドメイン検証が実際に攻撃入力を止めるかどうかである。
//   npm run test:client-spaces

import {
  applyClientSpaces, assertValidSpaceDomain, applyUserKeys,
  DEFAULT_ALLOWED_SPACE_DOMAINS, InvalidCredentialError,
  parseApiKeyHeaders, parseClientSpaces,
} from "../src/core/credentials.ts";
import { parseSpacesConfig, resolveSpace } from "../src/core/backlog-client.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { console.log(`  ${c ? "OK " : "NG "} ${n}${e}`); c ? pass++ : fail++; };
const rejects = (n: string, fn: () => unknown) => {
  try { fn(); ok(n, false, " (通ってしまった)"); }
  catch (e) { ok(n, e instanceof InvalidCredentialError, e instanceof Error ? ` (${e.name})` : ""); }
};

const BYO = parseSpacesConfig(JSON.stringify({ spaces: [], allowClientSpaces: true }));
const MIXED = parseSpacesConfig(JSON.stringify({
  spaces: [{ name: "WORK", domain: "work.backlog.com", apiKey: "server-key" }],
  defaultSpace: "WORK",
  allowClientSpaces: true,
}));
const CLOSED = parseSpacesConfig(JSON.stringify({
  spaces: [{ name: "WORK", domain: "work.backlog.com", apiKey: "server-key" }],
  defaultSpace: "WORK",
}));

console.log("設定の受け付け:");
ok("スペース 0 個でも allowClientSpaces なら通る", BYO.spaces.length === 0);
ok("既定スペースは空になる", BYO.defaultSpace === "");
rejectsConfig("スペース 0 個で allowClientSpaces 無しは拒否", '{"spaces":[]}');
function rejectsConfig(n: string, json: string) {
  try { parseSpacesConfig(json); ok(n, false, " (通ってしまった)"); }
  catch { ok(n, true); }
}

console.log("ヘッダの解析:");
const declared = parseClientSpaces("WORK=a.backlog.com,PRIVATE=b.backlog.jp");
ok("複数の宣言を分解する", declared.work === "a.backlog.com" && declared.private === "b.backlog.jp");
ok("スペース名を小文字化", parseClientSpaces("Work=a.backlog.com").work === "a.backlog.com");
rejects("= が無いエントリ", () => parseClientSpaces("WORKa.backlog.com"));
rejects("同じスペースの二重宣言", () => parseClientSpaces("WORK=a.backlog.com,work=b.backlog.com"));

console.log("ドメイン検証 — 正当なもの:");
for (const d of ["space.backlog.com", "space.backlog.jp", "old.backlogtool.com", "my-team.backlog.com", "a1.backlog.jp"]) {
  let good = true;
  try { assertValidSpaceDomain(d, DEFAULT_ALLOWED_SPACE_DOMAINS); } catch { good = false; }
  ok(`通す: ${d}`, good);
}

console.log("ドメイン検証 — SSRF を狙う入力:");
const attacks: Array<[string, string]> = [
  ["内部ホスト", "localhost"],
  ["メタデータ endpoint", "169.254.169.254"],
  ["IPv4 直指定", "10.0.0.1"],
  ["内部名", "internal.corp"],
  ["サフィックス偽装", "evilbacklog.com"],
  ["サフィックス偽装 (前方一致)", "backlog.com.evil.net"],
  ["サブドメイン偽装", "backlog.com.attacker.io"],
  ["スキーム付き", "https://evil.com"],
  ["認証情報埋め込み", "user:pass@evil.backlog.com"],
  ["@ による宛先すり替え", "space.backlog.com@evil.com"],
  ["ポート指定", "space.backlog.com:8080"],
  ["パス付き", "space.backlog.com/../../admin"],
  ["クエリ付き", "space.backlog.com?x=1"],
  ["URL エンコード", "space.backlog.com%2f@evil.com"],
  ["サフィックスそのもの", "backlog.com"],
  ["先頭ドット", ".backlog.com"],
  ["空文字", ""],
  ["アンダースコア", "a_b.backlog.com"],
  ["IPv6", "[::1]"],
  ["改行混入", "space.backlog.com\nX-Evil: 1"],
];
for (const [label, domain] of attacks) {
  rejects(`拒否: ${label}`, () => assertValidSpaceDomain(domain, DEFAULT_ALLOWED_SPACE_DOMAINS));
}

console.log("設定への反映:");
{
  const cfg = applyClientSpaces(BYO, parseClientSpaces("MINE=mine.backlog.jp"));
  ok("宣言したスペースが増える", cfg.spaces.length === 1);
  ok("ドメインが入る", resolveSpace(cfg, "MINE").domain === "mine.backlog.jp");
  ok("既定が空なら宣言分を既定にする", cfg.defaultSpace === "mine");
  ok("宣言スペースは書き込み可", resolveSpace(cfg, "MINE").readOnly === false);
  ok("この時点ではキーが無い", resolveSpace(cfg, "MINE").apiKey === undefined);
}
{
  const cfg = applyClientSpaces(MIXED, parseClientSpaces("MINE=mine.backlog.jp"));
  ok("設定済みスペースは残る", resolveSpace(cfg, "WORK").apiKey === "server-key");
  ok("設定側の既定を尊重する", cfg.defaultSpace === "WORK");
}

console.log("拒否すべき宣言:");
rejects("allowClientSpaces 無効なら拒否",
  () => applyClientSpaces(CLOSED, parseClientSpaces("MINE=mine.backlog.jp")));
// 名前を乗っ取れると、いつもの名前で違うホストへ書く事故になる
rejects("設定済みスペース名の再定義を拒否",
  () => applyClientSpaces(MIXED, parseClientSpaces("WORK=attacker.backlog.com")));
rejects("許可外ドメインを拒否",
  () => applyClientSpaces(BYO, parseClientSpaces("MINE=evil.example.com")));
ok("宣言が無ければ素通し", applyClientSpaces(CLOSED, {}) === CLOSED);

console.log("許可サフィックスの差し替え:");
{
  const custom = parseSpacesConfig(JSON.stringify({
    spaces: [], allowClientSpaces: true, allowedSpaceDomains: ["example.co.jp"],
  }));
  const cfg = applyClientSpaces(custom, parseClientSpaces("MINE=backlog.example.co.jp"));
  ok("指定したサフィックスを通す", resolveSpace(cfg, "MINE").domain === "backlog.example.co.jp");
  rejects("既定サフィックスは通さなくなる",
    () => applyClientSpaces(custom, parseClientSpaces("MINE=a.backlog.com")));
}

console.log("キーとの組み合わせ:");
{
  // 宣言 → キー、の順に適用されないとキーが「知らないスペース」で弾かれる
  const cfg = applyUserKeys(
    applyClientSpaces(BYO, parseClientSpaces("MINE=mine.backlog.jp")),
    parseApiKeyHeaders(undefined, "MINE=my-key"),
  );
  ok("宣言したスペースにキーが乗る", resolveSpace(cfg, "MINE").apiKey === "my-key");
  ok("出所は user", resolveSpace(cfg, "MINE").keySource === "user");
}
{
  // 宣言だけでキーが無い場合。呼び出しは MissingCredentialError で止まる
  const cfg = applyClientSpaces(BYO, parseClientSpaces("MINE=mine.backlog.jp"));
  ok("キー未指定なら apiKey は無い", resolveSpace(cfg, "MINE").apiKey === undefined);
}

console.log("\n" + (fail ? "NG" : "OK") + ` pass=${pass} fail=${fail}`);
if (fail) process.exit(1);
