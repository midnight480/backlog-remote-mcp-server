// DynamoAuthStore のクライアント登録 TTL を検証する。
//   npm run test:aws-store
//
// /register は認証なしで誰でも叩けるため、登録レコードに期限が無いと
// 匿名のレコードが永久に溜まる。使われている登録は延長されることを確認する。

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoAuthStore } from "../src/platforms/aws/auth/store.ts";

const DAY = 60 * 60 * 24;
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { console.log(`  ${c ? "OK " : "NG "} ${n}${e}`); c ? pass++ : fail++; };

// DynamoDBDocumentClient を差し替えて呼び出しを記録する
const makeStore = () => {
  const items = new Map<string, any>();
  const calls: string[] = [];
  const fake = {
    send: async (cmd: any) => {
      const n = cmd.constructor.name;
      calls.push(n);
      const key = cmd.input.Key?.pk ?? cmd.input.Item?.pk;
      if (n === "PutCommand") { items.set(key, cmd.input.Item); return {}; }
      if (n === "GetCommand") { return { Item: items.get(key) }; }
      if (n === "DeleteCommand") { items.delete(key); return {}; }
      return {};
    },
  };
  // 実クライアントを渡して構築後に doc を差し替える。fake が全ての send を
  // 受けるため、ネットワークには一切出ない。
  const store = new DynamoAuthStore("t", new DynamoDBClient({ region: "us-east-1" }));
  (store as any).doc = fake;
  return { store, items, calls };
};

const client: any = { client_id: "c1", redirect_uris: ["https://a.example/cb"], client_id_issued_at: 1 };
const nowSec = () => Math.floor(Date.now() / 1000);

console.log("クライアント登録の TTL:");
{
  const { store, items } = makeStore();
  await store.putClient(client);
  const rec = items.get("client#c1");
  ok("expiresAt が設定される", typeof rec.expiresAt === "number");
  const days = (rec.expiresAt - nowSec()) / DAY;
  ok("約 90 日先", days > 89.9 && days < 90.1, `  (${days.toFixed(1)} 日)`);
}
{
  const { store, items } = makeStore();
  await store.putClient(client);
  ok("登録直後は取得できる", (await store.getClient("c1"))?.client_id === "c1");

  // 期限切れに書き換える
  items.get("client#c1").expiresAt = nowSec() - 1;
  ok("期限切れは取得できない", (await store.getClient("c1")) === undefined);
}
{
  const { store, items, calls } = makeStore();
  await store.putClient(client);
  // 残り 80 日 (しきい値 45 日より多い) → 延長しない
  items.get("client#c1").expiresAt = nowSec() + 80 * DAY;
  calls.length = 0;
  await store.getClient("c1");
  ok("残り十分なら書き込まない", !calls.includes("PutCommand"), `  (${calls.join(",")})`);
}
{
  const { store, items, calls } = makeStore();
  await store.putClient(client);
  // 残り 10 日 (しきい値未満) → 延長する
  items.get("client#c1").expiresAt = nowSec() + 10 * DAY;
  calls.length = 0;
  const got = await store.getClient("c1");
  ok("残り僅かなら延長する", calls.includes("PutCommand"));
  ok("延長後も同じクライアントを返す", got?.client_id === "c1");
  const days = (items.get("client#c1").expiresAt - nowSec()) / DAY;
  ok("期限が 90 日に戻る", days > 89.9 && days < 90.1, `  (${days.toFixed(1)} 日)`);
}
{
  const { store } = makeStore();
  ok("未登録は undefined", (await store.getClient("missing")) === undefined);
}

console.log("\n" + (fail ? "NG" : "OK") + ` pass=${pass} fail=${fail}`);
if (fail) process.exit(1);
