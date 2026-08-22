#!/usr/bin/env node
// wrangler.jsonc からデプロイ用の設定 (wrangler.deploy.json) を生成する。
//
// wrangler は設定ファイル内の ${VAR} を展開しないため、カスタムドメインの
// ホスト名だけを外部から注入する。値の解決順は:
//   1. 環境変数 MCP_HOSTNAME
//   2. .dev.vars の MCP_HOSTNAME
// どちらも無ければエラーで停止する (routes 無しの状態でデプロイして
// カスタムドメインが外れる事故を防ぐため)。

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "wrangler.jsonc");
const OUT = join(ROOT, "wrangler.deploy.json");

// JSONC (// と /* */ コメント、末尾カンマ) を JSON に落とす。
// 文字列リテラル内の // や /* はコメントとして扱わない。
export function stripJsonc(text) {
	let out = "";
	let i = 0;
	while (i < text.length) {
		const c = text[i];
		if (c === '"') {
			out += c;
			i++;
			while (i < text.length) {
				if (text[i] === "\\") {
					out += text.slice(i, i + 2);
					i += 2;
					continue;
				}
				out += text[i];
				if (text[i] === '"') {
					i++;
					break;
				}
				i++;
			}
			continue;
		}
		if (c === "/" && text[i + 1] === "/") {
			while (i < text.length && text[i] !== "\n") i++;
			continue;
		}
		if (c === "/" && text[i + 1] === "*") {
			i += 2;
			while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
			i += 2;
			continue;
		}
		out += c;
		i++;
	}
	// 末尾カンマ除去 (文字列は上で保護済みだが、念のため簡易処理)
	return out.replace(/,(\s*[}\]])/g, "$1");
}

function readDevVar(name) {
	let text;
	try {
		text = readFileSync(join(ROOT, ".dev.vars"), "utf8");
	} catch {
		return undefined;
	}
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq === -1) continue;
		if (trimmed.slice(0, eq).trim() !== name) continue;
		return trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
	}
	return undefined;
}

function main() {
	const hostname = process.env.MCP_HOSTNAME ?? readDevVar("MCP_HOSTNAME");
	if (!hostname) {
		console.error(
			"✘ MCP_HOSTNAME が未設定です。\n" +
				"  .dev.vars に MCP_HOSTNAME=your-worker.example.com を追加するか、\n" +
				"  MCP_HOSTNAME=... npm run deploy のように環境変数で渡してください。",
		);
		process.exit(1);
	}
	if (/^https?:\/\//.test(hostname) || hostname.includes("/")) {
		console.error(
			`✘ MCP_HOSTNAME はスキーム・パスなしのホスト名で指定してください (受け取った値: ${hostname})`,
		);
		process.exit(1);
	}

	const config = JSON.parse(stripJsonc(readFileSync(SRC, "utf8")));
	config.routes = [{ pattern: hostname, custom_domain: true }];
	// dev 専用設定はデプロイ用から除く
	delete config.dev;
	writeFileSync(OUT, `${JSON.stringify(config, null, "\t")}\n`);
	console.log(`✔ wrangler.deploy.json を生成しました (custom domain: ${hostname})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
