// config.mts
// ローカル動作確認用のスペース設定を読み込む。OAuth / Cloudflare Access は通さない。
//
// 優先順位:
//   1. 環境変数 BACKLOG_SPACES_CONFIG (JSON。本番と同じ形式)
//   2. 環境変数 BACKLOG_DOMAIN + BACKLOG_API_KEY (単一スペースの簡易指定)
//   3. .dev.vars の BACKLOG_SPACES_CONFIG
//
// API キーはリポジトリに置かないこと (.dev.vars は .gitignore 済み)。

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** .dev.vars (KEY=VALUE 形式) を読み込む。引用符で囲まれた値にも対応する */
function readDevVars(path: string): Record<string, string> {
	if (!existsSync(path)) return {};
	const out: Record<string, string> = {};
	for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
		if (!m) continue;
		let value = m[2];
		if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
		out[m[1]] = value;
	}
	return out;
}

export interface LocalConfig {
	/** createMcpServer に渡す BACKLOG_SPACES_CONFIG の JSON 文字列 */
	spacesConfig: string;
	/** どこから読み込んだか (ログ表示用。キーは含めない) */
	source: string;
}

/** loadLocalConfig を呼び、設定が無ければメッセージを出して終了する */
export function loadLocalConfigOrExit(cwd = process.cwd()): LocalConfig {
	try {
		return loadLocalConfig(cwd);
	} catch (e) {
		console.error(e instanceof Error ? e.message : String(e));
		process.exit(2);
	}
}

export function loadLocalConfig(cwd = process.cwd()): LocalConfig {
	const env = process.env;
	if (env.BACKLOG_SPACES_CONFIG) {
		return { spacesConfig: env.BACKLOG_SPACES_CONFIG, source: "env BACKLOG_SPACES_CONFIG" };
	}
	if (env.BACKLOG_DOMAIN && env.BACKLOG_API_KEY) {
		const name = env.BACKLOG_SPACE_NAME || env.BACKLOG_DOMAIN.split(".")[0];
		return {
			spacesConfig: JSON.stringify({
				spaces: [
					{
						name,
						domain: env.BACKLOG_DOMAIN,
						apiKey: env.BACKLOG_API_KEY,
						readOnly: env.BACKLOG_READ_ONLY === "true",
					},
				],
				defaultSpace: name,
			}),
			source: `env BACKLOG_DOMAIN (${env.BACKLOG_DOMAIN})`,
		};
	}
	const devVarsPath = resolve(cwd, ".dev.vars");
	const devVars = readDevVars(devVarsPath);
	if (devVars.BACKLOG_SPACES_CONFIG) {
		return { spacesConfig: devVars.BACKLOG_SPACES_CONFIG, source: ".dev.vars BACKLOG_SPACES_CONFIG" };
	}
	throw new Error(
		"Backlog の設定が見つかりません。次のいずれかを設定してください:\n" +
			"  - BACKLOG_DOMAIN と BACKLOG_API_KEY の環境変数\n" +
			"  - BACKLOG_SPACES_CONFIG の環境変数\n" +
			"  - .dev.vars の BACKLOG_SPACES_CONFIG",
	);
}
