# Backlog Remote MCP Server

A remote MCP server running on Cloudflare Workers that exposes the Backlog API via the Model Context Protocol. Secured with Cloudflare Access (Google / Microsoft Entra ID) so only authorized users can connect.

[日本語ドキュメント](./README_ja.md) | [Configuration Guide](./SETTINGS.md)

## Features

- **Remote MCP Server**: Hosted on Cloudflare Workers. Accessible from anywhere
- **Cloudflare Access Authentication**: Google / Microsoft Entra ID (or any OIDC IdP). Only allowlisted email addresses can access
- **Multi-Space Support**: Operate multiple Backlog spaces through a single connection using the `space` parameter
- **Full Toolset**: Projects, issues, wiki, Git/PR, and notifications

## Architecture

```
MCP Client (Claude, Kiro, Cursor, etc.)
    ↓ Streamable HTTP + OAuth
Cloudflare Workers (your custom domain)
    ↓ Cloudflare Access (Google / Microsoft Entra ID)
    ↓ Email allowlist check
    ↓ Backlog API Key routing
Backlog API (space-a.backlog.com, space-b.backlog.com, ...)
```

## Setup

For detailed step-by-step setup instructions for each service (Backlog, Google, Microsoft Entra ID, Cloudflare), see the [Configuration Guide](./SETTINGS.md).

### Prerequisites

- Cloudflare account
- Cloudflare Zero Trust organization (with Google / Microsoft Entra ID connected)
- Backlog API keys (one per space)
- Node.js 18+
- Wrangler CLI

### 1. Clone and Install

```bash
git clone <this-repo>
cd my-own-backlog-remote-mcp-server
npm install
```

### 2. Create the Configuration File

All environment-specific values live in `.dev.vars`. This single file is read by both local development and deployment, and is never committed to Git.

```bash
cp .dev.vars.example .dev.vars
```

Fill it in as you work through the steps below.

### 3. Create KV Namespace

```bash
npx wrangler kv namespace create backlog-remote-mcp-server-OAUTH_KV
```

Set the returned `id` in `.dev.vars`:

```
OAUTH_KV_ID=0123456789abcdef0123456789abcdef
```

> **Note**
> Do not share a namespace with another Worker. OAuth authorization codes, tokens, and approved clients are stored here, so sharing one mixes credentials between Workers. Prefix the namespace with your project name to keep it dedicated.

### 4. Create Cloudflare Access SaaS Application

1. Cloudflare Dashboard → Zero Trust → Access controls → Applications
2. **Create new application** → **SaaS applications** tab → **OpenID Connect (OIDC)**
3. Configure:
   - Application name: `Backlog MCP Server`
   - Authentication protocol: **OIDC** (not SAML)
4. Add two **Redirect URLs**:
   ```
   https://<your-domain>/callback
   http://localhost:8788/callback
   ```
   The second one is for local verification. If Access rejects `http://`, use `npm run dev:https` and register `https://localhost:8788/callback` instead.
5. Turn **Proof Key for Code Exchange (PKCE)** **ON**.
   The Worker always sends a `code_challenge` (S256), so this is required. Leave "Allow PKCE without Client Secret" OFF.
6. Identity Providers:
   - Enable **Google** and/or **Microsoft Entra ID**
   - If using a single IdP, enable **Apply instant authentication** for direct redirect
7. Access Policies:
   - Action: **Allow** / Include → Emails → your allowed addresses
8. After creation, copy the displayed values into `.dev.vars`:

   | Field in the dashboard | Key in `.dev.vars` |
   |---|---|
   | Client ID | `ACCESS_CLIENT_ID` |
   | Client Secret | `ACCESS_CLIENT_SECRET` |
   | Token endpoint | `ACCESS_TOKEN_URL` |
   | Authorization endpoint | `ACCESS_AUTHORIZATION_URL` |
   | Key endpoint (JWKS) | `ACCESS_JWKS_URL` |

> **Warning**
> The Client Secret is **only shown immediately after creation**. Copy it before navigating away. If you miss it, use **Reset secret** to generate a new one.

### 5. Configure Backlog Spaces

Set `BACKLOG_SPACES_CONFIG` in `.dev.vars` as a single-line JSON value:

```
BACKLOG_SPACES_CONFIG={"spaces":[{"name":"COMPANY_A","domain":"company-a.backlog.com","apiKey":"xxx"},{"name":"SHARED","domain":"shared.backlog.jp","apiKey":"yyy","readOnly":true}],"defaultSpace":"COMPANY_A"}
```

Expanded for readability:

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

| Field | Required | Description |
|---|---|---|
| `name` | ✅ | Label used in the `space` tool argument. Matching is case-insensitive |
| `domain` | ✅ | Hostname without scheme. `.backlog.com` / `.backlog.jp` / `.backlogtool.com` |
| `apiKey` | ✅ | Issue one from Backlog: Personal Settings → API |
| `readOnly` | | When `true`, **all non-GET API calls are rejected**, guarding shared spaces against accidental writes and deletes |
| `defaultSpace` | ✅ | Target used when the `space` argument is omitted. Must match a `name` in `spaces` |

> **Note**
> Set `readOnly: true` on shared or production spaces. The tool set includes destructive operations such as `delete_issue` and `delete_project`, and the caller is an LLM. This flag is the backstop when an ambiguous instruction is aimed at the wrong space.

### 6. Custom Domain

Set the deployment hostname in `.dev.vars`:

```
MCP_HOSTNAME=backlog-remote-mcp-server.example.com
```

No manual DNS record is needed. It is registered as `custom_domain: true` at deploy time and configured automatically by Cloudflare. The domain must be in a zone on the same account.

### 7. Deploy

```bash
npm run deploy
```

This runs three steps in order:

1. Generate `wrangler.deploy.json` with `MCP_HOSTNAME` and `OAUTH_KV_ID` injected from `.dev.vars`
2. Upload the `.dev.vars` values as Worker secrets via `wrangler secret bulk`
3. `wrangler deploy`

> **Warning**
> `wrangler.jsonc` contains neither the custom domain nor the KV ID. A bare `npx wrangler deploy` attaches no custom domain and fails on the placeholder KV ID. Always use `npm run deploy`.

After deployment, the MCP server is available at:

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

You can still set secrets individually if you prefer:

```bash
npx wrangler secret put ACCESS_CLIENT_SECRET
```

## Connecting from MCP Clients

### Claude Desktop / Kiro / Cursor (via mcp-remote proxy)

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

On first connection, a browser window opens for authentication.

### MCP Inspector (for testing)

```bash
npx @modelcontextprotocol/inspector@latest
```

Enter `https://<MCP_HOSTNAME>/mcp` in the inspector and complete the OAuth flow via OAuth Settings.

## Usage

### Specifying a Space

All tools accept an optional `space` parameter:

```
# Use default space
"Show me the issues for PROJECT-KEY"

# Specify a particular space
"List projects in the PERSONAL space"
→ space: "PERSONAL"
```

### Examples

```
# List configured spaces
"What Backlog spaces are available?" → list_spaces

# List projects
"Show COMPANY_A projects" → get_project_list(space: "COMPANY_A")

# Create an issue
"Create a new bug issue in PROJECT-KEY" → add_issue(...)

# List pull requests
"Show open PRs in repo-name" → get_pull_requests(...)
```

## Available Tools

| Category | Tools |
|----------|-------|
| Space | list_spaces, get_space, get_users, get_myself |
| Project | get_project_list, get_project, add_project, update_project, delete_project, get_project_users |
| Issue | get_issue, get_issues, count_issues, add_issue, update_issue, delete_issue, get_issue_comments, add_issue_comment, get_priorities, get_issue_types, get_categories, get_version_milestones, add_version_milestone, get_resolutions |
| Wiki | get_wiki_pages, get_wikis_count, get_wiki, add_wiki |
| Git | get_git_repositories, get_git_repository, get_pull_requests, get_pull_request, add_pull_request, update_pull_request, get_pull_request_comments, add_pull_request_comment |
| Notification | get_notifications, get_notifications_count, reset_unread_notification_count, mark_notification_as_read |

`add_*`, `update_*`, and `delete_*` are write operations. Calling them against a space configured with `readOnly: true` is rejected before any request reaches the Backlog API. Use `list_spaces` to see the `readOnly` status of each space.

## Security

- **Authentication**: Cloudflare Access → Google / Microsoft Entra ID. The entire OAuth flow is managed by Cloudflare
- **Authorization**: `ALLOWED_EMAILS` provides an application-level email allowlist
- **Double-check**: Access Policy (Cloudflare side) + in-app allowlist (Worker side)
- **API Key Protection**: Backlog API keys are stored in Cloudflare Secrets and never exposed to clients
- **PKCE + CSRF**: OAuth flow is protected with PKCE (S256) and CSRF tokens
- **Write guard**: Spaces marked `readOnly: true` reject every non-GET call. The check lives in the API-call layer of `src/backlog-client.ts`, so it does not depend on individual tool implementations
- **Configuration isolation**: All environment-specific values live in `.dev.vars` (untracked). The repository contains placeholders only

### Operational notes

- `ALLOWED_EMAILS` is the effective authorization boundary for this server. There is no zone-level Access application in front of the Worker
- `npm run deploy` **overwrites** production secrets with the values in `.dev.vars`. If you need different values locally and in production, use `deploy:no-secrets` for routine deploys and push secrets explicitly with `secrets:push`
- A Backlog API key carries the full permissions of its owner. For spaces that need no writes, issue a read-only key *and* set `readOnly: true`

## Local Development

```bash
cp .dev.vars.example .dev.vars   # fill in your values
npm run dev
# Server starts at http://localhost:8788/mcp
```

`wrangler dev` emulates KV and Durable Objects locally, so it never touches real Cloudflare resources.

### Verifying the setup

Run the full OAuth-to-tool-call check in one command:

```bash
npm run check:local
```

It performs the following steps, opening a browser partway through so you can complete the Cloudflare Access login:

1. Fetch the Authorization Server metadata
2. Dynamic client registration
3. Approve in the browser → Access login
4. Token exchange with PKCE
5. `initialize` / `tools/list`
6. Call `get_space` and show the real response from Backlog

If `tools/list` returns only `access_denied`, the email you logged in with is not in `ALLOWED_EMAILS`.

### Running over HTTPS

Use this when Cloudflare Access will not accept an `http://` redirect URL.

```bash
npm run dev:https
# Server starts at https://localhost:8788/mcp (self-signed certificate)
```

### Type checking

```bash
npm run type-check
```

### .dev.vars.example

```
# Custom domain to deploy to (read by npm run deploy)
MCP_HOSTNAME=your-worker.example.com

# KV namespace ID for OAuth storage (read by npm run deploy)
OAUTH_KV_ID=your-kv-namespace-id

ACCESS_CLIENT_ID=your-local-client-id
ACCESS_CLIENT_SECRET=your-local-client-secret
ACCESS_TOKEN_URL=https://your-team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/xxx/token
ACCESS_AUTHORIZATION_URL=https://your-team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/xxx/authorization
ACCESS_JWKS_URL=https://your-team.cloudflareaccess.com/cdn-cgi/access/sso/oidc/xxx/jwks
COOKIE_ENCRYPTION_KEY=your-random-hex-string
ALLOWED_EMAILS=["your-email@gmail.com"]
# Spaces with readOnly:true reject every non-GET call (guards shared spaces against accidental writes)
BACKLOG_SPACES_CONFIG={"spaces":[{"name":"DEV","domain":"dev.backlog.com","apiKey":"xxx"},{"name":"SHARED","domain":"shared.backlog.com","apiKey":"yyy","readOnly":true}],"defaultSpace":"DEV"}
```

`MCP_HOSTNAME` and `OAUTH_KV_ID` are build-time only and are never uploaded as Worker secrets. Both can be overridden by environment variables, so CI can pass them directly:

```bash
MCP_HOSTNAME=staging.example.com OAUTH_KV_ID=... npm run deploy
```

## License

MIT
