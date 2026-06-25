/**
 * Tests for the thinking governor module.
 */

import { describe, expect, it } from "vitest";
import {
	createThinkingGovernorState,
	DEFAULT_THINKING_LIMITS,
	feedThinkingDelta,
	generateOverthinkingFeedback,
	isOverthinking,
} from "../src/core/thinking-governor.ts";

describe("thinking-governor", () => {
	describe("DEFAULT_THINKING_LIMITS", () => {
		it("has full max at 5000", () => {
			expect(DEFAULT_THINKING_LIMITS.fullMaxChars).toBe(5000);
		});

		it("has fast max at 1500", () => {
			expect(DEFAULT_THINKING_LIMITS.fastMaxChars).toBe(1500);
		});

		it("has fallback max at 7000", () => {
			expect(DEFAULT_THINKING_LIMITS.fallbackMaxChars).toBe(7000);
		});
	});

	describe("createThinkingGovernorState", () => {
		it("creates a fresh state with full mode limits", () => {
			const state = createThinkingGovernorState(DEFAULT_THINKING_LIMITS, "full");
			expect(state.accumulatedChars).toBe(0);
			expect(state.maxChars).toBe(5000);
			expect(state.exceeded).toBe(false);
			expect(state.triggerCount).toBe(0);
		});

		it("creates state with fast mode limits", () => {
			const state = createThinkingGovernorState(DEFAULT_THINKING_LIMITS, "fast");
			expect(state.maxChars).toBe(1500);
		});

		it("creates state with scout mode limits (same as fast)", () => {
			const state = createThinkingGovernorState(DEFAULT_THINKING_LIMITS, "scout");
			expect(state.maxChars).toBe(1500);
		});

		it("creates state with fallback mode limits", () => {
			const state = createThinkingGovernorState(DEFAULT_THINKING_LIMITS, "fallback");
			expect(state.maxChars).toBe(7000);
		});
	});

	describe("feedThinkingDelta", () => {
		it("accumulates characters", () => {
			const state = createThinkingGovernorState(DEFAULT_THINKING_LIMITS, "full");
			const result = feedThinkingDelta(state, "Hello, world!");
			expect(result.state.accumulatedChars).toBe(13);
			expect(result.newlyExceeded).toBe(false);
		});

		it("detects when limit is exceeded", () => {
			const state = createThinkingGovernorState(DEFAULT_THINKING_LIMITS, "full");
			// Feed more than maxChars
			const bigText = "x".repeat(DEFAULT_THINKING_LIMITS.fullMaxChars + 100);
			const result = feedThinkingDelta(state, bigText);
			expect(result.state.exceeded).toBe(true);
			expect(result.newlyExceeded).toBe(true);
			expect(result.state.triggerCount).toBe(1);
		});

		it("only sets newlyExceeded once per threshold crossing", () => {
			const state = createThinkingGovernorState(DEFAULT_THINKING_LIMITS, "full");
			const bigText = "x".repeat(DEFAULT_THINKING_LIMITS.fullMaxChars + 100);

			const result1 = feedThinkingDelta(state, bigText);
			expect(result1.newlyExceeded).toBe(true);

			const result2 = feedThinkingDelta(result1.state, "more text");
			expect(result2.newlyExceeded).toBe(false);
		});

		it("increments triggerCount on first exceed only", () => {
			const state = createThinkingGovernorState(DEFAULT_THINKING_LIMITS, "full");
			const bigText = "x".repeat(DEFAULT_THINKING_LIMITS.fullMaxChars + 100);

			const result1 = feedThinkingDelta(state, bigText);
			expect(result1.state.triggerCount).toBe(1);

			const result2 = feedThinkingDelta(result1.state, "more");
			expect(result2.state.triggerCount).toBe(1);
		});

		it("handles multiple delta feeds accumulating over limit", () => {
			const state = createThinkingGovernorState(DEFAULT_THINKING_LIMITS, "full");
			const half = Math.floor(DEFAULT_THINKING_LIMITS.fullMaxChars / 2);

			const r1 = feedThinkingDelta(state, "x".repeat(half));
			expect(r1.state.exceeded).toBe(false);

			const r2 = feedThinkingDelta(r1.state, "x".repeat(half + 100));
			expect(r2.state.exceeded).toBe(true);
			expect(r2.state.accumulatedChars).toBe(half + half + 100);
		});
	});

	describe("generateOverthinkingFeedback", () => {
		it("includes character count", () => {
			const state = createThinkingGovernorState(DEFAULT_THINKING_LIMITS, "full");
			const exceeded = feedThinkingDelta(state, "x".repeat(DEFAULT_THINKING_LIMITS.fullMaxChars + 50));
			const feedback = generateOverthinkingFeedback(exceeded.state);
			expect(feedback).toContain(String(DEFAULT_THINKING_LIMITS.fullMaxChars + 50));
			expect(feedback).toContain(String(DEFAULT_THINKING_LIMITS.fullMaxChars));
		});

		it("contains guidance about grounding", () => {
			const state = createThinkingGovernorState(DEFAULT_THINKING_LIMITS, "full");
			const exceeded = feedThinkingDelta(state, "x".repeat(DEFAULT_THINKING_LIMITS.fullMaxChars + 50));
			const feedback = generateOverthinkingFeedback(exceeded.state);
			expect(feedback).toContain("Ground your reasoning");
		});
	});

	describe("isOverthinking", () => {
		it("returns false for short text", () => {
			expect(isOverthinking("short")).toBe(false);
		});

		it("returns false for direct, grounded thinking", () => {
			const text =
				"I need to read the file first. Let me use the read tool to check the contents. " +
				"Based on the structure, I can see the function signature. The return type is Promise<void>. " +
				"This matches the pattern I saw in similar files.";
			expect(isOverthinking(text)).toBe(false);
		});

		it("detects overthinking patterns", () => {
			const text =
				"Let me reconsider this approach. On second thought, maybe I should re-evaluate. " +
				"Perhaps there is a better way. I wonder if the architecture is correct. " +
				"Let me just think about this for a moment before deciding. " +
				"I could also try a different approach. Alternatively, maybe I should just ask the user.";
			expect(isOverthinking(text)).toBe(true);
		});

		it("does not trigger on single hedge word", () => {
			const _text =
				"Perhaps I should read the file first before making any changes. " +
				"That would be the safest approach given the complexity.";
			// Text is 200+ chars but only one "perhaps" hit
			expect(isOverthinking(`${"x".repeat(200)} perhaps `)).toBe(false);
		});
	});
});
