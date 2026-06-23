#!/usr/bin/env node
// Verify prompt routing for all free models available in pi
import { classifyPromptVariant, classifyModelLineage } from './dist/core/prompt-family.js';

const freeModels = [
  // open-source-explicit lineage
  { provider: 'opencode', modelId: 'deepseek-v4-flash-free', expectedVariant: 'open-source-explicit', expectedLineage: 'deepseek' },
  { provider: 'opencode', modelId: 'mimo-v2.5-free', expectedVariant: 'open-source-explicit', expectedLineage: 'mimo' },
  { provider: 'zenmux', modelId: 'z-ai/glm-4.7-flash-free', expectedVariant: 'open-source-explicit', expectedLineage: 'glm' },
  { provider: 'zenmux', modelId: 'z-ai/glm-4.6v-flash-free', expectedVariant: 'open-source-explicit', expectedLineage: 'glm' },
  
  // default (unknown lineage)
  { provider: 'opencode', modelId: 'nemotron-3-ultra-free', expectedVariant: 'default', expectedLineage: 'unknown' },
  { provider: 'opencode', modelId: 'north-mini-code-free', expectedVariant: 'default', expectedLineage: 'unknown' },
  { provider: 'zenmux', modelId: 'stepfun/step-3.7-flash-free', expectedVariant: 'default', expectedLineage: 'unknown' },
  
  // openrouter free models
  { provider: 'openrouter', modelId: 'meta-llama/llama-3.3-70b-instruct:free', expectedVariant: 'open-source-explicit', expectedLineage: 'llama' },
  { provider: 'openrouter', modelId: 'qwen/qwen3-coder:free', expectedVariant: 'open-source-explicit', expectedLineage: 'qwen' },
  { provider: 'openrouter', modelId: 'google/gemma-4-26b-a4b-it:free', expectedVariant: 'open-source-explicit', expectedLineage: 'gemma' },
  { provider: 'openrouter', modelId: 'openai/gpt-oss-120b:free', expectedVariant: 'open-source-explicit', expectedLineage: 'gpt-oss' },
  { provider: 'openrouter', modelId: 'cohere/north-mini-code:free', expectedVariant: 'default', expectedLineage: 'unknown' },
  { provider: 'openrouter', modelId: 'nvidia/nemotron-3-ultra-550b-a55b:free', expectedVariant: 'default', expectedLineage: 'unknown' },
];

console.log('=== FREE MODEL PROMPT ROUTING VERIFICATION ===\n');

let allPassed = true;
for (const m of freeModels) {
  const lineage = classifyModelLineage(m.provider, m.modelId, undefined);
  const variant = classifyPromptVariant(m.provider, m.modelId, undefined);
  const lineageOk = lineage === m.expectedLineage;
  const variantOk = variant === m.expectedVariant;
  const ok = lineageOk && variantOk;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${m.provider}/${m.modelId}`);
  if (!lineageOk) console.log(`  lineage: ${lineage} (expected ${m.expectedLineage})`);
  if (!variantOk) console.log(`  variant: ${variant} (expected ${m.expectedVariant})`);
  if (!ok) allPassed = false;
}

console.log(`\n${allPassed ? 'ALL PASSED' : 'SOME FAILED'}`);
process.exit(allPassed ? 0 : 1);
