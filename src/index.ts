// index.ts
// Main entry point for Backlog Remote MCP Server on Cloudflare Workers

import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { handleAccessRequest } from "./access-handler";
import { parseSpacesConfig, type BacklogSpacesConfig } from "./backlog-client";
import { registerGitTools } from "./tools/git-tools";
import { registerIssueTools } from "./tools/issue-tools";
import { registerNotificationTools } from "./tools/notification-tools";
import { registerProjectTools } from "./tools/project-tools";
import { registerSpaceTools } from "./tools/space-tools";
import { registerWikiTools } from "./tools/wiki-tools";
import type { Props } from "./workers-oauth-utils";

export class BacklogMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({
		name: "Backlog Remote MCP Server",
		version: "1.0.0",
	});

	async init() {
		// Parse spaces config from environment
		const config: BacklogSpacesConfig = parseSpacesConfig(this.env.BACKLOG_SPACES_CONFIG);

		// Check email authorization
		const userEmail = this.props?.email?.toLowerCase() || "";
		let allowedEmails: Set<string>;
		try {
			allowedEmails = new Set(
				JSON.parse(this.env.ALLOWED_EMAILS || "[]").map((e: string) => e.toLowerCase()),
			);
		} catch {
			allowedEmails = new Set();
		}

		// If allowlist is configured and user is not in it, register no tools
		if (allowedEmails.size > 0 && !allowedEmails.has(userEmail)) {
			this.server.tool(
				"access_denied",
				"You are not authorized to use this server.",
				{},
				async () => ({
					content: [
						{
							type: "text",
							text: `Access denied. User ${userEmail} is not authorized.`,
						},
					],
				}),
			);
			return;
		}

		// Register all tool groups
		registerSpaceTools(this.server, config);
		registerProjectTools(this.server, config);
		registerIssueTools(this.server, config);
		registerWikiTools(this.server, config);
		registerGitTools(this.server, config);
		registerNotificationTools(this.server, config);
	}
}

// Export the OAuth provider as the default export
export default new OAuthProvider({
	apiRoute: "/mcp",
	apiHandler: BacklogMCP.serve("/mcp"),
	defaultHandler: { fetch: handleAccessRequest as any },
	authorizeEndpoint: "/authorize",
	tokenEndpoint: "/token",
	clientRegistrationEndpoint: "/register",
});
