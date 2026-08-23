// webhook-tools.ts
// Tools for Backlog webhooks

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type BacklogSpacesConfig, callBacklogApi, callBacklogApiForm, resolveSpace } from "../backlog-client";

const asText = (result: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
});

/** Backlog の Webhook 通知イベント種別。activityTypeIds に渡す番号の意味。 */
const ACTIVITY_TYPE_HINT =
	"Activity type IDs to notify on. 1=issue created, 2=issue updated, 3=issue commented, " +
	"4=issue deleted, 5=wiki created, 6=wiki updated, 7=wiki deleted, 8=file added, " +
	"9=file updated, 10=file deleted, 11=svn committed, 12=git pushed, 13=git repository created, " +
	"14=issue multi-updated, 15=project user added, 16=project user removed, 17=comment notification, " +
	"18=pull request added, 19=pull request updated, 20=pull request commented, 21=pull request merged. " +
	"Omit to keep the current setting.";

export function registerWebhookTools(server: McpServer, config: BacklogSpacesConfig) {
	server.tool(
		"get_webhooks",
		"Returns the list of webhooks in a project.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
		},
		async ({ space: spaceName, projectIdOrKey }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					path: `/projects/${encodeURIComponent(projectIdOrKey)}/webhooks`,
				}),
			);
		},
	);

	server.tool(
		"get_webhook",
		"Returns information about a specific webhook.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			webhookId: z.number().describe("Webhook ID."),
		},
		async ({ space: spaceName, projectIdOrKey, webhookId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					path: `/projects/${encodeURIComponent(projectIdOrKey)}/webhooks/${webhookId}`,
				}),
			);
		},
	);

	server.tool(
		"add_webhook",
		"Creates a webhook in a project.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			name: z.string().describe("Webhook name."),
			hookUrl: z.string().describe("URL the webhook posts to."),
			description: z.string().optional().describe("Webhook description."),
			allEvent: z
				.boolean()
				.optional()
				.describe("Notify on every event. When true, activityTypeIds is ignored."),
			activityTypeIds: z.array(z.number()).optional().describe(ACTIVITY_TYPE_HINT),
		},
		async ({ space: spaceName, projectIdOrKey, ...rest }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const body: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(rest)) {
				if (v !== undefined) body[k] = v;
			}
			return asText(
				await callBacklogApiForm(spaceConfig, {
					path: `/projects/${encodeURIComponent(projectIdOrKey)}/webhooks`,
					body,
				}),
			);
		},
	);

	server.tool(
		"update_webhook",
		"Updates a webhook. Only the fields you pass are changed.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			webhookId: z.number().describe("Webhook ID."),
			name: z.string().optional().describe("Webhook name."),
			hookUrl: z.string().optional().describe("URL the webhook posts to."),
			description: z.string().optional().describe("Webhook description."),
			allEvent: z.boolean().optional().describe("Notify on every event."),
			activityTypeIds: z.array(z.number()).optional().describe(ACTIVITY_TYPE_HINT),
		},
		async ({ space: spaceName, projectIdOrKey, webhookId, ...rest }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const body: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(rest)) {
				if (v !== undefined) body[k] = v;
			}
			return asText(
				await callBacklogApiForm(spaceConfig, {
					method: "PATCH",
					path: `/projects/${encodeURIComponent(projectIdOrKey)}/webhooks/${webhookId}`,
					body,
				}),
			);
		},
	);

	server.tool(
		"delete_webhook",
		"Deletes a webhook.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			webhookId: z.number().describe("Webhook ID."),
		},
		async ({ space: spaceName, projectIdOrKey, webhookId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					method: "DELETE",
					path: `/projects/${encodeURIComponent(projectIdOrKey)}/webhooks/${webhookId}`,
				}),
			);
		},
	);
}
