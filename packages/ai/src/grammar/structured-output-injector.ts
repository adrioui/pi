/**
 * Provider-native structured output injector for frontier APIs.
 *
 * For models with `grammar: false` (OpenAI, Anthropic, Google), injects
 * provider-native structured output instead of GBNF:
 * - OpenAI (Completions): response_format: { type: "json_object" }
 * - OpenAI (Responses): response_format: { type: "json_schema", schema: ... }
 * - Google: response_schema in generation config
 * - Anthropic: No change needed — tool_use schema is already enforced
 */

import type { TSchema } from "typebox";
import type { Api, Model } from "../types.ts";

type PayloadHook = (payload: unknown, model: Model<Api>) => unknown | undefined | Promise<unknown | undefined>;

export function createStructuredOutputInjector(toolSchemas: TSchema[]): PayloadHook {
	return (payload, model) => {
		if (model.grammar) return undefined;
		if (toolSchemas.length === 0) return undefined;

		if (payload && typeof payload === "object") {
			const p = payload as Record<string, unknown>;

			if (model.api === "openai-completions") {
				p.response_format = { type: "json_object" };
			} else if (model.api === "openai-responses") {
				if (toolSchemas.length === 1) {
					p.response_format = {
						type: "json_schema",
						json_schema: { name: "tool_args", schema: toolSchemas[0] },
					};
				}
			} else if (model.api === "google-generative-ai" || model.api === "google-vertex") {
				if (toolSchemas.length === 1) {
					const config = (p.generation_config ?? {}) as Record<string, unknown>;
					config.response_schema = toolSchemas[0];
					p.generation_config = config;
				}
			}
			// Anthropic already enforces tool_use schemas natively
		}
		return payload;
	};
}
