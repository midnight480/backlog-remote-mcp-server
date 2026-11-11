#!/usr/bin/env -S npx tsx
// smoke.mts
// 実際の Backlog スペースに対して、ツールを MCP 経由で呼んで動作を確かめるスモークテスト。
// サーバは本番と同じ src/core/create-server.ts を使い、プロセス内で MCP クライアントとつなぐ
// (OAuth / wrangler は通さない)。
//
//   npm run smoke -- --project KEY            # 読み取りだけ
//   npm run smoke -- --project KEY --write    # 書き込みも行う (作ったものは最後に削除する)
//
// オプション:
//   --project KEY   確認に使うプロジェクト (必須)。書き込みをするならテスト用のプロジェクトにすること
//   --space NAME    スペース名 (省略時は既定のスペース)
//   --write         Document / 課題 / 関連課題の作成・削除まで確認する
//   --keep          --write で作ったものを削除せずに残す
//   --verbose       各ツールの応答を表示する
//
// 結果は OK / NG / WARN / SKIP で表示する。NG が 1 件でもあれば終了コード 1。
// WARN は「ツールは動いたが権限などで確認しきれなかった」もの (例: 管理者でないので削除できない)。

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../../src/core/create-server.ts";
import { loadLocalConfigOrExit } from "./config.mts";

// ---- 引数 ----
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const option = (name: string) => {
	const i = argv.indexOf(name);
	return i === -1 ? undefined : argv[i + 1];
};
const PROJECT = option("--project");
const SPACE = option("--space");
const WRITE = flag("--write");
const KEEP = flag("--keep");
const VERBOSE = flag("--verbose");

if (!PROJECT) {
	console.error("--project <プロジェクトキー> を指定してください。例: npm run smoke -- --project TEST");
	process.exit(2);
}

// ---- MCP 接続 ----
const { spacesConfig, source } = loadLocalConfigOrExit();
const server = createMcpServer({ spacesConfig });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
const client = new Client({ name: "backlog-smoke", version: "1.0.0" });
await client.connect(clientTransport);

class ToolError extends Error {}

/** ツールを呼び、テキスト応答を JSON として返す。ツールがエラーを返したら ToolError を投げる */
async function call(name: string, args: Record<string, unknown> = {}): Promise<any> {
	const res: any = await client.callTool({ name, arguments: SPACE ? { space: SPACE, ...args } : args });
	const text = (res.content ?? []).map((c: any) => c.text ?? "").join("\n");
	if (VERBOSE) console.log(`      ${name} → ${text.slice(0, 600).replace(/\n/g, "\n      ")}`);
	if (res.isError) throw new ToolError(text.slice(0, 300));
	try {
		return text ? JSON.parse(text) : undefined;
	} catch {
		return text;
	}
}

// ---- 結果の記録 ----
type Status = "OK" | "NG" | "WARN" | "SKIP";
const results: { status: Status; name: string; note: string }[] = [];
const COLORS: Record<Status, string> = { OK: "32", NG: "31", WARN: "33", SKIP: "90" };
function record(status: Status, name: string, note = "") {
	results.push({ status, name, note });
	console.log(`  \x1b[${COLORS[status]}m${status.padEnd(4)}\x1b[0m ${name}${note ? `  — ${note}` : ""}`);
}

/** 1 つの確認を実行する。fn が文字列を返せばそれを補足として表示する */
async function check<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
	try {
		const value = await fn();
		record("OK", name, typeof value === "string" ? value : "");
		return value;
	} catch (e) {
		record("NG", name, e instanceof Error ? e.message.split("\n")[0] : String(e));
		return undefined;
	}
}

/**
 * check と同じだが、ツールのエラーが skipIf に当てはまれば NG ではなく SKIP にする。
 * プランで使えない機能 (403 featureRestricted) など、ツールの不具合ではないエラー向け。
 */
async function checkOrSkip<T>(
	name: string,
	fn: () => Promise<T>,
	skipIf: (message: string) => string | undefined,
): Promise<T | undefined> {
	try {
		const value = await fn();
		record("OK", name, typeof value === "string" ? value : "");
		return value;
	} catch (e) {
		const message = e instanceof Error ? e.message.split("\n")[0] : String(e);
		const reason = e instanceof ToolError ? skipIf(message) : undefined;
		record(reason ? "SKIP" : "NG", name, reason ?? message);
		return undefined;
	}
}

/** プランや設定で機能が無効なときの Backlog のエラー (403, code 5) */
const featureRestricted = (message: string) =>
	/featureRestricted/.test(message) ? "このスペースのプランか設定で機能が無効" : undefined;

function assert(cond: unknown, message: string): asserts cond {
	if (!cond) throw new Error(message);
}

const section = (title: string) => console.log(`\n\x1b[36m■ ${title}\x1b[0m`);
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);

// ======================================================================
console.log(`Backlog smoke test  (config: ${source}, project: ${PROJECT}, write: ${WRITE})`);

section("接続");
const tools = await check("tools/list", async () => {
	const list = await client.listTools();
	return `${list.tools.length} tools`;
});
assert(tools, "tools/list に失敗したので中止します");
await check("list_spaces", async () => {
	const spaces = await call("list_spaces");
	return Array.isArray(spaces) ? spaces.map((s: any) => `${s.name}${s.readOnly ? "(readOnly)" : ""}`).join(", ") : "";
});
await check("get_space", async () => (await call("get_space")).spaceKey);
const me = await check("get_myself", async () => call("get_myself"));

// ======================================================================
section("プロジェクト");
const project = await check("get_project", async () => call("get_project", { projectIdOrKey: PROJECT }));
if (!project) {
	console.error(`\nプロジェクト ${PROJECT} を取得できないので中止します`);
	process.exit(1);
}
const projectId: number = project.id;
await check("get_project_statuses", async () => `${(await call("get_project_statuses", { projectIdOrKey: PROJECT })).length} statuses`);
const issueTypes = await check("get_issue_types", async () => call("get_issue_types", { projectIdOrKey: PROJECT }));
const priorities = await check("get_priorities", async () => call("get_priorities"));
await check("get_project_users", async () => `${(await call("get_project_users", { projectIdOrKey: PROJECT })).length} users`);
await check("get_project_activities (count=1)", async () => {
	const acts = await call("get_project_activities", { projectIdOrKey: PROJECT, count: 1 });
	assert(Array.isArray(acts) && acts.length <= 1, "count=1 が効いていない");
});

// ======================================================================
section("課題 (読み取り)");
const issues = await check("get_issues (count=1, expand=childIssueSummary)", async () => {
	const list = await call("get_issues", { projectId: [projectId], count: 1, expand: ["childIssueSummary"] });
	assert(Array.isArray(list) && list.length <= 1, "count=1 が効いていない");
	return list;
});
await check("count_issues", async () => `${(await call("count_issues", { projectId: [projectId] })).count} issues`);
// 子課題を持つ課題で childIssueSummary を確かめる (子課題自身には件数が付かないため)
const recent = issues?.[0] ? await call("get_issues", { projectId: [projectId], count: 100 }).catch(() => []) : [];
const parentId = (recent as any[]).find((i) => i.parentIssueId)?.parentIssueId;
if (!issues?.[0]) {
	record("SKIP", "get_issue", "課題がない");
} else if (!parentId) {
	await check("get_issue", async () => (await call("get_issue", { issueIdOrKey: issues[0].issueKey })).issueKey);
	record("SKIP", "childIssueSummary", "子課題を持つ課題がない");
} else {
	await check("get_issues (parentIssueId, expand=childIssueSummary)", async () => {
		// 親課題そのものを id[] で取り、一覧 API の childIssueSummary (ドキュメント記載あり) を確かめる
		const [parent] = await call("get_issues", { projectId: [projectId], id: [parentId], expand: ["childIssueSummary"] });
		assert(parent?.childIssueSummary, "childIssueSummary が返らない");
		return `${parent.issueKey}: total=${parent.childIssueSummary.total}, closed=${parent.childIssueSummary.closed}`;
	});
	// 単体取得の API は childIssueSummary を返さない (実測) ので、課題の取得だけを確かめる
	await check("get_issue", async () => (await call("get_issue", { issueIdOrKey: String(parentId) })).issueKey);
}

// ======================================================================
section("Document (読み取り)");
const docCount = await checkOrSkip(
	"get_documents_count",
	async () => (await call("get_documents_count", { projectIdOrKey: PROJECT })).count as number,
	featureRestricted,
);
if (docCount !== undefined) {
	console.log(`         ${docCount} documents`);
	// ドキュメントが 0 件のプロジェクトでは、Backlog がツリーの根を持たず 404 を返す
	await checkOrSkip(
		"get_document_tree",
		async () => {
			const tree = await call("get_document_tree", { projectIdOrKey: PROJECT });
			assert(tree.activeTree, "activeTree がない");
		},
		(message) =>
			docCount === 0 && /ActiveRoot node not found/.test(message)
				? "ドキュメントが 0 件のプロジェクトでは API が 404 を返す"
				: undefined,
	);
	const firstDocs = await check("get_documents (count=1, offset=0)", async () => {
		const list = await call("get_documents", { projectId: [projectId], count: 1, offset: 0 });
		assert(Array.isArray(list) && list.length <= 1, "count=1 が効いていない");
		return list;
	});
	if (firstDocs?.[0]?.title) {
		// 作成から時間がたったドキュメントで検索する (直後だと検索への反映待ちと区別できない)
		const doc = firstDocs[0];
		await check(`get_documents (keyword=タイトル「${doc.title}」)`, async () => {
			const hits = await call("get_documents", { projectId: [projectId], keyword: doc.title });
			assert((hits ?? []).some((d: any) => d.id === doc.id), "タイトルで検索しても見つからない");
		});
		// 本文が検索対象かどうかはドキュメントに書かれていないので、結果を報告するだけにする
		const words = String(doc.plain ?? "")
			.split(/[\s`#*\-:()（）「」、。]+/)
			.filter((w: string) => w.length >= 4 && !doc.title.includes(w));
		if (words[0]) {
			const hits = await call("get_documents", { projectId: [projectId], keyword: words[0] }).catch(() => []);
			const found = (hits ?? []).some((d: any) => d.id === doc.id);
			record(found ? "OK" : "WARN", `get_documents (keyword=本文の語「${words[0]}」)`, found ? "本文も検索対象" : "本文の語では見つからない (本文は検索対象外の可能性)");
		}
	}
} else {
	record("SKIP", "Document の残り", "Document 機能が無効か、取得に失敗");
}

// ======================================================================
section("スペース・通知・Git");
await check("get_space_activities (count=1) → get_activity", async () => {
	const acts = await call("get_space_activities", { count: 1 });
	if (!acts?.[0]) return "アクティビティなし";
	const act = await call("get_activity", { activityId: acts[0].id });
	assert(act.id === acts[0].id, "get_activity の id が一致しない");
	return `type=${act.type}`;
});
await check("get_notifications (count=1)", async () => {
	const list = await call("get_notifications", { count: 1 });
	assert(Array.isArray(list) && list.length <= 1, "count=1 が効いていない");
});
if (me) await check("get_watchings_count", async () => `${(await call("get_watchings_count", { userId: me.id })).count} watchings`);
const repos = await checkOrSkip(
	"get_git_repositories",
	async () => call("get_git_repositories", { projectIdOrKey: PROJECT }),
	featureRestricted,
);
if (repos?.[0]) {
	const repo = repos[0].name;
	await check(`get_pull_requests (${repo}, count=1, statusId=[1])`, async () => {
		const prs = await call("get_pull_requests", { projectIdOrKey: PROJECT, repoIdOrName: repo, count: 1, statusId: [1] });
		assert(Array.isArray(prs) && prs.length <= 1, "count=1 が効いていない");
	});
	await check(`count_pull_requests (${repo}, statusId=[1])`, async () =>
		`${(await call("count_pull_requests", { projectIdOrKey: PROJECT, repoIdOrName: repo, statusId: [1] })).count} open PRs`,
	);
} else {
	record("SKIP", "pull request 系", "Git リポジトリがない");
}

// ======================================================================
if (WRITE) {
	const cleanup: { name: string; fn: () => Promise<unknown> }[] = [];

	section("Document (書き込み)");
	const title = `[smoke] ${stamp}`;
	const marker = `smoke-body-${stamp}`;
	const parent = await check("add_document (content を Markdown で送る)", async () => {
		const doc = await call("add_document", {
			projectId,
			title,
			content: `# 見出し\n\n${marker} **太字**`,
			addLast: true,
		});
		assert(doc?.id, "id が返らない");
		cleanup.unshift({ name: `delete_document ${doc.id}`, fn: () => call("delete_document", { documentId: doc.id }) });
		return doc;
	});
	if (parent) {
		await check("get_document (本文が保存されている)", async () => {
			const doc = await call("get_document", { documentId: parent.id });
			assert(String(doc.plain ?? "").includes(marker), `本文が空か違う: ${JSON.stringify(doc.plain).slice(0, 80)}`);
			assert(doc.title === title, "タイトルが違う");
		});
		const child = await check("add_document (parentId で子として作る / plain エイリアス)", async () => {
			const doc = await call("add_document", { projectId, title: `${title} child`, plain: `${marker}-child`, parentId: parent.id });
			cleanup.unshift({ name: `delete_document ${doc.id}`, fn: () => call("delete_document", { documentId: doc.id }) });
			const got = await call("get_document", { documentId: doc.id });
			assert(String(got.plain ?? "").includes(`${marker}-child`), "plain で渡した本文が保存されていない");
			return doc;
		});
		if (child) {
			await check("get_document_tree (子が親の下にある)", async () => {
				const tree = await call("get_document_tree", { projectIdOrKey: PROJECT });
				const find = (nodes: any[]): any => {
					for (const n of nodes ?? []) {
						if (n.id === parent.id) return n;
						const hit = find(n.children);
						if (hit) return hit;
					}
				};
				const node = find(tree.activeTree?.children);
				assert(node, "親がツリーにない");
				assert((node.children ?? []).some((c: any) => c.id === child.id), "子が親の下にない");
			});
		}
		{
			// emoji に使える値はドキュメントに書かれていない (実測: 📝 は通り、🧪 は msg.invalid.emoji で拒否された)
			const candidates = ["📝", "😀", ":memo:"];
			const tried: string[] = [];
			let accepted: string | undefined;
			for (const emoji of candidates) {
				try {
					const doc = await call("add_document", { projectId, title: `${title} emoji`, content: marker, emoji, parentId: parent.id });
					cleanup.unshift({ name: `delete_document ${doc.id}`, fn: () => call("delete_document", { documentId: doc.id }) });
					accepted = `${emoji} → 保存値 ${JSON.stringify(doc.emoji)}`;
					break;
				} catch (e) {
					tried.push(`${emoji}: ${(e as Error).message.match(/msg\.[\w.]+/)?.[0] ?? "error"}`);
				}
			}
			if (accepted) record("OK", "add_document (emoji)", `${accepted}${tried.length ? ` / 拒否: ${tried.join(", ")}` : ""}`);
			else record("WARN", "add_document (emoji)", `どの候補も拒否された: ${tried.join(", ")}`);
		}
		await check("add_document_tags → get_document → remove_document_tags", async () => {
			const tag = `smoke-${stamp}`;
			await call("add_document_tags", { documentId: parent.id, tagNames: [tag] });
			const tagged = await call("get_document", { documentId: parent.id });
			assert((tagged.tags ?? []).some((t: any) => t.name === tag), "タグが付いていない");
			await call("remove_document_tags", { documentId: parent.id, tagNames: [tag] });
			const untagged = await call("get_document", { documentId: parent.id });
			assert(!(untagged.tags ?? []).some((t: any) => t.name === tag), "タグが外れていない");
		});
		// 作成直後は検索に反映されていないことがあるので、待ちながら数回試す。
		// タイトルと本文の両方で試し、どちらが検索対象になっているかを記録する。
		for (const [label, keyword] of [["タイトル", title], ["本文", marker]] as const) {
			const name = `get_documents (作成直後のドキュメントを ${label} で検索)`;
			try {
				let foundAfter: number | undefined;
				for (const waitSec of [0, 3, 10]) {
					if (waitSec) await new Promise((r) => setTimeout(r, waitSec * 1000));
					const hits = await call("get_documents", { projectId: [projectId], keyword });
					if ((hits ?? []).some((d: any) => d.id === parent.id)) {
						foundAfter = waitSec;
						break;
					}
				}
				// 実測では、作成から 13 秒では検索に反映されなかった (既存ドキュメントはタイトルで見つかる)。
				// 反映待ちは API の仕様なので NG にはしない
				if (foundAfter !== undefined) record("OK", name, `${foundAfter} 秒待って見つかった`);
				else record("SKIP", name, "13 秒では検索に反映されない (既知。反映に時間がかかる)");
			} catch (e) {
				record("NG", name, (e as Error).message);
			}
		}
	}

	section("課題・関連課題 (書き込み)");
	const issueTypeId = issueTypes?.[0]?.id;
	const priorityId = (priorities ?? []).find((p: any) => p.id === 3)?.id ?? priorities?.[0]?.id;
	if (!issueTypeId || !priorityId) {
		record("SKIP", "課題の作成", "種別か優先度を取得できなかった");
	} else {
		const makeIssue = async (label: string) => {
			const issue = await call("add_issue", { projectId, summary: `[smoke] ${stamp} ${label}`, issueTypeId, priorityId });
			cleanup.unshift({ name: `delete_issue ${issue.issueKey}`, fn: () => call("delete_issue", { issueIdOrKey: issue.issueKey }) });
			return issue;
		};
		const a = await check("add_issue (A)", () => makeIssue("A"));
		const b = await check("add_issue (B)", () => makeIssue("B"));
		if (a && b) {
			await check("add_related_issue (targetIssueId) → get_related_issues", async () => {
				await call("add_related_issue", { issueIdOrKey: a.issueKey, targetIssueId: b.id });
				const related = await call("get_related_issues", { issueIdOrKey: a.issueKey });
				const list = Array.isArray(related) ? related : (related?.issues ?? []);
				assert(JSON.stringify(list).includes(String(b.id)), "B が関連課題にない");
			});
			await check("remove_related_issue", async () => {
				await call("remove_related_issue", { issueIdOrKey: a.issueKey, relatedIssueId: b.id });
			});
		}
	}

	section(KEEP ? "後片付け (--keep のため省略)" : "後片付け");
	if (KEEP) {
		for (const c of cleanup) record("SKIP", c.name, "--keep");
	} else {
		for (const c of cleanup) {
			try {
				await c.fn();
				record("OK", c.name);
			} catch (e) {
				// 削除は管理者・プロジェクト管理者に限られるものが多い
				record("WARN", c.name, `削除できなかったので画面から消してください: ${(e as Error).message.split("\n")[0]}`);
			}
		}
	}
}

// ======================================================================
const count = (s: Status) => results.filter((r) => r.status === s).length;
console.log(`\n結果: OK=${count("OK")}  NG=${count("NG")}  WARN=${count("WARN")}  SKIP=${count("SKIP")}`);
await client.close();
process.exit(count("NG") > 0 ? 1 : 0);
