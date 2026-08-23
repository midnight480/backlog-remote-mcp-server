// custom-field-tools.ts
// Tools for Backlog custom fields (カスタム属性)

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type BacklogSpacesConfig, callBacklogApi, callBacklogApiForm, resolveSpace } from "../backlog-client";

const asText = (result: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
});

/** カスタム属性の型 ID。Backlog が定めている固定値。 */
const TYPE_ID_HINT =
	"Custom field type: 1=text, 2=sentence (multi-line text), 3=number, 4=date, " +
	"5=single list, 6=multiple list, 7=checkbox, 8=radio.";

export function registerCustomFieldTools(server: McpServer, config: BacklogSpacesConfig) {
	const projectPath = (projectIdOrKey: string) =>
		`/projects/${encodeURIComponent(projectIdOrKey)}/customFields`;

	server.tool(
		"get_custom_fields",
		"Returns the list of custom fields in a project.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
		},
		async ({ space: spaceName, projectIdOrKey }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(await callBacklogApi(spaceConfig, { path: projectPath(projectIdOrKey) }));
		},
	);

	server.tool(
		"add_custom_field",
		"Creates a custom field in a project.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			typeId: z.number().min(1).max(8).describe(TYPE_ID_HINT),
			name: z.string().describe("Custom field name."),
			applicableIssueTypes: z
				.array(z.number())
				.optional()
				.describe("Issue type IDs this field applies to. Omit to apply to all."),
			description: z.string().optional().describe("Field description."),
			required: z.boolean().optional().describe("Whether the field is required."),
			min: z.number().optional().describe("Minimum value. For number (3) and date (4) types."),
			max: z.number().optional().describe("Maximum value. For number (3) and date (4) types."),
			initialValue: z.number().optional().describe("Initial value. For the number (3) type."),
			unit: z.string().optional().describe("Unit label. For the number (3) type."),
			items: z
				.array(z.string())
				.optional()
				.describe("List items. Required for list types (5, 6, 7, 8)."),
			allowAddItem: z
				.boolean()
				.optional()
				.describe("Allow users to add list items. For list types."),
			allowInput: z.boolean().optional().describe("Allow free input. For list types."),
		},
		async ({ space: spaceName, projectIdOrKey, ...rest }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const body: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(rest)) {
				if (v !== undefined) body[k] = v;
			}
			return asText(
				await callBacklogApiForm(spaceConfig, { path: projectPath(projectIdOrKey), body }),
			);
		},
	);

	server.tool(
		"update_custom_field",
		"Updates a custom field. Only the fields you pass are changed.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			customFieldId: z.number().describe("Custom field ID."),
			name: z.string().optional().describe("Custom field name."),
			applicableIssueTypes: z.array(z.number()).optional().describe("Issue type IDs."),
			description: z.string().optional().describe("Field description."),
			required: z.boolean().optional().describe("Whether the field is required."),
			min: z.number().optional().describe("Minimum value."),
			max: z.number().optional().describe("Maximum value."),
			initialValue: z.number().optional().describe("Initial value."),
			unit: z.string().optional().describe("Unit label."),
			items: z.array(z.string()).optional().describe("List items."),
			allowAddItem: z.boolean().optional().describe("Allow users to add list items."),
			allowInput: z.boolean().optional().describe("Allow free input."),
		},
		async ({ space: spaceName, projectIdOrKey, customFieldId, ...rest }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			const body: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(rest)) {
				if (v !== undefined) body[k] = v;
			}
			return asText(
				await callBacklogApiForm(spaceConfig, {
					method: "PATCH",
					path: `${projectPath(projectIdOrKey)}/${customFieldId}`,
					body,
				}),
			);
		},
	);

	server.tool(
		"delete_custom_field",
		"Deletes a custom field.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			customFieldId: z.number().describe("Custom field ID."),
		},
		async ({ space: spaceName, projectIdOrKey, customFieldId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					method: "DELETE",
					path: `${projectPath(projectIdOrKey)}/${customFieldId}`,
				}),
			);
		},
	);

	server.tool(
		"add_custom_field_item",
		"Adds a list item to a list-type custom field.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			customFieldId: z.number().describe("Custom field ID."),
			name: z.string().describe("Item name."),
		},
		async ({ space: spaceName, projectIdOrKey, customFieldId, name }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApiForm(spaceConfig, {
					path: `${projectPath(projectIdOrKey)}/${customFieldId}/items`,
					body: { name },
				}),
			);
		},
	);

	server.tool(
		"update_custom_field_item",
		"Renames a list item of a list-type custom field.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			customFieldId: z.number().describe("Custom field ID."),
			itemId: z.number().describe("List item ID."),
			name: z.string().describe("New item name."),
		},
		async ({ space: spaceName, projectIdOrKey, customFieldId, itemId, name }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApiForm(spaceConfig, {
					method: "PATCH",
					path: `${projectPath(projectIdOrKey)}/${customFieldId}/items/${itemId}`,
					body: { name },
				}),
			);
		},
	);

	server.tool(
		"delete_custom_field_item",
		"Deletes a list item from a list-type custom field.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			customFieldId: z.number().describe("Custom field ID."),
			itemId: z.number().describe("List item ID."),
		},
		async ({ space: spaceName, projectIdOrKey, customFieldId, itemId }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApi(spaceConfig, {
					method: "DELETE",
					path: `${projectPath(projectIdOrKey)}/${customFieldId}/items/${itemId}`,
				}),
			);
		},
	);
}
