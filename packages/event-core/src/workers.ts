import { COMPACT_MAX_FILE_CHARS, COMPACT_MAX_FILES, COMPACTION_MAX_RETRIES } from "./constants.ts";
import type { EventEnvelope, RoleDefinition } from "./types.ts";

type RuntimeEvent = EventEnvelope<string, Record<string, unknown>>;

function createEvent(base: RuntimeEvent, type: string, payload: Record<string, unknown>): RuntimeEvent {
	return {
		id: `${base.id}:${type}:${Date.now()}`,
		stream: base.stream,
		sequence: base.sequence + 1,
		type,
		timestamp: new Date().toISOString(),
		sessionId: base.sessionId,
		source: "event-core-worker",
		payload,
	};
}

export function createCortexWorker<TEvent extends RuntimeEvent = RuntimeEvent>(): RoleDefinition<TEvent> {
	return {
		name: "CortexWorker",
		match: (event) => event.type === "user_message_ready",
		run: async ({ event, publish }) => {
			await publish(
				createEvent(event, "turn_started", {
					turnId: event.id,
					chainId: event.sessionId ?? event.stream,
				}) as TEvent,
			);
		},
	};
}

export function createChatTitleWorker<TEvent extends RuntimeEvent = RuntimeEvent>(): RoleDefinition<TEvent> {
	return {
		name: "ChatTitleWorker",
		match: (event) => event.type === "turn_outcome" && event.payload.firstTurn === true,
		run: async ({ event, publish }) => {
			await publish(
				createEvent(event, "chat_title_generated", { title: String(event.payload.title ?? "New chat") }) as TEvent,
			);
		},
	};
}

export function createCompactionWorker<TEvent extends RuntimeEvent = RuntimeEvent>(): RoleDefinition<TEvent> {
	return {
		name: "CompactionWorker",
		listenSignals: ["ContextUsage/softCapExceeded"],
		run: async ({ event, publish }) => {
			await publish(
				createEvent(event, "compaction_started", {
					reason: "threshold",
					maxFiles: COMPACT_MAX_FILES,
					maxFileChars: COMPACT_MAX_FILE_CHARS,
					maxRetries: COMPACTION_MAX_RETRIES,
				}) as TEvent,
			);
		},
	};
}

export function createFileMentionResolverWorker<TEvent extends RuntimeEvent = RuntimeEvent>(): RoleDefinition<TEvent> {
	return {
		name: "FileMentionResolver",
		match: (event) => event.type === "user_message",
		run: async ({ event, publish }) => {
			const text = String(event.payload.text ?? "");
			const resolvedMentions = Array.from(text.matchAll(/@([^\s]+)/g)).map((match) => match[1]);
			await publish(createEvent(event, "user_message_ready", { ...event.payload, resolvedMentions }) as TEvent);
		},
	};
}

export function createProcessMetricsWorker<TEvent extends RuntimeEvent = RuntimeEvent>(): RoleDefinition<TEvent> {
	return {
		name: "ProcessMetricsWorker",
		match: (event) => event.type === "shell_process_ended",
		run: async ({ event, publish }) => {
			await publish(
				createEvent(event, "process_metrics_recorded", {
					processId: event.payload.processId ?? event.payload.toolCallId,
					durationMs: event.payload.durationMs ?? 0,
					exitCode: event.payload.exitCode ?? null,
					outputSize: event.payload.outputSize ?? 0,
					status: event.payload.status ?? "ended",
				}) as TEvent,
			);
		},
	};
}

export function createShellProcessWorker<TEvent extends RuntimeEvent = RuntimeEvent>(): RoleDefinition<TEvent> {
	return {
		name: "ShellProcessWorker",
		match: (event) => event.type === "shell_command_start",
		run: async ({ event, publish }) => {
			await publish(
				createEvent(event, "shell_process_started", {
					...event.payload,
					processId: event.payload.processId ?? event.id,
				}) as TEvent,
			);
		},
	};
}

export function createMemoryExtractionWorker<TEvent extends RuntimeEvent = RuntimeEvent>(): RoleDefinition<TEvent> {
	return {
		name: "MemoryExtractionWorker",
		match: (event) => event.type === "turn_outcome" && event.payload.sessionEnd === true,
		run: async ({ event, publish }) => {
			await publish(
				createEvent(event, "memory_extraction_started", {
					jobId: `memory-${event.id}`,
					sessionId: event.sessionId,
					cwd: event.payload.cwd,
					eventsPath: event.payload.eventsPath,
					memoryPath: event.payload.memoryPath,
					createdAt: new Date().toISOString(),
					attempts: 0,
					status: "pending",
				}) as TEvent,
			);
			// Memory extraction completion event closes the lifecycle
			await publish(
				createEvent(event, "memory_extraction_completed", {
					jobId: `memory-${event.id}`,
					sessionId: event.sessionId,
					status: "completed",
					completedAt: new Date().toISOString(),
				}) as TEvent,
			);
		},
	};
}

export function createGoalWorker<TEvent extends RuntimeEvent = RuntimeEvent>(): RoleDefinition<TEvent> {
	return {
		name: "GoalProjectionWorker",
		match: (event, projections) => {
			if (event.type !== "turn_outcome") {
				return false;
			}
			const goal = projections.get<{ status?: string }>("Goal");
			if (goal?.status !== "started") {
				return false;
			}
			return (
				event.payload.goalStatus === "finished" ||
				event.payload.goalStatus === "incomplete" ||
				event.payload.result === "finished" ||
				event.payload.result === "completed" ||
				event.payload.result === "success" ||
				event.payload.result === "incomplete" ||
				event.payload.result === "failed" ||
				event.payload.result === "error"
			);
		},
		run: async ({ event, publish }) => {
			const status =
				event.payload.goalStatus === "incomplete" ||
				event.payload.result === "incomplete" ||
				event.payload.result === "failed" ||
				event.payload.result === "error"
					? "incomplete"
					: "finished";
			await publish(
				createEvent(event, status === "finished" ? "goal.finished" : "goal.incomplete", {
					turnId: event.payload.turnId,
				}) as TEvent,
			);
		},
	};
}

export function createDisplayWorker<TEvent extends RuntimeEvent = RuntimeEvent>(): RoleDefinition<TEvent> {
	return {
		name: "DisplayProjectionWorker",
		match: (event) => event.type === "message_chunk" || event.type === "thinking_chunk",
		run: ({ event, emitSignal }) => {
			emitSignal({
				type: "Display/updated",
				payload: {
					sourceEventId: event.id,
					chunkType: event.type,
					text: event.payload.text ?? event.payload.delta ?? "",
				},
			});
		},
	};
}

export function createBuiltinWorkers<TEvent extends RuntimeEvent = RuntimeEvent>(): Array<RoleDefinition<TEvent>> {
	return [
		createCortexWorker<TEvent>(),
		createChatTitleWorker<TEvent>(),
		createCompactionWorker<TEvent>(),
		createFileMentionResolverWorker<TEvent>(),
		createProcessMetricsWorker<TEvent>(),
		createShellProcessWorker<TEvent>(),
		createMemoryExtractionWorker<TEvent>(),
		createGoalWorker<TEvent>(),
		createDisplayWorker<TEvent>(),
	];
}
