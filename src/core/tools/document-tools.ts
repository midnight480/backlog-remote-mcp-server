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
		"Returns the number of documents in a project (GET /documents/count). Documents are a separate feature from Wiki; the project must have the document feature enabled.",
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
		"Returns a list of documents (GET /documents). Filter by project with projectId (numeric project IDs, not keys). offset is always sent (the API requires it; defaults to 0).",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectId: z
				.array(z.number())
				.optional()
				.describe("Numeric project IDs to filter by. Use get_project to resolve a key to an ID."),
			keyword: z.string().optional().describe("Search keyword."),
			sort: z.enum(["created", "updated"]).optional().describe("Sort key: created or updated."),
			order: z.enum(["asc", "desc"]).optional().describe("Sort order. Defaults to desc."),
			count: z.number().min(1).max(100).optional().describe("Number of results (1-100, default 20)."),
			offset: z.number().min(0).optional().describe("Offset for pagination. Required by the API; this tool sends 0 if omitted."),
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
		"Returns the document tree of a project (GET /documents/tree), including the active tree and the trash tree.",
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
		"Returns information about a specific document (GET /documents/:documentId), including its content, tags and attachments.",
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
		"Creates a document in a project (POST /documents). The body is given in `content` and parsed as Markdown. " +
			"`plain` is accepted as a deprecated alias of `content` for backward compatibility; if both are given, `content` wins.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectId: z.number().describe("Numeric project ID (required). Use get_project to resolve a key."),
			title: z.string().optional().describe("Document title."),
			content: z.string().optional().describe("Document body, parsed as Markdown."),
			plain: z
				.string()
				.optional()
				.describe("Deprecated alias of `content`. Sent as `content`; ignored when `content` is also given."),
			emoji: z
				.string()
				.optional()
				.describe(
					"Emoji icon shown alongside the document title (a single emoji character, e.g. 📝). " +
						"Backlog accepts only emoji in its own set, which is not documented; others are rejected with " +
						"400 msg.invalid.emoji (observed: 📝 accepted, 🧪 rejected). If that happens, retry without emoji.",
				),
			parentId: z
				.string()
				.optional()
				.describe("Parent document ID. The document is created as a child of this node in the tree."),
			addLast: z
				.boolean()
				.optional()
				.describe(
					"If true, the document is added as the last sibling in the tree. Default false (added as the first sibling).",
				),
		},
		async ({ space: spaceName, projectId, title, content, plain, emoji, parentId, addLast }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const body: Record<string, unknown> = { projectId };
			if (title !== undefined) body.title = title;
			// 旧パラメータ plain は content の別名として扱う (content 優先)
			const bodyContent = content ?? plain;
			if (bodyContent !== undefined) body.content = bodyContent;
			if (emoji !== undefined) body.emoji = emoji;
			if (parentId !== undefined) body.parentId = parentId;
			if (addLast !== undefined) body.addLast = addLast;
			return asText(await callBacklogApiForm(spaceConfig, { path: "/documents", body }));
		},
	);

	server.tool(
		"delete_document",
		"Deletes a document (DELETE /documents/:documentId). Requires the Administrator or Project Administrator role.",
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
		"Downloads a file attached to a document (GET /documents/:documentId/attachments/:attachmentId). Fails for files over 4MB.",
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
		"Returns the comments on a document (GET /documents/:documentId/comments).",
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
		"Adds tags to a document (POST /documents/:documentId/tags, sent as tagNames[]).",
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
		"Removes tags from a document (DELETE /documents/:documentId/tags, sent as tagNames[]).",
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
