interface Env {
	// Durable Object
	MCP_OBJECT: DurableObjectNamespace;

	// KV
	OAUTH_KV: KVNamespace;

	// Cloudflare Access OAuth (SaaS app)
	ACCESS_CLIENT_ID: string;
	ACCESS_CLIENT_SECRET: string;
	ACCESS_TOKEN_URL: string;
	ACCESS_AUTHORIZATION_URL: string;
	ACCESS_JWKS_URL: string;
	COOKIE_ENCRYPTION_KEY: string;

	// Backlog spaces configuration (JSON string)
	// Format: {"spaces": [{"name": "SPACE_A", "domain": "space-a.backlog.com", "apiKey": "xxx"}, ...], "defaultSpace": "SPACE_A"}
	BACKLOG_SPACES_CONFIG: string;

	// Allowed email addresses (JSON array string)
	// Format: ["user@example.com"]
	ALLOWED_EMAILS: string;
}
