/**
 * GBNF grammar compilation and provider-native structured output injection.
 *
 * Used by the constrained-decoding layer to enforce tool-call argument schemas
 * during generation: GBNF for open-weight models (llama.cpp/vLLM), provider-native
 * structured output for frontier APIs.
 */

export { composePayloadHooks, createGrammarInjector } from "./grammar-injector.ts";
export { createStructuredOutputInjector } from "./structured-output-injector.ts";
export { typeboxToGbnf } from "./typebox-to-gbnf.ts";
