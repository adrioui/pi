/**
 * Worker tool registry scoping — filters tools based on ROLE_DEFINITIONS toolkit field.
 *
 * - workerBase: read, bash, edit, write, grep, find, ls, web_search, web_fetch, skill, compact, scratchpad-save, scratchpad-load
 * - criticBase: read, grep, find, ls, bash (read-only)
 * - Leader-only tools (spawnWorker, killWorker, etc.) are NOT available to any worker
 */

import { ROLE_DEFINITIONS } from "@earendil-works/pi-event-core";
import type { WorkerTool } from "./worker-session.ts";

const WORKER_BASE_TOOLS = new Set([
	"read",
	"bash",
	"edit",
	"write",
	"grep",
	"find",
	"ls",
	"web_search",
	"web_fetch",
	"skill",
	"compact",
	"scratchpad-save",
	"scratchpad-load",
]);

const CRITIC_BASE_TOOLS = new Set(["read", "grep", "find", "ls", "bash"]);

const LEADER_ONLY_TOOLS = new Set([
	"spawnWorker",
	"killWorker",
	"messageWorker",
	"reassignWorker",
	"createTask",
	"updateTask",
	"messageAdvisor",
	"finishGoal",
	"pass",
	"escalate",
	"checkpoint-changes",
	"restore-snapshot",
]);

export function filterToolsForRole(role: string, allTools: WorkerTool[]): WorkerTool[] {
	const def = (ROLE_DEFINITIONS as Record<string, { toolkit: string }>)[role];
	const toolkit = def?.toolkit ?? "workerBase";

	const allowedSet = toolkit === "criticBase" ? CRITIC_BASE_TOOLS : WORKER_BASE_TOOLS;

	return allTools.filter((tool) => {
		if (LEADER_ONLY_TOOLS.has(tool.name)) return false;
		return allowedSet.has(tool.name);
	});
}
