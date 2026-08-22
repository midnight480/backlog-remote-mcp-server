// notification-tools.ts
// Tools for managing Backlog notifications

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	type BacklogSpacesConfig,
	callBacklogApi,
	resolveSpace,
} from "../backlog-client";

export function registerNotificationTools(server: McpServer, config: BacklogSpacesConfig) {
	server.tool(
		"get_notifications",
		"Returns list of notifications.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			count: z.number().optional().describe("Number of notifications to return (max 100)."),
			order: z.enum(["asc", "desc"]).optional().describe("Sort order."),
			minId: z.number().optional().describe("Minimum notification ID."),
			maxId: z.number().optional().describe("Maximum notification ID."),
		},
		async ({ space: spaceName, count, order, minId, maxId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const query: Record<string, string | number | boolean | undefined> = {};
			if (count) query.count = count;
			if (order) query.order = order;
			if (minId) query.minId = minId;
			if (maxId) query.maxId = maxId;
			const result = await callBacklogApi(spaceConfig, {
				path: "/notifications",
				query,
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"get_notifications_count",
		"Returns count of unread notifications.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			alreadyRead: z.boolean().optional().describe("Include already read notifications."),
		},
		async ({ space: spaceName, alreadyRead }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const query: Record<string, string | number | boolean | undefined> = {};
			if (alreadyRead !== undefined) query.alreadyRead = alreadyRead;
			const result = await callBacklogApi(spaceConfig, {
				path: "/notifications/count",
				query,
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"reset_unread_notification_count",
		"Resets unread notification count.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
		},
		async ({ space: spaceName }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApi(spaceConfig, {
				method: "POST",
				path: "/notifications/markAsRead",
			});
			return { content: [{ type: "text", text: JSON.stringify(result ?? "Notifications reset", null, 2) }] };
		},
	);

	server.tool(
		"mark_notification_as_read",
		"Marks a notification as read.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			id: z.number().describe("Notification ID."),
		},
		async ({ space: spaceName, id }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const result = await callBacklogApi(spaceConfig, {
				method: "POST",
				path: `/notifications/${id}/markAsRead`,
			});
			return { content: [{ type: "text", text: JSON.stringify(result ?? "Marked as read", null, 2) }] };
		},
	);
}
