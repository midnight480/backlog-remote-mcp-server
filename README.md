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
Cloudflare Workers (backlog-remote-mcp-server.midnight480.com)
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

### 2. Create KV Namespace

```bash
npx wrangler kv namespace create "OAUTH_KV"
```

Set the returned ID in `wrangler.jsonc` under `kv_namespaces[0].id`.

### 3. Create Cloudflare Access SaaS Application

1. Cloudflare Dashboard → Zero Trust → Access controls → Applications
2. **Create new application** → **SaaS application**
3. Configure:
   - Application name: `Backlog MCP Server`
   - Protocol: **OIDC**
   - Redirect URL: `https://backlog-remote-mcp-server.midnight480.com/callback`
4. Identity Providers:
   - Enable **Google** and/or **Microsoft Entra ID**
   - If using a single IdP, enable **Apply instant authentication** for direct redirect
5. Access Policies:
   - Set allowed email addresses (e.g., Include → Emails → `your-email@gmail.com`)
6. After creation, note these values:
   - Client ID
   - Client Secret
   - Token endpoint
   - Authorization endpoint
   - Key endpoint (JWKS)

### 4. Configure Secrets

```bash
# Cloudflare Access SaaS App values
npx wrangler secret put ACCESS_CLIENT_ID
npx wrangler secret put ACCESS_CLIENT_SECRET
npx wrangler secret put ACCESS_TOKEN_URL
npx wrangler secret put ACCESS_AUTHORIZATION_URL
npx wrangler secret put ACCESS_JWKS_URL

# Cookie encryption key (randomly generated)
echo $(openssl rand -hex 32) | npx wrangler secret put COOKIE_ENCRYPTION_KEY

# Allowed email addresses
echo '["your-email@gmail.com"]' | npx wrangler secret put ALLOWED_EMAILS

# Backlog spaces configuration
npx wrangler secret put BACKLOG_SPACES_CONFIG
```

`BACKLOG_SPACES_CONFIG` value format:

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

### 5. Custom Domain

The custom domain is configured automatically via `custom_domain: true` in `wrangler.jsonc`. Ensure the domain `midnight480.com` is managed by Cloudflare DNS.

### 6. Deploy

```bash
npm run deploy
```

After deployment, the MCP server is available at:
```
https://backlog-remote-mcp-server.midnight480.com/mcp
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
        "https://backlog-remote-mcp-server.midnight480.com/mcp"
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

Enter `https://backlog-remote-mcp-server.midnight480.com/mcp` in the inspector and complete the OAuth flow via OAuth Settings.

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

## Security

- **Authentication**: Cloudflare Access → Google / Microsoft Entra ID. The entire OAuth flow is managed by Cloudflare
- **Authorization**: `ALLOWED_EMAILS` provides an application-level email allowlist
- **Double-check**: Access Policy (Cloudflare side) + in-app allowlist (Worker side)
- **API Key Protection**: Backlog API keys are stored in Cloudflare Secrets and never exposed to clients
- **PKCE + CSRF**: OAuth flow is protected with PKCE and CSRF tokens

## Local Development

```bash
# Create .dev.vars file (local secrets)
cp .dev.vars.example .dev.vars
# Fill in your values

npm run dev
# Server starts at http://localhost:8788/mcp
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
