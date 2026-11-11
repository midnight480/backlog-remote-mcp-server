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

/** add / update で共通の基本項目 */
const commonParams = {
	applicableIssueTypes: z
		.array(z.number())
		.optional()
		.describe("Issue type IDs this field is enabled for (sent as applicableIssueTypes[]). Empty/omitted = all issue types."),
	description: z.string().optional().describe("Field description."),
	required: z.boolean().optional().describe("True to make the custom field required."),
};

/**
 * 型ごとの追加パラメータ。min / max は数値型 (3) では数値、日付型 (4) では yyyy-MM-dd 文字列と
 * 同じ名前で型が変わるため、両方を受け付ける。
 */
const typeSpecificParams = {
	min: z
		.union([z.number(), z.string()])
		.optional()
		.describe("Minimum value. Number type (3): a number. Date type (4): a date string yyyy-MM-dd."),
	max: z
		.union([z.number(), z.string()])
		.optional()
		.describe("Maximum value. Number type (3): a number. Date type (4): a date string yyyy-MM-dd."),
	initialValue: z.number().optional().describe("Initial value. Number type (3) only."),
	unit: z.string().optional().describe("Unit label. Number type (3) only."),
	initialValueType: z
		.number()
		.int()
		.min(1)
		.max(3)
		.optional()
		.describe("Date type (4) only. Initial value: 1=today, 2=today + initialShift days, 3=the date given in initialDate."),
	initialDate: z
		.string()
		.optional()
		.describe("Date type (4) only. Initial date, yyyy-MM-dd (used with initialValueType=3)."),
	initialShift: z
		.number()
		.int()
		.optional()
		.describe("Date type (4) only. Number of days added to today (used with initialValueType=2)."),
	items: z
		.array(z.string())
		.optional()
		.describe("List types (5, 6, 7, 8) only. List item names (sent as items[])."),
	allowInput: z
		.boolean()
		.optional()
		.describe("List types (5, 6, 7, 8) only. True to allow the \"Other\" free-input form."),
	allowAddItem: z
		.boolean()
		.optional()
		.describe("List types (5, 6, 7, 8) only. True to allow users to add list items while adding or editing issues."),
};

const toBody = (rest: Record<string, unknown>) => {
	const body: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(rest)) {
		if (v !== undefined) body[k] = v;
	}
	return body;
};

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
		"Creates a custom field in a project. Pass only the type-specific parameters that match typeId " +
			"(number: min/max/initialValue/unit; date: min/max/initialValueType/initialDate/initialShift; " +
			"list types: items/allowInput/allowAddItem). " +
			"Requires the Administrator or Project Administrator role.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			typeId: z.number().int().min(1).max(8).describe(TYPE_ID_HINT),
			name: z.string().describe("Custom field name."),
			...commonParams,
			...typeSpecificParams,
		},
		async ({ space: spaceName, projectIdOrKey, ...rest }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApiForm(spaceConfig, { path: projectPath(projectIdOrKey), body: toBody(rest) }),
			);
		},
	);

	server.tool(
		"update_custom_field",
		"Updates a custom field. Only the fields you pass are changed. The type cannot be changed; " +
			"pass only the type-specific parameters that match the field's type. " +
			"Requires the Administrator or Project Administrator role.",
		{
			space: z.string().optional().describe("Space name. Uses default if omitted."),
			projectIdOrKey: z.string().describe("Project ID or project key."),
			customFieldId: z.number().describe("Custom field ID."),
			name: z.string().optional().describe("Custom field name."),
			...commonParams,
			...typeSpecificParams,
		},
		async ({ space: spaceName, projectIdOrKey, customFieldId, ...rest }) => {
			const spaceConfig = resolveSpace(config, spaceName);
			return asText(
				await callBacklogApiForm(spaceConfig, {
					method: "PATCH",
					path: `${projectPath(projectIdOrKey)}/${customFieldId}`,
					body: toBody(rest),
				}),
			);
		},
	);

	server.tool(
		"delete_custom_field",
		"Deletes a custom field. Requires the Administrator or Project Administrator role.",
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
		"Adds a list item to a list-type custom field. Fails if the field is not a list type. " +
			"If the field's \"Add items in adding or editing issues\" option (allowAddItem) is disabled, only the space Administrator can call this.",
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
		"Updates (renames) a list item of a list-type custom field. Fails if the field is not a list type. " +
			"Requires the Administrator or Project Administrator role.",
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
		"Deletes a list item from a list-type custom field. Fails if the field is not a list type. " +
			"Requires the Administrator or Project Administrator role.",
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
