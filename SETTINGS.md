# Setup Guide Index

This file is an index. The instructions have been split per platform under `docs/`.

English | [日本語](SETTINGS_ja.md)

## Order to follow

### 1. Shared

| Document | Contents |
|---|---|
| **[Backlog API keys and space configuration](docs/backlog.md)** | Issuing API keys, assembling `BACKLOG_SPACES_CONFIG`, when to use `readOnly` |

### 2. Pick an identity provider

Configure one or both.

| Document | Contents |
|---|---|
| **[Google Cloud](docs/idp-google.md)** | Creating the OAuth client, redirect URIs for both Cloudflare and AWS |
| **[Microsoft Entra ID](docs/idp-entra-id.md)** | App registration, client secret, API permissions |

### 3. Pick a deployment target

| Document | Contents |
|---|---|
| **[Cloudflare Workers](docs/deploy-cloudflare.md)** | Zero Trust / Access, KV, Workers Secrets, wrangler |
| **[AWS](docs/deploy-aws.md)** | Lambda, API Gateway, Cognito, DynamoDB, Secrets Manager, SAM |

## Which one to choose

| | Cloudflare Workers | AWS |
|---|---|---|
| Runtime | Workers (edge) | Lambda + API Gateway HTTP API |
| MCP session | Durable Objects | Stateless |
| OAuth authorization server | `@cloudflare/workers-oauth-provider` | MCP SDK `mcpAuthRouter` |
| Upstream IdP | Cloudflare Access | Amazon Cognito |
| State storage | Workers KV | DynamoDB (TTL) |
| Secrets | Workers Secrets | Secrets Manager |
| IaC | wrangler | AWS SAM |
| Config file | `.dev.vars` | `infra/aws/params.yaml` |

The tools and their behavior are identical on both. Business logic is shared in
`src/core`; only the runtime wiring differs under `src/platforms/`.

## Troubleshooting

At the end of each deployment guide.

- [Cloudflare troubleshooting](docs/deploy-cloudflare.md#troubleshooting)
- [AWS troubleshooting](docs/deploy-aws.md#troubleshooting)

---

See the [README](README.md) for an overview and usage.
