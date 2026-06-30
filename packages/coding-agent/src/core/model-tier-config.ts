/**
 * Model tier configuration — moved out of agent-model-resolver.ts for maintainability.
 * Model IDs break when versions change; config makes them maintainable.
 * Users can override via .pi/settings.local.json.
 */

import type { ModelTier } from "@earendil-works/pi-event-core";

const DEFAULT_TIER_MODEL_IDS: Record<ModelTier, string[]> = {
	fast: ["deepseek/deepseek-v4-flash", "deepseek-v4-flash"],
	smart: ["opencode-go/glm-5.2", "zai/glm-5.2", "glm-5.2", "deepseek/deepseek-v4-pro"],
	"smart+thinking": [
		"opencode-go/kimi-k2.7-code",
		"moonshotai/kimi-k2.7-code",
		"kimi-k2.7-code",
		"deepseek/deepseek-v4-pro",
	],
	"smart+high-temp+thinking": [
		"opencode-go/kimi-k2.7-code",
		"moonshotai/kimi-k2.7-code",
		"kimi-k2.7-code",
		"deepseek/deepseek-v4-pro",
	],
};

/**
 * Get model IDs for a tier, with optional user overrides.
 */
export function getTierModelIds(tier: ModelTier, overrides?: Partial<Record<ModelTier, string[]>>): string[] {
	return overrides?.[tier] ?? DEFAULT_TIER_MODEL_IDS[tier] ?? [];
}

export { DEFAULT_TIER_MODEL_IDS };
