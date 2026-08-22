// backlog-client.ts
// Backlog API client with multi-space routing

export interface BacklogSpace {
	name: string;
	domain: string;
	apiKey: string;
	/**
	 * true のスペースでは書き込み系 API (GET 以外) を拒否する。
	 * 共用スペースを誤って更新・削除しないためのガード。
	 */
	readOnly?: boolean;
}

/** 読み取り専用スペースへの書き込みを拒否したときに投げるエラー */
export class ReadOnlySpaceError extends Error {
	constructor(space: BacklogSpace, method: string, path: string) {
		super(
			`Space "${space.name}" is configured as read-only. ` +
				`Refusing ${method} ${path}. ` +
				`Use list_spaces to see which spaces allow writes.`,
		);
		this.name = "ReadOnlySpaceError";
	}
}

/** 読み取り専用スペースなら書き込みを拒否する。全ての書き込み経路がここを通る。 */
function assertWritable(space: BacklogSpace, method: string, path: string): void {
	if (space.readOnly && method.toUpperCase() !== "GET") {
		throw new ReadOnlySpaceError(space, method.toUpperCase(), path);
	}
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
			// 明示的に true のときだけ書き込み禁止。未指定・不正値は書き込み可。
			space.readOnly = space.readOnly === true;
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
	assertWritable(space, method, path);
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
	assertWritable(space, method, path);
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
