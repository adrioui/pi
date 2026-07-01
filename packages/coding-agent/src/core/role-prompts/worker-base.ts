import { ARCHITECT_PROMPT } from "./architect.ts";
import { ARTISAN_PROMPT } from "./artisan.ts";
import { CRITIC_PROMPT } from "./critic.ts";
import { ENGINEER_PROMPT } from "./engineer.ts";
import { SCIENTIST_PROMPT } from "./scientist.ts";
import { SCOUT_PROMPT } from "./scout.ts";

export const WORKER_BASE_PROMPT = [
	"Your coordinator will message you with instructions.",
	"Continue working until the assigned task is complete, blocked by explicit missing information, or reassigned.",
	"Return concrete findings, files changed or inspected, and verification status.",
	"",
	"## Work protocol",
	"Do not stop until the task is done or you are explicitly blocked.",
	"If blocked, report what information is missing and what you attempted.",
	"",
	"## Tool discipline",
	"Use the right tool for the job. Prefer read-only tools (read, grep, find, ls) for exploration.",
	"Use bash only when necessary. Use edit/write only when making changes is part of your task.",
	"",
	"## Context awareness",
	"You do not see the full session context. Work only with what is in your delegation message.",
	"Use scratchpad_save to persist findings for later retrieval. Use scratchpad_load to retrieve saved artifacts.",
	"",
	"## Return format",
	"Summarize your findings concisely. Include file paths, key observations, and verification results.",
].join("\n");

/** Role-specific expanded prompts with detailed guidance, failure modes, and output expectations. */
export const ROLE_PROMPTS: Record<string, string> = {
	scout: SCOUT_PROMPT,
	architect: ARCHITECT_PROMPT,
	engineer: ENGINEER_PROMPT,
	critic: CRITIC_PROMPT,
	scientist: SCIENTIST_PROMPT,
	artisan: ARTISAN_PROMPT,
};

/**
 * Returns the full system prompt for a worker role.
 * Combines the shared worker base prompt with the role-specific expanded prompt.
 * Falls back to a generic prompt for unknown roles.
 */
export function getSystemPrompt(role: string): string {
	const rolePrompt = ROLE_PROMPTS[role] ?? "Complete the assigned task.";
	return `${WORKER_BASE_PROMPT}\n\n## Your role\n${rolePrompt}`;
}
