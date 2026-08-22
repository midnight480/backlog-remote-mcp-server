// space-tools.ts
// Tools for managing Backlog space settings and general information

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	type BacklogSpacesConfig,
	callBacklogApi,
	resolveSpace,
} from "../backlog-client";

export function registerSpaceTools(server: McpServer, config: BacklogSpacesConfig) {
	// List available organizations/spaces
	server.tool(
		"list_spaces",
		"Returns list of configured Backlog spaces and which one is the default.",
		{},
		async () => {
			const spaces = config.spaces.map((s) => ({
				name: s.name,
				domain: s.domain,
				isDefault: s.name === config.defaultSpace,
			}));
			return {
				content: [{ type: "text", text: JSON.stringify(spaces, null, 2) }],
			};
		},
	);

	// Get space info
	server.tool(
		"get_space",
		"Returns information about the Backlog space.",
		{
			space: z
				.string()
				.optional()
				.describe("Space name to query. Uses default space if omitted."),
		},
		async ({ space: spaceName }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApi(spaceConfig, { path: "/space" });
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		},
	);

	// Get users
	server.tool(
		"get_users",
		"Returns list of users in the Backlog space.",
		{
			space: z
				.string()
				.optional()
				.describe("Space name to query. Uses default space if omitted."),
		},
		async ({ space: spaceName }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApi(spaceConfig, { path: "/users" });
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		},
	);

	// Get myself
	server.tool(
		"get_myself",
		"Returns information about the authenticated user.",
		{
			space: z
				.string()
				.optional()
				.describe("Space name to query. Uses default space if omitted."),
		},
		async ({ space: spaceName }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApi(spaceConfig, { path: "/users/myself" });
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		},
	);
}
