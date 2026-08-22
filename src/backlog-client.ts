// backlog-client.ts
// Backlog API client with multi-space routing

export interface BacklogSpace {
	name: string;
	domain: string;
	apiKey: string;
}

export interface BacklogSpacesConfig {
	spaces: BacklogSpace[];
	defaultSpace: string;
}

export function parseSpacesConfig(configJson: string): BacklogSpacesConfig {
	try {
		const config = JSON.parse(configJson) as BacklogSpacesConfig;
		if (!config.spaces || !Array.isArray(config.spaces) || config.spaces.length === 0) {
			throw new Error("BACKLOG_SPACES_CONFIG must have at least one space");
		}
		if (!config.defaultSpace) {
			config.defaultSpace = config.spaces[0].name;
		}
		// Validate each space
		for (const space of config.spaces) {
			if (!space.name || !space.domain || !space.apiKey) {
				throw new Error(`Space configuration invalid: each space needs name, domain, and apiKey`);
			}
		}
		return config;
	} catch (e) {
		if (e instanceof SyntaxError) {
			throw new Error("BACKLOG_SPACES_CONFIG is not valid JSON");
		}
		throw e;
	}
}

export function resolveSpace(config: BacklogSpacesConfig, spaceName?: string): BacklogSpace {
	const targetName = spaceName || config.defaultSpace;
	const space = config.spaces.find(
		(s) => s.name.toLowerCase() === targetName.toLowerCase(),
	);
	if (!space) {
		const available = config.spaces.map((s) => s.name).join(", ");
		throw new Error(
			`Space "${targetName}" not found. Available spaces: ${available}`,
		);
	}
	return space;
}

export interface BacklogApiOptions {
	method?: string;
	path: string;
	query?: Record<string, string | number | boolean | undefined>;
	body?: Record<string, unknown>;
}

export async function callBacklogApi(
	space: BacklogSpace,
	options: BacklogApiOptions,
): Promise<any> {
	const { method = "GET", path, query, body } = options;
	const baseUrl = `https://${space.domain}/api/v2`;

	const url = new URL(`${baseUrl}${path}`);
	url.searchParams.set("apiKey", space.apiKey);

	if (query) {
		for (const [key, value] of Object.entries(query)) {
			if (value !== undefined && value !== null) {
				url.searchParams.set(key, String(value));
			}
		}
	}

	const fetchOptions: RequestInit = {
		method,
		headers: {
			"Content-Type": "application/json",
		},
	};

	if (body && method !== "GET") {
		fetchOptions.body = JSON.stringify(body);
	}

	const response = await fetch(url.toString(), fetchOptions);

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`Backlog API error (${response.status}): ${errorText}`,
		);
	}

	// Some endpoints return 204 No Content
	if (response.status === 204) {
		return null;
	}

	return response.json();
}

/**
 * Call Backlog API with form-urlencoded body (needed for some POST/PATCH endpoints)
 */
export async function callBacklogApiForm(
	space: BacklogSpace,
	options: BacklogApiOptions,
): Promise<any> {
	const { method = "POST", path, body } = options;
	const baseUrl = `https://${space.domain}/api/v2`;

	const url = new URL(`${baseUrl}${path}`);
	url.searchParams.set("apiKey", space.apiKey);

	const formBody = new URLSearchParams();
	if (body) {
		for (const [key, value] of Object.entries(body)) {
			if (value !== undefined && value !== null) {
				if (Array.isArray(value)) {
					for (const item of value) {
						formBody.append(`${key}[]`, String(item));
					}
				} else {
					formBody.set(key, String(value));
				}
			}
		}
	}

	const response = await fetch(url.toString(), {
		method,
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: formBody.toString(),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Backlog API error (${response.status}): ${errorText}`);
	}

	if (response.status === 204) {
		return null;
	}

	return response.json();
}
