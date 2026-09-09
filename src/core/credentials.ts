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

import { type BacklogSpace, type BacklogSpacesConfig, parseSpacesConfig } from "./backlog-client";

/** スペース名 (小文字) → その利用者自身の API キー */
export type UserApiKeys = Record<string, string>;

/** 単一キー指定用のヘッダ。デフォルトスペースに適用される */
export const API_KEY_HEADER = "x-backlog-api-key";
/** 複数スペース指定用のヘッダ。`WORK=xxx,SHARED=yyy` 形式 */
export const API_KEYS_HEADER = "x-backlog-api-keys";
/** クライアントが自分のスペースを宣言するヘッダ。`WORK=example.backlog.com` 形式 */
export const CLIENT_SPACES_HEADER = "x-backlog-spaces";

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
/** ドメインの最大長 (RFC 1035 の上限) */
const MAX_DOMAIN_LENGTH = 253;

/**
 * クライアントが宣言できるドメインの既定サフィックス。
 *
 * ここを緩めるとサーバが任意ホストへリクエストを出す踏み台になる (SSRF)。
 * サーバは VPC の内側など、クライアントからは届かない位置にいることがあるため、
 * 「クライアント自身のキーを渡すだけだから無害」とは言えない。
 * 既定は Backlog のドメインだけに限る。
 */
export const DEFAULT_ALLOWED_SPACE_DOMAINS = ["backlog.com", "backlog.jp", "backlogtool.com"];

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
	...sources: UserApiKeys[]
): BacklogSpacesConfig {
	const byName = new Map(config.spaces.map((s) => [s.name.toLowerCase(), s]));
	const displayName = (target: string) =>
		config.spaces.find((s) => s.name.toLowerCase() === target)?.name ?? target;

	// 予約名をデフォルトスペースへ解決する。
	// 経路をまたぐ場合は後の source が勝つ (ヘッダがトークンの封筒を上書きする)。
	const resolved: UserApiKeys = {};
	for (const source of sources) {
		const fromThisSource = new Set<string>();
		for (const [name, key] of Object.entries(source)) {
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
			// 同じ経路の中で同じスペースを二重に指した場合は、どちらが勝つかを
			// 暗黙に決めず明示的に失敗させる。
			if (fromThisSource.has(target)) {
				throw new InvalidCredentialError(
					`Two different API keys were supplied for space "${displayName(target)}" ` +
						`(${API_KEY_HEADER} applies to the default space). Send only one.`,
				);
			}
			fromThisSource.add(target);
			resolved[target] = key;
		}
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

/**
 * サーバ側に共有キーが無く、本人のキーを受け取らないと使えないスペース名。
 *
 * ヘッダを送れない GUI クライアント向けに、同意画面へ入力欄を出す対象を決める。
 * 全スペースが共有キーを持つ構成では空になり、同意画面の見た目は変わらない。
 */
export function spacesNeedingUserKey(spacesConfig: string): string[] {
	return parseSpacesConfig(spacesConfig)
		.spaces.filter((s) => !s.apiKey)
		.map((s) => s.name);
}

/**
 * クライアントが宣言したドメインを検証する。
 *
 * 素のホスト名だけを受け付ける。スキーム・ポート・認証情報・パスを含むものは
 * すべて拒否する。`https://${domain}/api/v2` に素直に埋め込める形しか通さない。
 */
export function assertValidSpaceDomain(domain: string, allowedSuffixes: string[]): void {
	const where = CLIENT_SPACES_HEADER;
	if (domain.length === 0 || domain.length > MAX_DOMAIN_LENGTH) {
		throw new InvalidCredentialError(`${where}: domain is empty or too long.`);
	}
	// 大文字は正規化して比較する。Backlog のホスト名は小文字。
	const host = domain.toLowerCase();
	// 英数字とハイフンとドットのみ。punycode や制御文字、IPv6 の括弧などを弾く。
	if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) {
		throw new InvalidCredentialError(
			`${where}: "${domain}" is not a bare hostname. ` +
				`Give just the host, with no scheme, port, path or credentials.`,
		);
	}
	// 数字だけのラベルで終わるものは IPv4 とみなして拒否する
	if (/^[0-9.]+$/.test(host)) {
		throw new InvalidCredentialError(`${where}: "${domain}" looks like an IP address.`);
	}
	// サフィックスは必ずラベル境界で一致させる。"evilbacklog.com" を
	// "backlog.com" として通さないため、前に必ず "." を要求する。
	const allowed = allowedSuffixes.some((suffix) => host.endsWith(`.${suffix.toLowerCase()}`));
	if (!allowed) {
		throw new InvalidCredentialError(
			`${where}: "${domain}" is not an allowed Backlog domain. ` +
				`This server accepts spaces under: ${allowedSuffixes.join(", ")}`,
		);
	}
}

/** スペース名 → ドメイン */
export type ClientSpaces = Record<string, string>;

/**
 * `WORK=example.backlog.com,PRIVATE=mine.backlog.jp` を解析する。
 * 検証は applyClientSpaces で行う (許可サフィックスが設定側にあるため)。
 */
export function parseClientSpaces(raw: string): ClientSpaces {
	const spaces: ClientSpaces = {};
	for (const entry of raw.split(",")) {
		const trimmed = entry.trim();
		if (trimmed.length === 0) continue;
		const eq = trimmed.indexOf("=");
		if (eq === -1) {
			throw new InvalidCredentialError(
				`${CLIENT_SPACES_HEADER}: expected "space=domain" entries separated by commas.`,
			);
		}
		const name = trimmed.slice(0, eq).trim();
		const domain = trimmed.slice(eq + 1).trim();
		assertValidSpaceName(name, CLIENT_SPACES_HEADER);
		const normalized = name.toLowerCase();
		if (normalized in spaces) {
			throw new InvalidCredentialError(
				`${CLIENT_SPACES_HEADER}: space "${name}" is listed more than once.`,
			);
		}
		spaces[normalized] = domain;
	}
	return spaces;
}

/**
 * クライアントが宣言したスペースを設定に足した、新しい設定を返す。
 *
 * 設定側が allowClientSpaces を有効にしていなければ、宣言は拒否する。
 * 黙って無視すると、利用者は「キーを渡したのに共有キーで動いた」ことに
 * 気付けないため、必ずエラーにする。
 */
export function applyClientSpaces(
	config: BacklogSpacesConfig,
	declared: ClientSpaces,
): BacklogSpacesConfig {
	const names = Object.keys(declared);
	if (names.length === 0) return config;

	if (!config.allowClientSpaces) {
		throw new InvalidCredentialError(
			`${CLIENT_SPACES_HEADER}: this server does not accept client-declared spaces. ` +
				`Ask the administrator to configure the space, or to enable allowClientSpaces.`,
		);
	}

	const allowedSuffixes = config.allowedSpaceDomains?.length
		? config.allowedSpaceDomains
		: DEFAULT_ALLOWED_SPACE_DOMAINS;
	const existing = new Set(config.spaces.map((s) => s.name.toLowerCase()));
	const added: BacklogSpace[] = [];

	for (const [name, domain] of Object.entries(declared)) {
		// 設定済みのスペースを乗っ取れないようにする。名前が同じでも別のホストを
		// 指せてしまうと、いつもの名前で違う場所へ書く事故につながる。
		if (existing.has(name)) {
			throw new InvalidCredentialError(
				`${CLIENT_SPACES_HEADER}: space "${name}" is already configured on this server ` +
					`and cannot be redefined by a client.`,
			);
		}
		assertValidSpaceDomain(domain, allowedSuffixes);
		// クライアントが宣言したスペースには守るべき共用資産が無いため readOnly は付けない。
		// 権限は本人のキーに対する Backlog 側の設定がそのまま効く。
		added.push({ name, domain: domain.toLowerCase(), readOnly: false });
	}

	return {
		...config,
		spaces: [...config.spaces, ...added],
		// 設定側に既定が無ければ、最初に宣言されたスペースを既定にする
		defaultSpace: config.defaultSpace || added[0].name,
	};
}
