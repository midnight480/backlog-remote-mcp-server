// star-tools.ts
// Tools for Backlog stars (スター)

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type BacklogSpacesConfig, callBacklogApi, callBacklogApiForm, resolveSpace } from "../backlog-client";

const asText = (result: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
});

export function registerStarTools(server: McpServer, config: BacklogSpacesConfig) {
	server.tool(
		"add_star",
		"Adds a star to an issue, comment, wiki page or pull request. Pass exactly one of the target IDs.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			issueId: z.number().optional().describe("Issue ID to star."),
			commentId: z.number().optional().describe("Comment ID to star."),
			wikiId: z.number().optional().describe("Wiki page ID to star."),
			pullRequestId: z.number().optional().describe("Pull request ID to star."),
			pullRequestCommentId: z.number().optional().describe("Pull request comment ID to star."),
		},
		async ({ space: spaceName, ...targets }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const body: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(targets)) {
				if (v !== undefined) body[k] = v;
			}
			if (Object.keys(body).length !== 1) {
				throw new Error(
					"Pass exactly one of issueId, commentId, wikiId, pullRequestId or pullRequestCommentId.",
				);
			}
			return asText(await callBacklogApiForm(spaceConfig, { path: "/stars", body }));
		},
	);

	server.tool(
		"delete_star",
		"Removes a star.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			starId: z.number().describe("Star ID."),
		},
		async ({ space: spaceName, starId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, { method: "DELETE", path: `/stars/${starId}` }),
			);
		},
	);
}
