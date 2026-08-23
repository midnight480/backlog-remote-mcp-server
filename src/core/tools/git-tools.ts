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
				path: `/projects/${projectIdOrKey}/git/repositories`,
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
				path: `/projects/${projectIdOrKey}/git/repositories/${repoIdOrName}`,
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"get_pull_requests",
		"Returns list of pull requests for a repository.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			repoIdOrName: z.string().describe("Repository ID or name."),
			statusId: z.array(z.number()).optional().describe("Status IDs (1: Open, 2: Closed, 3: Merged)."),
			count: z.number().optional().describe("Number of results (max 100)."),
			offset: z.number().optional().describe("Offset for pagination."),
		},
		async ({ space: spaceName, projectIdOrKey, repoIdOrName, statusId, count, offset }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const url = new URL(
				`https://${spaceConfig.domain}/api/v2/projects/${projectIdOrKey}/git/repositories/${repoIdOrName}/pullRequests`,
			);
			url.searchParams.set("apiKey", spaceConfig.apiKey);
			if (count) url.searchParams.set("count", String(count));
			if (offset) url.searchParams.set("offset", String(offset));
			if (statusId) statusId.forEach((id) => url.searchParams.append("statusId[]", String(id)));

			const response = await fetch(url.toString());
			if (!response.ok) {
				throw new Error(`Backlog API error (${response.status}): ${await response.text()}`);
			}
			const result = await response.json();
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
				path: `/projects/${projectIdOrKey}/git/repositories/${repoIdOrName}/pullRequests/${number}`,
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
			summary: z.string().describe("Pull request title."),
			description: z.string().optional().describe("Pull request description."),
			base: z.string().describe("Base branch name."),
			branch: z.string().describe("Source branch name."),
			assigneeId: z.number().optional().describe("Assignee user ID."),
			issueId: z.number().optional().describe("Related issue ID."),
		},
		async ({ space: spaceName, projectIdOrKey, repoIdOrName, ...params }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const body: Record<string, unknown> = {
				summary: params.summary,
				base: params.base,
				branch: params.branch,
			};
			if (params.description) body.description = params.description;
			if (params.assigneeId) body.assigneeId = params.assigneeId;
			if (params.issueId) body.issueId = params.issueId;
			const result = await callBacklogApiForm(spaceConfig, {
				path: `/projects/${projectIdOrKey}/git/repositories/${repoIdOrName}/pullRequests`,
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
			summary: z.string().optional().describe("New title."),
			description: z.string().optional().describe("New description."),
			statusId: z.number().optional().describe("New status ID (1: Open, 2: Closed, 3: Merged)."),
			assigneeId: z.number().optional().describe("New assignee user ID."),
			comment: z.string().optional().describe("Comment to add."),
		},
		async ({ space: spaceName, projectIdOrKey, repoIdOrName, number, ...params }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const body: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(params)) {
				if (v !== undefined) body[k] = v;
			}
			const result = await callBacklogApiForm(spaceConfig, {
				method: "PATCH",
				path: `/projects/${projectIdOrKey}/git/repositories/${repoIdOrName}/pullRequests/${number}`,
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
			count: z.number().optional().describe("Number of results (max 100)."),
			order: z.enum(["asc", "desc"]).optional().describe("Sort order."),
		},
		async ({ space: spaceName, projectIdOrKey, repoIdOrName, number, count, order }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const query: Record<string, string | number | boolean | undefined> = {};
			if (count) query.count = count;
			if (order) query.order = order;
			const result = await callBacklogApi(spaceConfig, {
				path: `/projects/${projectIdOrKey}/git/repositories/${repoIdOrName}/pullRequests/${number}/comments`,
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
			content: z.string().describe("Comment content."),
		},
		async ({ space: spaceName, projectIdOrKey, repoIdOrName, number, content }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApiForm(spaceConfig, {
				path: `/projects/${projectIdOrKey}/git/repositories/${repoIdOrName}/pullRequests/${number}/comments`,
				body: { content },
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	const prPath = (projectIdOrKey: string, repoIdOrName: string, number: number) =>
		`/projects/${encodeURIComponent(projectIdOrKey)}/git/repositories/` +
		`${encodeURIComponent(repoIdOrName)}/pullRequests/${number}`;

	server.tool(
		"count_pull_requests",
		"Returns the number of pull requests in a repository.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			repoIdOrName: z.string().describe("Repository ID or name."),
		},
		async ({ space: spaceName, projectIdOrKey, repoIdOrName }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					path:
						`/projects/${encodeURIComponent(projectIdOrKey)}/git/repositories/` +
						`${encodeURIComponent(repoIdOrName)}/pullRequests/count`,
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
		"Updates the content of a pull request comment.",
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
