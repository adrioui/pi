export const CHARS_PER_TOKEN_UPPER = 4;
export const CHARS_PER_TOKEN_LOWER = 3;
export const TRUNCATION_TOKEN_LIMIT = 25000;
export const TRUNCATION_CHAR_LIMIT = 100000;
export const OUTPUT_TOKEN_RESERVE = 8192;
export const COMPACT_MAX_FILES = 10;
export const COMPACT_MAX_FILE_CHARS = 10000;
export const COMPACTION_MAX_RETRIES = 3;
export const COMPACTION_FALLBACK_KEEP_RATIO = 0.25;
export const KEEP_MESSAGE_RATIO = 0.1;

export const DEFAULT_CONTEXT_LIMIT_POLICY = {
	softCapRatio: 0.9,
	softCapMaxTokens: 200000,
} as const;

export function calculateContextCaps(contextWindow: number): { hardCap: number; softCap: number } {
	const hardCap = Math.max(0, contextWindow - OUTPUT_TOKEN_RESERVE);
	return {
		hardCap,
		softCap: Math.min(
			Math.floor(hardCap * DEFAULT_CONTEXT_LIMIT_POLICY.softCapRatio),
			DEFAULT_CONTEXT_LIMIT_POLICY.softCapMaxTokens,
		),
	};
}
