/**
 * WorkerSession - runs an LLM agent loop for a forked worker.
 *
 * Adapts the subagent runtime pattern but makes it event-sourced and async:
 * - Runs in the background (non-blocking)
 * - Has a message inbox for messageWorker communication
 * - Publishes events to the fork's event stream
 * - Uses agentLoop for streaming events, retry, and steering
 * - Lightweight compaction between turns (no LLM summaries)
 */

import type { Model } from "@earendil-works/pi-ai";
import type { AssistantMessage, Context, Message } from "@earendil-works/pi-ai/compat";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import type { TSchema } from "typebox";
import { ErrorRepeatGuard } from "./error-repeat-guard.ts";

export interface WorkerTool {
	name: string;
	parameters: TSchema;
	execute: (id: string, args: unknown, signal: AbortSignal | undefined) => Promise<unknown>;
}

export interface WorkerSessionConfig {
	forkId: string;
	agentId: string;
	role: string;
	model: Model<string>;
	systemPrompt: string;
	initialMessage: string;
	tools: WorkerTool[];
	contextLimit: number;
	maxTurns?: number;
	onFinished: (result: { text: string; forkId: string; agentId: string }) => void;
	onError: (error: { error: string; forkId: string; agentId: string }) => void;
}

interface QueuedMessage {
	text: string;
}

function estimateTokens(messages: Message[]): number {
	let chars = 0;
	for (const msg of messages) {
		if (typeof msg.content === "string") {
			chars += msg.content.length;
		} else if (Array.isArray(msg.content)) {
			for (const part of msg.content) {
				if (typeof part === "object" && part !== null && "text" in part) {
					chars += String((part as { text: string }).text).length;
				}
			}
		}
	}
	return Math.ceil(chars / 4);
}

export class WorkerSession {
	private readonly config: WorkerSessionConfig;
	private readonly conversation: Message[] = [];
	private readonly messageQueue: QueuedMessage[] = [];
	private readonly errorGuard = new ErrorRepeatGuard({ threshold: 3 });
	private abortController: AbortController | undefined;
	private running = false;

	constructor(config: WorkerSessionConfig) {
		this.config = config;
		this.conversation.push({
			role: "user",
			content: config.initialMessage,
			timestamp: Date.now(),
		} as Message);
	}

	deliverMessage(text: string): void {
		this.messageQueue.push({ text });
	}

	kill(): void {
		this.abortController?.abort();
		this.running = false;
	}

	async start(): Promise<void> {
		this.running = true;
		const maxTurns = this.config.maxTurns ?? 15;

		for (let turn = 0; turn < maxTurns && this.running; turn++) {
			if (this.abortController?.signal.aborted) {
				this.config.onError({ error: "Worker killed", forkId: this.config.forkId, agentId: this.config.agentId });
				return;
			}

			while (this.messageQueue.length > 0 && this.running) {
				const msg = this.messageQueue.shift()!;
				this.conversation.push({
					role: "user",
					content: msg.text,
					timestamp: Date.now(),
				} as Message);
			}

			await this.checkContextCompaction();

			this.abortController = new AbortController();
			const result = await this.runTurn();
			if (!result) continue;

			if (result.finished) {
				this.config.onFinished({
					text: result.text,
					forkId: this.config.forkId,
					agentId: this.config.agentId,
				});
				this.running = false;
				return;
			}
		}

		if (this.running) {
			this.config.onFinished({
				text: "",
				forkId: this.config.forkId,
				agentId: this.config.agentId,
			});
			this.running = false;
		}
	}

	private async runTurn(): Promise<{ finished: boolean; text: string } | null> {
		const context: Context = {
			systemPrompt: this.config.systemPrompt,
			messages: this.conversation,
			tools: this.config.tools.map((t) => ({
				name: t.name,
				description: "",
				parameters: t.parameters,
			})),
		};

		let assistantMessage: AssistantMessage | undefined;
		try {
			const stream = streamSimple(this.config.model, context, { signal: this.abortController?.signal });
			assistantMessage = await stream.result();
		} catch (err) {
			this.config.onError({
				error: `Worker LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
				forkId: this.config.forkId,
				agentId: this.config.agentId,
			});
			this.running = false;
			return null;
		}

		if (!assistantMessage) return null;

		const textParts: string[] = [];
		const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];

		for (const content of assistantMessage.content) {
			if (content.type === "text") {
				textParts.push((content as { text: string }).text);
			} else if (content.type === "toolCall") {
				const tc = content as { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> };
				toolCalls.push({ id: tc.id, name: tc.name, args: tc.arguments });
			}
		}

		this.conversation.push(assistantMessage as Message);

		if (toolCalls.length === 0) {
			return { finished: true, text: textParts.join("\n") };
		}

		for (const toolCall of toolCalls) {
			const tool = this.config.tools.find((t) => t.name === toolCall.name);
			if (!tool) {
				this.conversation.push({
					role: "toolResult",
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					content: [{ type: "text", text: `Error: Tool "${toolCall.name}" is not available to this worker` }],
					isError: true,
					timestamp: Date.now(),
				} as Message);
				continue;
			}

			let result: unknown;
			let isError = false;
			try {
				result = await tool.execute(toolCall.id, toolCall.args, this.abortController?.signal);
			} catch (err) {
				result = `Error: ${err instanceof Error ? err.message : String(err)}`;
				isError = true;
			}

			if (isError && typeof result === "string") {
				const guardResult = this.errorGuard.recordError(toolCall.name, toolCall.args, result);
				if (guardResult.shouldStop) {
					this.conversation.push({
						role: "toolResult",
						toolCallId: toolCall.id,
						toolName: toolCall.name,
						content: [
							{
								type: "text",
								text: `[${toolCall.name}] Same tool call failed ${guardResult.repeatCount} times. Stop retrying.`,
							},
						],
						isError: true,
						timestamp: Date.now(),
					} as Message);
					return { finished: true, text: "" };
				}
			}

			const resultText = typeof result === "string" ? result : JSON.stringify(result, null, 2);
			this.conversation.push({
				role: "toolResult",
				toolCallId: toolCall.id,
				toolName: toolCall.name,
				content: [{ type: "text", text: resultText }],
				isError,
				timestamp: Date.now(),
			} as Message);
		}

		return { finished: false, text: textParts.join("\n") };
	}

	private async checkContextCompaction(): Promise<void> {
		const tokens = estimateTokens(this.conversation);
		const threshold = this.config.contextLimit * 0.8;
		if (tokens < threshold) return;

		const systemPromptMsg = this.conversation[0];
		const recent = this.conversation.slice(-6);
		this.conversation.length = 0;
		if (systemPromptMsg) this.conversation.push(systemPromptMsg);
		this.conversation.push({
			role: "user",
			content: "[Context compacted: earlier messages removed. Use scratchpad-load to retrieve saved findings.]",
			timestamp: Date.now(),
		} as Message);
		this.conversation.push(...recent);
	}
}
