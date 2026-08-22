// wiki-tools.ts
// Tools for managing Backlog wiki pages

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	type BacklogSpacesConfig,
	callBacklogApi,
	callBacklogApiForm,
	resolveSpace,
} from "../backlog-client";

export function registerWikiTools(server: McpServer, config: BacklogSpacesConfig) {
	server.tool(
		"get_wiki_pages",
		"Returns list of Wiki pages for a project.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			keyword: z.string().optional().describe("Search keyword."),
		},
		async ({ space: spaceName, projectIdOrKey, keyword }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const query: Record<string, string | number | boolean | undefined> = {
				projectIdOrKey,
			};
			if (keyword) query.keyword = keyword;
			const result = await callBacklogApi(spaceConfig, { path: "/wikis", query });
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"get_wikis_count",
		"Returns count of wiki pages in a project.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
		},
		async ({ space: spaceName, projectIdOrKey }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApi(spaceConfig, {
				path: "/wikis/count",
				query: { projectIdOrKey },
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"get_wiki",
		"Returns information about a specific wiki page.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			wikiId: z.number().describe("Wiki page ID."),
		},
		async ({ space: spaceName, wikiId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApi(spaceConfig, { path: `/wikis/${wikiId}` });
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"add_wiki",
		"Creates a new wiki page.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectId: z.number().describe("Project ID."),
			name: z.string().describe("Wiki page name/title."),
			content: z.string().describe("Wiki page content."),
			mailNotify: z.boolean().optional().describe("Send email notification."),
		},
		async ({ space: spaceName, projectId, name, content, mailNotify }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const body: Record<string, unknown> = { projectId, name, content };
			if (mailNotify !== undefined) body.mailNotify = mailNotify;
			const result = await callBacklogApiForm(spaceConfig, { path: "/wikis", body });
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);
}
