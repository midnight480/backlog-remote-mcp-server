// document-tools.ts
// Tools for Backlog documents (ドキュメント機能)
//
// Wiki とは別機能。プロジェクト設定の useDocument が true のプロジェクトで使える。

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	type BacklogQueryValue,
	type BacklogSpacesConfig,
	callBacklogApi,
	resolveSpace,
} from "../backlog-client";

export function registerDocumentTools(server: McpServer, config: BacklogSpacesConfig) {
	server.tool(
		"get_documents_count",
		"Returns the number of documents in a project. Documents are a separate feature from Wiki; the project must have the document feature enabled.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
		},
		async ({ space: spaceName, projectIdOrKey }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApi(spaceConfig, {
				path: "/documents/count",
				query: { projectIdOrKey },
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"get_documents",
		"Returns a list of documents. Filter by project with projectId (numeric project IDs, not keys).",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectId: z
				.array(z.number())
				.optional()
				.describe("Numeric project IDs to filter by. Use get_project to resolve a key to an ID."),
			keyword: z.string().optional().describe("Search keyword."),
			sort: z.enum(["created", "updated"]).optional().describe("Sort key."),
			order: z.enum(["asc", "desc"]).optional().describe("Sort order. Defaults to desc."),
			count: z.number().min(1).max(100).optional().describe("Number of results (1-100, default 20)."),
			offset: z.number().min(0).optional().describe("Offset for pagination. Defaults to 0."),
		},
		async ({ space: spaceName, projectId, keyword, sort, order, count, offset }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			// offset は Backlog 側で必須なので未指定なら 0 を送る
			const query: Record<string, BacklogQueryValue> = { offset: offset ?? 0 };
			if (projectId && projectId.length > 0) query.projectId = projectId;
			if (keyword) query.keyword = keyword;
			if (sort) query.sort = sort;
			if (order) query.order = order;
			if (count !== undefined) query.count = count;
			const result = await callBacklogApi(spaceConfig, { path: "/documents", query });
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"get_document_tree",
		"Returns the document tree of a project, including the active tree and the trash tree.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
		},
		async ({ space: spaceName, projectIdOrKey }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApi(spaceConfig, {
				path: "/documents/tree",
				query: { projectIdOrKey },
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"get_document",
		"Returns information about a specific document.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			documentId: z.string().describe("Document ID."),
		},
		async ({ space: spaceName, documentId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApi(spaceConfig, {
				path: `/documents/${encodeURIComponent(documentId)}`,
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);
}
