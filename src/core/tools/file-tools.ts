// file-tools.ts
// Tools for shared files, attachments and disk usage.
//
// バイナリを返すエンドポイントは base64 で返す。MCP のレスポンスはテキスト前提のため、
// 画像は image コンテンツ、それ以外は base64 文字列 + メタデータとして返す。
// MAX_BINARY_BYTES を超えるものはエラーにして、Backlog から直接落とすよう促す。

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	type BacklogBinary,
	type BacklogQueryValue,
	type BacklogSpacesConfig,
	callBacklogApi,
	callBacklogApiBinary,
	callBacklogApiUpload,
	resolveSpace,
} from "../backlog-client";

const asText = (result: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
});

/**
 * バイナリを MCP のコンテンツに変換する。
 * 画像は image コンテンツとして返すとクライアントがそのまま表示できる。
 * それ以外は base64 を本文に載せ、取り違えないようメタデータを添える。
 */
export function binaryToContent(binary: BacklogBinary) {
	if (binary.mimeType.startsWith("image/")) {
		return {
			content: [
				{ type: "image" as const, data: binary.base64, mimeType: binary.mimeType },
				{
					type: "text" as const,
					text: JSON.stringify(
						{ filename: binary.filename, mimeType: binary.mimeType, size: binary.size },
						null,
						2,
					),
				},
			],
		};
	}
	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify(
					{
						filename: binary.filename,
						mimeType: binary.mimeType,
						size: binary.size,
						encoding: "base64",
						data: binary.base64,
					},
					null,
					2,
				),
			},
		],
	};
}

export function registerFileTools(server: McpServer, config: BacklogSpacesConfig) {
	server.tool(
		"get_shared_files",
		"Returns the list of shared files under a directory in a project.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			path: z
				.string()
				.optional()
				.describe("Directory path inside the shared file tree. Empty or omitted means the root."),
			order: z.enum(["asc", "desc"]).optional().describe("Sort order."),
			offset: z.number().min(0).optional().describe("Offset for pagination."),
			count: z.number().min(1).max(1000).optional().describe("Number of results (1-1000)."),
		},
		async ({ space: spaceName, projectIdOrKey, path, order, offset, count }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const query: Record<string, BacklogQueryValue> = {};
			if (order) query.order = order;
			if (offset !== undefined) query.offset = offset;
			if (count !== undefined) query.count = count;
			// path はディレクトリ区切りを保つ必要があるため、セグメントごとにエンコードする
			const dir = (path || "")
				.split("/")
				.filter(Boolean)
				.map(encodeURIComponent)
				.join("/");
			return asText(
				await callBacklogApi(spaceConfig, {
					path: `/projects/${encodeURIComponent(projectIdOrKey)}/files/metadata/${dir}`,
					query,
				}),
			);
		},
	);

	server.tool(
		"get_shared_file",
		"Downloads a shared file. Returns base64 content; images are returned as an image. Fails for files over 4MB.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			sharedFileId: z.number().describe("Shared file ID, from get_shared_files."),
		},
		async ({ space: spaceName, projectIdOrKey, sharedFileId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return binaryToContent(
				await callBacklogApiBinary(spaceConfig, {
					path: `/projects/${encodeURIComponent(projectIdOrKey)}/files/${sharedFileId}`,
				}),
			);
		},
	);

	server.tool(
		"get_project_disk_usage",
		"Returns the disk usage of a project.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
		},
		async ({ space: spaceName, projectIdOrKey }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					path: `/projects/${encodeURIComponent(projectIdOrKey)}/diskUsage`,
				}),
			);
		},
	);

	server.tool(
		"post_attachment",
		"Uploads a file and returns an attachment ID, which can then be passed to add_issue, update_issue or add_wiki as attachmentId.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			filename: z.string().describe("File name including extension."),
			contentBase64: z.string().describe("File content, base64 encoded. Max 4MB decoded."),
			contentType: z
				.string()
				.optional()
				.describe("MIME type. Defaults to application/octet-stream."),
		},
		async ({ space: spaceName, filename, contentBase64, contentType }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApiUpload(spaceConfig, {
					path: "/space/attachment",
					filename,
					contentBase64,
					contentType,
				}),
			);
		},
	);

	server.tool(
		"get_issue_attachments",
		"Returns the list of files attached to an issue.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			issueIdOrKey: z.string().describe("Issue ID or issue key."),
		},
		async ({ space: spaceName, issueIdOrKey }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					path: `/issues/${encodeURIComponent(issueIdOrKey)}/attachments`,
				}),
			);
		},
	);

	server.tool(
		"get_issue_attachment",
		"Downloads a file attached to an issue. Returns base64 content; images are returned as an image. Fails for files over 4MB.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			issueIdOrKey: z.string().describe("Issue ID or issue key."),
			attachmentId: z.number().describe("Attachment ID, from get_issue_attachments."),
		},
		async ({ space: spaceName, issueIdOrKey, attachmentId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return binaryToContent(
				await callBacklogApiBinary(spaceConfig, {
					path: `/issues/${encodeURIComponent(issueIdOrKey)}/attachments/${attachmentId}`,
				}),
			);
		},
	);

	server.tool(
		"delete_issue_attachment",
		"Deletes a file attached to an issue.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			issueIdOrKey: z.string().describe("Issue ID or issue key."),
			attachmentId: z.number().describe("Attachment ID."),
		},
		async ({ space: spaceName, issueIdOrKey, attachmentId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					method: "DELETE",
					path: `/issues/${encodeURIComponent(issueIdOrKey)}/attachments/${attachmentId}`,
				}),
			);
		},
	);
}
