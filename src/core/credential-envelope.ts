// oauth/credential-envelope.ts
// ヘッダを送れない GUI クライアント (Claude Desktop / claude.ai) 向けに、
// 利用者本人の Backlog API キーを「サーバに保存せず」運ぶための封筒。
//
// 何を保存し、何を保存しないか:
//   OAuth のトークン (識別子・クライアント・スコープ・メール) はサーバが保存する。
//   保存しないのは Backlog の API キーだけである。サーバが Backlog の資格情報を
//   持たなければ、サーバが侵害されても他人の Backlog 権限は漏れない。
//
// どうやって運ぶか (どの段階でもサーバ側には残さない):
//   1. 同意画面のフォームで本人がキーを入力する
//   2. POST /authorize    ... 封をして Cookie に入れる (ブラウザが持つ)
//   3. 上流 IdP を往復     ... Cookie は自ドメインなので往復後も残っている
//   4. /callback          ... Cookie から取り出し、認可コード文字列に連結する
//   5. POST /token        ... コードから外し、アクセス/リフレッシュトークンに連結する
//   6. 各 MCP リクエスト   ... トークンから外して復号し、その 1 回だけ使う
//
//   保存されるのは常に「識別子部分」だけで、封筒は常にクライアント (ブラウザや
//   MCP クライアント) 側にある。認可サーバの保存先に封筒が入ることは一度もない。
//
// Workers と Node の双方で動かすため WebCrypto だけを使う。Cloudflare 版では
// この封筒を workers-oauth-provider に渡さないことが要点で、渡さない限り
// KV に載るのは OAuth の情報だけになる。

import { InvalidCredentialError, type UserApiKeys } from "./credentials";

/**
 * 識別子と封筒の区切り。base64url の文字集合 (A-Za-z0-9-_) に現れない文字を選ぶ。
 * これにより、封筒の有無にかかわらず識別子部分を一意に切り出せる。
 */
const SEPARATOR = "~";

/** 封筒を預けるブラウザ Cookie。上流 IdP を往復する間だけ存在する */
export const ENVELOPE_COOKIE = "__Host-BACKLOG_CREDENTIALS";
/** 上流 IdP でのログインに要する時間だけ持てばよい */
const ENVELOPE_COOKIE_MAX_AGE_SEC = 60 * 10;

/** 封筒が大きくなりすぎないための上限。ヘッダ長やクライアント側の保存を考慮する */
const MAX_ENVELOPE_BYTES = 4096;

/** 鍵の取り違えを防ぐため、用途を鍵導出に混ぜる */
const HKDF_INFO = "backlog-mcp-credential-envelope-v1";

const utf8 = new TextEncoder();

/**
 * 導出した鍵を使い回す。リクエストごとに HKDF を回す必要はなく、
 * 同じ isolate / プロセスの中では同じ鍵になる。
 */
type DerivedKey = Awaited<ReturnType<typeof crypto.subtle.deriveKey>>;
const keyCache = new Map<string, Promise<DerivedKey>>();

function deriveKey(secret: string): Promise<DerivedKey> {
	const cached = keyCache.get(secret);
	if (cached) return cached;
	const derived = (async () => {
		const material = await crypto.subtle.importKey("raw", utf8.encode(secret), "HKDF", false, [
			"deriveKey",
		]);
		// salt は固定でよい。secret 自体が十分な長さのランダム値である前提で、
		// ここでの目的は「Cookie 署名など他用途の鍵と分離すること」にある。
		return crypto.subtle.deriveKey(
			{ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: utf8.encode(HKDF_INFO) },
			material,
			{ name: "AES-GCM", length: 256 },
			false,
			["encrypt", "decrypt"],
		);
	})();
	keyCache.set(secret, derived);
	return derived;
}

function toBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
	const padded = value.replace(/-/g, "+").replace(/_/g, "/");
	const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/**
 * キー一式を封じる。鍵を持つサーバ以外は中身を読めない。
 * 形式: base64url(iv[12] || ciphertext+authTag)
 */
export async function sealCredentials(keys: UserApiKeys, secret: string): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const body = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: "AES-GCM", iv },
			await deriveKey(secret),
			utf8.encode(JSON.stringify(keys)),
		),
	);
	const packed = new Uint8Array(iv.length + body.length);
	packed.set(iv, 0);
	packed.set(body, iv.length);
	const sealed = toBase64Url(packed);
	if (sealed.length > MAX_ENVELOPE_BYTES) {
		throw new InvalidCredentialError(
			`Too many API keys to carry in the token (${sealed.length} > ${MAX_ENVELOPE_BYTES} bytes).`,
		);
	}
	return sealed;
}

/**
 * 封筒を開く。改竄・鍵違い・破損はすべて undefined を返す。
 * 呼び出し側が「封筒が無い」場合と同じ扱いにできるようにするため、例外にしない。
 */
export async function openCredentials(
	sealed: string,
	secret: string,
): Promise<UserApiKeys | undefined> {
	try {
		if (sealed.length > MAX_ENVELOPE_BYTES) return undefined;
		const raw = fromBase64Url(sealed);
		// iv(12) + AES-GCM の認証タグ(16) より短いものは形式として成立しない
		if (raw.length <= 28) return undefined;
		const plain = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv: raw.subarray(0, 12) },
			await deriveKey(secret),
			raw.subarray(12),
		);
		const parsed = JSON.parse(new TextDecoder().decode(plain));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
		// 値が文字列であることまで確認する。壊れた封筒で後段を汚さない。
		for (const value of Object.values(parsed)) {
			if (typeof value !== "string") return undefined;
		}
		return parsed as UserApiKeys;
	} catch {
		return undefined;
	}
}

/** 識別子に封筒を連結する。封筒が無ければ識別子のまま返す。 */
export function attach(id: string, sealed?: string): string {
	return sealed ? `${id}${SEPARATOR}${sealed}` : id;
}

/**
 * コードやトークンを識別子と封筒に分ける。
 * 保存や照合に使ってよいのは id のみで、封筒は保存してはならない。
 */
export function detach(value: string): { id: string; sealed?: string } {
	const at = value.indexOf(SEPARATOR);
	if (at === -1) return { id: value };
	return { id: value.slice(0, at), sealed: value.slice(at + 1) };
}

// --- ブラウザ Cookie (同意画面から上流 IdP を往復する間だけ使う) ---

/**
 * 封筒を預ける Cookie。__Host- 接頭辞により、パスと安全な発信元が強制され、
 * サブドメインから書き込まれることもない。
 */
export function envelopeCookie(sealed: string): string {
	return (
		`${ENVELOPE_COOKIE}=${sealed}; HttpOnly; Secure; SameSite=Lax; Path=/; ` +
		`Max-Age=${ENVELOPE_COOKIE_MAX_AGE_SEC}`
	);
}

/** 使い終わった封筒はすぐ捨てる。ブラウザに残す理由がない。 */
export const clearEnvelopeCookie = `${ENVELOPE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

/** Cookie ヘッダから封筒を取り出す。Express / Workers のどちらからも使える。 */
export function readEnvelopeCookie(cookieHeader: string | null | undefined): string | undefined {
	if (!cookieHeader) return undefined;
	for (const part of cookieHeader.split(";")) {
		const eq = part.indexOf("=");
		if (eq === -1) continue;
		if (part.slice(0, eq).trim() !== ENVELOPE_COOKIE) continue;
		return part.slice(eq + 1).trim() || undefined;
	}
	return undefined;
}

/**
 * 同意画面のフォームから本人のキーを取り出す。
 *
 * 設定にあるスペース名しか見ない。フォームは利用者が細工できるため、
 * 知らないフィールドを拾って後段へ流さない。
 */
export function collectCredentialFields(
	get: (field: string) => string | null | undefined,
	spaces: string[],
	fieldPrefix: string,
): UserApiKeys {
	const keys: UserApiKeys = {};
	for (const space of spaces) {
		const value = get(`${fieldPrefix}${space}`);
		if (typeof value !== "string") continue;
		const trimmed = value.trim();
		// 空欄は「そのスペースは使わない」の意思表示として扱う
		if (trimmed.length > 0) keys[space.toLowerCase()] = trimmed;
	}
	return keys;
}

// --- 認可サーバの手前で封筒を出し入れするための変換 ---
//
// Cloudflare 版は workers-oauth-provider にトークン発行を任せるため、
// 封筒をその手前で外し、後で付け直す。ここに置くのは、この出し入れが
// 「取りこぼすと保存されてしまう」要注意箇所であり、実行環境に依存せず
// テストできる形にしておきたいため。

/** 内部ヘッダの名前。ラッパから apiHandler へ封筒を渡すためだけに使う。 */
export const INTERNAL_ENVELOPE_HEADER = "x-internal-credential-envelope";

/**
 * トークン要求から封筒を外す。form は書き換えられ、外した封筒を返す。
 * code と refresh_token のどちらに付いていても拾う。
 */
export function stripEnvelopeFromTokenRequest(form: FormData): string | undefined {
	let sealed: string | undefined;
	for (const field of ["code", "refresh_token"]) {
		const value = form.get(field);
		if (typeof value !== "string") continue;
		const parted = detach(value);
		if (!parted.sealed) continue;
		sealed = parted.sealed;
		form.set(field, parted.id);
	}
	return sealed;
}

/**
 * 発行されたトークンへ封筒を付け直す。
 * 両方に付ける。リフレッシュ側で落とすと、GUI クライアントは
 * リフレッシュのたびにキーを再入力する羽目になる。
 */
export function attachEnvelopeToTokenResponse(
	issued: Record<string, unknown>,
	sealed: string,
): Record<string, unknown> {
	for (const field of ["access_token", "refresh_token"]) {
		const value = issued[field];
		if (typeof value === "string") issued[field] = attach(value, sealed);
	}
	return issued;
}

/**
 * Authorization ヘッダから封筒を外し、内部ヘッダへ移し替える。
 *
 * 外から来た内部ヘッダは必ず捨てる。これを怠ると、クライアントが
 * 任意の封筒を宣言できてしまう (封筒自体はサーバの鍵でしか作れないが、
 * 他人から漏れた封筒の使い回しを許す理由はない)。
 */
export function moveEnvelopeToInternalHeader(headers: Headers): void {
	headers.delete(INTERNAL_ENVELOPE_HEADER);

	const authorization = headers.get("authorization");
	if (!authorization || !/^bearer /i.test(authorization)) return;

	const { id, sealed } = detach(authorization.slice(7).trim());
	if (!sealed) return;
	headers.set("authorization", `Bearer ${id}`);
	headers.set(INTERNAL_ENVELOPE_HEADER, sealed);
}
