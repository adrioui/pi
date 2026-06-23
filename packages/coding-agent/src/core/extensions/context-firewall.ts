/**
 * Context Firewall Extension - Phase 3
 *
 * Automatically injects project context into subagent system prompts.
 * Mirrors Magnitude's approach: subagents get a clean context firewall
 * with only the essential project state they need to work effectively.
 *
 * The firewall includes:
 * - Current working directory
 * - Active AGENTS.md guidance (filtered by recently touched files)
 * - Git branch and recent commits
 * - Brief summary of what the parent agent has been doing
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { ExtensionAPI, ExtensionFactory } from "./types.ts";

export interface ContextFirewallOptions {
	/** Root directory of the project */
	cwd: string;
	/** Maximum number of recent commits to include */
	maxRecentCommits?: number;
	/** Maximum length of activity summary */
	maxActivitySummary?: number;
}

/**
 * Build a concise project-context block for subagents.
 */
function buildProjectContextBlock(
	cwd: string,
	branch?: string,
	recentCommits?: string[],
	agentsGuidance?: string[],
	parentActivity?: string,
): string {
	const lines: string[] = ["<project-context>", `  <cwd>${cwd}</cwd>`];

	if (branch) {
		lines.push(`  <branch>${branch}</branch>`);
	}

	if (recentCommits && recentCommits.length > 0) {
		lines.push("  <recent-commits>");
		recentCommits.forEach((commit) => {
			lines.push(`    ${commit}`);
		});
		lines.push("  </recent-commits>");
	}

	if (agentsGuidance && agentsGuidance.length > 0) {
		lines.push("  <project-guidance>");
		agentsGuidance.forEach((guidance) => {
			lines.push(`    ${guidance}`);
		});
		lines.push("  </project-guidance>");
	}

	if (parentActivity) {
		lines.push(`  <parent-activity>${parentActivity}</parent-activity>`);
	}

	lines.push("</project-context>");

	return lines.join("\n");
}

/**
 * Extract git branch name from .git/HEAD.
 */
function getGitBranch(cwd: string): string | undefined {
	try {
		const headPath = join(cwd, ".git", "HEAD");
		if (!existsSync(headPath)) {
			return undefined;
		}

		const head = readFileSync(headPath, "utf-8").trim();
		const match = head.match(/^ref: refs\/heads\/(.+)$/);
		return match ? match[1] : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Get recent commits from git log.
 */
function getRecentCommits(cwd: string, max: number): string[] | undefined {
	try {
		const output = execSync(`git log --oneline -n ${max}`, {
			cwd,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});
		return output.trim().split("\n").filter(Boolean);
	} catch {
		return undefined;
	}
}

/**
 * Load AGENTS.md guidance relevant to recently touched files.
 * Returns an array of guidance snippets (one per matching AGENTS.md).
 */
function loadRelevantGuidance(cwd: string, touchedFiles: string[], resourceLoader: any): string[] | undefined {
	if (!resourceLoader || touchedFiles.length === 0) {
		return undefined;
	}

	try {
		// Make paths relative to cwd for glob matching
		const relativePaths = touchedFiles.map((absPath) => {
			const rel = relative(cwd, absPath);
			return rel.startsWith("..") ? absPath : rel;
		});

		// Temporarily set touched files and reload
		resourceLoader.setTouchedFiles(relativePaths);
		resourceLoader.reloadContextFiles();

		const agentsFiles = resourceLoader.getAgentsFiles().agentsFiles;
		return agentsFiles.map((f: { path: string; content: string }) => f.content);
	} catch {
		return undefined;
	}
}

/**
 * Summarize parent agent activity from recent messages.
 */
function summarizeParentActivity(messages: any[], maxLength: number): string | undefined {
	if (!messages || messages.length === 0) {
		return undefined;
	}

	// Get last few user and assistant messages
	const recent = messages.slice(-4);
	const summaries: string[] = [];

	for (const msg of recent) {
		if (msg.role === "user") {
			const text =
				typeof msg.content === "string" ? msg.content : msg.content.map((b: any) => b.text || "").join("");
			summaries.push(`User: ${text.slice(0, 100)}`);
		} else if (msg.role === "assistant") {
			const text =
				typeof msg.content === "string" ? msg.content : msg.content.map((b: any) => b.text || "").join("");
			summaries.push(`Assistant: ${text.slice(0, 100)}`);
		}
	}

	const summary = summaries.join(" | ");
	return summary.length > maxLength ? `${summary.slice(0, maxLength)}...` : summary;
}

export function createContextFirewallExtension(options: ContextFirewallOptions): ExtensionFactory {
	const { cwd, maxRecentCommits = 5, maxActivitySummary = 300 } = options;

	return (pi: ExtensionAPI) => {
		// Register tool_call handler to intercept task tool calls
		pi.on("tool_call", async (event, ctx) => {
			const { toolName, input } = event;

			// Only intercept task tool calls
			if (toolName !== "task") {
				return;
			}

			// Get the resource loader from the context if available
			const resourceLoader = (ctx as any).resourceLoader;

			// Build project context
			const branch = getGitBranch(cwd);
			const recentCommits = getRecentCommits(cwd, maxRecentCommits);

			// Get touched files from the resource loader if available
			const touchedFiles = resourceLoader ? (Array.from(resourceLoader.touchedFiles || []) as string[]) : [];
			const agentsGuidance = loadRelevantGuidance(cwd, touchedFiles, resourceLoader);

			// Get parent activity from conversation history
			const messages = (ctx as any).messages || [];
			const parentActivity = summarizeParentActivity(messages, maxActivitySummary);

			// Build the context firewall block
			const contextBlock = buildProjectContextBlock(cwd, branch, recentCommits, agentsGuidance, parentActivity);

			// Inject into the task request by mutating input
			const originalRequest = (input as any).request || "";
			const enhancedRequest = `${contextBlock}\n\n${originalRequest}`;

			// Mutate the input
			(input as any).request = enhancedRequest;

			console.log("[context-firewall] Injected project context into task subagent");
		});
	};
}
