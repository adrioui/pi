/**
 * Magnitude-style thinking_delta character governor.
 *
 * Monitors the number of thinking characters produced by the model in
 * extended-thinking (thinking_delta) mode. When the limit is exceeded,
 * the governor signals the harness to interrupt and inject overthinking
 * feedback into the next turn.
 */

/**
 * Thinking governor configuration.
 * Controls how many characters of thinking_delta are permitted before
 * the governor triggers overthinking feedback.
 */
export interface ThinkingGovernorConfig {
	/** Maximum thinking characters for the full/default reasoning profile. */
	fullMaxChars: number;
	/** Maximum thinking characters for fast/scout-style tasks. */
	fastMaxChars: number;
	/** Maximum thinking characters as default fallback. */
	fallbackMaxChars: number;
	/** Optional Magnitude-style per-role thinking character limits. */
	roleMaxChars?: Partial<Record<ThinkingGovernorRole, number>>;
}

export type ThinkingGovernorRole =
	| "leader"
	| "finder"
	| "scout"
	| "architect"
	| "engineer"
	| "critic"
	| "scientist"
	| "artisan"
	| "advisor";

/**
 * Default thinking limits inspired by Magnitude's DeepSeek V4 Pro tuning.
 */
export const DEFAULT_THINKING_LIMITS: ThinkingGovernorConfig = {
	fullMaxChars: 5_000,
	fastMaxChars: 1_500,
	fallbackMaxChars: 7_000,
	roleMaxChars: {
		leader: 20_000,
		finder: 2_000,
		scout: 2_000,
		architect: 20_000,
		engineer: 20_000,
		critic: 20_000,
		scientist: 20_000,
		artisan: 20_000,
		advisor: 1_200,
	},
};

/**
 * Thinking governor state for a single turn.
 */
export interface ThinkingGovernorState {
	/** Total thinking characters accumulated so far this turn. */
	accumulatedChars: number;
	/** The configured maximum for the current mode. */
	maxChars: number;
	/** Whether the limit has been exceeded this turn. */
	exceeded: boolean;
	/** How many times the governor has triggered overthinking feedback. */
	triggerCount: number;
}

/**
 * Create a fresh governor state for a new turn.
 */
export function createThinkingGovernorState(
	config: ThinkingGovernorConfig,
	mode: "full" | "fast" | "scout" | "fallback" = "full",
	role?: ThinkingGovernorRole,
): ThinkingGovernorState {
	const maxChars = role
		? (config.roleMaxChars?.[role] ?? config.fallbackMaxChars)
		: mode === "fast" || mode === "scout"
			? config.fastMaxChars
			: mode === "full"
				? config.fullMaxChars
				: config.fallbackMaxChars;
	return {
		accumulatedChars: 0,
		maxChars,
		exceeded: false,
		triggerCount: 0,
	};
}

/**
 * Feed thinking_delta text to the governor.
 * Returns the updated state and a boolean indicating whether the limit was
 * newly exceeded (first time crossing the threshold).
 */
export function feedThinkingDelta(
	state: ThinkingGovernorState,
	deltaText: string,
): { state: ThinkingGovernorState; newlyExceeded: boolean } {
	const newChars = state.accumulatedChars + deltaText.length;
	const wasExceeded = state.exceeded;
	const nowExceeded = newChars > state.maxChars;

	return {
		state: {
			...state,
			accumulatedChars: newChars,
			exceeded: nowExceeded,
			triggerCount: nowExceeded && !wasExceeded ? state.triggerCount + 1 : state.triggerCount,
		},
		newlyExceeded: nowExceeded && !wasExceeded,
	};
}

/**
 * Generate overthinking feedback text to inject into the next turn.
 */
export function generateOverthinkingFeedback(state: ThinkingGovernorState): string {
	return (
		"[Thinking Governor Warning] You have exceeded the thinking budget for this turn " +
		`(${state.accumulatedChars} chars > ${state.maxChars} max). ` +
		"Ground your reasoning in tool observations. If you need to reason extensively, " +
		"use fewer, more targeted thoughts and execute tools earlier to gather evidence. " +
		"Long chains of ungrounded reasoning increase latency without improving quality."
	);
}

/**
 * Check if thinking_delta text counts as "overthinking" based on heuristics.
 * Returns true if the text appears to be ungrounded rumination.
 */
export function isOverthinking(deltaText: string): boolean {
	const lower = deltaText.toLowerCase();

	// Signs of ungrounded thinking
	const overthinkingPatterns = [
		/re-?evaluat/i, // "re-evaluating"
		/let me reconsider/, // Going in circles
		/on second thought/, // Changing mind without new evidence
		/alternatively/, // Listing options without deciding
		/i could also/, // Proliferating options
		/maybe i should/, // Indecision
		/perhaps/, // Hedge words in rapid succession
		/i wonder if/, // Speculation without grounding
	];

	// Only check for overthinking on longer thinking segments (>200 chars)
	if (deltaText.length < 200) return false;

	let patternHits = 0;
	for (const pattern of overthinkingPatterns) {
		if (pattern.test(lower)) {
			patternHits++;
		}
	}

	// 2+ overthinking patterns in a segment suggests rumination
	return patternHits >= 2;
}
