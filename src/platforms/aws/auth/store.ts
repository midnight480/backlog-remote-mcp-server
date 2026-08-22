// platforms/aws/auth/store.ts
// OAuth の状態を DynamoDB に保存する。
//
// Cloudflare 版の KV に相当する層。単一テーブルに pk で種別を分けて格納し、
// expiresAt (epoch 秒) を TTL 属性にして認可コード・トークンを自動失効させる。
// TTL の削除は最大数日遅れることがあるため、読み出し時にも期限を検証する。

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
	DeleteCommand,
	DynamoDBDocumentClient,
	GetCommand,
	PutCommand,
	QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";

export interface AuthCodeRecord {
	code: string;
	clientId: string;
	redirectUri: string;
	codeChallenge: string;
	scopes: string[];
	userEmail: string;
	userId: string;
	resource?: string;
	expiresAt: number;
}

export interface TokenRecord {
	token: string;
	kind: "access" | "refresh";
	clientId: string;
	scopes: string[];
	userEmail: string;
	userId: string;
	resource?: string;
	expiresAt: number;
}

/** 上流 IdP へリダイレクトする間、MCP 側の認可要求を預けておくレコード */
export interface UpstreamStateRecord {
	state: string;
	clientId: string;
	redirectUri: string;
	codeChallenge: string;
	scopes: string[];
	mcpState?: string;
	resource?: string;
	/** 上流に対して使う PKCE の verifier */
	upstreamCodeVerifier: string;
	expiresAt: number;
}

const now = () => Math.floor(Date.now() / 1000);

/**
 * クライアント登録の保持期間。
 * /register は認証なしで誰でも叩けるため、期限を付けないと匿名のレコードが
 * 永久に溜まる。使われているクライアントは getClient のたびに延長されるので、
 * 実質「90 日間まったく使われなかった登録だけが消える」挙動になる。
 * 消えた場合も MCP クライアントは動的登録で作り直せる。
 */
const CLIENT_TTL_SEC = 60 * 60 * 24 * 90;
/** 書き込みを減らすため、残りがこの割合を切ったときだけ延長する */
const CLIENT_RENEW_THRESHOLD_SEC = CLIENT_TTL_SEC / 2;

export class DynamoAuthStore {
	private readonly doc: DynamoDBDocumentClient;

	constructor(
		private readonly tableName: string,
		client: DynamoDBClient = new DynamoDBClient({}),
	) {
		this.doc = DynamoDBDocumentClient.from(client, {
			marshallOptions: { removeUndefinedValues: true },
		});
	}

	private async put(item: Record<string, unknown>): Promise<void> {
		await this.doc.send(new PutCommand({ TableName: this.tableName, Item: item }));
	}

	private async get<T>(pk: string): Promise<T | undefined> {
		const res = await this.doc.send(new GetCommand({ TableName: this.tableName, Key: { pk } }));
		const item = res.Item as (T & { expiresAt?: number }) | undefined;
		if (!item) return undefined;
		// TTL の削除は遅延しうるため、読み出し時にも期限を確認する
		if (typeof item.expiresAt === "number" && item.expiresAt <= now()) return undefined;
		return item as T;
	}

	private async del(pk: string): Promise<void> {
		await this.doc.send(new DeleteCommand({ TableName: this.tableName, Key: { pk } }));
	}

	// --- 登録済みクライアント (動的クライアント登録) ---

	async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
		const rec = await this.get<{ client: OAuthClientInformationFull; expiresAt?: number }>(
			`client#${clientId}`,
		);
		if (!rec) return undefined;
		// 使われている登録は期限を延ばす。認可のたびに書き込むのは無駄なので、
		// 残りが半分を切ったときだけ更新する。
		const remaining = (rec.expiresAt ?? 0) - now();
		if (remaining < CLIENT_RENEW_THRESHOLD_SEC) {
			await this.putClient(rec.client);
		}
		return rec.client;
	}

	async putClient(client: OAuthClientInformationFull): Promise<void> {
		await this.put({
			pk: `client#${client.client_id}`,
			client,
			expiresAt: now() + CLIENT_TTL_SEC,
		});
	}

	// --- 上流 IdP へのリダイレクト状態 ---

	async putUpstreamState(rec: UpstreamStateRecord): Promise<void> {
		await this.put({ pk: `ustate#${rec.state}`, ...rec });
	}

	/** 一度しか使えない。取得と同時に削除する。 */
	async takeUpstreamState(state: string): Promise<UpstreamStateRecord | undefined> {
		const rec = await this.get<UpstreamStateRecord>(`ustate#${state}`);
		if (rec) await this.del(`ustate#${state}`);
		return rec;
	}

	// --- 認可コード ---

	async putAuthCode(rec: AuthCodeRecord): Promise<void> {
		await this.put({ pk: `code#${rec.code}`, ...rec });
	}

	async peekAuthCode(code: string): Promise<AuthCodeRecord | undefined> {
		return this.get<AuthCodeRecord>(`code#${code}`);
	}

	/** 認可コードは一度しか交換できない。取得と同時に削除する。 */
	async takeAuthCode(code: string): Promise<AuthCodeRecord | undefined> {
		const rec = await this.peekAuthCode(code);
		if (rec) await this.del(`code#${code}`);
		return rec;
	}

	// --- アクセストークン / リフレッシュトークン ---

	async putToken(rec: TokenRecord): Promise<void> {
		await this.put({ pk: `token#${rec.token}`, ...rec, tokenClientId: rec.clientId });
	}

	async getToken(token: string): Promise<TokenRecord | undefined> {
		return this.get<TokenRecord>(`token#${token}`);
	}

	async deleteToken(token: string): Promise<void> {
		await this.del(`token#${token}`);
	}
}
