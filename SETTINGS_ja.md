# 設定ガイド

Backlog Remote MCP Serverで使用する各サービスの詳細なセットアップ手順です。

[English version](./SETTINGS.md)

## 目次

1. [Backlog APIキー](#1-backlog-apiキー)
2. [Googleアカウント (Identity Provider)](#2-googleアカウント-identity-provider)
3. [Microsoft Entra ID (Identity Provider)](#3-microsoft-entra-id-identity-provider)
4. [Cloudflare Zero Trust & Access](#4-cloudflare-zero-trust--access)
5. [Cloudflare Workersデプロイ](#5-cloudflare-workersデプロイ)

---

## 1. Backlog APIキー

接続したい各BacklogスペースごとにAPIキーが必要です。

### 手順

1. Backlogスペースにログイン (例: `https://your-space.backlog.com`)
2. 右上のアバターをクリック → **個人設定**
3. **API** タブを開く
4. **新しいアプリケーションの登録** をクリック (またはプランにより **APIキーの発行**)
5. メモを入力 (例: `MCP Server`) → **登録**
6. 生成されたAPIキーをコピー

### 複数スペースがある場合

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
| `apiKey` | ✅ | 上記で生成したAPIキー |
| `readOnly` | | `true` で **GET以外のAPI呼び出しを拒否**。共用スペースの誤更新・誤削除を防ぎます |
| `defaultSpace` | ✅ | `space` パラメータ省略時に使用するスペース。`spaces` 内の `name` と一致させること |

この値は `.dev.vars` に1行のJSONとして設定します。

```
BACKLOG_SPACES_CONFIG={"spaces":[{"name":"WORK","domain":"your-company.backlog.com","apiKey":"xxx"},{"name":"SHARED","domain":"shared.backlog.jp","apiKey":"yyy","readOnly":true}],"defaultSpace":"WORK"}
```

### readOnly の使いどころ

MCPツールには `add_issue` / `update_issue` / `delete_issue` / `delete_project` といった破壊的操作が含まれ、呼び出す主体はLLMです。曖昧な指示が意図しないスペースに向いた場合、`readOnly: true` が最後の歯止めになります。

判定は `src/core/backlog-client.ts` のAPI呼び出し層で行われるため、個々のツール実装に依存せず、将来ツールが追加されても自動的に保護されます。拒否された場合はBacklog APIへリクエストを送る前にエラーが返ります。

```
Space "SHARED" is configured as read-only. Refusing POST /issues.
Use list_spaces to see which spaces allow writes.
```

各スペースの状態は `list_spaces` ツールで確認できます。

### 注意事項

- APIキーは、キー所有者の権限でBacklogスペースへのフルアクセスを許可します。`readOnly: true` はこのMCPサーバー内のガードであり、キー自体の権限を制限するものではありません
- 書き込みが不要なスペースには、Backlog側で権限を絞ったキーを発行し、あわせて `readOnly: true` を設定するのが確実です
- キーは機密情報です。Cloudflare Secretsに格納され、MCPクライアントには一切露出しません
- キーが漏洩した場合は、Backlogの個人設定 → API から即座に無効化してください

---

## 2. Googleアカウント (Identity Provider)

Cloudflare Access経由でGoogleを認証プロバイダーとして使用します。

### 前提条件

- Googleアカウント (GmailまたはGoogle Workspace)
- Cloudflare Zero Trust組織への管理者アクセス

### Step 2.1: Cloudflare Zero TrustでGoogleをIdPとして設定

1. **Cloudflare Dashboard** → **Zero Trust** → **Settings** → **Authentication**
2. **Login methods** の下で **Add new** をクリック
3. **Google** を選択
4. Google Cloud ConsoleでOAuth認証情報を作成する手順が表示されます

### Step 2.2: Google Cloud ConsoleでOAuth認証情報を作成

1. [Google Cloud Console](https://console.cloud.google.com/) にアクセス
2. プロジェクトを選択または新規作成
3. **APIとサービス** → **認証情報** に移動
4. **認証情報を作成** → **OAuthクライアントID** をクリック
5. アプリケーションの種類: **ウェブアプリケーション**
6. 名前: `Cloudflare Access`
7. 承認済みのリダイレクトURI: Cloudflare Zero Trustの設定画面に表示されているURIを追加
   - 形式: `https://<YOUR_TEAM_NAME>.cloudflareaccess.com/cdn-cgi/access/callback`
8. **作成** をクリック
9. **クライアントID** と **クライアントシークレット** をコピー

### Step 2.3: Cloudflareの設定を完了

1. Cloudflare Zero Trust Authenticationのページに戻る
2. GoogleのクライアントIDとクライアントシークレットを貼り付け
3. **Save** をクリック
4. **Test** をクリックして接続をテスト

### Step 2.4: OAuth同意画面の設定 (必要な場合)

テストが失敗するか同意画面エラーが出た場合:

1. Google Cloud Console → **APIとサービス** → **OAuth同意画面**
2. ユーザータイプ: **外部** (Google Workspaceの場合は **内部**)
3. アプリ名、サポートメール、デベロッパー連絡先を入力
4. スコープ: `email`, `profile`, `openid` を追加
5. テストユーザー: 自分のメールアドレスを追加 (外部かつ未公開の場合)
6. **保存** をクリック

---

## 3. Microsoft Entra ID (Identity Provider)

Cloudflare Access経由でMicrosoft Entra ID (旧 Azure AD) を認証プロバイダーとして使用します。

### 前提条件

- Microsoftアカウント (個人または職場/学校)
- Cloudflare Zero Trust組織への管理者アクセス
- [Microsoft Entra管理センター](https://entra.microsoft.com/) (またはAzure Portal) へのアクセス

### Step 3.1: Entra IDでアプリケーションを登録

1. [Microsoft Entra管理センター](https://entra.microsoft.com/) にアクセス
2. **ID** → **アプリケーション** → **アプリの登録** に移動
3. **新規登録** をクリック
4. 設定:
   - 名前: `Cloudflare Access`
   - サポートされているアカウントの種類: 用途に応じて選択
     - **この組織ディレクトリのみ**: 自分の組織だけ
     - **マルチテナント + 個人**: 任意のMicrosoftアカウント
   - リダイレクトURI:
     - プラットフォーム: **Web**
     - URI: `https://<YOUR_TEAM_NAME>.cloudflareaccess.com/cdn-cgi/access/callback`
5. **登録** をクリック
6. **アプリケーション (クライアント) ID** と **ディレクトリ (テナント) ID** を控える

### Step 3.2: クライアントシークレットの作成

1. 登録したアプリで **証明書とシークレット** を開く
2. **新しいクライアントシークレット** をクリック
3. 説明: `Cloudflare Access`
4. 有効期限: 適切な期間を選択 (推奨: 24ヶ月)
5. **追加** をクリック
6. **値** をすぐにコピー (後から表示できません)

### Step 3.3: APIアクセス許可の設定

1. **APIのアクセス許可** を開く
2. **アクセス許可の追加** → **Microsoft Graph** → **委任されたアクセス許可**
3. 以下の許可を追加:
   - `email`
   - `openid`
   - `profile`
   - `User.Read`
4. **[組織名] に管理者の同意を与えます** をクリック (管理者権限がある場合)

### Step 3.4: Cloudflare Zero Trustの設定

1. **Cloudflare Dashboard** → **Zero Trust** → **Settings** → **Authentication**
2. **Login methods** の下で **Add new** をクリック
3. **Azure AD** を選択
4. 入力:
   - Application ID: Step 3.1のクライアントID
   - Application secret: Step 3.2のクライアントシークレット
   - Directory ID: Step 3.1のテナントID
5. (任意) グループベースのアクセスポリシーを使いたい場合は **Support Groups** を有効化
6. **Save** をクリック
7. **Test** をクリックして接続をテスト

---

## 4. Cloudflare Zero Trust & Access

### Step 4.1: Zero Trust組織の作成 (未作成の場合)

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) にアクセス
2. 左サイドバーの **Zero Trust** をクリック
3. プロンプトに従ってチーム名を作成 (例: `your-team`)
4. これで `your-team.cloudflareaccess.com` ドメインが使えるようになります

### Step 4.2: Access SaaS Applicationの作成

1. **Zero Trust** → **Access controls** → **Applications**
2. **Create new application** → **SaaS applications** タブ → **OpenID Connect (OIDC)** を選択
3. 設定:
   - Application name: `Backlog MCP Server`
   - Authentication protocol: **OIDC** (SAMLではない)
4. **Redirect URLs** に2つ追加:
   ```
   https://<MCP_HOSTNAME>/callback
   http://localhost:8788/callback
   ```
   下はローカル検証 (`npm run check:local`) 用です。Accessが `http://` を拒否する場合は `npm run dev:https` を使い `https://localhost:8788/callback` を登録してください。
5. **Proof Key for Code Exchange (PKCE)** を **ON** にする

   Workerは常に `code_challenge` (S256) を送るため必須です。OFFのままだとトークン交換が失敗します。
   その下に現れる **Allow PKCE without Client Secret** は **OFF** のままにしてください (Workerはclient_secretを送る機密クライアントです)。
6. **Identity providers** で設定済みのIdPを有効化 (Google、Microsoft、または両方)
7. (任意) IdPが1つだけの場合、**Apply instant authentication** をONにするとログイン選択画面をスキップ

### Step 4.3: Access Policyの設定

1. 同じアプリケーション設定画面の **Policies** セクション
2. ポリシーを作成:
   - Name: `Allow me`
   - Action: **Allow**
   - Include rules:
     - **Emails**: `your-email@gmail.com`, `your-ms@company.com`
   - (またはEmail domain、IdP groups等を使用)
3. **Save** をクリック

### Step 4.4: エンドポイント情報の確認

アプリケーション作成後、以下の値が表示されます:

| フィールド | 例 |
|-----------|-----|
| Client ID | `abc123...` |
| Client Secret | `secret456...` |
| Token endpoint | `https://your-team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<client_id>/token` |
| Authorization endpoint | `https://your-team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<client_id>/authorization` |
| Key (JWKS) endpoint | `https://your-team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<client_id>/jwks` |

Worker Secretsとの対応:

| Secret名 | 設定元 |
|----------|-------|
| `ACCESS_CLIENT_ID` | Client ID |
| `ACCESS_CLIENT_SECRET` | Client Secret |
| `ACCESS_TOKEN_URL` | Token endpoint |
| `ACCESS_AUTHORIZATION_URL` | Authorization endpoint |
| `ACCESS_JWKS_URL` | Key (JWKS) endpoint |

### Step 4.5: (任意) リフレッシュトークンの有効化

**Advanced settings** → **Refresh tokens** をONにすると再認証の頻度を減らせます。

---

## 5. Cloudflare Workersデプロイ

### Step 5.1: .dev.vars の作成

環境固有の値はすべて `.dev.vars` に集約します。このファイルはローカル開発とデプロイの両方から参照され、`.gitignore` 済みです。

```bash
cp .dev.vars.example .dev.vars
```

### Step 5.2: KV Namespaceの作成

```bash
npx wrangler kv namespace create backlog-remote-mcp-server-OAUTH_KV
```

出力された `id` を `.dev.vars` に設定します。

```
OAUTH_KV_ID=0123456789abcdef0123456789abcdef
```

> **Warning**
> 他のWorkerと共用のnamespaceを使わないでください。OAuthの認可コード・アクセストークン・承認済みクライアントがここに格納されます。共有すると別Workerと認証情報が混ざります。既に `OAUTH_KV` という汎用名のnamespaceがある場合も、プロジェクト名を接頭辞に付けた専用のものを新規作成してください。

`wrangler.jsonc` を編集する必要はありません。デプロイ時に `.dev.vars` の値が注入されます。

### Step 5.3: .dev.vars の記入

Step 4.4 で確認した値と、セクション1で作成したスペース設定を書き込みます。

```
# デプロイ先のカスタムドメイン
MCP_HOSTNAME=backlog-remote-mcp-server.example.com

# Step 5.2 で作成した KV namespace の ID
OAUTH_KV_ID=0123456789abcdef0123456789abcdef

# Step 4.4 の値
ACCESS_CLIENT_ID=...
ACCESS_CLIENT_SECRET=...
ACCESS_TOKEN_URL=https://<team>.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<client_id>/token
ACCESS_AUTHORIZATION_URL=https://<team>.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<client_id>/authorization
ACCESS_JWKS_URL=https://<team>.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<client_id>/jwks

# Cookie暗号化キー
COOKIE_ENCRYPTION_KEY=<openssl rand -hex 32 の出力>

# 許可メールアドレス (JSON配列)
ALLOWED_EMAILS=["your-email@gmail.com","your-ms@company.com"]

# Backlogスペース設定 (セクション1参照)
BACKLOG_SPACES_CONFIG={"spaces":[...],"defaultSpace":"WORK"}
```

`COOKIE_ENCRYPTION_KEY` は以下で生成できます。

```bash
openssl rand -hex 32
```

> **Note**
> `ALLOWED_EMAILS` はAccess Policyとは別のチェックです。**両方**に同じアドレスが入っていないとツールが利用できません。片方だけだとログインは通るのに `access_denied` ツール1件しか返らない、という状態になります。

### Step 5.4: ローカルでの疎通確認 (推奨)

デプロイ前にローカルで全経路を確認できます。

```bash
npm run dev          # 別ターミナルで起動したままにする
npm run check:local  # 別ターミナルで実行
```

`check:local` は以下を順に実行し、途中でブラウザが開くのでAccessログインを完了させてください。

1. Authorization Serverメタデータの取得
2. 動的クライアント登録
3. ブラウザで承認 → Access ログイン
4. PKCEによるトークン交換
5. `initialize` / `tools/list`
6. `get_space` を実際に呼び出してBacklogからの応答を確認

ここが通れば、Access設定・PKCE・メール許可・Backlog APIキーがすべて正しいことになります。

### Step 5.5: デプロイ

```bash
npm run deploy
```

3ステップが順に実行されます。

1. `.dev.vars` の `MCP_HOSTNAME` と `OAUTH_KV_ID` を注入した `wrangler.deploy.json` を生成
2. `.dev.vars` の値を `wrangler secret bulk` でWorkerのシークレットとして登録
3. `wrangler deploy`

> **Warning**
> `wrangler.jsonc` にはカスタムドメインもKV IDも含まれていません。素の `npx wrangler deploy` はカスタムドメインが付かず、KV IDもプレースホルダのままで失敗します。必ず `npm run deploy` を使ってください。

Workerは以下にデプロイされます。

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

シークレットを個別に設定したい場合は従来の方法も使えます。

```bash
npx wrangler secret put ACCESS_CLIENT_SECRET
```

> **Note**
> `npm run deploy` は `.dev.vars` の値で本番のシークレットを**上書き**します。ローカルと本番で値を分けたくなった場合は、通常のデプロイに `deploy:no-secrets` を使い、シークレット更新は `secrets:push` で明示的に行う運用に切り替えてください。

### Step 5.6: 動作確認

1. ブラウザで `https://<MCP_HOSTNAME>/mcp` を開く
2. Cloudflare Accessのログイン画面にリダイレクトされるはず
3. 設定したIdPで認証
4. ログイン成功後、MCPエンドポイントからJSONレスポンスが返る

### Step 5.7: MCP Inspectorでテスト

```bash
npx @modelcontextprotocol/inspector@latest
```

1. URL欄に `https://<MCP_HOSTNAME>/mcp` を入力
2. **OAuth Settings** → **Quick OAuth Flow** をクリック
3. 認証を完了
4. **Connect** → **List Tools** をクリックし、全ツールが表示されることを確認

---

## トラブルシューティング

| 問題 | 解決策 |
|------|--------|
| コールバックで "Missing id token" エラー | Access SaaS Appのプロトコルが **OIDC** (SAMLではない) であることを確認 |
| ログイン後 "User not authorized" | Access Policyのメールアドレス **と** `ALLOWED_EMAILS` secretの両方を確認 |
| "Invalid state signature" | COOKIE_ENCRYPTION_KEYが変更された可能性。ブラウザCookieをクリアして再試行 |
| 接続後にツールが表示されない | `BACKLOG_SPACES_CONFIG` のJSONが有効か確認。`wrangler tail` でWorkerログを確認 |
| Google "access_denied" エラー | OAuth同意画面が設定されており、テストユーザーに自分のメールが含まれているか確認 (未公開の場合) |
| Entra ID "AADSTS..." エラー | リダイレクトURIが完全に一致すること、管理者の同意が付与されていること、シークレットが期限切れでないことを確認 |
| トークン交換が失敗する / `invalid_grant` | Access SaaS Appの **PKCE** がONか確認 (Step 4.2)。Workerは常に `code_challenge` を送ります |
| `MCP_HOSTNAME が未設定です` / `OAUTH_KV_ID が未設定です` | `.dev.vars` に該当キーがないか、プレースホルダのままです (Step 5.2 / 5.3) |
| `Space "..." is configured as read-only` | そのスペースに `readOnly: true` が設定されています。書き込みが必要なら `BACKLOG_SPACES_CONFIG` から外してください |
| `Space "..." not found` | `defaultSpace` または `space` 引数が `spaces` 内の `name` と一致していません。`list_spaces` で確認できます |
| デプロイしたがカスタムドメインが付かない | 素の `wrangler deploy` を実行していませんか。`npm run deploy` を使ってください |
| ローカルで `/callback` に戻れない | Access SaaS Appのリダイレクトに `http://localhost:8788/callback` を追加してください (Step 4.2) |
