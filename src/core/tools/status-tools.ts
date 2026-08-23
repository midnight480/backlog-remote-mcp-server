// status-tools.ts
// Tools for project statuses (状態)
//
// update_issue は statusId を要求するが、その ID を引く手段がサーバ内に無かった。
// get_project_statuses がその欠けていた導線にあたる。

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type BacklogSpacesConfig, callBacklogApi, callBacklogApiForm, resolveSpace } from "../backlog-client";

const asText = (result: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
});

/** Backlog が用意している状態の色。これ以外は API に拒否される。 */
const STATUS_COLORS = [
	"#ea2c00",
	"#e87758",
	"#e07b9a",
	"#868cb7",
	"#3b9dbd",
	"#4caf93",
	"#b0be3c",
	"#eda62a",
	"#f42858",
	"#393939",
] as const;

export function registerStatusTools(server: McpServer, config: BacklogSpacesConfig) {
	const statusPath = (projectIdOrKey: string) =>
		`/projects/${encodeURIComponent(projectIdOrKey)}/statuses`;

	server.tool(
		"get_project_statuses",
		"Returns the list of statuses in a project, with their IDs. Use this to find the statusId to pass to update_issue.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
		},
		async ({ space: spaceName, projectIdOrKey }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(await callBacklogApi(spaceConfig, { path: statusPath(projectIdOrKey) }));
		},
	);

	server.tool(
		"add_project_status",
		"Adds a status to a project.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			name: z.string().describe("Status name."),
			color: z.enum(STATUS_COLORS).describe("Status color. Must be one of the Backlog preset colors."),
		},
		async ({ space: spaceName, projectIdOrKey, name, color }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApiForm(spaceConfig, {
					path: statusPath(projectIdOrKey),
					body: { name, color },
				}),
			);
		},
	);

	server.tool(
		"update_project_status",
		"Updates a status in a project.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			statusId: z.number().describe("Status ID."),
			name: z.string().optional().describe("New status name."),
			color: z.enum(STATUS_COLORS).optional().describe("New status color."),
		},
		async ({ space: spaceName, projectIdOrKey, statusId, name, color }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const body: Record<string, unknown> = {};
			if (name !== undefined) body.name = name;
			if (color !== undefined) body.color = color;
			return asText(
				await callBacklogApiForm(spaceConfig, {
					method: "PATCH",
					path: `${statusPath(projectIdOrKey)}/${statusId}`,
					body,
				}),
			);
		},
	);

	server.tool(
		"delete_project_status",
		"Deletes a status. Issues in this status are moved to substituteStatusId.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			statusId: z.number().describe("Status ID to delete."),
			substituteStatusId: z
				.number()
				.describe("Status ID that issues currently in the deleted status are moved to."),
		},
		async ({ space: spaceName, projectIdOrKey, statusId, substituteStatusId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			// DELETE でもパラメータはボディ (form-urlencoded) で送る
			return asText(
				await callBacklogApiForm(spaceConfig, {
					method: "DELETE",
					path: `${statusPath(projectIdOrKey)}/${statusId}`,
					body: { substituteStatusId },
				}),
			);
		},
	);

	server.tool(
		"update_project_status_order",
		"Reorders the statuses of a project. Pass every status ID in the order you want.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			statusId: z
				.array(z.number())
				.describe("All status IDs of the project, in the desired display order."),
		},
		async ({ space: spaceName, projectIdOrKey, statusId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApiForm(spaceConfig, {
					method: "PATCH",
					path: `${statusPath(projectIdOrKey)}/updateDisplayOrder`,
					body: { statusId },
				}),
			);
		},
	);
}
