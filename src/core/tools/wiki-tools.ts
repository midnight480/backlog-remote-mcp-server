// wiki-tools.ts
// Tools for managing Backlog wiki pages

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	type BacklogQueryValue,
	type BacklogSpacesConfig,
	callBacklogApi,
	callBacklogApiBinary,
	callBacklogApiForm,
	resolveSpace,
} from "../backlog-client";
import { binaryToContent } from "./file-tools";

const asText = (result: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
});

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

	server.tool(
		"update_wiki",
		"Updates a wiki page. Only the fields you pass are changed.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			wikiId: z.number().describe("Wiki page ID."),
			name: z.string().optional().describe("New page name/title."),
			content: z.string().optional().describe("New page content."),
			mailNotify: z.boolean().optional().describe("Send email notification."),
		},
		async ({ space: spaceName, wikiId, ...rest }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const body: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(rest)) if (v !== undefined) body[k] = v;
			return asText(
				await callBacklogApiForm(spaceConfig, {
					method: "PATCH",
					path: `/wikis/${wikiId}`,
					body,
				}),
			);
		},
	);

	server.tool(
		"delete_wiki",
		"Deletes a wiki page.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			wikiId: z.number().describe("Wiki page ID."),
			mailNotify: z.boolean().optional().describe("Send email notification."),
		},
		async ({ space: spaceName, wikiId, mailNotify }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const body: Record<string, unknown> = {};
			if (mailNotify !== undefined) body.mailNotify = mailNotify;
			return asText(
				await callBacklogApiForm(spaceConfig, {
					method: "DELETE",
					path: `/wikis/${wikiId}`,
					body,
				}),
			);
		},
	);

	server.tool(
		"get_wiki_tags",
		"Returns the list of wiki tags used in a project.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
		},
		async ({ space: spaceName, projectIdOrKey }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, { path: "/wikis/tags", query: { projectIdOrKey } }),
			);
		},
	);

	server.tool(
		"get_wiki_history",
		"Returns the edit history of a wiki page.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			wikiId: z.number().describe("Wiki page ID."),
			minId: z.number().optional().describe("Return entries with an ID greater than this."),
			maxId: z.number().optional().describe("Return entries with an ID smaller than this."),
			count: z.number().min(1).max(100).optional().describe("Number of results (1-100)."),
			order: z.enum(["asc", "desc"]).optional().describe("Sort order."),
		},
		async ({ space: spaceName, wikiId, ...rest }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const query: Record<string, BacklogQueryValue> = {};
			for (const [k, v] of Object.entries(rest)) if (v !== undefined) query[k] = v as BacklogQueryValue;
			return asText(
				await callBacklogApi(spaceConfig, { path: `/wikis/${wikiId}/history`, query }),
			);
		},
	);

	server.tool(
		"get_wiki_stars",
		"Returns the stars on a wiki page.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			wikiId: z.number().describe("Wiki page ID."),
		},
		async ({ space: spaceName, wikiId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(await callBacklogApi(spaceConfig, { path: `/wikis/${wikiId}/stars` }));
		},
	);

	server.tool(
		"get_wiki_attachments",
		"Returns the list of files attached to a wiki page.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			wikiId: z.number().describe("Wiki page ID."),
		},
		async ({ space: spaceName, wikiId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(await callBacklogApi(spaceConfig, { path: `/wikis/${wikiId}/attachments` }));
		},
	);

	server.tool(
		"add_wiki_attachments",
		"Attaches already-uploaded files to a wiki page. Upload them first with post_attachment.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			wikiId: z.number().describe("Wiki page ID."),
			attachmentId: z.array(z.number()).describe("Attachment IDs returned by post_attachment."),
		},
		async ({ space: spaceName, wikiId, attachmentId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApiForm(spaceConfig, {
					path: `/wikis/${wikiId}/attachments`,
					body: { attachmentId },
				}),
			);
		},
	);

	server.tool(
		"get_wiki_attachment",
		"Downloads a file attached to a wiki page. Fails for files over 4MB.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			wikiId: z.number().describe("Wiki page ID."),
			attachmentId: z.number().describe("Attachment ID."),
		},
		async ({ space: spaceName, wikiId, attachmentId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return binaryToContent(
				await callBacklogApiBinary(spaceConfig, {
					path: `/wikis/${wikiId}/attachments/${attachmentId}`,
				}),
			);
		},
	);

	server.tool(
		"delete_wiki_attachment",
		"Removes a file attached to a wiki page.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			wikiId: z.number().describe("Wiki page ID."),
			attachmentId: z.number().describe("Attachment ID."),
		},
		async ({ space: spaceName, wikiId, attachmentId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					method: "DELETE",
					path: `/wikis/${wikiId}/attachments/${attachmentId}`,
				}),
			);
		},
	);

	server.tool(
		"get_wiki_shared_files",
		"Returns the shared files linked to a wiki page.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			wikiId: z.number().describe("Wiki page ID."),
		},
		async ({ space: spaceName, wikiId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(await callBacklogApi(spaceConfig, { path: `/wikis/${wikiId}/sharedFiles` }));
		},
	);

	server.tool(
		"link_wiki_shared_files",
		"Links shared files to a wiki page.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			wikiId: z.number().describe("Wiki page ID."),
			fileId: z.array(z.number()).describe("Shared file IDs, from get_shared_files."),
		},
		async ({ space: spaceName, wikiId, fileId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApiForm(spaceConfig, {
					path: `/wikis/${wikiId}/sharedFiles`,
					body: { fileId },
				}),
			);
		},
	);

	server.tool(
		"unlink_wiki_shared_file",
		"Removes the link between a shared file and a wiki page. The file itself is not deleted.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			wikiId: z.number().describe("Wiki page ID."),
			fileId: z.number().describe("Shared file ID."),
		},
		async ({ space: spaceName, wikiId, fileId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					method: "DELETE",
					path: `/wikis/${wikiId}/sharedFiles/${fileId}`,
				}),
			);
		},
	);
}
