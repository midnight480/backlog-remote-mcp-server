# AWS へのデプロイ

前提: [Backlog の設定](backlog_ja.md) と、[Google](idp-google_ja.md) または
[Entra ID](idp-entra-id_ja.md) のいずれかの IdP 設定が済んでいること。

## 構成

| 役割 | 使うもの |
|---|---|
| 実行環境 | AWS Lambda (Node.js 22 / arm64) |
| 公開エンドポイント | API Gateway HTTP API |
| MCP セッション | 持たない (ステートレス) |
| OAuth 認可サーバ | MCP SDK の `mcpAuthRouter` (自前ホスト) |
| 上流 IdP | Amazon Cognito User Pool |
| 状態保存 | DynamoDB (TTL で自動失効) |
| シークレット | AWS Secrets Manager |
| 同意画面の署名鍵 | Secrets Manager (CloudFormation が自動生成) |
| IaC | AWS SAM |
| 設定ファイル | `infra/aws/params.yaml` |

### Cloudflare 版との違い

- **Durable Objects に相当する仕組みがない**ため、MCP はステートレスで動かします。
  現状の全ツールはリクエスト/レスポンス型でサーバ発の push を使っていないため、
  機能上の欠落はありません。
- **Cognito は動的クライアント登録 (RFC 7591) に対応していません。** MCP クライアントは
  DCR を使うため Cognito を認可サーバにはできません。認可サーバは MCP SDK の実装を
  自前でホストし、Cognito は**ユーザー認証だけを担う上流 IdP** として置きます。
  これは Cloudflare 版で Cloudflare Access が担っている役割と同じです。
- **Lambda Function URL は使いません。** `WWW-Authenticate` ヘッダを
  `x-amzn-Remapped-www-authenticate` に書き換えてしまい、MCP クライアントの
  保護リソース探索 (RFC 9728) が働かなくなるためです。API Gateway HTTP API は
  このヘッダをそのまま通します。

## 前提ツール

```bash
aws --version    # AWS CLI v2
sam --version    # AWS SAM CLI
node --version   # Node.js 20 以上
```

AWS の認証情報が設定済みであること (`aws sts get-caller-identity` で確認)。

## 1. 設定ファイルの作成

```bash
cp infra/aws/params.example.yaml infra/aws/params.yaml
```

`infra/aws/params.yaml` は `.gitignore` 済みです。以降の手順で値を埋めます。

> **Note**
> `sam deploy --parameter-overrides` に値を直接書くと**カンマで分割されて JSON が壊れます**。
> 必ずこのファイル経由で渡してください。`npm run aws:deploy` はそうなっています。

## 2. 必須項目を記入

```yaml
# Backlog スペース設定 (1 行の JSON)。docs/backlog_ja.md 参照
BacklogSpacesConfig: '{"spaces":[...],"defaultSpace":"..."}'

# 許可するメールアドレス (JSON 配列)
AllowedEmails: '["your-email@example.com"]'

# Cognito Hosted UI のドメイン接頭辞 (グローバルに一意)
CognitoDomainPrefix: 'your-unique-prefix'

# 1 回目のデプロイでは placeholder のままにする
PublicBaseUrl: 'https://placeholder.invalid'
```

`CognitoDomainPrefix` は AWS 全体で一意である必要があります。プロジェクト名 +
ランダム文字列にしておくと衝突しません。

## 3. IdP (Google) を設定する場合

[Google Cloud の設定](idp-google_ja.md) で作成した OAuth クライアントの値を記入します。

```yaml
GoogleClientId: '....apps.googleusercontent.com'
GoogleClientSecret: 'GOCSPX-....'
```

**空のままでも構いません。** その場合 Google 連携は作られず、Cognito の内部ユーザー
のみになります。後から追加できます。

Google Cloud Console の「承認済みのリダイレクト URI」に以下を登録してください。

```
https://<CognitoDomainPrefix>.auth.<REGION>.amazoncognito.com/oauth2/idpresponse
```

## 4. カスタムドメイン (任意)

既定では API Gateway のエンドポイント (`https://xxxx.execute-api.<region>.amazonaws.com`)
を使います。独自ドメインを割り当てる場合、**DNS の管理先によって手順が変わります**。

### Route 53 にゾーンがある場合 (全自動)

ホストゾーン ID を入れるだけです。証明書の発行・DNS 検証・A レコード作成まで
CloudFormation が行います。

```yaml
ApiDomainName: 'backlog-mcp.example.com'
HostedZoneId: 'Z0123456789ABCDEFGHIJ'
AcmCertificateArn: ''
```

### Route 53 以外で DNS を管理している場合 (Cloudflare など)

証明書を先に発行します。テンプレート内で作らないのは、Route 53 外だと
CloudFormation が DNS 検証の完了を待ち続けてスタックごと詰まるためです。

```bash
npm run aws:request-cert -- --domain backlog-mcp.example.com
```

表示された CNAME を DNS に登録すると、検証完了まで待って ARN を出力します。
中断しても証明書は残り、再実行で続きから進みます。

```yaml
ApiDomainName: 'backlog-mcp.example.com'
HostedZoneId: ''
AcmCertificateArn: 'arn:aws:acm:...'
```

デプロイ後、出力される `CustomDomainTarget` に向けて CNAME を登録します。

> **Warning**
> Cloudflare DNS の場合、**Proxy は必ず OFF (DNS only)** にしてください。
> ON にすると Cloudflare が TLS を終端し、API Gateway 側の証明書と噛み合いません。
> ACM の検証用レコードも同様です。

## 5. デプロイ

```bash
npm run aws:deploy
```

以下が順に行われます。

1. `sam build` (esbuild で CJS にバンドル)
2. `sam deploy` — Lambda / API Gateway / DynamoDB / Cognito / Secrets Manager を作成
3. Secrets Manager に `BacklogSpacesConfig` と Cognito の client secret を登録

**シークレットはデプロイの過程で自動登録されます。** Lambda の環境変数には ARN しか
入りません (環境変数は `lambda:GetFunctionConfiguration` 権限があれば読めるため)。

### 2 回目のデプロイ

1 回目の出力に含まれるエンドポイントを `PublicBaseUrl` に設定して再デプロイします。
これで issuer と Cognito のコールバック URL が確定します。

```yaml
# カスタムドメインを使う場合はそちらを指定する
PublicBaseUrl: 'https://backlog-mcp.example.com'
```

```bash
npm run aws:deploy
```

## 6. 動作確認

```bash
curl https://<PublicBaseUrl>/health
```

MCP エンドポイントまで含めた疎通確認は、Cloudflare 版と同じスクリプトが使えます。

```bash
npm run check:local -- --base https://<PublicBaseUrl>
```

ブラウザが開くのでログインを完了させると、`tools/list` と `get_space` まで確認します。

## コマンド一覧

| コマンド | 動作 |
|---|---|
| `npm run aws:validate` | テンプレートの検証 |
| `npm run aws:build` | ビルドのみ |
| `npm run aws:deploy` | ビルド + デプロイ + シークレット登録 |
| `npm run aws:secrets:push` | シークレットのみ更新 |
| `npm run aws:secrets:dry-run` | 送信されるシークレット名の確認 (値は非表示) |
| `npm run aws:request-cert` | ACM 証明書の発行と検証待ち |

## スタック名を変える

既定は `backlog-mcp-aws` です。変更する場合は `package.json` の `aws:deploy` にある
`--stack-name` を書き換えてください。

**CloudFormation はスタック名を変更できません。** 名前を変えるとスタックの
作り直し (削除 → 再作成) になります。API Gateway のカスタムドメインも作り直されるため、
CNAME の向き先が変わる点に注意してください。

## 削除

```bash
sam delete --stack-name backlog-mcp-aws --region ap-northeast-1
```

ACM 証明書はスタック外なので残ります。DNS レコードも手動で削除してください。

## トラブルシューティング

| 問題 | 解決策 |
|------|--------|
| `Unzipped size must be smaller than 262144000 bytes` | `sam deploy` に元テンプレートを渡しています。ビルド済みの `.aws-sam/build/template.yaml` を指定してください (`npm run aws:deploy` はそうなっています) |
| 環境変数に `{` だけが入る | `--parameter-overrides` に JSON を直接渡すとカンマで分割されます。`file://infra/aws/params.yaml` を使ってください |
| `Dynamic require of "http" is not supported` | ESM でバンドルされています。`Format: cjs` を確認してください |
| MCP が 406 `Client must accept both application/json and text/event-stream` | `serverless-http` の擬似 Node リクエストからヘッダが読めていません。`web-bridge.ts` 経由で Web 標準の Request を組み立てる実装になっているか確認してください |
| `invalid_client_secret` | Cognito アプリクライアントの secret が Lambda に渡っていません。Secrets Manager の `<stack>/upstream-client-secret` を確認してください |
| 同意画面が毎回出る | 承認は `__Host-APPROVED_CLIENTS` Cookie に記録されます。Cookie を消したか、MCP クライアントが毎回新しい `client_id` を動的登録している可能性があります |
| ログイン後に `access_denied` | `AllowedEmails` にそのアドレスが含まれていません |
| `redirect_uri_mismatch` (Google) | Google Cloud Console の承認済みリダイレクト URI に Cognito の `/oauth2/idpresponse` が登録されていません |
| `Space "..." is configured as read-only` | そのスペースに `readOnly: true` が設定されています |
| カスタムドメインで TLS エラー | Cloudflare DNS の Proxy が ON になっていませんか。DNS only にしてください |
| CloudWatch に `Runtime.NodeJsExit` が出る | 既知の問題です。外部への `fetch` を行う経路 (`/callback` と Backlog を呼ぶ `tools/call`) でのみ発生し、**応答自体は正常**です。Node 組み込み fetch (undici) の keep-alive ソケットが Lambda の凍結と噛み合わないことが原因と見ています。実害はログノイズのみのため未対応です |

---

- 戻る: [README](../README_ja.md)
- 別のプラットフォーム: [Cloudflare Workers 版](deploy-cloudflare_ja.md)
