// watching-tools.ts
// Tools for Backlog watchings (ウォッチ)

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	type BacklogQueryValue,
	type BacklogSpacesConfig,
	callBacklogApi,
	callBacklogApiForm,
	resolveSpace,
} from "../backlog-client";

const asText = (result: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
});

export function registerWatchingTools(server: McpServer, config: BacklogSpacesConfig) {
	server.tool(
		"get_watchings",
		"Returns the watching list of a user.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			userId: z.number().describe("User ID. Use get_myself to find your own ID."),
			order: z.enum(["asc", "desc"]).optional().describe("Sort order."),
			sort: z
				.enum(["created", "updated", "issueUpdated"])
				.optional()
				.describe("Sort key."),
			count: z.number().min(1).max(100).optional().describe("Number of results (1-100)."),
			offset: z.number().min(0).optional().describe("Offset for pagination."),
			resourceAlreadyRead: z
				.boolean()
				.optional()
				.describe("Filter by whether the watched resource has been read."),
			issueId: z.array(z.number()).optional().describe("Filter by issue IDs."),
		},
		async ({ space: spaceName, userId, ...rest }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const query: Record<string, BacklogQueryValue> = {};
			for (const [k, v] of Object.entries(rest)) {
				if (v !== undefined) query[k] = v as BacklogQueryValue;
			}
			return asText(
				await callBacklogApi(spaceConfig, { path: `/users/${userId}/watchings`, query }),
			);
		},
	);

	server.tool(
		"get_watchings_count",
		"Returns the number of watchings for a user.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			userId: z.number().describe("User ID."),
			resourceAlreadyRead: z.boolean().optional().describe("Filter by read state."),
			alreadyRead: z.boolean().optional().describe("Filter by whether the watching itself is read."),
		},
		async ({ space: spaceName, userId, resourceAlreadyRead, alreadyRead }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const query: Record<string, BacklogQueryValue> = {};
			if (resourceAlreadyRead !== undefined) query.resourceAlreadyRead = resourceAlreadyRead;
			if (alreadyRead !== undefined) query.alreadyRead = alreadyRead;
			return asText(
				await callBacklogApi(spaceConfig, { path: `/users/${userId}/watchings/count`, query }),
			);
		},
	);

	server.tool(
		"get_watching",
		"Returns information about a specific watching.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			watchingId: z.number().describe("Watching ID."),
		},
		async ({ space: spaceName, watchingId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(await callBacklogApi(spaceConfig, { path: `/watchings/${watchingId}` }));
		},
	);

	server.tool(
		"add_watching",
		"Starts watching an issue.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			issueIdOrKey: z.string().describe("Issue ID or issue key."),
			note: z.string().optional().describe("Note for the watching."),
		},
		async ({ space: spaceName, issueIdOrKey, note }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const body: Record<string, unknown> = { issueIdOrKey };
			if (note !== undefined) body.note = note;
			return asText(await callBacklogApiForm(spaceConfig, { path: "/watchings", body }));
		},
	);

	server.tool(
		"update_watching",
		"Updates the note of a watching.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			watchingId: z.number().describe("Watching ID."),
			note: z.string().describe("New note."),
		},
		async ({ space: spaceName, watchingId, note }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApiForm(spaceConfig, {
					method: "PATCH",
					path: `/watchings/${watchingId}`,
					body: { note },
				}),
			);
		},
	);

	server.tool(
		"delete_watching",
		"Stops watching (deletes a watching).",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			watchingId: z.number().describe("Watching ID."),
		},
		async ({ space: spaceName, watchingId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					method: "DELETE",
					path: `/watchings/${watchingId}`,
				}),
			);
		},
	);

	server.tool(
		"mark_watching_as_read",
		"Marks a watching as read.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			watchingId: z.number().describe("Watching ID."),
		},
		async ({ space: spaceName, watchingId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApiForm(spaceConfig, {
					path: `/watchings/${watchingId}/markAsRead`,
					body: {},
				}),
			);
		},
	);
}
