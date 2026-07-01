/**
 * WorkerSession - runs an LLM agent loop for a forked worker.
 *
 * Adapts the subagent runtime pattern but makes it event-sourced and async:
 * - Runs in the background (non-blocking)
 * - Has a message inbox for messageWorker communication
 * - Publishes events to the fork's event stream
 * - Uses streamSimple with lightweight retry and tool-result event publishing
 * - Lightweight compaction between turns (no LLM summaries)
 */

import type { AgentToolResult, AgentToolUpdateCallback } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { AssistantMessage, Context, Message } from "@earendil-works/pi-ai/compat";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import type { TSchema } from "typebox";
import { ErrorRepeatGuard } from "./error-repeat-guard.ts";
import { evaluatePermission, type PermissionRule } from "./permissions/permission-gate.ts";

export interface WorkerTool {
	name: string;
	description: string;
	parameters: TSchema;
	execute: (
		id: string,
		args: unknown,
		signal: AbortSignal | undefined,
		onUpdate?: AgentToolUpdateCallback<unknown>,
	) => Promise<AgentToolResult<unknown>>;
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
	userRules?: PermissionRule[];
	publishEvent?: (type: string, payload: Record<string, unknown>) => Promise<void> | void;
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
	private readonly initialTask: Message;
	private abortController: AbortController | undefined;
	private running = false;

	constructor(config: WorkerSessionConfig) {
		this.config = config;
		this.initialTask = {
			role: "user",
			content: config.initialMessage,
			timestamp: Date.now(),
		} as Message;
		this.conversation.push(this.initialTask);
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
			const partialText = this.lastAssistantText() ?? "[Worker reached maximum turns without finishing]";
			this.config.onFinished({
				text: partialText,
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
				description: t.description,
				parameters: t.parameters,
			})),
		};

		const assistantMessage = await this.runModelWithRetry(context);

		if (!assistantMessage) return null;
		if (assistantMessage.stopReason === "error" || assistantMessage.stopReason === "aborted") {
			this.config.onError({
				error: `Worker LLM ${assistantMessage.stopReason}: ${assistantMessage.errorMessage ?? "unknown"}`,
				forkId: this.config.forkId,
				agentId: this.config.agentId,
			});
			this.running = false;
			return null;
		}

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
		await this.publishEvent("message_end", {
			messageRole: "assistant",
			text: textParts.join("\n"),
			stopReason: assistantMessage.stopReason,
		});

		if (toolCalls.length === 0) {
			return { finished: true, text: textParts.join("\n") };
		}

		for (const toolCall of toolCalls) {
			const tool = this.config.tools.find((t) => t.name === toolCall.name);
			await this.publishEvent("tool_event", {
				toolCallId: toolCall.id,
				toolName: toolCall.name,
				args: toolCall.args,
				status: "started",
			});
			if (!tool) {
				const resultText = `Error: Tool "${toolCall.name}" is not available to this worker`;
				this.conversation.push({
					role: "toolResult",
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					content: [{ type: "text", text: resultText }],
					isError: true,
					timestamp: Date.now(),
				} as Message);
				await this.publishEvent("message_end", {
					messageRole: "toolResult",
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					text: resultText,
					isError: true,
				});
				await this.publishEvent("tool_event", {
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					result: resultText,
					status: "error",
				});
				continue;
			}

			const permissionDecision = evaluatePermission(toolCall.name, toolCall.args, {
				interactive: false,
				context: "subagent",
				knownTools: this.config.tools.map((t) => t.name),
				userRules: this.config.userRules ?? [],
			});
			if (!permissionDecision.permitted) {
				const resultText = `Permission denied: ${permissionDecision.reason ?? `Tool ${toolCall.name} is not permitted in worker context`}`;
				this.conversation.push({
					role: "toolResult",
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					content: [{ type: "text", text: resultText }],
					isError: true,
					timestamp: Date.now(),
				} as Message);
				await this.publishEvent("message_end", {
					messageRole: "toolResult",
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					text: resultText,
					isError: true,
				});
				await this.publishEvent("tool_event", {
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					result: resultText,
					status: "error",
				});
				continue;
			}

			let result: AgentToolResult<unknown>;
			let isError = false;
			try {
				result = await tool.execute(toolCall.id, toolCall.args, this.abortController?.signal, (partialResult) => {
					const text = extractToolResultText(partialResult);
					void this.publishEvent("tool_event", {
						toolCallId: toolCall.id,
						toolName: toolCall.name,
						result: text,
						status: "updated",
					}).catch(() => {});
				});
			} catch (err) {
				result = {
					content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
					details: { error: true },
				};
				isError = true;
			}

			const resultText = extractToolResultText(result);
			if (isError) {
				const guardResult = this.errorGuard.recordError(toolCall.name, toolCall.args, resultText);
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

			this.conversation.push({
				role: "toolResult",
				toolCallId: toolCall.id,
				toolName: toolCall.name,
				content: [{ type: "text", text: resultText }],
				isError,
				timestamp: Date.now(),
			} as Message);
			await this.publishEvent("message_end", {
				messageRole: "toolResult",
				toolCallId: toolCall.id,
				toolName: toolCall.name,
				text: resultText,
				isError,
			});
			await this.publishEvent("tool_event", {
				toolCallId: toolCall.id,
				toolName: toolCall.name,
				result: resultText,
				status: isError ? "error" : "completed",
			});
		}

		return { finished: false, text: textParts.join("\n") };
	}

	private async runModelWithRetry(context: Context): Promise<AssistantMessage | undefined> {
		for (let attempt = 0; attempt < 3; attempt++) {
			if (this.abortController?.signal.aborted) return undefined;
			try {
				const stream = streamSimple(this.config.model, context, { signal: this.abortController?.signal });
				return await stream.result();
			} catch (err) {
				if (attempt < 2 && isTransientError(err)) {
					await sleep(Math.min(1000 * 2 ** attempt, 8000), this.abortController?.signal);
					if (this.abortController?.signal.aborted) return undefined;
					continue;
				}
				this.config.onError({
					error: `Worker LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
					forkId: this.config.forkId,
					agentId: this.config.agentId,
				});
				this.running = false;
				return undefined;
			}
		}
		return undefined;
	}

	private async checkContextCompaction(): Promise<void> {
		const tokens = estimateTokens(this.conversation);
		const threshold = this.config.contextLimit * 0.8;
		if (tokens < threshold) return;

		let keepFromIndex = Math.max(0, this.conversation.length - 5);
		while (keepFromIndex > 0 && this.conversation[keepFromIndex]?.role === "toolResult") {
			keepFromIndex--;
		}
		const recent = this.conversation.slice(keepFromIndex);
		this.conversation.length = 0;
		this.conversation.push(this.initialTask);
		this.conversation.push({
			role: "user",
			content: "[Context compacted: earlier messages removed. Use scratchpad_load to retrieve saved findings.]",
			timestamp: Date.now(),
		} as Message);
		this.conversation.push(...recent);
	}

	private async publishEvent(type: string, payload: Record<string, unknown>): Promise<void> {
		await this.config.publishEvent?.(type, payload);
	}

	private lastAssistantText(): string | undefined {
		for (let i = this.conversation.length - 1; i >= 0; i--) {
			const message = this.conversation[i];
			if (message?.role !== "assistant") continue;
			const text = textFromContent(message.content);
			if (text) return text;
		}
		return undefined;
	}
}

function extractToolResultText(result: AgentToolResult<unknown>): string {
	const text = result.content
		.map((part) => (part.type === "text" ? part.text : ""))
		.filter(Boolean)
		.join("\n");
	if (text) return text;
	const fallback = JSON.stringify(result.details ?? result, null, 2);
	return fallback.length > 2000 ? `${fallback.slice(0, 2000)}\n... [truncated]` : fallback;
}

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.map((part) =>
			typeof part === "object" && part !== null && "type" in part && part.type === "text" && "text" in part
				? String(part.text)
				: "",
		)
		.filter(Boolean)
		.join("\n")
		.trim();
}

function isTransientError(err: unknown): boolean {
	const message = err instanceof Error ? err.message : String(err);
	return /429|500|502|503|504|timeout|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|socket hang up|fetch failed|UND_ERR_SOCKET|rate limit/i.test(
		message,
	);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const onAbort = () => {
			clearTimeout(timer);
			resolve();
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
