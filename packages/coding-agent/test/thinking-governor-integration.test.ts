/**
 * Integration tests for the thinking governor wired into AgentSession.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, type AgentMessage } from "@earendil-works/pi-agent-core";
import { type AssistantMessage, type AssistantMessageEvent, EventStream, getModel } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createTestResourceLoader } from "./utilities.ts";

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
	}
}

function createAssistantMessage(text: string, overrides?: Partial<AssistantMessage>): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
		...overrides,
	};
}

function getUserMessageText(message: AgentMessage): string {
	if (message.role !== "user") return "";
	if (typeof message.content === "string") return message.content;
	const content: Array<{ type: string; text?: string }> = Array.isArray(message.content) ? message.content : [];
	return content
		.filter((part): part is { type: "text"; text: string } => {
			return (
				typeof part === "object" &&
				part !== null &&
				"type" in part &&
				"text" in part &&
				part.type === "text" &&
				typeof part.text === "string"
			);
		})
		.map((part) => part.text)
		.join("");
}

describe("AgentSession thinking governor integration", () => {
	let session: AgentSession;
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-thinking-governor-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		if (session) {
			session.dispose();
		}
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true });
		}
	});

	function createSessionWithThinkingDeltas(thinkingDeltas: string[]) {
		const model = getModel("anthropic", "claude-sonnet-4-5")!;
		let callCount = 0;
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: "Test", tools: [] },
			streamFn: () => {
				callCount++;
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					if (callCount === 1) {
						const partial: AssistantMessage = createAssistantMessage("", { content: [] });
						stream.push({ type: "start", partial });
						for (const delta of thinkingDeltas) {
							stream.push({
								type: "thinking_delta",
								contentIndex: 0,
								delta,
								partial,
							});
						}
						stream.push({ type: "done", reason: "stop", message: createAssistantMessage("Done") });
					} else {
						// Subsequent runs (after steering feedback) return plain text.
						stream.push({ type: "done", reason: "stop", message: createAssistantMessage("Follow-up") });
					}
				});
				return stream;
			},
		});

		const sessionManager = SessionManager.inMemory();
		const settingsManager = SettingsManager.create(tempDir, tempDir);
		const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
		const modelRegistry = ModelRegistry.create(authStorage, tempDir);
		authStorage.setRuntimeApiKey("anthropic", "test-key");

		session = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			cwd: tempDir,
			modelRegistry,
			resourceLoader: createTestResourceLoader(),
		});
		// Apply the low thinking level to the session so the governor uses the
		// fast budget (1500 chars).
		session.setThinkingLevel("low");

		return session;
	}

	it("injects overthinking feedback when thinking_delta exceeds the budget", async () => {
		// Each delta is 600 chars; three deltas exceed the 1500 fast budget.
		const deltas = ["x".repeat(600), "x".repeat(600), "x".repeat(600)];
		createSessionWithThinkingDeltas(deltas);

		await session.prompt("hi");

		const feedbackMessages = session.messages.filter(
			(message) => message.role === "user" && getUserMessageText(message).includes("Thinking Governor Warning"),
		);
		expect(feedbackMessages.length).toBeGreaterThan(0);
		const text = getUserMessageText(feedbackMessages[0]!);
		expect(text).toContain("1800 chars > 1500 max");
	});

	it("does not queue feedback when thinking_delta stays under the budget", async () => {
		const deltas = ["x".repeat(200), "x".repeat(200)];
		createSessionWithThinkingDeltas(deltas);

		await session.prompt("hi");

		expect(session.getSteeringMessages()).toHaveLength(0);
	});
});
