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
		"Returns the authenticated user's own notifications.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			count: z.number().min(1).max(100).optional().describe("Number of notifications to return (1-100, default 20)."),
			order: z.enum(["asc", "desc"]).optional().describe("Sort order."),
			minId: z.number().optional().describe("Minimum notification ID."),
			maxId: z.number().optional().describe("Maximum notification ID."),
			senderId: z.number().optional().describe("Filter by sender user ID."),
		},
		async ({ space: spaceName, count, order, minId, maxId, senderId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const query: Record<string, string | number | boolean | undefined> = {};
			if (count !== undefined) query.count = count;
			if (order) query.order = order;
			if (minId !== undefined) query.minId = minId;
			if (maxId !== undefined) query.maxId = maxId;
			if (senderId !== undefined) query.senderId = senderId;
			const result = await callBacklogApi(spaceConfig, {
				path: "/notifications",
				query,
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		},
	);

	server.tool(
		"get_notifications_count",
		"Returns the number of notifications.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			alreadyRead: z
				.boolean()
				.optional()
				.describe(
					"false = count notifications unread since the user last checked, true = count already read ones.",
				),
			resourceAlreadyRead: z
				.boolean()
				.optional()
				.describe("false = count unread notifications, true = count already read notifications."),
		},
		async ({ space: spaceName, alreadyRead, resourceAlreadyRead }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const query: Record<string, string | number | boolean | undefined> = {};
			if (alreadyRead !== undefined) query.alreadyRead = alreadyRead;
			if (resourceAlreadyRead !== undefined) query.resourceAlreadyRead = resourceAlreadyRead;
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
