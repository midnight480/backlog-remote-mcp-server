# Backlog Remote MCP Server

Cloudflare Workers上で動作するリモートMCPサーバー。Backlog APIをMCPプロトコル経由で利用可能にし、Cloudflare Access + Google/Microsoft Entra ID認証で自分だけがアクセスできるようにしています。

[English version](./README.md) | [設定ガイド](./SETTINGS_ja.md)

## 特徴

- **リモートMCPサーバー**: Cloudflare Workers上でホスティング。どこからでもアクセス可能
- **Cloudflare Access認証**: Google / Microsoft Entra ID (またはその他のIdP) による認証。許可されたメールアドレスのみアクセス可能
- **複数スペース対応**: 1つの接続で複数のBacklogスペースを操作可能。`space`パラメータで振り分け
- **フルツールセット**: プロジェクト、課題、Wiki、Git/PR、通知を網羅

## アーキテクチャ

```
MCP Client (Claude, Kiro, Cursor, etc.)
    ↓ Streamable HTTP + OAuth
Cloudflare Workers (設定したカスタムドメイン)
    ↓ Cloudflare Access (Google / Microsoft Entra ID)
    ↓ Email allowlist check
    ↓ Backlog API Key routing
Backlog API (space-a.backlog.com, space-b.backlog.com, ...)
```

### ディレクトリ構成

ビジネスロジックと実行環境の配線を分離しています。

```
src/
  core/                    実行環境に依存しない部分
    backlog-client.ts      Backlog API クライアント (readOnly ガードもここ)
    tools/                 MCP ツール 40 個
    create-server.ts       MCP サーバの組み立てと認可判定
  platforms/
    cloudflare/            Cloudflare Workers 向けの配線
      index.ts             OAuthProvider + McpAgent (Durable Object)
      access-handler.ts    Cloudflare Access との OIDC 連携
      workers-oauth-utils.ts
```

`src/core` は `@modelcontextprotocol/sdk` と `zod` にしか依存せず、Cloudflare 固有の API を一切参照しません。他の実行環境向けアダプタを `src/platforms/` 配下に追加すれば、ツール実装を共有したまま対応先を増やせます。

## セットアップ手順

各サービス (Backlog、Google、Microsoft Entra ID、Cloudflare) のスクリーンショット付き詳細手順は [設定ガイド](./SETTINGS_ja.md) を参照してください。

### 前提条件

- Cloudflareアカウント
- Cloudflare Zero Trust組織 (Google / Microsoft Entra ID等のIdPを接続済み)
- Backlog APIキー (各スペースごと)
- Node.js 18+
- Wrangler CLI

### 1. リポジトリのクローンと依存関係インストール

```bash
git clone <this-repo>
cd my-own-backlog-remote-mcp-server
npm install
```

### 2. 設定ファイルの作成

環境固有の値はすべて `.dev.vars` にまとめます。このファイルはローカル開発とデプロイの両方で参照され、Gitにはコミットされません。

```bash
cp .dev.vars.example .dev.vars
```

以降の手順で得た値を、このファイルに書き込んでいきます。

### 3. KV Namespaceの作成

```bash
npx wrangler kv namespace create backlog-remote-mcp-server-OAUTH_KV
```

出力された `id` を `.dev.vars` に設定します。

```
OAUTH_KV_ID=0123456789abcdef0123456789abcdef
```

> **Note**
> 他のWorkerと共用のnamespaceを使わないでください。OAuthの認可コード・トークン・承認済みクライアントがここに格納されるため、共有すると認証情報が混ざります。プロジェクト名を接頭辞に付けた専用namespaceを推奨します。

### 4. Cloudflare Access SaaS Applicationの作成

1. Cloudflare Dashboard → Zero Trust → Access controls → Applications
2. **Create new application** → **SaaS applications** タブ → **OpenID Connect (OIDC)**
3. 設定:
   - Application name: `Backlog MCP Server`
   - Authentication protocol: **OIDC** (SAMLではない)
4. **Redirect URLs** に2つ登録:
   ```
   https://<あなたのドメイン>/callback
   http://localhost:8788/callback
   ```
   下はローカル検証用です。Accessが `http://` を拒否する場合は `npm run dev:https` を使い `https://localhost:8788/callback` を登録してください。
5. **Proof Key for Code Exchange (PKCE)** を **ON**
   Workerは常に `code_challenge` (S256) を送るため必須です。「Allow PKCE without Client Secret」はOFFのままにします。
6. Identity Providers:
   - **Google** や **Microsoft Entra ID** を有効化
   - IdPが1つだけなら **Apply instant authentication** をON (直接リダイレクト)
7. Access Policies:
   - Action: **Allow** / Include → Emails → 許可するメールアドレス
8. 作成後、表示される以下の値を `.dev.vars` に転記:

   | 画面上の項目 | `.dev.vars` のキー |
   |---|---|
   | Client ID | `ACCESS_CLIENT_ID` |
   | Client Secret | `ACCESS_CLIENT_SECRET` |
   | Token endpoint | `ACCESS_TOKEN_URL` |
   | Authorization endpoint | `ACCESS_AUTHORIZATION_URL` |
   | Key endpoint (JWKS) | `ACCESS_JWKS_URL` |

> **Warning**
> Client Secretは**作成直後しか表示されません**。画面を離れる前に転記してください。取り逃した場合は **Reset secret** で再発行します。

### 5. Backlogスペースの設定

`.dev.vars` の `BACKLOG_SPACES_CONFIG` に、利用するスペースをJSON1行で設定します。

```
BACKLOG_SPACES_CONFIG={"spaces":[{"name":"COMPANY_A","domain":"company-a.backlog.com","apiKey":"xxx"},{"name":"SHARED","domain":"shared.backlog.jp","apiKey":"yyy","readOnly":true}],"defaultSpace":"COMPANY_A"}
```

読みやすく展開すると以下の構造です。

```json
{
  "spaces": [
    {
      "name": "COMPANY_A",
      "domain": "company-a.backlog.com",
      "apiKey": "your-api-key-for-company-a"
    },
    {
      "name": "SHARED",
      "domain": "shared.backlog.jp",
      "apiKey": "your-api-key-for-shared",
      "readOnly": true
    }
  ],
  "defaultSpace": "COMPANY_A"
}
```

| フィールド | 必須 | 説明 |
|---|---|---|
| `name` | ✅ | ツール呼び出し時に `space` 引数で指定するラベル。大文字小文字は区別されません |
| `domain` | ✅ | スキームなしのホスト名。`.backlog.com` / `.backlog.jp` / `.backlogtool.com` |
| `apiKey` | ✅ | Backlogの 個人設定 → API から発行 |
| `readOnly` | | `true` にすると **GET以外のAPIを拒否** します。共用スペースの誤更新・誤削除を防げます |
| `defaultSpace` | ✅ | `space` 引数を省略したときの宛先。`spaces` 内の `name` と一致させること |

> **Note**
> 共用スペースや本番スペースには `readOnly: true` を推奨します。ツールには `delete_issue` や `delete_project` といった破壊的操作が含まれており、MCPの利用者はLLMです。曖昧な指示が意図しないスペースに向いた場合の歯止めになります。

### 6. カスタムドメインの設定

`.dev.vars` にデプロイ先のホスト名を設定します。

```
MCP_HOSTNAME=backlog-remote-mcp-server.example.com
```

DNSレコードの手動作成は不要です。デプロイ時に `custom_domain: true` として登録され、Cloudflare側で自動設定されます。対象ドメインが同じアカウントのゾーンにある必要があります。

### 7. デプロイ

```bash
npm run deploy
```

このコマンドは3ステップを順に実行します。

1. `.dev.vars` の `MCP_HOSTNAME` と `OAUTH_KV_ID` を注入した `wrangler.deploy.json` を生成
2. `.dev.vars` の値を `wrangler secret bulk` でWorkerのシークレットとして登録
3. `wrangler deploy`

> **Warning**
> `wrangler.jsonc` にはカスタムドメインとKV IDが含まれていません。素の `npx wrangler deploy` を実行するとドメインが付かず、KV IDもプレースホルダのまま失敗します。必ず `npm run deploy` を使ってください。

デプロイ後、以下のURLでMCPサーバーが利用可能になります。

```
https://<MCP_HOSTNAME>/mcp
```

#### 関連コマンド

| コマンド | 動作 |
|---|---|
| `npm run deploy` | 設定生成 → シークレット登録 → デプロイ |
| `npm run deploy:dry-run` | 設定生成と検証のみ (アップロードしない) |
| `npm run deploy:no-secrets` | シークレットに触れずデプロイのみ |
| `npm run secrets:push` | シークレット登録のみ |
| `npm run secrets:dry-run` | 送信されるキー名の確認のみ (値は表示されません) |

シークレットを手動で登録したい場合は従来どおり個別に設定することもできます。

```bash
npx wrangler secret put ACCESS_CLIENT_SECRET
```

## MCPクライアントからの接続

### Claude Desktop / Kiro / Cursor (mcp-remoteプロキシ経由)

```json
{
  "mcpServers": {
    "backlog": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://<MCP_HOSTNAME>/mcp"
      ]
    }
  }
}
```

初回接続時にブラウザが開き、認証を求められます。

### MCP Inspector (テスト用)

```bash
npx @modelcontextprotocol/inspector@latest
```

Inspector画面で `https://<MCP_HOSTNAME>/mcp` を入力し、OAuth Settingsから認証フローを実行します。

## 使い方

### スペースの指定

すべてのツールに `space` パラメータ(オプション)があります:

```
# デフォルトスペースを使用
「PROJECT-KEYプロジェクトの課題一覧を見せて」

# 特定のスペースを指定
「PERSONALスペースのプロジェクト一覧を見せて」
→ space: "PERSONAL" を指定
```

### 利用例

```
# 設定されたスペース一覧を確認
「利用可能なバックログスペースを教えて」→ list_spaces

# プロジェクト一覧
「COMPANY_Aのプロジェクト一覧」→ get_project_list(space: "COMPANY_A")

# 課題作成
「PROJECT-KEYに新しいバグ課題を作って」→ add_issue(...)

# PR一覧
「repo-nameのオープンなPRを見せて」→ get_pull_requests(...)
```

## 利用可能なツール

| カテゴリ | ツール |
|---------|--------|
| Space | list_spaces, get_space, get_users, get_myself |
| Project | get_project_list, get_project, add_project, update_project, delete_project, get_project_users |
| Issue | get_issue, get_issues, count_issues, add_issue, update_issue, delete_issue, get_issue_comments, add_issue_comment, get_priorities, get_issue_types, get_categories, get_version_milestones, add_version_milestone, get_resolutions |
| Wiki | get_wiki_pages, get_wikis_count, get_wiki, add_wiki |
| Git | get_git_repositories, get_git_repository, get_pull_requests, get_pull_request, add_pull_request, update_pull_request, get_pull_request_comments, add_pull_request_comment |
| Notification | get_notifications, get_notifications_count, reset_unread_notification_count, mark_notification_as_read |

`add_*` / `update_*` / `delete_*` は書き込み系です。`readOnly: true` を設定したスペースに対してこれらを呼ぶと、Backlog APIへリクエストを送る前に拒否されます。`list_spaces` で各スペースの `readOnly` 状態を確認できます。

## セキュリティ

- **認証**: Cloudflare Access → Google / Microsoft Entra ID。OAuthフロー全体がCloudflare側で管理
- **認可**: `ALLOWED_EMAILS` で許可メールアドレスをホワイトリスト管理
- **二重チェック**: Access Policy (Cloudflare側) + アプリケーション内allowlist (Worker側)
- **APIキー保護**: Backlog APIキーはCloudflare Secretsに格納。クライアントには一切露出しない
- **PKCE + CSRF**: OAuth flowはPKCE (S256) とCSRFトークンで保護
- **書き込みガード**: `readOnly: true` のスペースはGET以外を拒否。判定は `src/core/backlog-client.ts` のAPI呼び出し層で行うため、個々のツール実装に依存しません
- **設定の分離**: 環境固有の値はすべて `.dev.vars` (Git管理外) に集約。リポジトリにはプレースホルダのみ

### 運用上の注意

- `ALLOWED_EMAILS` がこのサーバーの実質的な認可境界です。Worker前段にZoneレベルのAccessアプリケーションは置かれていません
- `npm run deploy` は `.dev.vars` の値を本番のシークレットとして**上書き**します。ローカルと本番で値を分けたくなった場合は `deploy:no-secrets` を通常のデプロイに使い、シークレット更新は `secrets:push` で明示的に行ってください
- Backlog APIキーはキー所有者の権限をそのまま持ちます。書き込みが不要なスペースには読み取り専用のキーを発行し、あわせて `readOnly: true` を設定するのが確実です

## ローカル開発

```bash
cp .dev.vars.example .dev.vars   # 各値を設定
npm run dev
# http://localhost:8788/mcp で起動
```

`wrangler dev` はKVとDurable Objectをローカルでエミュレートするため、実際のCloudflareリソースには触れません。

### 疎通確認

OAuthからMCPツール実行までを一括で確認できます。

```bash
npm run check:local
```

以下の順に実行され、途中でブラウザが開くのでCloudflare Accessのログインを完了させてください。

1. Authorization Serverメタデータの取得
2. 動的クライアント登録
3. ブラウザで承認 → Access ログイン
4. PKCEによるトークン交換
5. `initialize` / `tools/list`
6. `get_space` を実際に呼び出してBacklogからの応答を確認

`tools/list` に `access_denied` の1件だけが返る場合は、ログインしたメールアドレスが `ALLOWED_EMAILS` に含まれていません。

### HTTPSで起動する

Cloudflare AccessのRedirect URLが `http://` を受け付けない場合に使います。

```bash
npm run dev:https
# https://localhost:8788/mcp で起動 (自己署名証明書)
```

### 型チェック

```bash
npm run type-check
```

### .dev.vars.example

```
# デプロイ先のカスタムドメイン (npm run deploy がここから読む)
MCP_HOSTNAME=your-worker.example.com

# OAuth 用 KV namespace の ID (npm run deploy がここから読む)
OAUTH_KV_ID=your-kv-namespace-id

ACCESS_CLIENT_ID=your-local-client-id
ACCESS_CLIENT_SECRET=your-local-client-secret
ACCESS_TOKEN_URL=https://your-team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/xxx/token
ACCESS_AUTHORIZATION_URL=https://your-team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/xxx/authorization
ACCESS_JWKS_URL=https://your-team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/xxx/jwks
COOKIE_ENCRYPTION_KEY=your-random-hex-string
ALLOWED_EMAILS=["your-email@gmail.com"]
# readOnly:true のスペースは GET 以外の API を拒否する (共用スペースの誤更新・誤削除を防ぐ)
BACKLOG_SPACES_CONFIG={"spaces":[{"name":"DEV","domain":"dev.backlog.com","apiKey":"xxx"},{"name":"SHARED","domain":"shared.backlog.com","apiKey":"yyy","readOnly":true}],"defaultSpace":"DEV"}
```

`MCP_HOSTNAME` と `OAUTH_KV_ID` はビルド時にのみ使われ、Workerのシークレットとしては送信されません。どちらも環境変数で上書きできるため、CIからは以下のように渡せます。

```bash
MCP_HOSTNAME=staging.example.com OAUTH_KV_ID=... npm run deploy
```

## License

MIT
