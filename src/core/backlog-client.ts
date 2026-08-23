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

/**
 * クエリ値。配列を渡すと `key[]=v1&key[]=v2` 形式で展開する。
 * Backlog の一部エンドポイント (例: GET /documents の projectId[]) が
 * 繰り返しパラメータを要求するため。
 */
export type BacklogQueryValue = string | number | boolean | Array<string | number> | undefined;

export interface BacklogApiOptions {
	method?: string;
	path: string;
	query?: Record<string, BacklogQueryValue>;
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
			if (value === undefined || value === null) continue;
			if (Array.isArray(value)) {
				for (const item of value) {
					url.searchParams.append(`${key}[]`, String(item));
				}
			} else {
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

/** バイナリ応答の上限。Lambda / API Gateway の応答サイズ制限に収まるよう保守的に設定する。 */
export const MAX_BINARY_BYTES = 4 * 1024 * 1024;

export interface BacklogBinary {
	/** base64 エンコードした本体 */
	base64: string;
	mimeType: string;
	/** 元のバイト数 (base64 化前) */
	size: number;
	filename?: string;
}

/** Uint8Array を base64 に変換する。Workers / Lambda 双方で動くよう btoa を使い、
 *  引数展開でスタックを溢れさせないためチャンク処理する。 */
function toBase64(bytes: Uint8Array): string {
	const CHUNK = 0x8000;
	let binary = "";
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return btoa(binary);
}

/** Content-Disposition からファイル名を取り出す。RFC 5987 の filename* を優先する。 */
function parseFilename(header: string | null): string | undefined {
	if (!header) return undefined;
	const star = header.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
	if (star) {
		try {
			return decodeURIComponent(star[1].replace(/^"|"$/g, ""));
		} catch {
			// フォールバックして plain filename を見る
		}
	}
	const plain = header.match(/filename="?([^";]+)"?/i);
	return plain ? plain[1] : undefined;
}

/**
 * バイナリを返すエンドポイント (アイコン、共有ファイル、添付ダウンロード) 用。
 * MAX_BINARY_BYTES を超えるものはエラーにする。
 */
export async function callBacklogApiBinary(
	space: BacklogSpace,
	options: BacklogApiOptions,
): Promise<BacklogBinary> {
	const { method = "GET", path, query } = options;
	assertWritable(space, method, path);

	const url = new URL(`https://${space.domain}/api/v2${path}`);
	url.searchParams.set("apiKey", space.apiKey);
	if (query) {
		for (const [key, value] of Object.entries(query)) {
			if (value === undefined || value === null) continue;
			if (Array.isArray(value)) {
				for (const item of value) url.searchParams.append(`${key}[]`, String(item));
			} else {
				url.searchParams.set(key, String(value));
			}
		}
	}

	const response = await fetch(url.toString(), { method });
	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Backlog API error (${response.status}): ${errorText}`);
	}

	const buffer = await response.arrayBuffer();
	if (buffer.byteLength > MAX_BINARY_BYTES) {
		throw new Error(
			`File is ${buffer.byteLength} bytes, which exceeds the ${MAX_BINARY_BYTES} byte limit ` +
				`for inline responses. Download it directly from Backlog instead.`,
		);
	}

	return {
		base64: toBase64(new Uint8Array(buffer)),
		mimeType: response.headers.get("content-type") || "application/octet-stream",
		size: buffer.byteLength,
		filename: parseFilename(response.headers.get("content-disposition")),
	};
}

/**
 * multipart/form-data でファイルを送る (POST /space/attachment, Wiki 添付)。
 * MCP クライアントからはテキストしか渡せないため、本体は base64 で受け取る。
 */
export async function callBacklogApiUpload(
	space: BacklogSpace,
	options: {
		path: string;
		filename: string;
		contentBase64: string;
		contentType?: string;
		/** フォームのフィールド名。既定は Backlog が期待する "file" */
		fieldName?: string;
	},
): Promise<any> {
	const { path, filename, contentBase64, contentType, fieldName = "file" } = options;
	assertWritable(space, "POST", path);

	let bytes: Uint8Array;
	try {
		const binary = atob(contentBase64);
		bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	} catch {
		throw new Error("contentBase64 is not valid base64.");
	}
	if (bytes.length > MAX_BINARY_BYTES) {
		throw new Error(
			`File is ${bytes.length} bytes, which exceeds the ${MAX_BINARY_BYTES} byte upload limit.`,
		);
	}

	const url = new URL(`https://${space.domain}/api/v2${path}`);
	url.searchParams.set("apiKey", space.apiKey);

	const form = new FormData();
	form.append(
		fieldName,
		new Blob([bytes.buffer as ArrayBuffer], { type: contentType || "application/octet-stream" }),
		filename,
	);

	// Content-Type は FormData から自動で boundary 付きで設定させる
	const response = await fetch(url.toString(), { method: "POST", body: form });
	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Backlog API error (${response.status}): ${errorText}`);
	}
	if (response.status === 204) return null;
	return response.json();
}
