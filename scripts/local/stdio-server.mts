#!/usr/bin/env -S npx tsx
// stdio-server.mts
// 本番と同じツール群 (src/core/create-server.ts) を stdio の MCP サーバとして起動する。
// OAuth / Cloudflare Access / wrangler を通さずに、Claude Code や MCP Inspector から
// ツールを直接呼んで動作確認するためのもの。
//
//   npm run local:stdio
//   claude mcp add backlog-local -- npm --prefix /path/to/backlog-remote-mcp-server run -s local:stdio
//   npx @modelcontextprotocol/inspector npm run -s local:stdio
//
// 設定の読み込み元は scripts/local/config.mts を参照。
// stdout は MCP のプロトコルに使うので、ログは必ず stderr に出すこと。

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "../../src/core/create-server.ts";
import { loadLocalConfigOrExit } from "./config.mts";

const { spacesConfig, source } = loadLocalConfigOrExit();
const server = createMcpServer({ spacesConfig });
await server.connect(new StdioServerTransport());
console.error(`[backlog-local] stdio MCP server started (config: ${source})`);
