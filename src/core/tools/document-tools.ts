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
	callBacklogApiBinary,
	callBacklogApiForm,
	resolveSpace,
} from "../backlog-client";
import { binaryToContent } from "./file-tools";

const asText = (result: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
});

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

	server.tool(
		"add_document",
		"Creates a document in a project.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectId: z.number().describe("Numeric project ID. Use get_project to resolve a key."),
			title: z.string().describe("Document title."),
			plain: z.string().describe("Document body as plain text."),
			json: z
				.string()
				.optional()
				.describe("Document body as Backlog's rich-text JSON. Falls back to plain if omitted."),
			emoji: z.string().optional().describe("Emoji shown as the document icon."),
			parentId: z.string().optional().describe("Parent document ID, to nest it in the tree."),
			attachmentId: z
				.array(z.number())
				.optional()
				.describe("Attachment IDs returned by post_attachment."),
		},
		async ({ space: spaceName, ...rest }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const body: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(rest)) if (v !== undefined) body[k] = v;
			return asText(await callBacklogApiForm(spaceConfig, { path: "/documents", body }));
		},
	);

	server.tool(
		"delete_document",
		"Deletes a document.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			documentId: z.string().describe("Document ID."),
		},
		async ({ space: spaceName, documentId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					method: "DELETE",
					path: `/documents/${encodeURIComponent(documentId)}`,
				}),
			);
		},
	);

	server.tool(
		"get_document_attachment",
		"Downloads a file attached to a document. Fails for files over 4MB.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			documentId: z.string().describe("Document ID."),
			attachmentId: z.number().describe("Attachment ID, from get_document."),
		},
		async ({ space: spaceName, documentId, attachmentId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return binaryToContent(
				await callBacklogApiBinary(spaceConfig, {
					path: `/documents/${encodeURIComponent(documentId)}/attachments/${attachmentId}`,
				}),
			);
		},
	);

	// 以下 3 つは公式 SDK 0.19.1 に実装が無く、公式ドキュメントから仕様を確認して実装した。

	server.tool(
		"get_document_comments",
		"Returns the comments on a document.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			documentId: z.string().describe("Document ID."),
		},
		async ({ space: spaceName, documentId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					path: `/documents/${encodeURIComponent(documentId)}/comments`,
				}),
			);
		},
	);

	server.tool(
		"add_document_tags",
		"Adds tags to a document.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			documentId: z.string().describe("Document ID."),
			tagNames: z.array(z.string()).describe("Tag names to add."),
		},
		async ({ space: spaceName, documentId, tagNames }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApiForm(spaceConfig, {
					path: `/documents/${encodeURIComponent(documentId)}/tags`,
					body: { tagNames },
				}),
			);
		},
	);

	server.tool(
		"remove_document_tags",
		"Removes tags from a document.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			documentId: z.string().describe("Document ID."),
			tagNames: z.array(z.string()).describe("Tag names to remove."),
		},
		async ({ space: spaceName, documentId, tagNames }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			// DELETE でもパラメータはボディ (form-urlencoded) で送る
			return asText(
				await callBacklogApiForm(spaceConfig, {
					method: "DELETE",
					path: `/documents/${encodeURIComponent(documentId)}/tags`,
					body: { tagNames },
				}),
			);
		},
	);
}
