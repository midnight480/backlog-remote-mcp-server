// space-tools.ts
// Tools for managing Backlog space settings and general information

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

/** アクティビティ種別 ID。space / project / user のアクティビティ取得で共通に使う。 */
export const ACTIVITY_TYPE_HINT =
	"Activity type IDs to filter by (1-51, sent as activityTypeId[]). 1=issue created, 2=issue updated, " +
	"3=issue commented, 4=issue deleted, 5=wiki created, 6=wiki updated, 7=wiki deleted, 8=file added, " +
	"9=file updated, 10=file deleted, 11=svn committed, 12=git pushed, 13=git repository created, " +
	"14=issue multi-updated, 15=project user added, 16=project user deleted, 17=comment notification added, " +
	"18=pull request added, 19=pull request updated, 20=comment added on pull request, 21=pull request deleted, " +
	"22=milestone created, 23=milestone updated, 24=milestone deleted, 25=project group added, " +
	"26=project group deleted, 34=status deleted, 35=issue dates multi-updated, 36=document created, " +
	"37=document deleted, 38=document title updated, 39=document revision updated, 40=document commented, " +
	"41=document comment updated, 42=document comment deleted, 43=document comment reply created, " +
	"44=document comment reply updated, 45=document comment reply deleted, 46=document attachment added, " +
	"47=issue multi-created, 48=document multi-created, 49=document mentioned, 50=related issue added, " +
	"51=related issue deleted. Omit to get every type.";

/** アクティビティ取得系で共通のページングパラメータ */
export const activityParams = {
	activityTypeId: z.array(z.number().int().min(1).max(51)).optional().describe(ACTIVITY_TYPE_HINT),
	minId: z.number().optional().describe("Return activities with an ID greater than this."),
	maxId: z.number().optional().describe("Return activities with an ID smaller than this."),
	count: z.number().min(1).max(100).optional().describe("Number of results (1-100, default 20)."),
	order: z.enum(["asc", "desc"]).optional().describe("Sort order. Defaults to desc."),
};

/** activityParams で受けた値をクエリに詰め直す */
export function toActivityQuery(rest: Record<string, unknown>): Record<string, BacklogQueryValue> {
	const query: Record<string, BacklogQueryValue> = {};
	for (const [k, v] of Object.entries(rest)) {
		if (v !== undefined) query[k] = v as BacklogQueryValue;
	}
	return query;
}

export function registerSpaceTools(server: McpServer, config: BacklogSpacesConfig) {
	// List available organizations/spaces
	server.tool(
		"list_spaces",
		"Returns list of configured Backlog spaces, which one is the default, whether each one allows writes, " +
			"and whether an API key is available for it in this session. " +
			"A space with credential \"missing\" cannot be used until the client sends the caller's own API key.",
		{},
		async () => {
			const spaces = config.spaces.map((s) => ({
				name: s.name,
				domain: s.domain,
				isDefault: s.name === config.defaultSpace,
				readOnly: s.readOnly === true,
				// キーの値そのものは絶対に返さない。使えるかどうかと出所だけを示す。
				credential: s.apiKey ? (s.keySource ?? "server") : "missing",
			}));
			return {
				content: [{ type: "text", text: JSON.stringify(spaces, null, 2) }],
			};
		},
	);

	// Get space info
	server.tool(
		"get_space",
		"Returns information about the Backlog space, including feature flags such as " +
			"parentChildIssue and grandchildIssueEnabled (whether 3-level issue hierarchies are available).",
		{
			space: z
				.string()
				.optional()
				.describe("Space name to query. Uses default space if omitted."),
		},
		async ({ space: spaceName }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApi(spaceConfig, { path: "/space" });
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		},
	);

	// Get users
	server.tool(
		"get_users",
		"Returns list of users in the Backlog space. " +
			"Requires the Administrator or Project Administrator role.",
		{
			space: z
				.string()
				.optional()
				.describe("Space name to query. Uses default space if omitted."),
		},
		async ({ space: spaceName }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApi(spaceConfig, { path: "/users" });
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		},
	);

	// Get myself
	server.tool(
		"get_myself",
		"Returns information about the authenticated user.",
		{
			space: z
				.string()
				.optional()
				.describe("Space name to query. Uses default space if omitted."),
		},
		async ({ space: spaceName }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApi(spaceConfig, { path: "/users/myself" });
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		},
	);

	server.tool(
		"get_space_activities",
		"Returns recent updates (activities) in the space (GET /space/activities).",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			...activityParams,
		},
		async ({ space: spaceName, ...rest }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					path: "/space/activities",
					query: toActivityQuery(rest),
				}),
			);
		},
	);

	server.tool(
		"get_activity",
		"Returns a single activity by its ID (GET /activities/:activityId).",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			activityId: z.number().describe("Activity ID."),
		},
		async ({ space: spaceName, activityId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(await callBacklogApi(spaceConfig, { path: `/activities/${activityId}` }));
		},
	);

	server.tool(
		"get_space_icon",
		"Downloads the space logo image.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
		},
		async ({ space: spaceName }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return binaryToContent(await callBacklogApiBinary(spaceConfig, { path: "/space/image" }));
		},
	);

	server.tool(
		"get_space_notification",
		"Returns the space notification message.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
		},
		async ({ space: spaceName }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(await callBacklogApi(spaceConfig, { path: "/space/notification" }));
		},
	);

	server.tool(
		"update_space_notification",
		"Updates the space notification message shown to every member. Requires the Administrator role.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			content: z.string().describe("Space notification content (required)."),
		},
		async ({ space: spaceName, content }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApiForm(spaceConfig, {
					method: "PUT",
					path: "/space/notification",
					body: { content },
				}),
			);
		},
	);

	server.tool(
		"get_space_disk_usage",
		"Returns the disk usage of the whole space, broken down by project. Requires the Administrator role.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
		},
		async ({ space: spaceName }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(await callBacklogApi(spaceConfig, { path: "/space/diskUsage" }));
		},
	);

	server.tool(
		"get_licence",
		"Returns the licence information of the space.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
		},
		async ({ space: spaceName }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(await callBacklogApi(spaceConfig, { path: "/space/licence" }));
		},
	);

	server.tool(
		"get_rate_limit",
		"Returns information about the API rate limit currently applied to you.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
		},
		async ({ space: spaceName }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(await callBacklogApi(spaceConfig, { path: "/rateLimit" }));
		},
	);
}
