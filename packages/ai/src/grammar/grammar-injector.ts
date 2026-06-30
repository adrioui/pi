/**
 * GBNF grammar injector for llama.cpp/vLLM open-weight models.
 *
 * Uses the `onPayload` hook in StreamOptions to inject GBNF grammar into
 * provider request payloads. Each provider API module already calls
 * `options?.onPayload?.(params, model)` before sending the request.
 *
 * Returns `undefined` for models without grammar support (frontier APIs).
 */

import type { TSchema } from "typebox";
import type { Api, Model } from "../types.ts";
import { typeboxToGbnf } from "./typebox-to-gbnf.ts";

const GRAMMAR_FIELD_BY_API: Partial<Record<Api, string>> = {
	"openai-completions": "grammar",
};

type PayloadHook = (payload: unknown, model: Model<Api>) => unknown | undefined | Promise<unknown | undefined>;

export function createGrammarInjector(toolSchemas: TSchema[]): PayloadHook {
	return (payload, model) => {
		if (!model.grammar) return undefined;
		if (toolSchemas.length === 0) return undefined;

		const gbnfRules = toolSchemas.map((schema) => typeboxToGbnf(schema)).join("\n\n");
		const field = model.grammarField ?? GRAMMAR_FIELD_BY_API[model.api] ?? "grammar";

		if (payload && typeof payload === "object") {
			const p = payload as Record<string, unknown>;
			p[field] = gbnfRules;
		}
		return payload;
	};
}

/**
 * Compose multiple payload hooks into a single hook.
 * Each hook receives the output of the previous one.
 */
export function composePayloadHooks(hooks: (PayloadHook | undefined)[]): PayloadHook {
	return async (payload, model) => {
		let current = payload;
		for (const hook of hooks) {
			if (!hook) continue;
			const result = await hook(current, model);
			if (result !== undefined) {
				current = result;
			}
		}
		return current;
	};
}
