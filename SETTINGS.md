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
      "name": "SHARED",
      "domain": "shared.backlog.jp",
      "apiKey": "apikey-for-shared-space",
      "readOnly": true
    }
  ],
  "defaultSpace": "WORK"
}
```

| Field | Required | Description |
|-------|:---:|-------------|
| `name` | ✅ | A label you choose. Used as the `space` parameter in MCP tool calls. Matching is case-insensitive |
| `domain` | ✅ | Your Backlog space domain (e.g., `your-space.backlog.com` or `your-space.backlog.jp`). No scheme |
| `apiKey` | ✅ | The API key generated above |
| `readOnly` | | When `true`, **all non-GET API calls are rejected**, guarding shared spaces against accidental writes and deletes |
| `defaultSpace` | ✅ | Which space to use when the `space` parameter is omitted. Must match a `name` in `spaces` |

Set this in `.dev.vars` as a single-line JSON value:

```
BACKLOG_SPACES_CONFIG={"spaces":[{"name":"WORK","domain":"your-company.backlog.com","apiKey":"xxx"},{"name":"SHARED","domain":"shared.backlog.jp","apiKey":"yyy","readOnly":true}],"defaultSpace":"WORK"}
```

### When to use readOnly

The tool set includes destructive operations such as `add_issue`, `update_issue`, `delete_issue`, and `delete_project`, and the caller is an LLM. When an ambiguous instruction is aimed at the wrong space, `readOnly: true` is the backstop.

The check lives in the API-call layer of `src/backlog-client.ts`, so it does not depend on individual tool implementations and automatically covers tools added later. Rejection happens before any request reaches the Backlog API:

```
Space "SHARED" is configured as read-only. Refusing POST /issues.
Use list_spaces to see which spaces allow writes.
```

Use the `list_spaces` tool to see the status of each space.

### Important Notes

- API keys grant full access to the Backlog space on behalf of the key owner. `readOnly: true` is a guard inside this MCP server; it does not restrict the key itself
- For spaces that need no writes, issue a permission-restricted key in Backlog *and* set `readOnly: true`
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
2. Click **Create new application** → **SaaS applications** tab → **OpenID Connect (OIDC)**
3. Configure:
   - Application name: `Backlog MCP Server`
   - Authentication protocol: **OIDC** (not SAML)
4. Under **Redirect URLs**, add two entries:
   ```
   https://<MCP_HOSTNAME>/callback
   http://localhost:8788/callback
   ```
   The second is for local verification (`npm run check:local`). If Access rejects `http://`, use `npm run dev:https` and register `https://localhost:8788/callback` instead.
5. Turn **Proof Key for Code Exchange (PKCE)** **ON**

   The Worker always sends a `code_challenge` (S256), so this is required — token exchange fails without it.
   Leave the **Allow PKCE without Client Secret** toggle that appears below it **OFF** (the Worker is a confidential client and sends its client_secret).
6. Under **Identity providers**, enable the IdPs you configured (Google, Microsoft, or both)
7. (Optional) If only one IdP is enabled, turn on **Apply instant authentication** to skip the login method selection screen

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

### Step 5.1: Create .dev.vars

All environment-specific values live in `.dev.vars`. This single file is read by both local development and deployment, and is listed in `.gitignore`.

```bash
cp .dev.vars.example .dev.vars
```

### Step 5.2: Create KV Namespace

```bash
npx wrangler kv namespace create backlog-remote-mcp-server-OAUTH_KV
```

Set the returned `id` in `.dev.vars`:

```
OAUTH_KV_ID=0123456789abcdef0123456789abcdef
```

> **Warning**
> Do not share a namespace with another Worker. OAuth authorization codes, access tokens, and approved clients are stored here — sharing one mixes credentials between Workers. Even if a generically named `OAUTH_KV` namespace already exists, create a dedicated one prefixed with your project name.

You do not need to edit `wrangler.jsonc`. The value from `.dev.vars` is injected at deploy time.

### Step 5.3: Fill In .dev.vars

Enter the values from Step 4.4 and the space configuration from Section 1.

```
# Custom domain to deploy to
MCP_HOSTNAME=backlog-remote-mcp-server.example.com

# KV namespace ID created in Step 5.2
OAUTH_KV_ID=0123456789abcdef0123456789abcdef

# Values from Step 4.4
ACCESS_CLIENT_ID=...
ACCESS_CLIENT_SECRET=...
ACCESS_TOKEN_URL=https://<team>.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<client_id>/token
ACCESS_AUTHORIZATION_URL=https://<team>.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<client_id>/authorization
ACCESS_JWKS_URL=https://<team>.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<client_id>/jwks

# Cookie encryption key
COOKIE_ENCRYPTION_KEY=<output of openssl rand -hex 32>

# Allowed email addresses (JSON array)
ALLOWED_EMAILS=["your-email@gmail.com","your-ms@company.com"]

# Backlog spaces configuration (see Section 1)
BACKLOG_SPACES_CONFIG={"spaces":[...],"defaultSpace":"WORK"}
```

Generate the cookie encryption key with:

```bash
openssl rand -hex 32
```

> **Note**
> `ALLOWED_EMAILS` is a separate check from the Access Policy. An address must be in **both** or the tools stay unavailable — login succeeds but `tools/list` returns only the single `access_denied` tool.

### Step 5.4: Verify Locally (recommended)

You can exercise the whole path before deploying.

```bash
npm run dev          # leave running in one terminal
npm run check:local  # run in another terminal
```

`check:local` performs the following in order, opening a browser partway through so you can complete the Access login:

1. Fetch the Authorization Server metadata
2. Dynamic client registration
3. Approve in the browser → Access login
4. Token exchange with PKCE
5. `initialize` / `tools/list`
6. Call `get_space` and show the real response from Backlog

If this passes, your Access configuration, PKCE setting, email allowlist, and Backlog API keys are all correct.

### Step 5.5: Deploy

```bash
npm run deploy
```

This runs three steps in order:

1. Generate `wrangler.deploy.json` with `MCP_HOSTNAME` and `OAUTH_KV_ID` injected from `.dev.vars`
2. Upload the `.dev.vars` values as Worker secrets via `wrangler secret bulk`
3. `wrangler deploy`

> **Warning**
> `wrangler.jsonc` contains neither the custom domain nor the KV ID. A bare `npx wrangler deploy` attaches no custom domain and fails on the placeholder KV ID. Always use `npm run deploy`.

The Worker is deployed to:

```
https://<MCP_HOSTNAME>/mcp
```

#### Related commands

| Command | What it does |
|---|---|
| `npm run deploy` | Generate config → upload secrets → deploy |
| `npm run deploy:dry-run` | Generate and validate only (no upload) |
| `npm run deploy:no-secrets` | Deploy without touching secrets |
| `npm run secrets:push` | Upload secrets only |
| `npm run secrets:dry-run` | Show which keys would be sent (values are never printed) |

You can still set secrets individually:

```bash
npx wrangler secret put ACCESS_CLIENT_SECRET
```

> **Note**
> `npm run deploy` **overwrites** production secrets with the values in `.dev.vars`. If you need different values locally and in production, switch to `deploy:no-secrets` for routine deploys and push secrets explicitly with `secrets:push`.

### Step 5.6: Verify the Deployment

1. Open `https://<MCP_HOSTNAME>/mcp` in a browser
2. You should be redirected to the Cloudflare Access login screen
3. Authenticate with your configured IdP
4. After successful login, the MCP endpoint returns a JSON response

### Step 5.7: Test with MCP Inspector

```bash
npx @modelcontextprotocol/inspector@latest
```

1. Enter `https://<MCP_HOSTNAME>/mcp` in the URL field
2. Click **OAuth Settings** → **Quick OAuth Flow**
3. Complete authentication
4. Click **Connect** → **List Tools** and confirm all tools appear

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
| Token exchange fails / `invalid_grant` | Check that **PKCE** is ON in the Access SaaS App (Step 4.2). The Worker always sends a `code_challenge` |
| `MCP_HOSTNAME is not set` / `OAUTH_KV_ID is not set` | The key is missing from `.dev.vars` or still holds a placeholder (Steps 5.2 / 5.3) |
| `Space "..." is configured as read-only` | That space has `readOnly: true`. Remove it from `BACKLOG_SPACES_CONFIG` if writes are needed |
| `Space "..." not found` | `defaultSpace` or the `space` argument does not match a `name` in `spaces`. Check with `list_spaces` |
| Deployed but no custom domain attached | You likely ran a bare `wrangler deploy`. Use `npm run deploy` |
| Cannot return to `/callback` locally | Add `http://localhost:8788/callback` to the Access SaaS App redirect URLs (Step 4.2) |
