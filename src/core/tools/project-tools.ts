// project-tools.ts
// Tools for managing Backlog projects

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	type BacklogSpacesConfig,
	callBacklogApi,
	callBacklogApiBinary,
	callBacklogApiForm,
	resolveSpace,
} from "../backlog-client";
import { binaryToContent } from "./file-tools";
import { activityParams, toActivityQuery } from "./space-tools";

const asText = (result: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
});

/** add_project / update_project に共通の設定項目 (公式ドキュメントのフォームパラメータ順) */
const projectSettingParams = {
	chartEnabled: z.boolean().optional().describe("Enable chart."),
	useResolvedForChart: z
		.boolean()
		.optional()
		.describe("Consider \"Resolved\" and the statuses after it as closed in charts."),
	subtaskingEnabled: z.boolean().optional().describe("Enable subtasking."),
	grandchildIssueEnabled: z
		.boolean()
		.optional()
		.describe("Enable 3rd level subtasks (grandchild issues). Only effective when subtaskingEnabled is true."),
	projectLeaderCanEditProjectLeader: z
		.boolean()
		.optional()
		.describe("Allow project administrators to manage each other."),
	useWiki: z.boolean().optional().describe("Enable Wiki."),
	useDocument: z.boolean().optional().describe("Enable Document."),
	useFileSharing: z.boolean().optional().describe("Enable shared files."),
	useWikiTreeView: z.boolean().optional().describe("Enable Wiki tree view."),
	useSubversion: z.boolean().optional().describe("Enable Subversion."),
	useGit: z.boolean().optional().describe("Enable Git."),
	useOriginalImageSizeAtWiki: z
		.boolean()
		.optional()
		.describe("Display images in Wikis in their original size."),
	textFormattingRule: z
		.enum(["backlog", "markdown"])
		.optional()
		.describe("Text formatting rule: \"backlog\" or \"markdown\"."),
	useDevAttributes: z
		.boolean()
		.optional()
		.describe("Enable priorities, versions and milestones."),
};

export function registerProjectTools(server: McpServer, config: BacklogSpacesConfig) {
	server.tool(
		"get_project_list",
		"Returns list of projects.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			archived: z
				.boolean()
				.optional()
				.describe("Omit to get all projects, false for unarchived projects only, true for archived projects only."),
			all: z
				.boolean()
				.optional()
				.describe(
					"Only applies to space administrators. true returns all projects; false (default) returns only projects the user has joined.",
				),
		},
		async ({ space: spaceName, archived, all }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const query: Record<string, string | number | boolean | undefined> = {};
			if (archived !== undefined) query.archived = archived;
			if (all !== undefined) query.all = all;
			const result = await callBacklogApi(spaceConfig, { path: "/projects", query });
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"get_project",
		"Returns information about a specific project.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
		},
		async ({ space: spaceName, projectIdOrKey }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApi(spaceConfig, {
				path: `/projects/${projectIdOrKey}`,
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"add_project",
		"Creates a new project. Requires the space Administrator role.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			name: z.string().describe("Project name."),
			key: z
				.string()
				.describe("Project key. Uppercase letters (A-Z), numbers (0-9) and underscore (_) can be used."),
			...projectSettingParams,
		},
		async ({ space: spaceName, ...params }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const body: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(params)) {
				if (v !== undefined) body[k] = v;
			}
			const result = await callBacklogApiForm(spaceConfig, { path: "/projects", body });
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"update_project",
		"Updates an existing project. Only the fields you pass are changed. " +
			"Requires the Administrator or Project Administrator role.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			name: z.string().optional().describe("New project name."),
			key: z
				.string()
				.optional()
				.describe("New project key. Uppercase letters (A-Z), numbers (0-9) and underscore (_) can be used."),
			...projectSettingParams,
			archived: z.boolean().optional().describe("Archive this project."),
		},
		async ({ space: spaceName, projectIdOrKey, ...params }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const body: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(params)) {
				if (v !== undefined) body[k] = v;
			}
			const result = await callBacklogApiForm(spaceConfig, {
				method: "PATCH",
				path: `/projects/${projectIdOrKey}`,
				body,
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"delete_project",
		"Deletes a project. Requires the space Administrator role.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
		},
		async ({ space: spaceName, projectIdOrKey }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApi(spaceConfig, {
				method: "DELETE",
				path: `/projects/${projectIdOrKey}`,
			});
			return { content: [{ type: "text", text: JSON.stringify(result ?? "Deleted successfully", null, 2) }] };
		},
	);

	server.tool(
		"get_project_users",
		"Returns list of members of a specific project.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			excludeGroupMembers: z
				.boolean()
				.optional()
				.describe(
					"true to exclude members who belong to the project only through a team (group); false (default) returns all members.",
				),
		},
		async ({ space: spaceName, projectIdOrKey, excludeGroupMembers }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApi(spaceConfig, {
				path: `/projects/${projectIdOrKey}/users`,
				query: { excludeGroupMembers },
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"get_project_icon",
		"Downloads a project icon image.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
		},
		async ({ space: spaceName, projectIdOrKey }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return binaryToContent(
				await callBacklogApiBinary(spaceConfig, {
					path: `/projects/${encodeURIComponent(projectIdOrKey)}/image`,
				}),
			);
		},
	);

	server.tool(
		"get_project_activities",
		"Returns recent updates (activities) in a project.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			...activityParams,
		},
		async ({ space: spaceName, projectIdOrKey, ...rest }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					path: `/projects/${encodeURIComponent(projectIdOrKey)}/activities`,
					query: toActivityQuery(rest),
				}),
			);
		},
	);

	server.tool(
		"add_project_user",
		"Adds a user to the project members. Requires the Administrator or Project Administrator role.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			userId: z.number().describe("User ID to add."),
		},
		async ({ space: spaceName, projectIdOrKey, userId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApiForm(spaceConfig, {
					path: `/projects/${encodeURIComponent(projectIdOrKey)}/users`,
					body: { userId },
				}),
			);
		},
	);

	server.tool(
		"delete_project_user",
		"Removes a user from the project members. Requires the Administrator or Project Administrator role.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			userId: z.number().describe("User ID to remove."),
		},
		async ({ space: spaceName, projectIdOrKey, userId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			// DELETE でもパラメータはボディ (form-urlencoded) で送る
			return asText(
				await callBacklogApiForm(spaceConfig, {
					method: "DELETE",
					path: `/projects/${encodeURIComponent(projectIdOrKey)}/users`,
					body: { userId },
				}),
			);
		},
	);

	server.tool(
		"get_project_administrators",
		"Returns the list of users who have the Project Administrator role in a project.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
		},
		async ({ space: spaceName, projectIdOrKey }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					path: `/projects/${encodeURIComponent(projectIdOrKey)}/administrators`,
				}),
			);
		},
	);

	server.tool(
		"add_project_administrator",
		"Grants a user the Project Administrator role. Requires the space Administrator role.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			userId: z.number().describe("User ID."),
		},
		async ({ space: spaceName, projectIdOrKey, userId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApiForm(spaceConfig, {
					path: `/projects/${encodeURIComponent(projectIdOrKey)}/administrators`,
					body: { userId },
				}),
			);
		},
	);

	server.tool(
		"delete_project_administrator",
		"Removes the Project Administrator role from a user. Requires the space Administrator role.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			userId: z.number().describe("User ID."),
		},
		async ({ space: spaceName, projectIdOrKey, userId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApiForm(spaceConfig, {
					method: "DELETE",
					path: `/projects/${encodeURIComponent(projectIdOrKey)}/administrators`,
					body: { userId },
				}),
			);
		},
	);
}
