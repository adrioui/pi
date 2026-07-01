import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { DetachedProcessRegistry } from "../../../src/core/detached-process-registry.ts";
import { IdenticalContinueTracker } from "../../../src/core/identical-continue-tracker.ts";
import { buildWorkerContext } from "../../../src/core/worker-context-builder.ts";
import { WorkerExecutor } from "../../../src/core/worker-executor.ts";
import { WorkerSession, type WorkerTool } from "../../../src/core/worker-session.ts";
import { filterToolsForRole } from "../../../src/core/worker-tools.ts";

function createWorkerTestModel(): Model<string> {
	return {
		id: "test-model",
		name: "Test",
		api: "openai-completions",
		provider: "faux",
		baseUrl: "http://localhost",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
	};
}

function createAssistantMessage(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-completions",
		provider: "faux",
		model: "test-model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: Date.now(),
	};
}

describe("WorkerSession", () => {
	it("creates and runs to completion", async () => {
		const model = {
			id: "test-model",
			name: "Test",
			api: "openai-completions",
			provider: "faux",
			baseUrl: "http://localhost",
			reasoning: false,
			input: ["text" as const],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 4096,
		};

		let finished = false;
		let errored = false;
		const session = new WorkerSession({
			forkId: "fork1",
			agentId: "agent1",
			role: "scout",
			model: model as any,
			systemPrompt: "You are a scout.",
			initialMessage: "Investigate the codebase.",
			tools: [],
			contextLimit: 128000,
			maxTurns: 1,
			onFinished: () => {
				finished = true;
			},
			onError: () => {
				errored = true;
			},
		});

		await session.start();
		// Without a real LLM, the session will error out or reach max turns
		// The important thing is it doesn't crash and calls onFinished or onError
		expect(finished || errored).toBe(true);
	});

	it("delivers messages to the queue", () => {
		const model = {
			id: "test-model",
			name: "Test",
			api: "openai-completions",
			provider: "faux",
			baseUrl: "http://localhost",
			reasoning: false,
			input: ["text" as const],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 4096,
		};

		const session = new WorkerSession({
			forkId: "fork1",
			agentId: "agent1",
			role: "scout",
			model: model as any,
			systemPrompt: "You are a scout.",
			initialMessage: "Investigate.",
			tools: [],
			contextLimit: 128000,
			onFinished: () => {},
			onError: () => {},
		});

		// Should not throw
		session.deliverMessage("New task: check files.");
		session.kill();
	});

	it("marks invalid worker tool-call streams with corrective validation feedback", async () => {
		const publishEvents: string[] = [];
		const session = new WorkerSession({
			forkId: "fork1",
			agentId: "agent1",
			role: "scout",
			model: createWorkerTestModel(),
			systemPrompt: "You are a scout.",
			initialMessage: "Read the file.",
			tools: [
				{
					name: "read",
					description: "Read files",
					parameters: Type.Object({ path: Type.String() }),
					execute: async () => ({ content: [{ type: "text", text: "file" }], details: null }),
				},
			],
			contextLimit: 128000,
			maxTurns: 5,
			publishEvent: async (type) => {
				publishEvents.push(type);
			},
			onFinished: () => {},
			onError: () => {},
		});

		const partial = createAssistantMessage(
			[{ type: "toolCall", id: "call-1", name: "read", arguments: {} }],
			"toolUse",
		);
		const internals = session as unknown as {
			handleAgentEvent(event: AgentEvent, signal: AbortSignal): Promise<void>;
		};

		await internals.handleAgentEvent(
			{
				type: "message_update",
				message: partial,
				assistantMessageEvent: {
					type: "toolcall_delta",
					contentIndex: 0,
					delta: '{"path":123}',
					partial,
				},
			},
			new AbortController().signal,
		);

		const aborted = createAssistantMessage(partial.content, "aborted");
		await internals.handleAgentEvent({ type: "message_end", message: aborted }, new AbortController().signal);

		expect(aborted.stopReason).toBe("error");
		expect(aborted.errorMessage).toContain("tool_validation:");
		expect(publishEvents).toContain("tool_validation_failed");
	});
});

describe("WorkerExecutor", () => {
	it("does not clean up a killed worker before its session settles", async () => {
		let killed = false;
		const executor = new WorkerExecutor({
			resolveModel: () => undefined,
			getSystemPrompt: () => "",
			getAllTools: () => [],
			getProjectContext: () => "",
			getTranscript: () => "",
			publishEvent: async () => {},
			onWorkerFinished: () => {},
			onWorkerError: () => {},
		});
		const internals = executor as unknown as {
			workers: Map<string, { kill(): void }>;
			onWorkerKilled(event: { payload: { agentId: string; forkId: string } }): Promise<void>;
		};
		internals.workers.set("agent1", {
			kill: () => {
				killed = true;
			},
		});

		await internals.onWorkerKilled({ payload: { agentId: "agent1", forkId: "fork1" } });

		expect(killed).toBe(true);
		expect(internals.workers.has("agent1")).toBe(true);
		executor.dispose();
	});
});

describe("filterToolsForRole", () => {
	const allTools: WorkerTool[] = [
		{
			name: "read",
			description: "Read files",
			parameters: Type.Object({}),
			execute: async () => ({ content: [{ type: "text", text: "" }], details: null }),
		},
		{
			name: "bash",
			description: "Run shell commands",
			parameters: Type.Object({}),
			execute: async () => ({ content: [{ type: "text", text: "" }], details: null }),
		},
		{
			name: "spawnWorker",
			description: "Spawn a worker",
			parameters: Type.Object({}),
			execute: async () => ({ content: [{ type: "text", text: "" }], details: null }),
		},
		{
			name: "killWorker",
			description: "Kill a worker",
			parameters: Type.Object({}),
			execute: async () => ({ content: [{ type: "text", text: "" }], details: null }),
		},
	];

	it("filters out leader-only tools for workers", () => {
		const filtered = filterToolsForRole("scout", allTools);
		expect(filtered.map((t) => t.name)).toContain("read");
		expect(filtered.map((t) => t.name)).not.toContain("spawnWorker");
		expect(filtered.map((t) => t.name)).not.toContain("killWorker");
	});

	it("critic gets read-only tool set", () => {
		const filtered = filterToolsForRole("critic", allTools);
		expect(filtered.map((t) => t.name)).toContain("read");
		expect(filtered.map((t) => t.name)).toContain("bash");
		// Critic should not have edit/write
		expect(filtered.map((t) => t.name)).not.toContain("edit");
	});
});

describe("buildWorkerContext", () => {
	it("builds XML-structured context", () => {
		const context = buildWorkerContext({
			sessionStart: "Session started",
			projectContext: "Project files here",
			transcript: "Previous messages",
		});
		expect(context).toContain("<session-start>");
		expect(context).toContain("Session started");
		expect(context).toContain("</session-start>");
		expect(context).toContain("<project-context>");
		expect(context).toContain("Project files here");
		expect(context).toContain("</project-context>");
		expect(context).toContain("<transcript>");
		expect(context).toContain("Previous messages");
		expect(context).toContain("</transcript>");
	});
});

describe("DetachedProcessRegistry", () => {
	it("tracks and kills processes per fork", () => {
		const registry = new DetachedProcessRegistry();
		// Use fake PIDs that won't exist
		registry.register(99999, "fork1");
		registry.register(99998, "fork1");
		registry.register(99997, "fork2");

		expect(registry.getProcessesForFork("fork1").length).toBe(2);
		expect(registry.getProcessesForFork("fork2").length).toBe(1);

		// killAll should not throw even for non-existent PIDs
		registry.killAll("fork1");
		expect(registry.getProcessesForFork("fork1").length).toBe(0);
		expect(registry.getProcessesForFork("fork2").length).toBe(1);
	});
});

describe("IdenticalContinueTracker", () => {
	it("detects identical context", () => {
		const tracker = new IdenticalContinueTracker();
		const messages = [{ role: "user", content: "hello", timestamp: 0 } as any];
		expect(tracker.shouldSkip(messages)).toBe(false);
		expect(tracker.shouldSkip(messages)).toBe(true);
	});

	it("reset clears the tracker", () => {
		const tracker = new IdenticalContinueTracker();
		const messages = [{ role: "user", content: "hello", timestamp: 0 } as any];
		tracker.shouldSkip(messages);
		tracker.reset();
		expect(tracker.shouldSkip(messages)).toBe(false);
	});
});
