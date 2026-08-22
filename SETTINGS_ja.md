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
      "name": "PERSONAL",
      "domain": "your-personal.backlog.com",
      "apiKey": "個人スペースのAPIキー"
    }
  ],
  "defaultSpace": "WORK"
}
```

| フィールド | 説明 |
|-----------|------|
| `name` | 任意のラベル。MCPツール呼び出し時の `space` パラメータとして使用 |
| `domain` | Backlogスペースのドメイン (例: `your-space.backlog.com` または `your-space.backlog.jp`) |
| `apiKey` | 上記で生成したAPIキー |
| `defaultSpace` | `space` パラメータ省略時に使用するスペース |

### 注意事項

- APIキーは、キー所有者の権限でBacklogスペースへのフルアクセスを許可します
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
2. **Create new application** → **SaaS application** をクリック
3. 設定:
   - Application name: `Backlog MCP Server`
   - Authentication protocol: **OIDC**
4. **Redirect URLs** に追加:
   ```
   https://backlog-remote-mcp-server.midnight480.com/callback
   ```
5. **Identity providers** で設定済みのIdPを有効化 (Google、Microsoft、または両方)
6. (任意) IdPが1つだけの場合、**Apply instant authentication** をONにするとログイン選択画面をスキップ

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

### Step 5.1: KV Namespaceの作成

```bash
npx wrangler kv namespace create "OAUTH_KV"
```

出力されたIDをコピーし、`wrangler.jsonc` を更新:

```jsonc
"kv_namespaces": [
  {
    "binding": "OAUTH_KV",
    "id": "<ここにKV IDを貼り付け>"
  }
]
```

### Step 5.2: 全Secretsの設定

```bash
# Cloudflare Accessの値 (Step 4.4参照)
npx wrangler secret put ACCESS_CLIENT_ID
npx wrangler secret put ACCESS_CLIENT_SECRET
npx wrangler secret put ACCESS_TOKEN_URL
npx wrangler secret put ACCESS_AUTHORIZATION_URL
npx wrangler secret put ACCESS_JWKS_URL

# Cookie暗号化キー
openssl rand -hex 32 | npx wrangler secret put COOKIE_ENCRYPTION_KEY

# 許可メールアドレス (JSON配列)
echo '["your-email@gmail.com", "your-ms@company.com"]' | npx wrangler secret put ALLOWED_EMAILS

# Backlogスペース設定 (JSON - セクション1参照)
npx wrangler secret put BACKLOG_SPACES_CONFIG
# プロンプトが出たらJSONを貼り付け
```

### Step 5.3: デプロイ

```bash
npm run deploy
```

Workerは以下にデプロイされます:
```
https://backlog-remote-mcp-server.midnight480.com/mcp
```

### Step 5.4: 動作確認

1. ブラウザで https://backlog-remote-mcp-server.midnight480.com/mcp を開く
2. Cloudflare Accessのログイン画面にリダイレクトされるはず
3. 設定したIdPで認証
4. ログイン成功後、MCPエンドポイントからJSONレスポンスが返る

### Step 5.5: MCP Inspectorでテスト

```bash
npx @modelcontextprotocol/inspector@latest
```

1. URL欄に `https://backlog-remote-mcp-server.midnight480.com/mcp` を入力
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
