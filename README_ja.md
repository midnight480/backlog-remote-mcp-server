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
Cloudflare Workers (backlog-remote-mcp-server.midnight480.com)
    ↓ Cloudflare Access (Google / Microsoft Entra ID)
    ↓ Email allowlist check
    ↓ Backlog API Key routing
Backlog API (space-a.backlog.com, space-b.backlog.com, ...)
```

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

### 2. KV Namespaceの作成

```bash
npx wrangler kv namespace create "OAUTH_KV"
```

出力されたIDを `wrangler.jsonc` の `kv_namespaces[0].id` に設定します。

### 3. Cloudflare Access SaaS Applicationの作成

1. Cloudflare Dashboard → Zero Trust → Access controls → Applications
2. **Create new application** → **SaaS application**
3. 設定:
   - Application name: `Backlog MCP Server`
   - Protocol: **OIDC**
   - Redirect URL: `https://backlog-remote-mcp-server.midnight480.com/callback`
4. Identity Providers:
   - **Google** や **Microsoft Entra ID** を有効化
   - IdPが1つだけなら **Apply instant authentication** をON (直接リダイレクト)
5. Access Policies:
   - 許可するメールアドレスを設定 (例: Include → Emails → `your-email@gmail.com`)
6. 作成後、以下の値を控える:
   - Client ID
   - Client Secret
   - Token endpoint
   - Authorization endpoint
   - Key endpoint (JWKS)

### 4. Secretsの設定

```bash
# Cloudflare Access SaaS Appの値
npx wrangler secret put ACCESS_CLIENT_ID
npx wrangler secret put ACCESS_CLIENT_SECRET
npx wrangler secret put ACCESS_TOKEN_URL
npx wrangler secret put ACCESS_AUTHORIZATION_URL
npx wrangler secret put ACCESS_JWKS_URL

# Cookie暗号化キー (ランダム生成)
echo $(openssl rand -hex 32) | npx wrangler secret put COOKIE_ENCRYPTION_KEY

# 許可するメールアドレス
echo '["your-email@gmail.com"]' | npx wrangler secret put ALLOWED_EMAILS

# Backlogスペース設定
npx wrangler secret put BACKLOG_SPACES_CONFIG
```

`BACKLOG_SPACES_CONFIG` の値は以下のJSON形式:

```json
{
  "spaces": [
    {
      "name": "COMPANY_A",
      "domain": "company-a.backlog.com",
      "apiKey": "your-api-key-for-company-a"
    },
    {
      "name": "PERSONAL",
      "domain": "personal.backlog.com",
      "apiKey": "your-api-key-for-personal"
    }
  ],
  "defaultSpace": "COMPANY_A"
}
```

### 5. カスタムドメインの設定

Cloudflare DNSで `backlog-remote-mcp-server.midnight480.com` をWorkerにルーティングするために:

1. Cloudflare Dashboard → DNS → `midnight480.com`
2. レコードは不要 (wrangler.jsonc の `custom_domain: true` で自動設定)

### 6. デプロイ

```bash
npm run deploy
```

デプロイ後、以下のURLでMCPサーバーが利用可能:
```
https://backlog-remote-mcp-server.midnight480.com/mcp
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
        "https://backlog-remote-mcp-server.midnight480.com/mcp"
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

Inspector画面で `https://backlog-remote-mcp-server.midnight480.com/mcp` を入力し、OAuth Settingsから認証フローを実行します。

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

## セキュリティ

- **認証**: Cloudflare Access → Google / Microsoft Entra ID。OAuthフロー全体がCloudflare側で管理
- **認可**: `ALLOWED_EMAILS` で許可メールアドレスをホワイトリスト管理
- **二重チェック**: Access Policy (Cloudflare側) + アプリケーション内allowlist (Worker側)
- **APIキー保護**: Backlog APIキーはCloudflare Secretsに格納。クライアントには一切露出しない
- **PKCE + CSRF**: OAuth flowはPKCEとCSRFトークンで保護

## ローカル開発

```bash
# .dev.varsファイルを作成 (ローカル用シークレット)
cp .dev.vars.example .dev.vars
# 各値を設定

npm run dev
# http://localhost:8788/mcp で起動
```

### .dev.vars.example

```
ACCESS_CLIENT_ID=your-local-client-id
ACCESS_CLIENT_SECRET=your-local-client-secret
ACCESS_TOKEN_URL=https://your-team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/xxx/token
ACCESS_AUTHORIZATION_URL=https://your-team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/xxx/authorization
ACCESS_JWKS_URL=https://your-team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/xxx/jwks
COOKIE_ENCRYPTION_KEY=your-random-hex-string
ALLOWED_EMAILS=["your-email@gmail.com"]
BACKLOG_SPACES_CONFIG={"spaces":[{"name":"DEV","domain":"dev.backlog.com","apiKey":"xxx"}],"defaultSpace":"DEV"}
```

## License

MIT
