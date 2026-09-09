# Backlog API Keys and Space Configuration

Applies to: all four deployment targets

Issue an API key per Backlog space and assemble `BACKLOG_SPACES_CONFIG`.
A single server can serve multiple spaces.

You need an API key for each Backlog space you want to connect.

## Steps

1. Log in to your Backlog space (e.g., `https://your-space.backlog.com`)
2. Click your avatar (top-right) → **Personal Settings**
3. Go to the **API** tab
4. Click **Register new application** (or **Generate API Key** depending on your plan)
5. Enter a memo (e.g., `MCP Server`) and click **Submit**
6. Copy the generated API key

## Repeat for Each Space

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
| `apiKey` | | A shared API key embedded in the server config. **Omit it** to make the space per-user only: every caller then has to supply their own key (see [Per-user API keys](#per-user-api-keys)) |
| `readOnly` | | When `true`, **all non-GET API calls are rejected**, guarding shared spaces against accidental writes and deletes |
| `defaultSpace` | ✅ | Which space to use when the `space` parameter is omitted. Must match a `name` in `spaces` |

Set this in `.dev.vars` as a single-line JSON value:

```
BACKLOG_SPACES_CONFIG={"spaces":[{"name":"WORK","domain":"your-company.backlog.com","apiKey":"xxx"},{"name":"SHARED","domain":"shared.backlog.jp","apiKey":"yyy","readOnly":true}],"defaultSpace":"WORK"}
```

## When to use readOnly

The tool set includes destructive operations such as `add_issue`, `update_issue`, `delete_issue`, and `delete_project`, and the caller is an LLM. When an ambiguous instruction is aimed at the wrong space, `readOnly: true` is the backstop.

The check lives in the API-call layer of `src/core/backlog-client.ts`, so it does not depend on individual tool implementations and automatically covers tools added later. Rejection happens before any request reaches the Backlog API:

```
Space "SHARED" is configured as read-only. Refusing POST /issues.
Use list_spaces to see which spaces allow writes.
```

Use the `list_spaces` tool to see the status of each space.

## Per-user API keys

A key placed in `BACKLOG_SPACES_CONFIG` is a *shared* key: every caller acts as
whoever owns it. Issues get created by one system user, and Backlog's own
permissions no longer distinguish your users from one another.

To make each caller act as themselves, **omit `apiKey` from the space** and have
the client send the caller's own key with each request. The server never stores
these keys — they are read from the request, used for that one request, and
discarded.

| Header | Purpose |
|---|---|
| `X-Backlog-Api-Key` | One key, applied to `defaultSpace` |
| `X-Backlog-Api-Keys` | Several keys, as `SPACE=key` pairs separated by commas |

```
X-Backlog-Api-Key: your-own-api-key
X-Backlog-Api-Keys: WORK=your-work-key,SHARED=your-shared-key
```

Space names are matched case-insensitively. A name that matches no configured
space is rejected rather than silently falling back to the shared key, so a typo
cannot make you write to Backlog as somebody else.

Where a space has both a shared key and a per-user key, the per-user key wins.
`list_spaces` reports which spaces currently have a usable key, and where it came
from (`user`, `server`, or `missing`); it never reveals the key itself.

### Client configuration

**Claude Code** — `.mcp.json`:

```json
{
  "mcpServers": {
    "backlog": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "X-Backlog-Api-Key": "${BACKLOG_API_KEY}" }
    }
  }
}
```

**Codex** — `~/.codex/config.toml`. Use `env_http_headers` so the key comes from
the environment rather than the file:

```toml
[mcp_servers.backlog]
url = "https://mcp.example.com/mcp"
env_http_headers = { "X-Backlog-Api-Key" = "BACKLOG_API_KEY" }
```

**Kiro** — `.kiro/settings/mcp.json` (or `~/.kiro/settings/mcp.json`). Kiro only
expands environment variables listed in its *Mcp Approved Env Vars* setting:

```json
{
  "mcpServers": {
    "backlog": {
      "type": "streamable-http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "X-Backlog-Api-Key": "${BACKLOG_API_KEY}" }
    }
  }
}
```

Prefer the environment-variable form over pasting the key into the file — these
config files tend to end up in Git.

#### Several spaces at once

Swap the singular header for the plural one and list one `SPACE=key` pair per
space. The value is the same string in every client, so only the header name and
the surrounding syntax change:

```json
      "headers": { "X-Backlog-Api-Keys": "${BACKLOG_API_KEYS}" }
```

```toml
env_http_headers = { "X-Backlog-Api-Keys" = "BACKLOG_API_KEYS" }
```

```bash
export BACKLOG_API_KEYS="WORK=key-for-work,SHARED=key-for-shared"
```

Both headers can be sent together: `X-Backlog-Api-Key` covers `defaultSpace` and
`X-Backlog-Api-Keys` covers the rest. Naming the same space twice is an error
rather than a silent winner, so pick one or the other for any given space.

Note that the header does not replace signing in. `/mcp` still sits behind the
OAuth flow, so the first connection opens a browser regardless. The two
credentials answer different questions: OAuth decides *who may use this server*,
the header decides *who you are to Backlog*.

### Clients that cannot send headers

Claude Desktop's custom-connector dialog and the claude.ai connector UI accept a
URL and optional OAuth client credentials, but have no field for a custom header.
For those, the key is collected once during the authorization flow instead.

Any space configured without an `apiKey` gets an input box on the consent screen
that appears when you connect. Paste your key there and approve; nothing else to
configure. Since the server keeps no copy, the consent screen appears on every
re-authorization — that is, whenever the refresh token expires, not on every request.

**The key is still never stored.** It is sealed with AES-256-GCM under a
server-held key and carried by the client the whole way:

```
consent form → short-lived browser cookie → authorization code → access / refresh token
```

At every step the server persists only the identifier half; the sealed half lives
in the string the client holds. Nothing about the key reaches DynamoDB, Firestore,
or Cosmos DB. A header, when present, overrides whatever the token carries.

The trade-off is that the sealed key rides in the refresh token, which is long-lived.
Treat those tokens as you would the key itself, and revoke from Backlog Personal
Settings → API if a client is compromised.

The OAuth tokens themselves are stored server-side, as before — the identifier,
client, scopes, and your email address. It is only the Backlog key that is not.

### Platform support

Both paths work on all four deployments.

On Cloudflare the authorization server is `@cloudflare/workers-oauth-provider`,
which owns the token format and encrypts anything attached to a grant into KV. To
keep the Backlog key out of KV entirely, the key is never handed to that library:
the Worker unwraps the sealed half before delegating to it and re-attaches it to
the tokens on the way back out. KV holds only OAuth data.

## Important Notes

- API keys grant full access to the Backlog space on behalf of the key owner. `readOnly: true` is a guard inside this MCP server; it does not restrict the key itself
- For spaces that need no writes, issue a permission-restricted key in Backlog *and* set `readOnly: true`
- Keep keys confidential. Shared keys are stored as platform secrets and never exposed to MCP clients; per-user keys are never stored at all
- If a key is compromised, revoke it immediately from Backlog Personal Settings → API

---

---

- Next: [Use Google Cloud as the IdP](idp-google.md) / [Use Microsoft Entra ID as the IdP](idp-entra-id.md)
- Deploy: [Cloudflare Workers](deploy-cloudflare.md) / [AWS](deploy-aws.md)
