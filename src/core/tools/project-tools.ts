// project-tools.ts
// Tools for managing Backlog projects

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	type BacklogSpacesConfig,
	callBacklogApi,
	callBacklogApiForm,
	resolveSpace,
} from "../backlog-client";

export function registerProjectTools(server: McpServer, config: BacklogSpacesConfig) {
	server.tool(
		"get_project_list",
		"Returns list of projects.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			archived: z.boolean().optional().describe("Filter by archived status."),
			all: z.boolean().optional().describe("Set to true to get all projects including ones the user is not a member of."),
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
		"Creates a new project.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			name: z.string().describe("Project name."),
			key: z.string().describe("Project key (uppercase letters and underscores)."),
			chartEnabled: z.boolean().optional().describe("Enable chart."),
			subtaskingEnabled: z.boolean().optional().describe("Enable subtasking."),
			projectLeaderCanEditProjectLeader: z.boolean().optional(),
			textFormattingRule: z.enum(["backlog", "markdown"]).optional(),
		},
		async ({ space: spaceName, name, key, chartEnabled, subtaskingEnabled, projectLeaderCanEditProjectLeader, textFormattingRule }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const body: Record<string, unknown> = { name, key };
			if (chartEnabled !== undefined) body.chartEnabled = chartEnabled;
			if (subtaskingEnabled !== undefined) body.subtaskingEnabled = subtaskingEnabled;
			if (projectLeaderCanEditProjectLeader !== undefined) body.projectLeaderCanEditProjectLeader = projectLeaderCanEditProjectLeader;
			if (textFormattingRule) body.textFormattingRule = textFormattingRule;
			const result = await callBacklogApiForm(spaceConfig, { path: "/projects", body });
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"update_project",
		"Updates an existing project.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			name: z.string().optional().describe("New project name."),
			key: z.string().optional().describe("New project key."),
			chartEnabled: z.boolean().optional(),
			subtaskingEnabled: z.boolean().optional(),
			projectLeaderCanEditProjectLeader: z.boolean().optional(),
			textFormattingRule: z.enum(["backlog", "markdown"]).optional(),
			archived: z.boolean().optional(),
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
		"Deletes a project.",
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
		"Returns list of users in a specific project.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
		},
		async ({ space: spaceName, projectIdOrKey }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApi(spaceConfig, {
				path: `/projects/${projectIdOrKey}/users`,
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);
}
