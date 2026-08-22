// issue-tools.ts
// Tools for managing Backlog issues and comments

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	type BacklogSpacesConfig,
	callBacklogApi,
	callBacklogApiForm,
	resolveSpace,
} from "../backlog-client";

export function registerIssueTools(server: McpServer, config: BacklogSpacesConfig) {
	server.tool(
		"get_issue",
		"Returns information about a specific issue.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			issueIdOrKey: z.string().describe("Issue ID or issue key (e.g., PROJECT-1)."),
		},
		async ({ space: spaceName, issueIdOrKey }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApi(spaceConfig, { path: `/issues/${issueIdOrKey}` });
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"get_issues",
		"Returns list of issues matching the given criteria.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectId: z.array(z.number()).optional().describe("Project IDs to filter."),
			issueTypeId: z.array(z.number()).optional().describe("Issue type IDs."),
			categoryId: z.array(z.number()).optional().describe("Category IDs."),
			milestoneId: z.array(z.number()).optional().describe("Milestone IDs."),
			statusId: z.array(z.number()).optional().describe("Status IDs."),
			priorityId: z.array(z.number()).optional().describe("Priority IDs."),
			assigneeId: z.array(z.number()).optional().describe("Assignee user IDs."),
			createdUserId: z.array(z.number()).optional().describe("Creator user IDs."),
			keyword: z.string().optional().describe("Search keyword."),
			count: z.number().optional().describe("Number of issues to return (max 100)."),
			offset: z.number().optional().describe("Offset for pagination."),
			sort: z.string().optional().describe("Sort field."),
			order: z.enum(["asc", "desc"]).optional().describe("Sort order."),
		},
		async ({ space: spaceName, ...params }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const query: Record<string, string | number | boolean | undefined> = {};
			if (params.keyword) query.keyword = params.keyword;
			if (params.count) query.count = params.count;
			if (params.offset) query.offset = params.offset;
			if (params.sort) query.sort = params.sort;
			if (params.order) query.order = params.order;

			// Array params need special handling via URL
			const url = new URL(`https://${spaceConfig.domain}/api/v2/issues`);
			url.searchParams.set("apiKey", spaceConfig.apiKey);
			for (const [k, v] of Object.entries(query)) {
				if (v !== undefined) url.searchParams.set(k, String(v));
			}
			if (params.projectId) params.projectId.forEach((id) => url.searchParams.append("projectId[]", String(id)));
			if (params.issueTypeId) params.issueTypeId.forEach((id) => url.searchParams.append("issueTypeId[]", String(id)));
			if (params.categoryId) params.categoryId.forEach((id) => url.searchParams.append("categoryId[]", String(id)));
			if (params.milestoneId) params.milestoneId.forEach((id) => url.searchParams.append("milestoneId[]", String(id)));
			if (params.statusId) params.statusId.forEach((id) => url.searchParams.append("statusId[]", String(id)));
			if (params.priorityId) params.priorityId.forEach((id) => url.searchParams.append("priorityId[]", String(id)));
			if (params.assigneeId) params.assigneeId.forEach((id) => url.searchParams.append("assigneeId[]", String(id)));
			if (params.createdUserId) params.createdUserId.forEach((id) => url.searchParams.append("createdUserId[]", String(id)));

			const response = await fetch(url.toString());
			if (!response.ok) {
				throw new Error(`Backlog API error (${response.status}): ${await response.text()}`);
			}
			const result = await response.json();
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"count_issues",
		"Returns count of issues matching the given criteria.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectId: z.array(z.number()).optional().describe("Project IDs to filter."),
			statusId: z.array(z.number()).optional().describe("Status IDs."),
			keyword: z.string().optional().describe("Search keyword."),
		},
		async ({ space: spaceName, projectId, statusId, keyword }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const url = new URL(`https://${spaceConfig.domain}/api/v2/issues/count`);
			url.searchParams.set("apiKey", spaceConfig.apiKey);
			if (keyword) url.searchParams.set("keyword", keyword);
			if (projectId) projectId.forEach((id) => url.searchParams.append("projectId[]", String(id)));
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
		"add_issue",
		"Creates a new issue in the specified project.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectId: z.number().describe("Project ID."),
			summary: z.string().describe("Issue summary/title."),
			issueTypeId: z.number().describe("Issue type ID."),
			priorityId: z.number().describe("Priority ID."),
			description: z.string().optional().describe("Issue description."),
			startDate: z.string().optional().describe("Start date (YYYY-MM-DD)."),
			dueDate: z.string().optional().describe("Due date (YYYY-MM-DD)."),
			estimatedHours: z.number().optional().describe("Estimated hours."),
			actualHours: z.number().optional().describe("Actual hours."),
			assigneeId: z.number().optional().describe("Assignee user ID."),
			categoryId: z.array(z.number()).optional().describe("Category IDs."),
			milestoneId: z.array(z.number()).optional().describe("Milestone IDs."),
			parentIssueId: z.number().optional().describe("Parent issue ID."),
		},
		async ({ space: spaceName, ...params }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const body: Record<string, unknown> = {
				projectId: params.projectId,
				summary: params.summary,
				issueTypeId: params.issueTypeId,
				priorityId: params.priorityId,
			};
			if (params.description) body.description = params.description;
			if (params.startDate) body.startDate = params.startDate;
			if (params.dueDate) body.dueDate = params.dueDate;
			if (params.estimatedHours) body.estimatedHours = params.estimatedHours;
			if (params.actualHours) body.actualHours = params.actualHours;
			if (params.assigneeId) body.assigneeId = params.assigneeId;
			if (params.categoryId) body.categoryId = params.categoryId;
			if (params.milestoneId) body.milestoneId = params.milestoneId;
			if (params.parentIssueId) body.parentIssueId = params.parentIssueId;

			const result = await callBacklogApiForm(spaceConfig, { path: "/issues", body });
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"update_issue",
		"Updates an existing issue.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			issueIdOrKey: z.string().describe("Issue ID or issue key."),
			summary: z.string().optional().describe("New summary."),
			description: z.string().optional().describe("New description."),
			statusId: z.number().optional().describe("New status ID."),
			priorityId: z.number().optional().describe("New priority ID."),
			assigneeId: z.number().optional().describe("New assignee user ID."),
			startDate: z.string().optional().describe("New start date (YYYY-MM-DD)."),
			dueDate: z.string().optional().describe("New due date (YYYY-MM-DD)."),
			estimatedHours: z.number().optional().describe("New estimated hours."),
			actualHours: z.number().optional().describe("New actual hours."),
			comment: z.string().optional().describe("Comment to add with the update."),
		},
		async ({ space: spaceName, issueIdOrKey, ...params }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const body: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(params)) {
				if (v !== undefined) body[k] = v;
			}
			const result = await callBacklogApiForm(spaceConfig, {
				method: "PATCH",
				path: `/issues/${issueIdOrKey}`,
				body,
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"delete_issue",
		"Deletes an issue.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			issueIdOrKey: z.string().describe("Issue ID or issue key."),
		},
		async ({ space: spaceName, issueIdOrKey }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApi(spaceConfig, {
				method: "DELETE",
				path: `/issues/${issueIdOrKey}`,
			});
			return { content: [{ type: "text", text: JSON.stringify(result ?? "Deleted successfully", null, 2) }] };
		},
	);

	server.tool(
		"get_issue_comments",
		"Returns list of comments for an issue.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			issueIdOrKey: z.string().describe("Issue ID or issue key."),
			count: z.number().optional().describe("Number of comments to return (max 100)."),
			order: z.enum(["asc", "desc"]).optional().describe("Sort order."),
		},
		async ({ space: spaceName, issueIdOrKey, count, order }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const query: Record<string, string | number | boolean | undefined> = {};
			if (count) query.count = count;
			if (order) query.order = order;
			const result = await callBacklogApi(spaceConfig, {
				path: `/issues/${issueIdOrKey}/comments`,
				query,
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"add_issue_comment",
		"Adds a comment to an issue.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			issueIdOrKey: z.string().describe("Issue ID or issue key."),
			content: z.string().describe("Comment content."),
			notifiedUserId: z.array(z.number()).optional().describe("User IDs to notify."),
		},
		async ({ space: spaceName, issueIdOrKey, content, notifiedUserId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const body: Record<string, unknown> = { content };
			if (notifiedUserId) body.notifiedUserId = notifiedUserId;
			const result = await callBacklogApiForm(spaceConfig, {
				path: `/issues/${issueIdOrKey}/comments`,
				body,
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	// Priorities
	server.tool(
		"get_priorities",
		"Returns list of issue priorities.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
		},
		async ({ space: spaceName }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApi(spaceConfig, { path: "/priorities" });
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	// Issue types
	server.tool(
		"get_issue_types",
		"Returns list of issue types for a project.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
		},
		async ({ space: spaceName, projectIdOrKey }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApi(spaceConfig, {
				path: `/projects/${projectIdOrKey}/issueTypes`,
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	// Categories
	server.tool(
		"get_categories",
		"Returns list of categories for a project.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
		},
		async ({ space: spaceName, projectIdOrKey }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApi(spaceConfig, {
				path: `/projects/${projectIdOrKey}/categories`,
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	// Version/Milestones
	server.tool(
		"get_version_milestones",
		"Returns list of version milestones for a project.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
		},
		async ({ space: spaceName, projectIdOrKey }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApi(spaceConfig, {
				path: `/projects/${projectIdOrKey}/versions`,
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"add_version_milestone",
		"Creates a new version milestone for a project.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			name: z.string().describe("Version/milestone name."),
			description: z.string().optional(),
			startDate: z.string().optional().describe("Start date (YYYY-MM-DD)."),
			releaseDueDate: z.string().optional().describe("Release due date (YYYY-MM-DD)."),
		},
		async ({ space: spaceName, projectIdOrKey, ...params }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const body: Record<string, unknown> = { name: params.name };
			if (params.description) body.description = params.description;
			if (params.startDate) body.startDate = params.startDate;
			if (params.releaseDueDate) body.releaseDueDate = params.releaseDueDate;
			const result = await callBacklogApiForm(spaceConfig, {
				path: `/projects/${projectIdOrKey}/versions`,
				body,
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	// Resolutions
	server.tool(
		"get_resolutions",
		"Returns list of issue resolutions.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
		},
		async ({ space: spaceName }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApi(spaceConfig, { path: "/resolutions" });
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);
}
