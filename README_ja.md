# Backlog Remote MCP Server

Backlog を MCP (Model Context Protocol) 経由で操作するリモートサーバです。
**Cloudflare Workers と AWS のどちらにもデプロイできます。**

[English](README.md) | 日本語

## 特徴

- **マルチスペース対応** — 複数の Backlog スペースを 1 つのサーバから扱えます
- **読み取り専用ガード** — 共用スペースを `readOnly` にすると書き込み系 API を拒否します
- **OAuth 2.1 + PKCE** — 動的クライアント登録 (DCR) に対応し、MCP クライアントから直接接続できます
- **メールアドレスによる認可** — 許可リストで利用者を限定します
- **2 つの実行環境** — ビジネスロジックを共有したまま Cloudflare / AWS のどちらでも動きます

## デプロイ先を選ぶ

| | Cloudflare Workers | AWS |
|---|---|---|
| 実行環境 | Workers (エッジ) | Lambda + API Gateway HTTP API |
| MCP セッション | Durable Objects | ステートレス |
| OAuth 認可サーバ | `@cloudflare/workers-oauth-provider` | MCP SDK の `mcpAuthRouter` |
| 上流 IdP | Cloudflare Access | Amazon Cognito |
| 状態保存 | Workers KV | DynamoDB (TTL) |
| シークレット | Workers Secrets | Secrets Manager |
| IaC | wrangler | AWS SAM |
| 設定ファイル | `.dev.vars` | `infra/aws/params.yaml` |

提供されるツールと挙動はどちらも同じです。

## セットアップ

### 0. 前提

Node.js 20 以上が必要です。

```bash
git clone <this-repo>
cd my-own-backlog-remote-mcp-server
npm install
```

デプロイ先に応じて追加のツールが要ります。

| デプロイ先 | 必要なもの |
|---|---|
| Cloudflare Workers | Cloudflare アカウント (Workers 有効)、独自ドメイン (任意) |
| AWS | AWS アカウント、AWS CLI v2、AWS SAM CLI |

### 進める順番

1. **[Backlog の API キーとスペース設定](docs/backlog_ja.md)** — 両プラットフォーム共通
2. Identity Provider を選ぶ
   - **[Google Cloud](docs/idp-google_ja.md)**
   - **[Microsoft Entra ID](docs/idp-entra-id_ja.md)**
3. デプロイ先を選ぶ
   - **[Cloudflare Workers 版](docs/deploy-cloudflare_ja.md)**
   - **[AWS 版](docs/deploy-aws_ja.md)**

## アーキテクチャ

```
MCP クライアント (Claude, Kiro, Cursor など)
    ↓ Streamable HTTP + OAuth
実行環境 (Cloudflare Workers または AWS Lambda)
    ↓ 上流 IdP (Cloudflare Access または Amazon Cognito)
    ↓ メールアドレスの許可リスト判定
    ↓ Backlog API キーによるルーティング
Backlog スペース A / B / C ...
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
    aws/                   AWS Lambda 向けの配線
infra/
  aws/                     SAM テンプレートとパラメータ
```

`src/core` は `@modelcontextprotocol/sdk` と `zod` にしか依存せず、実行環境固有の
API を一切参照しません。プラットフォームを追加する場合は `src/platforms/` 配下に
アダプタを足すだけで、ツール実装をそのまま共有できます。

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

ローカル実行は Cloudflare Workers 版 (`wrangler dev`) で行います。ビジネスロジックは
`src/core` に集約されているため、ここで確認した挙動は AWS 版でもそのまま通用します。

```bash
cp .dev.vars.example .dev.vars   # 各値を設定
npm run dev
# http://localhost:8788/mcp で起動
```

`wrangler dev` は KV と Durable Object をローカルでエミュレートするため、実際の
Cloudflare リソースには触れません。

### 疎通確認

OAuth から MCP ツール実行までを一括で確認できます。

```bash
npm run check:local
```

以下の順に実行され、途中でブラウザが開くのでログインを完了させてください。

1. Authorization Server メタデータの取得
2. 動的クライアント登録
3. ブラウザで承認 → IdP ログイン
4. PKCE によるトークン交換
5. `initialize` / `tools/list`
6. `get_space` を実際に呼び出して Backlog からの応答を確認

`tools/list` に `access_denied` の 1 件だけが返る場合は、ログインしたメールアドレスが
許可リストに含まれていません。

**デプロイ済みのエンドポイントに対しても使えます。**

```bash
npm run check:local -- --base https://your-deployed-host
```

### HTTPS で起動する

IdP のリダイレクト URL が `http://` を受け付けない場合に使います。

```bash
npm run dev:https
# https://localhost:8788/mcp で起動 (自己署名証明書)
```

### 型チェックとテスト

プラットフォームごとに型を分離しているため、AWS 側で Workers のグローバルを
誤用するとエラーになります (逆も同様)。

```bash
npm run type-check      # tsconfig.cloudflare.json と tsconfig.aws.json の両方
npm run test:aws-oauth  # AWS 版 OAuth 認可サーバのロジック検証
```

### 設定ファイル

| ファイル | 用途 | Git |
|---|---|---|
| `.dev.vars` | ローカル開発 + Cloudflare デプロイ | 除外 |
| `.dev.vars.example` | 上記のひな形 | コミット |
| `infra/aws/params.yaml` | AWS デプロイ | 除外 |
| `infra/aws/params.example.yaml` | 上記のひな形 | コミット |

実値の書き方はそれぞれのデプロイ手順を参照してください。

## License

MIT
