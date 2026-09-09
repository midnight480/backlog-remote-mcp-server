// credentials.ts
// 「利用者本人の Backlog API キー」をリクエストごとに受け取るための層。
//
// 設計方針:
//   このサーバは利用者の Backlog 資格情報を一切永続化しない。キーはリクエスト
//   単位で運ばれてきて、そのリクエストの間だけ BacklogSpacesConfig に重ねられ、
//   応答と共に捨てられる。保管場所はクライアント側 (JSON 設定やトークン) にある。
//
// 運搬経路は2つあり、どちらもここで同じ UserApiKeys に正規化する:
//   1. HTTP ヘッダ   — JSON でサーバを設定できるクライアント (Claude Code / Codex / Kiro CLI)
//   2. トークン封筒  — ヘッダを指定できない GUI クライアント (Claude Desktop / claude.ai)
//
// この層が扱うのは「入力の解析と検証」だけで、HTTP そのものには触れない。
// 実行環境ごとの配線 (Express の req からヘッダを読む等) は呼び出し側の責務。

import type { BacklogSpace, BacklogSpacesConfig } from "./backlog-client";

/** スペース名 (小文字) → その利用者自身の API キー */
export type UserApiKeys = Record<string, string>;

/** 単一キー指定用のヘッダ。デフォルトスペースに適用される */
export const API_KEY_HEADER = "x-backlog-api-key";
/** 複数スペース指定用のヘッダ。`WORK=xxx,SHARED=yyy` 形式 */
export const API_KEYS_HEADER = "x-backlog-api-keys";

/**
 * 単一キーヘッダの置き場所を表す予約名。
 * 解析時点ではデフォルトスペース名が分からないため、
 * applyUserKeys で実際のスペース名へ解決する。
 */
export const DEFAULT_SPACE_SENTINEL = "*";

/** キーの最大長。Backlog の API キーは 64 文字程度だが余裕を持たせる */
const MAX_KEY_LENGTH = 512;
/** スペース名の最大長 */
const MAX_SPACE_NAME_LENGTH = 128;

/** ヘッダやトークン封筒の中身が不正だったときに投げるエラー (利用者の設定ミス) */
export class InvalidCredentialError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidCredentialError";
	}
}

/**
 * API キーとして受け付ける文字。
 * 空白と制御文字とカンマ (区切り文字) を除く印字可能 ASCII に限る。
 * ログや URL に紛れ込んだときの事故を減らし、区切り解析を曖昧にしないため。
 */
function assertValidKey(key: string, where: string): void {
	if (key.length === 0) {
		throw new InvalidCredentialError(`${where}: API key is empty.`);
	}
	if (key.length > MAX_KEY_LENGTH) {
		throw new InvalidCredentialError(
			`${where}: API key is too long (${key.length} > ${MAX_KEY_LENGTH}).`,
		);
	}
	for (let i = 0; i < key.length; i++) {
		const code = key.charCodeAt(i);
		if (code <= 0x20 || code >= 0x7f || key[i] === ",") {
			throw new InvalidCredentialError(
				`${where}: API key contains an unsupported character at position ${i}. ` +
					`Expected printable ASCII without spaces or commas.`,
			);
		}
	}
}

function assertValidSpaceName(name: string, where: string): void {
	if (name.length === 0) {
		throw new InvalidCredentialError(`${where}: space name is empty.`);
	}
	if (name.length > MAX_SPACE_NAME_LENGTH) {
		throw new InvalidCredentialError(
			`${where}: space name is too long (${name.length} > ${MAX_SPACE_NAME_LENGTH}).`,
		);
	}
	for (let i = 0; i < name.length; i++) {
		const code = name.charCodeAt(i);
		if (code <= 0x20 || code >= 0x7f) {
			throw new InvalidCredentialError(
				`${where}: space name contains an unsupported character at position ${i}.`,
			);
		}
	}
}

/**
 * `WORK=xxx,SHARED=yyy` を解析する。
 * キー自体に `=` が含まれても壊れないよう、最初の `=` だけで分割する。
 */
export function parseApiKeyList(raw: string): UserApiKeys {
	const keys: UserApiKeys = {};
	for (const entry of raw.split(",")) {
		const trimmed = entry.trim();
		if (trimmed.length === 0) continue;
		const eq = trimmed.indexOf("=");
		if (eq === -1) {
			throw new InvalidCredentialError(
				`${API_KEYS_HEADER}: expected "space=key" entries separated by commas.`,
			);
		}
		const name = trimmed.slice(0, eq).trim();
		const key = trimmed.slice(eq + 1).trim();
		assertValidSpaceName(name, API_KEYS_HEADER);
		assertValidKey(key, API_KEYS_HEADER);
		const normalized = name.toLowerCase();
		if (normalized in keys) {
			throw new InvalidCredentialError(
				`${API_KEYS_HEADER}: space "${name}" is listed more than once.`,
			);
		}
		keys[normalized] = key;
	}
	return keys;
}

/**
 * 2つのヘッダ値を UserApiKeys に正規化する。
 * 両方指定されている場合は併用でき、単一キーヘッダはデフォルトスペースに割り当てる。
 */
export function parseApiKeyHeaders(single?: string, list?: string): UserApiKeys {
	const keys: UserApiKeys = list ? parseApiKeyList(list) : {};
	if (single !== undefined) {
		const key = single.trim();
		assertValidKey(key, API_KEY_HEADER);
		keys[DEFAULT_SPACE_SENTINEL] = key;
	}
	return keys;
}

/**
 * 設定済みスペースに利用者本人のキーを重ねた、新しい設定を返す。
 *
 * 元の config は書き換えない。リクエストごとに使い捨てる設定を作ることで、
 * ある利用者のキーが別のリクエストへ漏れないようにする。
 */
export function applyUserKeys(
	config: BacklogSpacesConfig,
	userKeys: UserApiKeys,
): BacklogSpacesConfig {
	const byName = new Map(config.spaces.map((s) => [s.name.toLowerCase(), s]));

	// 予約名をデフォルトスペースへ解決する
	const resolved: UserApiKeys = {};
	for (const [name, key] of Object.entries(userKeys)) {
		const target = name === DEFAULT_SPACE_SENTINEL ? config.defaultSpace.toLowerCase() : name;
		if (!byName.has(target)) {
			const available = config.spaces.map((s) => s.name).join(", ");
			// 綴り間違いを黙って共有キーへフォールバックさせない。
			// 本人のキーのつもりで別人の権限で書き込む事故を防ぐ。
			throw new InvalidCredentialError(
				`No Backlog space named "${name === DEFAULT_SPACE_SENTINEL ? config.defaultSpace : name}" is configured. ` +
					`Available spaces: ${available}`,
			);
		}
		// 両ヘッダが同じスペースを指した場合に、どちらが勝つかを暗黙に決めない。
		// 利用者が意図を確認できるよう明示的に失敗させる。
		if (target in resolved) {
			throw new InvalidCredentialError(
				`Two different API keys were supplied for space "${config.spaces.find((s) => s.name.toLowerCase() === target)?.name ?? target}" ` +
					`(${API_KEY_HEADER} applies to the default space). Send only one.`,
			);
		}
		resolved[target] = key;
	}

	const spaces: BacklogSpace[] = config.spaces.map((space) => {
		const userKey = resolved[space.name.toLowerCase()];
		if (userKey) {
			return { ...space, apiKey: userKey, keySource: "user" as const };
		}
		return { ...space, keySource: space.apiKey ? ("server" as const) : undefined };
	});

	return { spaces, defaultSpace: config.defaultSpace };
}
