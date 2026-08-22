# Configuration Guide

Detailed setup instructions for each service used by Backlog Remote MCP Server.

[日本語版](./SETTINGS_ja.md)

## Table of Contents

1. [Backlog API Key](#1-backlog-api-key)
2. [Google Account (Identity Provider)](#2-google-account-identity-provider)
3. [Microsoft Entra ID (Identity Provider)](#3-microsoft-entra-id-identity-provider)
4. [Cloudflare Zero Trust & Access](#4-cloudflare-zero-trust--access)
5. [Cloudflare Workers Deployment](#5-cloudflare-workers-deployment)

---

## 1. Backlog API Key

You need an API key for each Backlog space you want to connect.

### Steps

1. Log in to your Backlog space (e.g., `https://your-space.backlog.com`)
2. Click your avatar (top-right) → **Personal Settings**
3. Go to the **API** tab
4. Click **Register new application** (or **Generate API Key** depending on your plan)
5. Enter a memo (e.g., `MCP Server`) and click **Submit**
6. Copy the generated API key

### Repeat for Each Space

If you have multiple spaces, repeat the above for each one. Then format them into the `BACKLOG_SPACES_CONFIG` JSON:

```json
{
  "spaces": [
    {
      "name": "WORK",
      "domain": "your-company.backlog.com",
      "apiKey": "apikey-for-work-space"
    },
    {
      "name": "PERSONAL",
      "domain": "your-personal.backlog.com",
      "apiKey": "apikey-for-personal-space"
    }
  ],
  "defaultSpace": "WORK"
}
```

| Field | Description |
|-------|-------------|
| `name` | A label you choose. Used as the `space` parameter in MCP tool calls |
| `domain` | Your Backlog space domain (e.g., `your-space.backlog.com` or `your-space.backlog.jp`) |
| `apiKey` | The API key generated above |
| `defaultSpace` | Which space to use when `space` parameter is omitted |

### Important Notes

- API keys grant full access to the Backlog space on behalf of the key owner
- Keep keys confidential. They are stored as Cloudflare Secrets and never exposed to MCP clients
- If a key is compromised, revoke it immediately from Backlog Personal Settings → API

---

## 2. Google Account (Identity Provider)

Use Google as the authentication provider via Cloudflare Access.

### Prerequisites

- A Google account (Gmail or Google Workspace)
- Admin access to your Cloudflare Zero Trust organization

### Step 2.1: Configure Google as an IdP in Cloudflare Zero Trust

1. Go to **Cloudflare Dashboard** → **Zero Trust** → **Settings** → **Authentication**
2. Under **Login methods**, click **Add new**
3. Select **Google**
4. You will see instructions to create OAuth credentials in Google Cloud Console

### Step 2.2: Create OAuth Credentials in Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select or create a project
3. Navigate to **APIs & Services** → **Credentials**
4. Click **Create Credentials** → **OAuth client ID**
5. Application type: **Web application**
6. Name: `Cloudflare Access`
7. Authorized redirect URIs: Add the URI shown in the Cloudflare Zero Trust setup page
   - Format: `https://<YOUR_TEAM_NAME>.cloudflareaccess.com/cdn-cgi/access/callback`
8. Click **Create**
9. Copy the **Client ID** and **Client Secret**

### Step 2.3: Complete Cloudflare Setup

1. Back in the Cloudflare Zero Trust Authentication page
2. Paste the Client ID and Client Secret from Google
3. Click **Save**
4. Test the connection by clicking **Test**

### Step 2.4: Configure OAuth Consent Screen (if needed)

If the test fails or you get a consent screen error:

1. Google Cloud Console → **APIs & Services** → **OAuth consent screen**
2. User Type: **External** (or Internal for Google Workspace)
3. Fill in app name, support email, and developer contact
4. Scopes: Add `email`, `profile`, `openid`
5. Test users: Add your email address (if External and not yet published)
6. Click **Save**

---

## 3. Microsoft Entra ID (Identity Provider)

Use Microsoft Entra ID (formerly Azure AD) as the authentication provider via Cloudflare Access.

### Prerequisites

- A Microsoft account (personal or work/school)
- Admin access to your Cloudflare Zero Trust organization
- Access to [Microsoft Entra admin center](https://entra.microsoft.com/) (or Azure Portal)

### Step 3.1: Register an Application in Entra ID

1. Go to [Microsoft Entra admin center](https://entra.microsoft.com/)
2. Navigate to **Identity** → **Applications** → **App registrations**
3. Click **New registration**
4. Configure:
   - Name: `Cloudflare Access`
   - Supported account types: Choose based on your needs
     - **Single tenant**: Only your organization
     - **Multitenant + personal**: Any Microsoft account
   - Redirect URI:
     - Platform: **Web**
     - URI: `https://<YOUR_TEAM_NAME>.cloudflareaccess.com/cdn-cgi/access/callback`
5. Click **Register**
6. Note the **Application (client) ID** and **Directory (tenant) ID**

### Step 3.2: Create a Client Secret

1. In the registered app, go to **Certificates & secrets**
2. Click **New client secret**
3. Description: `Cloudflare Access`
4. Expiry: Choose an appropriate duration (recommended: 24 months)
5. Click **Add**
6. Copy the **Value** immediately (it will not be shown again)

### Step 3.3: Configure API Permissions

1. Go to **API permissions**
2. Click **Add a permission** → **Microsoft Graph** → **Delegated permissions**
3. Add these permissions:
   - `email`
   - `openid`
   - `profile`
   - `User.Read`
4. Click **Grant admin consent for [your org]** (if you have admin access)

### Step 3.4: Configure Cloudflare Zero Trust

1. Go to **Cloudflare Dashboard** → **Zero Trust** → **Settings** → **Authentication**
2. Under **Login methods**, click **Add new**
3. Select **Azure AD**
4. Fill in:
   - Application ID: The client ID from Step 3.1
   - Application secret: The client secret from Step 3.2
   - Directory ID: The tenant ID from Step 3.1
5. (Optional) Enable **Support Groups** if you want group-based access policies
6. Click **Save**
7. Test the connection by clicking **Test**

---

## 4. Cloudflare Zero Trust & Access

### Step 4.1: Create Zero Trust Organization (if not done)

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **Zero Trust** in the left sidebar
3. Follow the prompts to create a team name (e.g., `your-team`)
4. This gives you a `your-team.cloudflareaccess.com` domain

### Step 4.2: Create Access SaaS Application

1. Go to **Zero Trust** → **Access controls** → **Applications**
2. Click **Create new application** → **SaaS application**
3. Configure:
   - Application name: `Backlog MCP Server`
   - Authentication protocol: **OIDC**
4. Under **Redirect URLs**, add:
   ```
   https://backlog-remote-mcp-server.midnight480.com/callback
   ```
5. Under **Identity providers**, enable the IdPs you configured (Google, Microsoft, or both)
6. (Optional) If only one IdP is enabled, turn on **Apply instant authentication** to skip the login method selection screen

### Step 4.3: Configure Access Policies

1. In the same application setup, under **Policies**
2. Create a policy:
   - Name: `Allow me`
   - Action: **Allow**
   - Include rules:
     - **Emails**: `your-email@gmail.com`, `your-ms@company.com`
   - (Or use **Email domain**, **IdP groups**, etc.)
3. Click **Save**

### Step 4.4: Note the Endpoints

After creating the application, you will see:

| Field | Example Value |
|-------|--------------|
| Client ID | `abc123...` |
| Client Secret | `secret456...` |
| Token endpoint | `https://your-team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<client_id>/token` |
| Authorization endpoint | `https://your-team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<client_id>/authorization` |
| Key (JWKS) endpoint | `https://your-team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<client_id>/jwks` |

These values map to the Worker secrets:

| Secret Name | Value From |
|-------------|-----------|
| `ACCESS_CLIENT_ID` | Client ID |
| `ACCESS_CLIENT_SECRET` | Client Secret |
| `ACCESS_TOKEN_URL` | Token endpoint |
| `ACCESS_AUTHORIZATION_URL` | Authorization endpoint |
| `ACCESS_JWKS_URL` | Key (JWKS) endpoint |

### Step 4.5: (Optional) Enable Refresh Tokens

Under **Advanced settings** → turn on **Refresh tokens** to reduce re-authentication frequency.

---

## 5. Cloudflare Workers Deployment

### Step 5.1: Create KV Namespace

```bash
npx wrangler kv namespace create "OAUTH_KV"
```

Copy the output ID and update `wrangler.jsonc`:

```jsonc
"kv_namespaces": [
  {
    "binding": "OAUTH_KV",
    "id": "<paste-your-kv-id-here>"
  }
]
```

### Step 5.2: Set All Secrets

```bash
# Cloudflare Access values (from Step 4.4)
npx wrangler secret put ACCESS_CLIENT_ID
npx wrangler secret put ACCESS_CLIENT_SECRET
npx wrangler secret put ACCESS_TOKEN_URL
npx wrangler secret put ACCESS_AUTHORIZATION_URL
npx wrangler secret put ACCESS_JWKS_URL

# Cookie encryption key
openssl rand -hex 32 | npx wrangler secret put COOKIE_ENCRYPTION_KEY

# Allowed emails (JSON array)
echo '["your-email@gmail.com", "your-ms@company.com"]' | npx wrangler secret put ALLOWED_EMAILS

# Backlog spaces config (JSON - see Section 1)
npx wrangler secret put BACKLOG_SPACES_CONFIG
# Then paste the JSON when prompted
```

### Step 5.3: Deploy

```bash
npm run deploy
```

The Worker deploys to:
```
https://backlog-remote-mcp-server.midnight480.com/mcp
```

### Step 5.4: Verify

1. Open https://backlog-remote-mcp-server.midnight480.com/mcp in a browser
2. You should be redirected to the Cloudflare Access login page
3. Authenticate with your configured IdP
4. After successful login, you should see a JSON response from the MCP endpoint

### Step 5.5: Test with MCP Inspector

```bash
npx @modelcontextprotocol/inspector@latest
```

1. Enter the URL: `https://backlog-remote-mcp-server.midnight480.com/mcp`
2. Click **OAuth Settings** → **Quick OAuth Flow**
3. Complete the authentication
4. Click **Connect** → **List Tools** to verify all tools are available

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Missing id token" error on callback | Ensure the Access SaaS app protocol is set to **OIDC**, not SAML |
| "User not authorized" after login | Check both Access Policy emails AND `ALLOWED_EMAILS` secret |
| "Invalid state signature" | COOKIE_ENCRYPTION_KEY may have been changed. Clear browser cookies and retry |
| Tools not showing after connect | Check `BACKLOG_SPACES_CONFIG` JSON is valid. Check Worker logs with `wrangler tail` |
| Google "access_denied" error | Ensure OAuth consent screen is configured and your email is in test users (if not published) |
| Entra ID "AADSTS..." errors | Verify redirect URI matches exactly, admin consent is granted, and secret is not expired |
