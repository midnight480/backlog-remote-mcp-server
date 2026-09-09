// 利用者本人の Backlog API キーを受け取る層 (credentials.ts) を検証する。
//
// このサーバはキーを保存しないため、「クライアントから運ばれてきた値を
// 正しく解析し、正しいスペースにだけ適用し、間違いを黙って握りつぶさない」
// ことが安全性の中心になる。特に:
//   - 綴り違いのスペース名で共有キーへフォールバックしないこと
//   - ある利用者のキーが元の設定オブジェクトに残らないこと
//   - キーが無い状態で API を呼ぼうとしたら手前で止まること
//   npm run test:credentials

import {
  DEFAULT_SPACE_SENTINEL,
  InvalidCredentialError, applyUserKeys, parseApiKeyHeaders, parseApiKeyList,
} from "../src/core/credentials.ts";
import {
  MissingCredentialError, callBacklogApi, parseSpacesConfig, resolveSpace,
} from "../src/core/backlog-client.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { console.log(`  ${c ? "OK " : "NG "} ${n}${e}`); c ? pass++ : fail++; };
const throws = (n: string, fn: () => unknown) => {
  try { fn(); ok(n, false, " (例外が出なかった)"); }
  catch (e) { ok(n, e instanceof InvalidCredentialError, e instanceof Error ? ` (${e.name})` : ""); }
};

const CONFIG = JSON.stringify({
  spaces: [
    { name: "WORK", domain: "work.backlog.com", apiKey: "server-work-key" },
    { name: "SHARED", domain: "shared.backlog.jp", readOnly: true },
  ],
  defaultSpace: "WORK",
});

console.log("ヘッダの解析:");
ok("単一キーは予約名に入る",
  parseApiKeyHeaders("abc123", undefined)[DEFAULT_SPACE_SENTINEL] === "abc123");
ok("前後の空白を落とす",
  parseApiKeyHeaders("  abc123  ", undefined)[DEFAULT_SPACE_SENTINEL] === "abc123");
const multi = parseApiKeyList("WORK=k1,SHARED=k2");
ok("複数指定を分解する", multi.work === "k1" && multi.shared === "k2");
ok("スペース名は小文字に正規化", parseApiKeyList("Work=k1").work === "k1");
ok("エントリ前後の空白を許す", parseApiKeyList(" WORK = k1 , SHARED = k2 ").shared === "k2");
ok("空エントリは無視", Object.keys(parseApiKeyList("WORK=k1,,")).length === 1);
ok("キー内の = を保つ", parseApiKeyList("WORK=k1=k2").work === "k1=k2");
ok("両ヘッダを併用できる", (() => {
  const k = parseApiKeyHeaders("dflt", "SHARED=k2");
  return k[DEFAULT_SPACE_SENTINEL] === "dflt" && k.shared === "k2";
})());

console.log("不正な入力を拒否:");
throws("= が無いエントリ",        () => parseApiKeyList("WORKk1"));
throws("同じスペースの二重指定",  () => parseApiKeyList("WORK=k1,work=k2"));
throws("空のキー",                () => parseApiKeyList("WORK="));
throws("空白を含むキー",          () => parseApiKeyHeaders("a b", undefined));
throws("制御文字を含むキー",      () => parseApiKeyHeaders("a\x01b", undefined));
throws("非 ASCII を含むキー",     () => parseApiKeyHeaders("aあb", undefined));
throws("長すぎるキー",            () => parseApiKeyHeaders("x".repeat(513), undefined));
throws("空のスペース名",          () => parseApiKeyList("=k1"));

console.log("設定への適用:");
const base = parseSpacesConfig(CONFIG);
ok("apiKey 無しのスペースを許容", base.spaces[1].apiKey === undefined);

const applied = applyUserKeys(base, parseApiKeyHeaders(undefined, "WORK=mine,SHARED=mine2"));
ok("本人のキーが共有キーを上書き", resolveSpace(applied, "WORK").apiKey === "mine");
ok("出所を user と記録",          resolveSpace(applied, "WORK").keySource === "user");
ok("キー未設定スペースにも入る",  resolveSpace(applied, "SHARED").apiKey === "mine2");
ok("元の設定は書き換えない",      resolveSpace(base, "WORK").apiKey === "server-work-key");
ok("readOnly を維持",             resolveSpace(applied, "SHARED").readOnly === true);

const sentinel = applyUserKeys(base, parseApiKeyHeaders("mine", undefined));
ok("予約名はデフォルトスペースへ", resolveSpace(sentinel, "WORK").apiKey === "mine");
ok("他スペースは据え置き",         resolveSpace(sentinel, "SHARED").apiKey === undefined);

const none = applyUserKeys(base, {});
ok("キー未指定なら共有キーのまま", resolveSpace(none, "WORK").apiKey === "server-work-key");
ok("出所を server と記録",         resolveSpace(none, "WORK").keySource === "server");
ok("共有キーも無ければ未設定",     resolveSpace(none, "SHARED").keySource === undefined);

// 綴り違いを共有キーへ黙ってフォールバックさせると、本人のつもりで
// 別人の権限で書き込む事故になる。必ず失敗させる。
throws("知らないスペース名は拒否", () => applyUserKeys(base, { typo: "k" }));

// 両ヘッダが同じスペースを指したとき、どちらが勝つかを暗黙に決めない。
throws("同じスペースへの二重指定を拒否",
  () => applyUserKeys(base, parseApiKeyHeaders("single", "WORK=multi")));
ok("別スペースなら併用できる",
  resolveSpace(applyUserKeys(base, parseApiKeyHeaders("single", "SHARED=multi")), "WORK").apiKey === "single");

console.log("キーが無いまま呼んだとき:");
await (async () => {
  try {
    await callBacklogApi(resolveSpace(none, "SHARED"), { path: "/space" });
    ok("API 呼び出し前に止まる", false, " (例外が出なかった)");
  } catch (e) {
    ok("API 呼び出し前に止まる", e instanceof MissingCredentialError);
    ok("設定方法を案内する", e instanceof Error && e.message.includes("X-Backlog-Api-Key"));
  }
})();

console.log("\n" + (fail ? "NG" : "OK") + ` pass=${pass} fail=${fail}`);
if (fail) process.exit(1);
