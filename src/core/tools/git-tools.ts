// git-tools.ts
// Tools for managing Backlog Git repositories and pull requests

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

const asText = (result: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
});

const repoPath = (projectIdOrKey: string, repoIdOrName: string) =>
	`/projects/${encodeURIComponent(projectIdOrKey)}/git/repositories/${encodeURIComponent(repoIdOrName)}`;

const prPath = (projectIdOrKey: string, repoIdOrName: string, number: number) =>
	`${repoPath(projectIdOrKey, repoIdOrName)}/pullRequests/${number}`;

/** GET /pullRequests と GET /pullRequests/count で共通のクエリパラメータ。 */
const pullRequestFilterSchema = {
	statusId: z
		.array(z.number())
		.optional()
		.describe("Filter by status IDs (sent as statusId[]). 1: Open, 2: Closed, 3: Merged."),
	assigneeId: z.array(z.number()).optional().describe("Filter by assignee user IDs (sent as assigneeId[])."),
	issueId: z.array(z.number()).optional().describe("Filter by related issue IDs (sent as issueId[])."),
	createdUserId: z
		.array(z.number())
		.optional()
		.describe("Filter by created user IDs (sent as createdUserId[])."),
	offset: z.number().int().min(0).optional().describe("Offset for pagination."),
	count: z.number().int().min(1).max(100).optional().describe("Number of records to retrieve (1-100). Default 20."),
};

export function registerGitTools(server: McpServer, config: BacklogSpacesConfig) {
	server.tool(
		"get_git_repositories",
		"Returns list of Git repositories for a project.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
		},
		async ({ space: spaceName, projectIdOrKey }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApi(spaceConfig, {
				path: `/projects/${encodeURIComponent(projectIdOrKey)}/git/repositories`,
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"get_git_repository",
		"Returns information about a specific Git repository.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			repoIdOrName: z.string().describe("Repository ID or name."),
		},
		async ({ space: spaceName, projectIdOrKey, repoIdOrName }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApi(spaceConfig, {
				path: repoPath(projectIdOrKey, repoIdOrName),
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"get_pull_requests",
		"Returns list of pull requests for a repository. All filters are optional; array filters are sent as `name[]`.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			repoIdOrName: z.string().describe("Repository ID or name."),
			...pullRequestFilterSchema,
		},
		async ({ space: spaceName, projectIdOrKey, repoIdOrName, ...filters }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					path: `${repoPath(projectIdOrKey, repoIdOrName)}/pullRequests`,
					query: filters,
				}),
			);
		},
	);

	server.tool(
		"get_pull_request",
		"Returns information about a specific pull request.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			repoIdOrName: z.string().describe("Repository ID or name."),
			number: z.number().describe("Pull request number."),
		},
		async ({ space: spaceName, projectIdOrKey, repoIdOrName, number }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApi(spaceConfig, {
				path: prPath(projectIdOrKey, repoIdOrName, number),
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"add_pull_request",
		"Creates a new pull request.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			repoIdOrName: z.string().describe("Repository ID or name."),
			summary: z.string().describe("Pull request title (summary)."),
			description: z.string().describe("Pull request description. Required by the API. Mention notation is available."),
			base: z.string().describe("Name of the merge base branch (merge into)."),
			branch: z.string().describe("Name of the branch to be merged (merge from)."),
			issueId: z.number().optional().describe("Related issue ID."),
			assigneeId: z.number().optional().describe("Assignee user ID."),
			notifiedUserId: z
				.array(z.number())
				.optional()
				.describe("User IDs to notify when the pull request is added (sent as notifiedUserId[])."),
			attachmentId: z
				.array(z.number())
				.optional()
				.describe("Attachment IDs returned by the Post Attachment File API (sent as attachmentId[])."),
		},
		async ({ space: spaceName, projectIdOrKey, repoIdOrName, ...params }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const body: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(params)) {
				if (v !== undefined) body[k] = v;
			}
			const result = await callBacklogApiForm(spaceConfig, {
				path: `${repoPath(projectIdOrKey, repoIdOrName)}/pullRequests`,
				body,
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"update_pull_request",
		"Updates an existing pull request.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			repoIdOrName: z.string().describe("Repository ID or name."),
			number: z.number().describe("Pull request number."),
			summary: z.string().optional().describe("New title (summary)."),
			description: z.string().optional().describe("New description. Mention notation is available."),
			issueId: z.number().optional().describe("Related issue ID."),
			assigneeId: z.number().optional().describe("New assignee user ID."),
			notifiedUserId: z
				.array(z.number())
				.optional()
				.describe("User IDs to notify of the update (sent as notifiedUserId[])."),
			comment: z.string().optional().describe("Comment to add along with the update. Mention notation is available."),
			statusId: z
				.number()
				.optional()
				.describe(
					"New status ID (1: Open, 2: Closed, 3: Merged). Not listed in the official API docs; kept for compatibility with backlog-js / the official MCP server.",
				),
		},
		async ({ space: spaceName, projectIdOrKey, repoIdOrName, number, ...params }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const body: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(params)) {
				if (v !== undefined) body[k] = v;
			}
			const result = await callBacklogApiForm(spaceConfig, {
				method: "PATCH",
				path: prPath(projectIdOrKey, repoIdOrName, number),
				body,
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"get_pull_request_comments",
		"Returns list of comments for a pull request.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			repoIdOrName: z.string().describe("Repository ID or name."),
			number: z.number().describe("Pull request number."),
			minId: z.number().optional().describe("Minimum comment ID."),
			maxId: z.number().optional().describe("Maximum comment ID."),
			count: z.number().int().min(1).max(100).optional().describe("Number of records to retrieve (1-100). Default 20."),
			order: z.enum(["asc", "desc"]).optional().describe('Sort order. Default "desc".'),
		},
		async ({ space: spaceName, projectIdOrKey, repoIdOrName, number, ...query }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApi(spaceConfig, {
				path: `${prPath(projectIdOrKey, repoIdOrName, number)}/comments`,
				query,
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"add_pull_request_comment",
		"Adds a comment to a pull request.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			repoIdOrName: z.string().describe("Repository ID or name."),
			number: z.number().describe("Pull request number."),
			content: z.string().describe("Comment content. Mention notation is available."),
			attachmentId: z
				.array(z.number())
				.optional()
				.describe("Attachment IDs returned by the Post Attachment File API (sent as attachmentId[])."),
			notifiedUserId: z
				.array(z.number())
				.optional()
				.describe("User IDs to notify when the comment is added (sent as notifiedUserId[])."),
		},
		async ({ space: spaceName, projectIdOrKey, repoIdOrName, number, content, attachmentId, notifiedUserId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApiForm(spaceConfig, {
				path: `${prPath(projectIdOrKey, repoIdOrName, number)}/comments`,
				body: { content, attachmentId, notifiedUserId },
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"count_pull_requests",
		"Returns the number of pull requests in a repository. Accepts the same filters as get_pull_requests.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			repoIdOrName: z.string().describe("Repository ID or name."),
			...pullRequestFilterSchema,
		},
		async ({ space: spaceName, projectIdOrKey, repoIdOrName, ...filters }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					path: `${repoPath(projectIdOrKey, repoIdOrName)}/pullRequests/count`,
					query: filters,
				}),
			);
		},
	);

	server.tool(
		"count_pull_request_comments",
		"Returns the number of comments on a pull request.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			repoIdOrName: z.string().describe("Repository ID or name."),
			number: z.number().describe("Pull request number."),
		},
		async ({ space: spaceName, projectIdOrKey, repoIdOrName, number }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					path: `${prPath(projectIdOrKey, repoIdOrName, number)}/comments/count`,
				}),
			);
		},
	);

	server.tool(
		"update_pull_request_comment",
		"Updates the content of a pull request comment. Mention notation is available.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			repoIdOrName: z.string().describe("Repository ID or name."),
			number: z.number().describe("Pull request number."),
			commentId: z.number().describe("Comment ID."),
			content: z.string().describe("New comment content."),
		},
		async ({ space: spaceName, projectIdOrKey, repoIdOrName, number, commentId, content }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApiForm(spaceConfig, {
					method: "PATCH",
					path: `${prPath(projectIdOrKey, repoIdOrName, number)}/comments/${commentId}`,
					body: { content },
				}),
			);
		},
	);

	server.tool(
		"get_pull_request_attachments",
		"Returns the list of files attached to a pull request.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			repoIdOrName: z.string().describe("Repository ID or name."),
			number: z.number().describe("Pull request number."),
		},
		async ({ space: spaceName, projectIdOrKey, repoIdOrName, number }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					path: `${prPath(projectIdOrKey, repoIdOrName, number)}/attachments`,
				}),
			);
		},
	);

	server.tool(
		"get_pull_request_attachment",
		"Downloads a file attached to a pull request. Fails for files over 4MB.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			repoIdOrName: z.string().describe("Repository ID or name."),
			number: z.number().describe("Pull request number."),
			attachmentId: z.number().describe("Attachment ID."),
		},
		async ({ space: spaceName, projectIdOrKey, repoIdOrName, number, attachmentId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return binaryToContent(
				await callBacklogApiBinary(spaceConfig, {
					path: `${prPath(projectIdOrKey, repoIdOrName, number)}/attachments/${attachmentId}`,
				}),
			);
		},
	);

	server.tool(
		"delete_pull_request_attachment",
		"Deletes a file attached to a pull request.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			repoIdOrName: z.string().describe("Repository ID or name."),
			number: z.number().describe("Pull request number."),
			attachmentId: z.number().describe("Attachment ID."),
		},
		async ({ space: spaceName, projectIdOrKey, repoIdOrName, number, attachmentId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			// 公式 SDK 0.19.1 はここで GET を発行するが、API 仕様上は DELETE。
			// https://developer.nulab.com/docs/backlog/api/2/delete-pull-request-attachments/
			return asText(
				await callBacklogApi(spaceConfig, {
					method: "DELETE",
					path: `${prPath(projectIdOrKey, repoIdOrName, number)}/attachments/${attachmentId}`,
				}),
			);
		},
	);
}
