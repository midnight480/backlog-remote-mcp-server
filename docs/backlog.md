# Backlog API Keys and Space Configuration

Applies to: both Cloudflare and AWS

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
| `apiKey` | ✅ | The API key generated above |
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

## Important Notes

- API keys grant full access to the Backlog space on behalf of the key owner. `readOnly: true` is a guard inside this MCP server; it does not restrict the key itself
- For spaces that need no writes, issue a permission-restricted key in Backlog *and* set `readOnly: true`
- Keep keys confidential. They are stored as Cloudflare Secrets and never exposed to MCP clients
- If a key is compromised, revoke it immediately from Backlog Personal Settings → API

---

---

- Next: [Use Google Cloud as the IdP](idp-google.md) / [Use Microsoft Entra ID as the IdP](idp-entra-id.md)
- Deploy: [Cloudflare Workers](deploy-cloudflare.md) / [AWS](deploy-aws.md)
