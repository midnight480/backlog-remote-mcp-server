// issue-metadata-tools.ts
// CRUD for issue types, categories and versions/milestones.
//
// 参照系 (get_issue_types / get_categories / get_version_milestones) と
// add_version_milestone は issue-tools 側にある。ここは残りの書き込み系。

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type BacklogSpacesConfig, callBacklogApi, callBacklogApiForm, resolveSpace } from "../backlog-client";

const asText = (result: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
});

/** 種別・カテゴリの色。Backlog 側で固定されている。 */
const ISSUE_TYPE_COLORS = [
	"#e30000",
	"#990000",
	"#934981",
	"#814fbc",
	"#2779ca",
	"#007e9a",
	"#7ea800",
	"#ff9200",
	"#ff3265",
	"#666665",
] as const;

export function registerIssueMetadataTools(server: McpServer, config: BacklogSpacesConfig) {
	const proj = (k: string) => `/projects/${encodeURIComponent(k)}`;

	server.tool(
		"add_issue_type",
		"Adds an issue type to a project.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			name: z.string().describe("Issue type name."),
			color: z.enum(ISSUE_TYPE_COLORS).describe("Issue type color. Must be a Backlog preset color."),
			templateSummary: z.string().optional().describe("Template for the issue summary."),
			templateDescription: z.string().optional().describe("Template for the issue description."),
		},
		async ({ space: spaceName, projectIdOrKey, ...rest }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const body: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(rest)) if (v !== undefined) body[k] = v;
			return asText(
				await callBacklogApiForm(spaceConfig, { path: `${proj(projectIdOrKey)}/issueTypes`, body }),
			);
		},
	);

	server.tool(
		"update_issue_type",
		"Updates an issue type.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			issueTypeId: z.number().describe("Issue type ID."),
			name: z.string().optional().describe("New name."),
			color: z.enum(ISSUE_TYPE_COLORS).optional().describe("New color."),
			templateSummary: z.string().optional().describe("Template for the issue summary."),
			templateDescription: z.string().optional().describe("Template for the issue description."),
		},
		async ({ space: spaceName, projectIdOrKey, issueTypeId, ...rest }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const body: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(rest)) if (v !== undefined) body[k] = v;
			return asText(
				await callBacklogApiForm(spaceConfig, {
					method: "PATCH",
					path: `${proj(projectIdOrKey)}/issueTypes/${issueTypeId}`,
					body,
				}),
			);
		},
	);

	server.tool(
		"delete_issue_type",
		"Deletes an issue type. Issues of this type are moved to substituteIssueTypeId.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			issueTypeId: z.number().describe("Issue type ID to delete."),
			substituteIssueTypeId: z
				.number()
				.describe("Issue type ID that existing issues are moved to."),
		},
		async ({ space: spaceName, projectIdOrKey, issueTypeId, substituteIssueTypeId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			// DELETE でもパラメータはボディ (form-urlencoded) で送る
			return asText(
				await callBacklogApiForm(spaceConfig, {
					method: "DELETE",
					path: `${proj(projectIdOrKey)}/issueTypes/${issueTypeId}`,
					body: { substituteIssueTypeId },
				}),
			);
		},
	);

	server.tool(
		"add_category",
		"Adds a category to a project.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			name: z.string().describe("Category name."),
		},
		async ({ space: spaceName, projectIdOrKey, name }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApiForm(spaceConfig, {
					path: `${proj(projectIdOrKey)}/categories`,
					body: { name },
				}),
			);
		},
	);

	server.tool(
		"update_category",
		"Renames a category.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			categoryId: z.number().describe("Category ID."),
			name: z.string().describe("New category name."),
		},
		async ({ space: spaceName, projectIdOrKey, categoryId, name }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApiForm(spaceConfig, {
					method: "PATCH",
					path: `${proj(projectIdOrKey)}/categories/${categoryId}`,
					body: { name },
				}),
			);
		},
	);

	server.tool(
		"delete_category",
		"Deletes a category.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			categoryId: z.number().describe("Category ID."),
		},
		async ({ space: spaceName, projectIdOrKey, categoryId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					method: "DELETE",
					path: `${proj(projectIdOrKey)}/categories/${categoryId}`,
				}),
			);
		},
	);

	server.tool(
		"update_version_milestone",
		"Updates a version/milestone.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			versionId: z.number().describe("Version/milestone ID."),
			name: z.string().describe("Version name."),
			description: z.string().optional().describe("Description."),
			startDate: z.string().optional().describe("Start date, yyyy-MM-dd."),
			releaseDueDate: z.string().optional().describe("Release due date, yyyy-MM-dd."),
			archived: z.boolean().optional().describe("Whether the version is archived."),
		},
		async ({ space: spaceName, projectIdOrKey, versionId, ...rest }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const body: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(rest)) if (v !== undefined) body[k] = v;
			return asText(
				await callBacklogApiForm(spaceConfig, {
					method: "PATCH",
					path: `${proj(projectIdOrKey)}/versions/${versionId}`,
					body,
				}),
			);
		},
	);

	server.tool(
		"delete_version_milestone",
		"Deletes a version/milestone.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			versionId: z.number().describe("Version/milestone ID."),
		},
		async ({ space: spaceName, projectIdOrKey, versionId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					method: "DELETE",
					path: `${proj(projectIdOrKey)}/versions/${versionId}`,
				}),
			);
		},
	);
}
