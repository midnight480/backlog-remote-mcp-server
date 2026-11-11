// issue-tools.ts
// Tools for managing Backlog issues and comments

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

/**
 * GET /issues と /issues/count で共通の絞り込み条件。
 * 配列パラメータは callBacklogApi が key[]=v1&key[]=v2 形式に展開する。
 */
const issueFilterParams = {
	projectId: z.array(z.number()).optional().describe("Project IDs to filter."),
	issueTypeId: z.array(z.number()).optional().describe("Issue type IDs."),
	categoryId: z.array(z.number()).optional().describe("Category IDs."),
	versionId: z.array(z.number()).optional().describe("Version IDs."),
	milestoneId: z.array(z.number()).optional().describe("Milestone IDs."),
	statusId: z.array(z.number()).optional().describe("Status IDs. Use get_project_statuses to find IDs."),
	priorityId: z.array(z.number()).optional().describe("Priority IDs."),
	assigneeId: z.array(z.number()).optional().describe("Assignee user IDs."),
	createdUserId: z.array(z.number()).optional().describe("Creator user IDs."),
	resolutionId: z.array(z.number()).optional().describe("Resolution IDs. Use get_resolutions to find IDs."),
	id: z.array(z.number()).optional().describe("Issue IDs."),
	parentIssueId: z
		.array(z.number())
		.optional()
		.describe("Parent issue IDs. Filters to issues directly under each given parent, covering both child and grandchild issues."),
	parentChild: z
		.number()
		.int()
		.min(0)
		.max(10)
		.optional()
		.describe(
			"Filter by parent-child level. 0=all (default), 1=exclude subtasks, " +
				"2=child or grandchild issues, 3=standalone (no parent and no children), " +
				"4=issues having children, 5=grandchild only, 6=child only, 7=top level only, " +
				"8=excluding grandchildren, 9=excluding top level of a 3-level hierarchy, 10=bottom level only.",
		),
	attachment: z.boolean().optional().describe("True for issues with attachments, false for issues without."),
	sharedFile: z.boolean().optional().describe("True for issues with shared files, false for issues without."),
	hasDueDate: z
		.literal(false)
		.optional()
		.describe("Pass false to return only issues without a due date. Backlog rejects true."),
	createdSince: z.string().optional().describe("Created since (yyyy-MM-dd)."),
	createdUntil: z.string().optional().describe("Created until (yyyy-MM-dd)."),
	updatedSince: z.string().optional().describe("Updated since (yyyy-MM-dd)."),
	updatedUntil: z.string().optional().describe("Updated until (yyyy-MM-dd)."),
	startDateSince: z.string().optional().describe("Start date since (yyyy-MM-dd)."),
	startDateUntil: z.string().optional().describe("Start date until (yyyy-MM-dd)."),
	dueDateSince: z.string().optional().describe("Due date since (yyyy-MM-dd)."),
	dueDateUntil: z.string().optional().describe("Due date until (yyyy-MM-dd)."),
	keyword: z.string().optional().describe("Search keyword."),
	customFields: z
		.array(
			z.discriminatedUnion("type", [
				z.object({
					type: z.literal("text"),
					id: z.number().describe("Custom field ID."),
					value: z.string().describe("Keyword. Sent as customField_{id}."),
				}),
				z.object({
					type: z.literal("numeric"),
					id: z.number().describe("Custom field ID."),
					min: z.number().optional().describe("Minimum. Sent as customField_{id}_min."),
					max: z.number().optional().describe("Maximum. Sent as customField_{id}_max."),
				}),
				z.object({
					type: z.literal("date"),
					id: z.number().describe("Custom field ID."),
					min: z.string().optional().describe("Date from (yyyy-MM-dd). Sent as customField_{id}_min."),
					max: z.string().optional().describe("Date to (yyyy-MM-dd). Sent as customField_{id}_max."),
				}),
				z.object({
					type: z.literal("list"),
					id: z.number().describe("Custom field ID."),
					value: z.array(z.number()).min(1).describe("List item IDs. Sent as customField_{id}[]."),
				}),
			]),
		)
		.optional()
		.describe(
			"Filter by custom fields. Pick the type matching the field (text, numeric, date or list). " +
				"Use get_custom_fields to find field IDs and list item IDs.",
		),
};

type CustomFieldFilter = {
	type: "text" | "numeric" | "date" | "list";
	id: number;
	value?: string | number[];
	min?: number | string;
	max?: number | string;
};

/** カスタム属性の検索条件を customField_{id} / _min / _max / [] 形式のクエリに展開する */
function customFieldFilterQuery(filters: CustomFieldFilter[] | undefined): Record<string, BacklogQueryValue> {
	const query: Record<string, BacklogQueryValue> = {};
	for (const f of filters ?? []) {
		const key = `customField_${f.id}`;
		if (f.type === "text" || f.type === "list") {
			// list は配列なので callBacklogApi が customField_{id}[] に展開する
			if (f.value !== undefined) query[key] = f.value;
		} else {
			if (f.min !== undefined) query[`${key}_min`] = f.min;
			if (f.max !== undefined) query[`${key}_max`] = f.max;
		}
	}
	return query;
}

/** 課題の登録・更新で使うカスタム属性の値 (customField_{id}, customField_{id}_otherValue) */
const customFieldValuesParam = z
	.array(
		z.object({
			id: z.number().describe("Custom field ID."),
			value: z
				.union([z.string(), z.number(), z.array(z.number())])
				.optional()
				.describe(
					"Value sent as customField_{id}. Text: string; numeric: number; date: yyyy-MM-dd; " +
						"list: list item ID (an array for multiple-selection fields).",
				),
			otherValue: z
				.string()
				.optional()
				.describe("Text for the 'other' option of a list field. Sent as customField_{id}_otherValue."),
		}),
	)
	.optional()
	.describe("Custom field values. Use get_custom_fields to find field IDs and list item IDs.");

function customFieldValuesBody(
	fields: Array<{ id: number; value?: string | number | number[]; otherValue?: string }> | undefined,
): Record<string, unknown> {
	const body: Record<string, unknown> = {};
	for (const f of fields ?? []) {
		if (f.value !== undefined) body[`customField_${f.id}`] = f.value;
		if (f.otherValue !== undefined) body[`customField_${f.id}_otherValue`] = f.otherValue;
	}
	return body;
}

/** 課題の expand パラメータ。childIssueSummary で直下の子課題の件数を返す。 */
const issueExpandParam = z
	.array(z.enum(["childIssueSummary"]))
	.optional()
	.describe(
		'Pass ["childIssueSummary"] to include a childIssueSummary object on each issue ' +
			"with the total number of direct child issues (total) and the number of closed ones (closed).",
	);

/** issueFilterParams で受けた値をクエリにそのまま詰め直す */
function issueFilterQuery(params: Record<string, unknown>): Record<string, BacklogQueryValue> {
	const { customFields, ...rest } = params;
	const query: Record<string, BacklogQueryValue> = {};
	for (const [k, v] of Object.entries(rest)) {
		if (v !== undefined) query[k] = v as BacklogQueryValue;
	}
	return { ...query, ...customFieldFilterQuery(customFields as CustomFieldFilter[] | undefined) };
}

/** GET /issues と /issues/count の並び順・ページング (ドキュメント上は count にも存在する) */
const issueListParams = {
	count: z.number().int().min(1).max(100).optional().describe("Number of issues to return (1-100, default 20)."),
	offset: z.number().int().min(0).optional().describe("Offset for pagination."),
	sort: z
		.string()
		.optional()
		.describe(
			"Sort field. One of: issueType, category, version, milestone, summary, status, priority, " +
				"attachment, sharedFile, created, createdUser, updated, updatedUser, assignee, startDate, " +
				"dueDate, estimatedHours, actualHours, childIssue, or customField_${id} for a custom field ID.",
		),
	order: z.enum(["asc", "desc"]).optional().describe("Sort order. Defaults to desc."),
};

export function registerIssueTools(server: McpServer, config: BacklogSpacesConfig) {
	server.tool(
		"get_issue",
		"Returns information about a specific issue. " +
			"`expand` is not listed on the Get Issue doc page (only on Get Issue List); kept for compatibility.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			issueIdOrKey: z.string().describe("Issue ID or issue key (e.g., PROJECT-1)."),
			expand: issueExpandParam,
		},
		async ({ space: spaceName, issueIdOrKey, expand }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApi(spaceConfig, {
				path: `/issues/${issueIdOrKey}`,
				query: { expand },
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"get_issues",
		"Returns list of issues matching the given criteria. " +
			"Use parentChild to filter by hierarchy level (e.g., 5 for grandchild issues only, 7 for top level only) " +
			"and parentIssueId to list the direct children of a parent issue.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			...issueFilterParams,
			...issueListParams,
			expand: issueExpandParam,
		},
		async ({ space: spaceName, ...params }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApi(spaceConfig, {
				path: "/issues",
				query: issueFilterQuery(params),
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"count_issues",
		"Returns count of issues matching the given criteria. Accepts the same filters as get_issues.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			...issueFilterParams,
			...issueListParams,
		},
		async ({ space: spaceName, ...params }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApi(spaceConfig, {
				path: "/issues/count",
				query: issueFilterQuery(params),
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"add_issue",
		"Creates a new issue in the specified project. Available to users restricted to 'add issue only' as well.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectId: z.number().describe("Project ID."),
			summary: z.string().describe("Issue summary/title."),
			issueTypeId: z.number().describe("Issue type ID."),
			priorityId: z.number().describe("Priority ID."),
			description: z.string().optional().describe("Issue description. Mention notation is available."),
			startDate: z.string().optional().describe("Start date (YYYY-MM-DD)."),
			dueDate: z.string().optional().describe("Due date (YYYY-MM-DD)."),
			estimatedHours: z.number().optional().describe("Estimated hours."),
			actualHours: z.number().optional().describe("Actual hours."),
			assigneeId: z.number().optional().describe("Assignee user ID."),
			categoryId: z.array(z.number()).optional().describe("Category IDs."),
			versionId: z.array(z.number()).optional().describe("Version IDs."),
			milestoneId: z.array(z.number()).optional().describe("Milestone IDs."),
			parentIssueId: z
				.number()
				.optional()
				.describe(
					"Parent issue ID. Set to a child issue's ID to create a grandchild issue " +
						"(requires grandchildIssueEnabled on the project and space).",
				),
			notifiedUserId: z.array(z.number()).optional().describe("User IDs to notify."),
			attachmentId: z
				.array(z.number())
				.optional()
				.describe("Attachment IDs returned by post_attachment."),
			customFields: customFieldValuesParam,
		},
		async ({ space: spaceName, customFields, ...params }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const body: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(params)) {
				if (v !== undefined) body[k] = v;
			}
			Object.assign(body, customFieldValuesBody(customFields));
			const result = await callBacklogApiForm(spaceConfig, { path: "/issues", body });
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"update_issue",
		"Updates an existing issue. Not available to users restricted to 'add issue only'.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			issueIdOrKey: z.string().describe("Issue ID or issue key."),
			summary: z.string().optional().describe("New summary."),
			parentIssueId: z
				.number()
				.optional()
				.describe(
					"New parent issue ID. Set to a child issue's ID to make this a grandchild issue " +
						"(requires grandchildIssueEnabled on the project and space). Omit to leave unchanged.",
				),
			description: z.string().optional().describe("New description. Mention notation is available."),
			statusId: z.number().optional().describe("New status ID."),
			resolutionId: z.number().optional().describe("New resolution ID. Use get_resolutions to find IDs."),
			priorityId: z.number().optional().describe("New priority ID."),
			assigneeId: z.number().optional().describe("New assignee user ID."),
			issueTypeId: z.number().optional().describe("New issue type ID."),
			categoryId: z.array(z.number()).optional().describe("New category IDs."),
			versionId: z.array(z.number()).optional().describe("New version IDs."),
			milestoneId: z.array(z.number()).optional().describe("New milestone IDs."),
			startDate: z.string().optional().describe("New start date (YYYY-MM-DD)."),
			dueDate: z.string().optional().describe("New due date (YYYY-MM-DD)."),
			estimatedHours: z.number().optional().describe("New estimated hours."),
			actualHours: z.number().optional().describe("New actual hours."),
			notifiedUserId: z.array(z.number()).optional().describe("User IDs to notify."),
			attachmentId: z
				.array(z.number())
				.optional()
				.describe("Attachment IDs returned by post_attachment."),
			comment: z.string().optional().describe("Comment to add with the update. Mention notation is available."),
			customFields: customFieldValuesParam,
		},
		async ({ space: spaceName, issueIdOrKey, customFields, ...params }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const body: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(params)) {
				if (v !== undefined) body[k] = v;
			}
			Object.assign(body, customFieldValuesBody(customFields));
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
		"Deletes an issue. Requires the Administrator role or project administrator rights.",
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
			minId: z.number().optional().describe("Return comments with an ID greater than this."),
			maxId: z.number().optional().describe("Return comments with an ID smaller than this."),
			count: z.number().min(1).max(100).optional().describe("Number of comments to return (1-100, default 20)."),
			order: z.enum(["asc", "desc"]).optional().describe("Sort order. Defaults to desc."),
		},
		async ({ space: spaceName, issueIdOrKey, count, order, minId, maxId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const query: Record<string, string | number | boolean | undefined> = {};
			if (count) query.count = count;
			if (order) query.order = order;
			if (minId !== undefined) query.minId = minId;
			if (maxId !== undefined) query.maxId = maxId;
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
			content: z.string().describe("Comment content. Mention notation is available."),
			notifiedUserId: z.array(z.number()).optional().describe("User IDs to notify."),
			attachmentId: z
				.array(z.number())
				.optional()
				.describe("Attachment IDs returned by post_attachment."),
		},
		async ({ space: spaceName, issueIdOrKey, content, notifiedUserId, attachmentId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const body: Record<string, unknown> = { content };
			if (notifiedUserId) body.notifiedUserId = notifiedUserId;
			if (attachmentId) body.attachmentId = attachmentId;
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
		"Creates a new version milestone for a project. Not available to users restricted to 'add issue only'.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			name: z.string().describe("Version/milestone name."),
			description: z.string().optional().describe("Version/milestone description."),
			startDate: z.string().optional().describe("Start date (yyyy-MM-dd)."),
			releaseDueDate: z.string().optional().describe("Release due (end) date (yyyy-MM-dd)."),
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

	const issuePath = (issueIdOrKey: string) => `/issues/${encodeURIComponent(issueIdOrKey)}`;

	server.tool(
		"count_issue_comments",
		"Returns the number of comments on an issue.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			issueIdOrKey: z.string().describe("Issue ID or issue key."),
		},
		async ({ space: spaceName, issueIdOrKey }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, { path: `${issuePath(issueIdOrKey)}/comments/count` }),
			);
		},
	);

	server.tool(
		"get_issue_comment",
		"Returns a specific comment on an issue.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			issueIdOrKey: z.string().describe("Issue ID or issue key."),
			commentId: z.number().describe("Comment ID."),
		},
		async ({ space: spaceName, issueIdOrKey, commentId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					path: `${issuePath(issueIdOrKey)}/comments/${commentId}`,
				}),
			);
		},
	);

	server.tool(
		"update_issue_comment",
		"Updates the content of a comment on an issue. Only the comment's author can update it.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			issueIdOrKey: z.string().describe("Issue ID or issue key."),
			commentId: z.number().describe("Comment ID."),
			content: z.string().describe("New comment content. Mention notation is available."),
		},
		async ({ space: spaceName, issueIdOrKey, commentId, content }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApiForm(spaceConfig, {
					method: "PATCH",
					path: `${issuePath(issueIdOrKey)}/comments/${commentId}`,
					body: { content },
				}),
			);
		},
	);

	server.tool(
		"delete_issue_comment",
		"Deletes a comment on an issue. Only the comment's author can delete it.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			issueIdOrKey: z.string().describe("Issue ID or issue key."),
			commentId: z.number().describe("Comment ID."),
		},
		async ({ space: spaceName, issueIdOrKey, commentId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					method: "DELETE",
					path: `${issuePath(issueIdOrKey)}/comments/${commentId}`,
				}),
			);
		},
	);

	server.tool(
		"get_issue_comment_notifications",
		"Returns the notification list of a comment.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			issueIdOrKey: z.string().describe("Issue ID or issue key."),
			commentId: z.number().describe("Comment ID."),
		},
		async ({ space: spaceName, issueIdOrKey, commentId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					path: `${issuePath(issueIdOrKey)}/comments/${commentId}/notifications`,
				}),
			);
		},
	);

	server.tool(
		"add_issue_comment_notification",
		"Notifies users about an existing comment. Only the user who added the comment can add notifications.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			issueIdOrKey: z.string().describe("Issue ID or issue key."),
			commentId: z.number().describe("Comment ID."),
			notifiedUserId: z.array(z.number()).describe("User IDs to notify."),
		},
		async ({ space: spaceName, issueIdOrKey, commentId, notifiedUserId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApiForm(spaceConfig, {
					path: `${issuePath(issueIdOrKey)}/comments/${commentId}/notifications`,
					body: { notifiedUserId },
				}),
			);
		},
	);

	server.tool(
		"get_issue_participants",
		"Returns the list of participants of an issue.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			issueIdOrKey: z.string().describe("Issue ID or issue key."),
		},
		async ({ space: spaceName, issueIdOrKey }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, { path: `${issuePath(issueIdOrKey)}/participants` }),
			);
		},
	);

	server.tool(
		"get_issue_shared_files",
		"Returns the shared files linked to an issue.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			issueIdOrKey: z.string().describe("Issue ID or issue key."),
		},
		async ({ space: spaceName, issueIdOrKey }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, { path: `${issuePath(issueIdOrKey)}/sharedFiles` }),
			);
		},
	);

	server.tool(
		"link_issue_shared_files",
		"Links shared files to an issue. Not available to users restricted to 'add issue only'.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			issueIdOrKey: z.string().describe("Issue ID or issue key."),
			fileId: z.array(z.number()).describe("Shared file IDs, from get_shared_files."),
		},
		async ({ space: spaceName, issueIdOrKey, fileId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApiForm(spaceConfig, {
					path: `${issuePath(issueIdOrKey)}/sharedFiles`,
					body: { fileId },
				}),
			);
		},
	);

	server.tool(
		"unlink_issue_shared_file",
		"Removes the link between a shared file and an issue. The file itself is not deleted.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			issueIdOrKey: z.string().describe("Issue ID or issue key."),
			fileId: z.number().describe("Shared file ID."),
		},
		async ({ space: spaceName, issueIdOrKey, fileId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					method: "DELETE",
					path: `${issuePath(issueIdOrKey)}/sharedFiles/${fileId}`,
				}),
			);
		},
	);

	server.tool(
		"get_related_issues",
		"Returns the issues related to an issue. Each item has a type field for the relation type (currently always RELATES).",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			issueIdOrKey: z.string().describe("Issue ID or issue key."),
		},
		async ({ space: spaceName, issueIdOrKey }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, { path: `${issuePath(issueIdOrKey)}/relatedIssues` }),
			);
		},
	);

	server.tool(
		"add_related_issue",
		"Relates another issue to this issue. Up to 50 related issues per issue. " +
			"Relating an already related issue, or the issue itself, is not an error and returns the issue unchanged.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			issueIdOrKey: z.string().describe("Issue ID or issue key."),
			targetIssueId: z.number().describe("Numeric ID of the issue to relate. Must be an issue you can view."),
		},
		async ({ space: spaceName, issueIdOrKey, targetIssueId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApiForm(spaceConfig, {
					path: `${issuePath(issueIdOrKey)}/relatedIssues`,
					body: { targetIssueId },
				}),
			);
		},
	);

	server.tool(
		"remove_related_issue",
		"Removes a relation between two issues. Returns an error if no such relation exists.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			issueIdOrKey: z.string().describe("Issue ID or issue key."),
			relatedIssueId: z.number().describe("Numeric ID of the related issue."),
		},
		async ({ space: spaceName, issueIdOrKey, relatedIssueId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					method: "DELETE",
					path: `${issuePath(issueIdOrKey)}/relatedIssues/${relatedIssueId}`,
				}),
			);
		},
	);
}
