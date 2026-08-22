# Deploying to AWS

Prerequisites: [Backlog configuration](backlog.md) and one of
[Google](idp-google.md) or [Entra ID](idp-entra-id.md) as the IdP.

## Architecture

| Role | Component |
|---|---|
| Runtime | AWS Lambda (Node.js 22 / arm64) |
| Public endpoint | API Gateway HTTP API |
| MCP session | None (stateless) |
| OAuth authorization server | MCP SDK `mcpAuthRouter` (self-hosted) |
| Upstream IdP | Amazon Cognito User Pool |
| State storage | DynamoDB (auto-expiry via TTL) |
| Secrets | AWS Secrets Manager |
| IaC | AWS SAM |
| Config file | `infra/aws/params.yaml` |

### Differences from the Cloudflare deployment

- **There is no equivalent of Durable Objects**, so MCP runs stateless. Every current
  tool is request/response and none use server-initiated push, so nothing is lost.
- **Cognito does not support Dynamic Client Registration (RFC 7591).** MCP clients rely
  on DCR, so Cognito cannot act as the authorization server. The authorization server
  is the MCP SDK implementation hosted by this Worker, and Cognito is the **upstream IdP
  that only authenticates users** — the same role Cloudflare Access plays in the
  Cloudflare deployment.
- **Lambda Function URLs are not used.** They rewrite `WWW-Authenticate` to
  `x-amzn-Remapped-www-authenticate`, which breaks protected-resource discovery
  (RFC 9728) for MCP clients. API Gateway HTTP API passes the header through.

## Required tools

```bash
aws --version    # AWS CLI v2
sam --version    # AWS SAM CLI
node --version   # Node.js 20+
```

AWS credentials must be configured (verify with `aws sts get-caller-identity`).

## 1. Create the configuration file

```bash
cp infra/aws/params.example.yaml infra/aws/params.yaml
```

`infra/aws/params.yaml` is gitignored. Fill it in as you work through the steps.

> **Note**
> Passing values directly to `sam deploy --parameter-overrides` **splits them on commas
> and corrupts JSON**. Always pass them through this file — `npm run aws:deploy` does.

## 2. Fill in the required values

```yaml
# Backlog spaces (single-line JSON). See docs/backlog.md
BacklogSpacesConfig: '{"spaces":[...],"defaultSpace":"..."}'

# Allowed email addresses (JSON array)
AllowedEmails: '["your-email@example.com"]'

# Cognito Hosted UI domain prefix (globally unique)
CognitoDomainPrefix: 'your-unique-prefix'

# Leave as the placeholder for the first deploy
PublicBaseUrl: 'https://placeholder.invalid'
```

`CognitoDomainPrefix` must be unique across all of AWS. A project name plus a random
suffix avoids collisions.

## 3. Configure the IdP (Google)

Enter the values from the OAuth client created in
[Google Cloud setup](idp-google.md):

```yaml
GoogleClientId: '....apps.googleusercontent.com'
GoogleClientSecret: 'GOCSPX-....'
```

**Leaving these empty is fine.** No Google integration is created and only Cognito's
internal users can sign in. You can add it later.

Register this redirect URI in the Google Cloud Console:

```
https://<CognitoDomainPrefix>.auth.<REGION>.amazoncognito.com/oauth2/idpresponse
```

## 4. Custom domain (optional)

By default the API Gateway endpoint
(`https://xxxx.execute-api.<region>.amazonaws.com`) is used. **The steps for a custom
domain depend on where DNS is managed.**

### Zone in Route 53 (fully automatic)

Just provide the hosted zone ID. CloudFormation requests the certificate, creates the
DNS validation records, and creates the A record.

```yaml
ApiDomainName: 'backlog-mcp.example.com'
HostedZoneId: 'Z0123456789ABCDEFGHIJ'
AcmCertificateArn: ''
```

### DNS managed elsewhere (e.g. Cloudflare)

Request the certificate first. It is not created inside the template because, with DNS
outside Route 53, CloudFormation would block on validation and stall the whole stack.

```bash
npm run aws:request-cert -- --domain backlog-mcp.example.com
```

Add the printed CNAME to your DNS; the script waits for validation and prints the ARN.
Interrupting it is safe — the certificate remains and rerunning resumes.

```yaml
ApiDomainName: 'backlog-mcp.example.com'
HostedZoneId: ''
AcmCertificateArn: 'arn:aws:acm:...'
```

After deploying, point a CNAME at the `CustomDomainTarget` output.

> **Warning**
> On Cloudflare DNS, **the proxy must be OFF (DNS only)**. With it on, Cloudflare
> terminates TLS and the API Gateway certificate never matches. The same applies to the
> ACM validation record.

## 5. Deploy

```bash
npm run aws:deploy
```

This runs, in order:

1. `sam build` (bundled to CJS with esbuild)
2. `sam deploy` — creates Lambda / API Gateway / DynamoDB / Cognito / Secrets Manager
3. Registers `BacklogSpacesConfig` and the Cognito client secret in Secrets Manager

**Secrets are registered as part of the deploy.** Lambda environment variables hold only
ARNs, because environment variables are readable by anyone with
`lambda:GetFunctionConfiguration`.

### Second deploy

Set `PublicBaseUrl` to the endpoint from the first deploy and deploy again. This fixes
the issuer and the Cognito callback URL.

```yaml
# Use the custom domain here if you configured one
PublicBaseUrl: 'https://backlog-mcp.example.com'
```

```bash
npm run aws:deploy
```

## 6. Verify

```bash
curl https://<PublicBaseUrl>/health
```

The same end-to-end script as the Cloudflare deployment works here:

```bash
npm run check:local -- --base https://<PublicBaseUrl>
```

A browser opens for login; after that it checks `tools/list` and `get_space`.

## Commands

| Command | What it does |
|---|---|
| `npm run aws:validate` | Validate the template |
| `npm run aws:build` | Build only |
| `npm run aws:deploy` | Build + deploy + register secrets |
| `npm run aws:secrets:push` | Update secrets only |
| `npm run aws:secrets:dry-run` | Show which secrets would be sent (values hidden) |
| `npm run aws:request-cert` | Request an ACM certificate and wait for validation |

## Changing the stack name

The default is `backlog-mcp-aws`. To change it, edit `--stack-name` in the `aws:deploy`
script in `package.json`.

**CloudFormation cannot rename a stack.** Changing the name means deleting and
recreating it. The API Gateway custom domain is recreated too, so the CNAME target
changes.

## Deleting

```bash
sam delete --stack-name backlog-mcp-aws --region ap-northeast-1
```

The ACM certificate lives outside the stack and remains. Remove DNS records manually.

## Troubleshooting

| Issue | Solution |
|------|--------|
| `Unzipped size must be smaller than 262144000 bytes` | You passed the source template to `sam deploy`. Pass the built `.aws-sam/build/template.yaml` (`npm run aws:deploy` does) |
| An environment variable contains only `{` | Passing JSON directly to `--parameter-overrides` splits it on commas. Use `file://infra/aws/params.yaml` |
| `Dynamic require of "http" is not supported` | The bundle is ESM. Check that `Format: cjs` is set |
| MCP returns 406 `Client must accept both application/json and text/event-stream` | Headers cannot be read from the `serverless-http` mock request. Confirm the Web-standard `Request` is built via `web-bridge.ts` |
| `invalid_client_secret` | The Cognito app client secret is not reaching Lambda. Check `<stack>/upstream-client-secret` in Secrets Manager |
| `access_denied` after login | That address is not in `AllowedEmails` |
| `redirect_uri_mismatch` (Google) | Cognito's `/oauth2/idpresponse` is not registered in the Google Cloud Console redirect URIs |
| `Space "..." is configured as read-only` | That space has `readOnly: true` |
| TLS error on the custom domain | Cloudflare DNS proxy is probably ON. Set it to DNS only |

---

- Back: [README](../README.md)
- Other platform: [Cloudflare Workers](deploy-cloudflare.md)
