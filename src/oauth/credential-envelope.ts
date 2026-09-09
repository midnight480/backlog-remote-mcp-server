// oauth/credential-envelope.ts
// ヘッダを送れない GUI クライアント (Claude Desktop / claude.ai) 向けに、
// 利用者本人の Backlog API キーを「サーバに保存せず」運ぶための封筒。
//
// なぜ保存しないのか:
//   このサーバは他サービスの資格情報を預からない方針を採る。保管庫を持たなければ、
//   サーバが侵害されても他人の Backlog 権限は漏れない。
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
//   MCP クライアント) 側にある。AuthStore に封筒が入ることは一度もない。
//
// 封筒の中身はサーバの鍵でしか開けないため、クライアントから見ても不透明である。

import { Buffer } from "node:buffer";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { Request } from "express";
import { InvalidCredentialError, type UserApiKeys } from "../core/credentials";
import { parseCookies } from "./consent";

/**
 * 識別子と封筒の区切り。base64url の文字集合 (A-Za-z0-9-_) に現れない文字を選ぶ。
 * これにより、封筒の有無にかかわらず識別子部分を一意に切り出せる。
 */
const SEPARATOR = "~";

/** 封筒を預けるブラウザ Cookie。上流 IdP を往復する間だけ存在する */
const ENVELOPE_COOKIE = "__Host-BACKLOG_CREDENTIALS";
/** 上流 IdP でのログインに要する時間だけ持てばよい */
const ENVELOPE_COOKIE_MAX_AGE_SEC = 60 * 10;

/** 封筒が大きくなりすぎないための上限。ヘッダ長やクライアント側の保存を考慮する */
const MAX_ENVELOPE_BYTES = 4096;

/** 鍵の取り違えを防ぐため、用途を鍵導出に混ぜる */
const HKDF_INFO = "backlog-mcp-credential-envelope-v1";

function deriveKey(secret: string): Buffer {
	// salt は固定でよい。secret 自体が十分な長さのランダム値である前提で、
	// ここでの目的は「Cookie 署名など他用途の鍵と分離すること」にある。
	return Buffer.from(hkdfSync("sha256", Buffer.from(secret), Buffer.alloc(0), HKDF_INFO, 32));
}

/**
 * キー一式を封じる。鍵を持つサーバ以外は中身を読めない。
 * 形式: base64url(iv[12] || authTag[16] || ciphertext)
 */
export function sealCredentials(keys: UserApiKeys, secret: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
	const body = Buffer.concat([
		cipher.update(Buffer.from(JSON.stringify(keys), "utf8")),
		cipher.final(),
	]);
	const sealed = Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
	if (Buffer.byteLength(sealed) > MAX_ENVELOPE_BYTES) {
		throw new InvalidCredentialError(
			`Too many API keys to carry in the token (${Buffer.byteLength(sealed)} > ${MAX_ENVELOPE_BYTES} bytes).`,
		);
	}
	return sealed;
}

/**
 * 封筒を開く。改竄・鍵違い・破損はすべて undefined を返す。
 * 呼び出し側が「封筒が無い」場合と同じ扱いにできるようにするため、例外にしない。
 */
export function openCredentials(sealed: string, secret: string): UserApiKeys | undefined {
	try {
		const raw = Buffer.from(sealed, "base64url");
		if (raw.length <= 28) return undefined;
		const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), raw.subarray(0, 12));
		decipher.setAuthTag(raw.subarray(12, 28));
		const plain = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
		const parsed = JSON.parse(plain.toString("utf8"));
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

export function readEnvelopeCookie(req: Request): string | undefined {
	return parseCookies(req.headers.cookie)[ENVELOPE_COOKIE] || undefined;
}
