# Backlog の API キーとスペース設定

対象: Cloudflare / AWS 共通

Backlog のスペースごとに API キーを発行し、`BACKLOG_SPACES_CONFIG` を組み立てます。
複数スペースを 1 つのサーバから扱えます。

接続したい各BacklogスペースごとにAPIキーが必要です。

## 手順

1. Backlogスペースにログイン (例: `https://your-space.backlog.com`)
2. 右上のアバターをクリック → **個人設定**
3. **API** タブを開く
4. **新しいアプリケーションの登録** をクリック (またはプランにより **APIキーの発行**)
5. メモを入力 (例: `MCP Server`) → **登録**
6. 生成されたAPIキーをコピー

## 複数スペースがある場合

各スペースで同じ手順を繰り返し、以下のJSON形式で `BACKLOG_SPACES_CONFIG` を構成します:

```json
{
  "spaces": [
    {
      "name": "WORK",
      "domain": "your-company.backlog.com",
      "apiKey": "仕事用スペースのAPIキー"
    },
    {
      "name": "SHARED",
      "domain": "shared.backlog.jp",
      "apiKey": "共用スペースのAPIキー",
      "readOnly": true
    }
  ],
  "defaultSpace": "WORK"
}
```

| フィールド | 必須 | 説明 |
|-----------|:---:|------|
| `name` | ✅ | 任意のラベル。MCPツール呼び出し時の `space` パラメータとして使用。大文字小文字は区別されません |
| `domain` | ✅ | Backlogスペースのドメイン (例: `your-space.backlog.com` または `your-space.backlog.jp`)。スキームは含めません |
| `apiKey` | | サーバ設定に埋め込む共有APIキー。**省略する**とそのスペースは利用者本人のキー専用になり、呼び出し側が自分のキーを渡さないと使えません ([利用者ごとのAPIキー](#利用者ごとのapiキー)) |
| `readOnly` | | `true` で **GET以外のAPI呼び出しを拒否**。共用スペースの誤更新・誤削除を防ぎます |
| `defaultSpace` | ✅ | `space` パラメータ省略時に使用するスペース。`spaces` 内の `name` と一致させること |

この値は `.dev.vars` に1行のJSONとして設定します。

```
BACKLOG_SPACES_CONFIG={"spaces":[{"name":"WORK","domain":"your-company.backlog.com","apiKey":"xxx"},{"name":"SHARED","domain":"shared.backlog.jp","apiKey":"yyy","readOnly":true}],"defaultSpace":"WORK"}
```

## readOnly の使いどころ

MCPツールには `add_issue` / `update_issue` / `delete_issue` / `delete_project` といった破壊的操作が含まれ、呼び出す主体はLLMです。曖昧な指示が意図しないスペースに向いた場合、`readOnly: true` が最後の歯止めになります。

判定は `src/core/backlog-client.ts` のAPI呼び出し層で行われるため、個々のツール実装に依存せず、将来ツールが追加されても自動的に保護されます。拒否された場合はBacklog APIへリクエストを送る前にエラーが返ります。

```
Space "SHARED" is configured as read-only. Refusing POST /issues.
Use list_spaces to see which spaces allow writes.
```

各スペースの状態は `list_spaces` ツールで確認できます。

## 利用者ごとのAPIキー

`BACKLOG_SPACES_CONFIG` に書いたキーは *共有キー* です。誰が操作しても、その
キーの持ち主として記録されます。課題の登録者が全員同じシステムユーザーになり、
Backlog 側の権限設定も利用者を区別できなくなります。

操作した本人として振る舞わせるには、**スペースから `apiKey` を省略**し、
クライアントからリクエストごとに本人のキーを送ります。サーバはこのキーを
保存しません。リクエストから読み、その 1 回の処理に使い、破棄します。

| ヘッダ | 用途 |
|---|---|
| `X-Backlog-Api-Key` | キー1つ。`defaultSpace` に適用されます |
| `X-Backlog-Api-Keys` | 複数スペース分。`スペース名=キー` をカンマ区切りで並べます |

```
X-Backlog-Api-Key: 本人のAPIキー
X-Backlog-Api-Keys: WORK=仕事用のキー,SHARED=共用スペースのキー
```

スペース名の大文字小文字は区別しません。設定にないスペース名を指定した場合は
**共有キーへ黙ってフォールバックせずエラーにします**。綴り間違いのせいで、
本人のつもりが別人の権限で書き込んでしまう事故を防ぐためです。

共有キーと本人のキーが両方ある場合は本人のキーが優先されます。どのスペースで
キーが使える状態か、その出所はどこか (`user` / `server` / `missing`) は
`list_spaces` で確認できます。キーの値そのものは返しません。

### クライアント側の設定

**Claude Code** — `.mcp.json`:

```json
{
  "mcpServers": {
    "backlog": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "X-Backlog-Api-Key": "${BACKLOG_API_KEY}" }
    }
  }
}
```

**Codex** — `~/.codex/config.toml`。キーをファイルに書かずに環境変数から渡せる
`env_http_headers` を使います。

```toml
[mcp_servers.backlog]
url = "https://mcp.example.com/mcp"
env_http_headers = { "X-Backlog-Api-Key" = "BACKLOG_API_KEY" }
```

**Kiro** — `.kiro/settings/mcp.json` (または `~/.kiro/settings/mcp.json`)。
Kiro は *Mcp Approved Env Vars* に登録した環境変数だけを展開します。

```json
{
  "mcpServers": {
    "backlog": {
      "type": "streamable-http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "X-Backlog-Api-Key": "${BACKLOG_API_KEY}" }
    }
  }
}
```

いずれの場合も、キーを直接書かず環境変数を参照する形を勧めます。この種の設定
ファイルは Git に入りがちです。

なお、このヘッダはログインの代わりではありません。`/mcp` は従来どおり OAuth の
内側にあるので、初回接続時にはブラウザでの認可が走ります。2つの資格情報は別の
問いに答えるものです。OAuth が「このサーバを使ってよい人か」、ヘッダが
「Backlog に対して誰であるか」です。

### ヘッダを送れないクライアント

Claude Desktop のカスタムコネクタと claude.ai のコネクタ設定は、URL と OAuth の
クライアント認証情報しか入力欄がなく、任意のヘッダを送れません。これらの
クライアント向けには、認可フローの中で一度だけキーを受け取ります。

`apiKey` を設定していないスペースは、接続時に出る同意画面に入力欄が現れます。
そこにキーを貼って承認するだけで、他に設定は要りません。サーバが控えを持たない
ため、再認可のたびに同意画面が出ます (リクエストごとではなく、リフレッシュ
トークンが切れたときです)。

**この経路でもキーは保存されません。** サーバが持つ鍵で AES-256-GCM により封をし、
最後までクライアントが運びます。

```
同意画面 → 短命なブラウザ Cookie → 認可コード → アクセス / リフレッシュトークン
```

どの段階でもサーバが保存するのは識別子の側だけで、封をした側はクライアントが
持つ文字列の中にしかありません。DynamoDB / Firestore / Cosmos DB にキーが渡ることは
一度もありません。ヘッダがある場合はそちらが優先されます。

代償として、封をしたキーは寿命の長いリフレッシュトークンに乗ります。これらの
トークンはキー本体と同等に扱い、クライアントが侵害された場合は Backlog の
個人設定 → API からキーを無効化してください。

### 対応プラットフォーム

同意画面の経路が使えるのは、本プロジェクト自身の認可サーバで動く
**AWS / Google Cloud / Azure** です。

**Cloudflare** の認可サーバは `@cloudflare/workers-oauth-provider` で、トークンの
形式を握っており、認可に紐づけたデータは必ず暗号化して KV に保存します。KV に
書かずにキーを運ぶ方法が無いため、この経路は有効にしていません。Cloudflare では
ヘッダ経路 (JSON 設定のクライアント全般) か、共有キーを使ってください。

## 注意事項

- APIキーは、キー所有者の権限でBacklogスペースへのフルアクセスを許可します。`readOnly: true` はこのMCPサーバー内のガードであり、キー自体の権限を制限するものではありません
- 書き込みが不要なスペースには、Backlog側で権限を絞ったキーを発行し、あわせて `readOnly: true` を設定するのが確実です
- キーは機密情報です。共有キーは各プラットフォームのシークレットに格納され、MCPクライアントには一切露出しません。利用者ごとのキーはそもそも保存されません
- キーが漏洩した場合は、Backlogの個人設定 → API から即座に無効化してください

---

---

- 次: [Google Cloud を IdP にする](idp-google_ja.md) / [Microsoft Entra ID を IdP にする](idp-entra-id_ja.md)
- デプロイ: [Cloudflare Workers 版](deploy-cloudflare_ja.md) / [AWS 版](deploy-aws_ja.md)
