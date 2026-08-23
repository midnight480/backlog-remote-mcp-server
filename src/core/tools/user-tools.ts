// user-tools.ts
// Tools for Backlog users beyond the basics in space-tools.
//
// get_users / get_myself は space-tools 側にある (既存ツール名を変えないため)。

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
import { activityParams, toActivityQuery } from "./space-tools";

const asText = (result: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
});

export function registerUserTools(server: McpServer, config: BacklogSpacesConfig) {
	server.tool(
		"get_user",
		"Returns information about a specific user.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			userId: z.number().describe("User ID."),
		},
		async ({ space: spaceName, userId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(await callBacklogApi(spaceConfig, { path: `/users/${userId}` }));
		},
	);

	server.tool(
		"add_user",
		"Creates a user in the space. Requires space administrator privileges.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			userId: z.string().describe("Login ID for the new user."),
			password: z.string().describe("Password for the new user."),
			name: z.string().describe("Display name."),
			mailAddress: z.string().describe("Email address."),
			roleType: z
				.number()
				.min(1)
				.max(6)
				.describe(
					"Role: 1=administrator, 2=normal user, 3=reporter, 4=viewer, 5=guest reporter, 6=guest viewer.",
				),
		},
		async ({ space: spaceName, ...body }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(await callBacklogApiForm(spaceConfig, { path: "/users", body }));
		},
	);

	server.tool(
		"update_user",
		"Updates a user. Requires space administrator privileges.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			userId: z.number().describe("User ID to update."),
			password: z.string().optional().describe("New password."),
			name: z.string().optional().describe("New display name."),
			mailAddress: z.string().optional().describe("New email address."),
			roleType: z.number().min(1).max(6).optional().describe("New role type."),
		},
		async ({ space: spaceName, userId, ...rest }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const body: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(rest)) {
				if (v !== undefined) body[k] = v;
			}
			return asText(
				await callBacklogApiForm(spaceConfig, {
					method: "PATCH",
					path: `/users/${userId}`,
					body,
				}),
			);
		},
	);

	server.tool(
		"delete_user",
		"Deletes a user. Requires space administrator privileges.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			userId: z.number().describe("User ID to delete."),
		},
		async ({ space: spaceName, userId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, { method: "DELETE", path: `/users/${userId}` }),
			);
		},
	);

	server.tool(
		"get_user_icon",
		"Downloads a user's icon image.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			userId: z.number().describe("User ID."),
		},
		async ({ space: spaceName, userId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return binaryToContent(
				await callBacklogApiBinary(spaceConfig, { path: `/users/${userId}/icon` }),
			);
		},
	);

	server.tool(
		"get_user_activities",
		"Returns recent activities of a user.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			userId: z.number().describe("User ID."),
			...activityParams,
		},
		async ({ space: spaceName, userId, ...rest }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					path: `/users/${userId}/activities`,
					query: toActivityQuery(rest),
				}),
			);
		},
	);

	server.tool(
		"get_user_stars",
		"Returns the stars a user has received.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			userId: z.number().describe("User ID."),
			minId: z.number().optional().describe("Return stars with an ID greater than this."),
			maxId: z.number().optional().describe("Return stars with an ID smaller than this."),
			count: z.number().min(1).max(100).optional().describe("Number of results (1-100)."),
			order: z.enum(["asc", "desc"]).optional().describe("Sort order."),
		},
		async ({ space: spaceName, userId, ...rest }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const query: Record<string, BacklogQueryValue> = {};
			for (const [k, v] of Object.entries(rest)) {
				if (v !== undefined) query[k] = v as BacklogQueryValue;
			}
			return asText(
				await callBacklogApi(spaceConfig, { path: `/users/${userId}/stars`, query }),
			);
		},
	);

	server.tool(
		"get_user_stars_count",
		"Returns the number of stars a user has received.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			userId: z.number().describe("User ID."),
			since: z.string().optional().describe("Start date, yyyy-MM-dd."),
			until: z.string().optional().describe("End date, yyyy-MM-dd."),
		},
		async ({ space: spaceName, userId, since, until }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const query: Record<string, BacklogQueryValue> = {};
			if (since) query.since = since;
			if (until) query.until = until;
			return asText(
				await callBacklogApi(spaceConfig, { path: `/users/${userId}/stars/count`, query }),
			);
		},
	);

	// 「最近の閲覧」系。いずれも認証ユーザー自身のものを対象にする。
	const recentParams = {
		space: z.string().optional().describe("Space name. Uses default if omitted."),
		order: z.enum(["asc", "desc"]).optional().describe("Sort order."),
		offset: z.number().min(0).optional().describe("Offset for pagination."),
		count: z.number().min(1).max(100).optional().describe("Number of results (1-100)."),
	};
	const recentQuery = (rest: Record<string, unknown>) => {
		const query: Record<string, BacklogQueryValue> = {};
		for (const [k, v] of Object.entries(rest)) {
			if (v !== undefined) query[k] = v as BacklogQueryValue;
		}
		return query;
	};

	server.tool(
		"get_recently_viewed_issues",
		"Returns issues the authenticated user recently viewed.",
		recentParams,
		async ({ space: spaceName, ...rest }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					path: "/users/myself/recentlyViewedIssues",
					query: recentQuery(rest),
				}),
			);
		},
	);

	server.tool(
		"add_recently_viewed_issue",
		"Records an issue as recently viewed by the authenticated user.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			issueIdOrKey: z.string().describe("Issue ID or issue key."),
		},
		async ({ space: spaceName, issueIdOrKey }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApiForm(spaceConfig, {
					path: "/users/myself/recentlyViewedIssues",
					body: { issueIdOrKey },
				}),
			);
		},
	);

	server.tool(
		"get_recently_viewed_projects",
		"Returns projects the authenticated user recently viewed.",
		recentParams,
		async ({ space: spaceName, ...rest }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					path: "/users/myself/recentlyViewedProjects",
					query: recentQuery(rest),
				}),
			);
		},
	);

	server.tool(
		"get_recently_viewed_wikis",
		"Returns wiki pages the authenticated user recently viewed.",
		recentParams,
		async ({ space: spaceName, ...rest }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					path: "/users/myself/recentlyViewedWikis",
					query: recentQuery(rest),
				}),
			);
		},
	);

	server.tool(
		"add_recently_viewed_wiki",
		"Records a wiki page as recently viewed by the authenticated user.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			wikiId: z.number().describe("Wiki page ID."),
		},
		async ({ space: spaceName, wikiId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApiForm(spaceConfig, {
					path: "/users/myself/recentlyViewedWikis",
					body: { wikiId },
				}),
			);
		},
	);
}
