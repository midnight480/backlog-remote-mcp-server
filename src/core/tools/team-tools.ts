// team-tools.ts
// Tools for Backlog teams (チーム)

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

export function registerTeamTools(server: McpServer, config: BacklogSpacesConfig) {
	server.tool(
		"get_teams",
		"Returns the list of teams in the space.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			order: z.enum(["asc", "desc"]).optional().describe("Sort order."),
			offset: z.number().min(0).optional().describe("Offset for pagination."),
			count: z.number().min(1).max(100).optional().describe("Number of results (1-100)."),
		},
		async ({ space: spaceName, order, offset, count }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const query: Record<string, BacklogQueryValue> = {};
			if (order) query.order = order;
			if (offset !== undefined) query.offset = offset;
			if (count !== undefined) query.count = count;
			return asText(await callBacklogApi(spaceConfig, { path: "/teams", query }));
		},
	);

	server.tool(
		"get_team",
		"Returns information about a specific team.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			teamId: z.number().describe("Team ID."),
		},
		async ({ space: spaceName, teamId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(await callBacklogApi(spaceConfig, { path: `/teams/${teamId}` }));
		},
	);

	server.tool(
		"add_team",
		"Creates a team.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			name: z.string().describe("Team name."),
			members: z.array(z.number()).optional().describe("User IDs to add as members."),
		},
		async ({ space: spaceName, name, members }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const body: Record<string, unknown> = { name };
			if (members) body.members = members;
			return asText(await callBacklogApiForm(spaceConfig, { path: "/teams", body }));
		},
	);

	server.tool(
		"update_team",
		"Updates a team.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			teamId: z.number().describe("Team ID."),
			name: z.string().optional().describe("New team name."),
			members: z
				.array(z.number())
				.optional()
				.describe("Full list of member user IDs. This replaces the existing members."),
		},
		async ({ space: spaceName, teamId, name, members }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const body: Record<string, unknown> = {};
			if (name !== undefined) body.name = name;
			if (members !== undefined) body.members = members;
			return asText(
				await callBacklogApiForm(spaceConfig, {
					method: "PATCH",
					path: `/teams/${teamId}`,
					body,
				}),
			);
		},
	);

	server.tool(
		"delete_team",
		"Deletes a team.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			teamId: z.number().describe("Team ID."),
		},
		async ({ space: spaceName, teamId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, { method: "DELETE", path: `/teams/${teamId}` }),
			);
		},
	);

	server.tool(
		"get_team_icon",
		"Downloads a team icon image.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			teamId: z.number().describe("Team ID."),
		},
		async ({ space: spaceName, teamId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return binaryToContent(
				await callBacklogApiBinary(spaceConfig, { path: `/teams/${teamId}/icon` }),
			);
		},
	);

	server.tool(
		"get_project_teams",
		"Returns the list of teams assigned to a project.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
		},
		async ({ space: spaceName, projectIdOrKey }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					path: `/projects/${encodeURIComponent(projectIdOrKey)}/teams`,
				}),
			);
		},
	);

	server.tool(
		"add_project_team",
		"Assigns a team to a project.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			teamId: z.number().describe("Team ID."),
		},
		async ({ space: spaceName, projectIdOrKey, teamId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApiForm(spaceConfig, {
					path: `/projects/${encodeURIComponent(projectIdOrKey)}/teams`,
					body: { teamId },
				}),
			);
		},
	);

	server.tool(
		"delete_project_team",
		"Removes a team from a project.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			teamId: z.number().describe("Team ID."),
		},
		async ({ space: spaceName, projectIdOrKey, teamId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			// DELETE でもパラメータはボディ (form-urlencoded) で送る
			return asText(
				await callBacklogApiForm(spaceConfig, {
					method: "DELETE",
					path: `/projects/${encodeURIComponent(projectIdOrKey)}/teams`,
					body: { teamId },
				}),
			);
		},
	);
}
