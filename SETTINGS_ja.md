# セットアップ手順の索引

このファイルは索引です。手順はプラットフォームごとに `docs/` へ分割しました。

[English](SETTINGS.md) | 日本語

## 進める順番

### 1. 共通

| ドキュメント | 内容 |
|---|---|
| **[Backlog の API キーとスペース設定](docs/backlog_ja.md)** | API キーの発行、`BACKLOG_SPACES_CONFIG` の組み立て、`readOnly` の使いどころ |

### 2. Identity Provider を選ぶ

どちらか一方、または両方を設定します。

| ドキュメント | 内容 |
|---|---|
| **[Google Cloud](docs/idp-google_ja.md)** | OAuth クライアントの作成、リダイレクト URI (Cloudflare / AWS 両対応) |
| **[Microsoft Entra ID](docs/idp-entra-id_ja.md)** | アプリ登録、クライアントシークレット、API アクセス許可 |

### 3. デプロイ先を選ぶ

| ドキュメント | 内容 |
|---|---|
| **[Cloudflare Workers 版](docs/deploy-cloudflare_ja.md)** | Zero Trust / Access、KV、Workers Secrets、wrangler |
| **[AWS 版](docs/deploy-aws_ja.md)** | Lambda、API Gateway、Cognito、DynamoDB、Secrets Manager、SAM |

## どちらを選ぶか

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

提供されるツールと挙動はどちらも同じです。ビジネスロジックは `src/core` で共有され、
実行環境固有の配線だけが `src/platforms/` 配下で分かれています。

## トラブルシューティング

デプロイ先ごとの手順書の末尾にあります。

- [Cloudflare 版のトラブルシューティング](docs/deploy-cloudflare_ja.md#トラブルシューティング)
- [AWS 版のトラブルシューティング](docs/deploy-aws_ja.md#トラブルシューティング)

---

概要と使い方は [README](README_ja.md) を参照してください。
