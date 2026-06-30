import { randomUUID } from "node:crypto";
import type { EventEnvelope } from "./types.ts";

export type ForkMode = "spawn" | "resume" | "continue";

export interface AgentCreatedPayload {
	forkId: string;
	parentForkId: string | null;
	agentId: string;
	name: string;
	role: string;
	context: string;
	mode: ForkMode;
	taskId?: string;
	message?: string;
}

export interface ForkRecord extends AgentCreatedPayload {
	status: "running" | "finished" | "killed";
	createdAt: string;
	finishedAt?: string;
}

export interface ForkContextInput {
	sessionStart?: string;
	projectContext?: string;
	transcript?: string;
}

export function buildForkContext(input: ForkContextInput): string {
	return [
		"<session-start>",
		input.sessionStart ?? "",
		"</session-start>",
		"<project-context>",
		input.projectContext ?? "",
		"</project-context>",
		"<transcript>",
		input.transcript ?? "",
		"</transcript>",
	].join("\n");
}

export function createAgentCreatedEvent(
	base: Pick<EventEnvelope, "stream" | "sequence" | "sessionId">,
	payload: Omit<Partial<AgentCreatedPayload>, "context"> & { role: string; context: string },
): EventEnvelope<"agent_created", AgentCreatedPayload> {
	const forkId = payload.forkId ?? randomUUID();
	return {
		id: randomUUID(),
		stream: `${base.stream}:fork:${forkId}`,
		sequence: base.sequence + 1,
		type: "agent_created",
		timestamp: new Date().toISOString(),
		sessionId: base.sessionId,
		payload: {
			forkId,
			parentForkId: payload.parentForkId ?? null,
			agentId: payload.agentId ?? randomUUID(),
			name: payload.name ?? payload.role,
			role: payload.role,
			context: payload.context,
			mode: payload.mode ?? "spawn",
			taskId: payload.taskId,
			message: payload.message,
		},
	};
}

export class ForkRegistry {
	private readonly forks = new Map<string, ForkRecord>();

	spawn(payload: AgentCreatedPayload): ForkRecord {
		const record: ForkRecord = { ...payload, status: "running", createdAt: new Date().toISOString() };
		this.forks.set(payload.forkId, record);
		return record;
	}

	finish(forkId: string): ForkRecord | undefined {
		const current = this.forks.get(forkId);
		if (!current) return undefined;
		const next: ForkRecord = { ...current, status: "finished", finishedAt: new Date().toISOString() };
		this.forks.set(forkId, next);
		return next;
	}

	kill(forkId: string): ForkRecord | undefined {
		const current = this.forks.get(forkId);
		if (!current) return undefined;
		const next: ForkRecord = { ...current, status: "killed", finishedAt: new Date().toISOString() };
		this.forks.set(forkId, next);
		return next;
	}

	lineage(forkId: string): ForkRecord[] {
		const lineage: ForkRecord[] = [];
		let current = this.forks.get(forkId);
		while (current) {
			lineage.unshift(current);
			current = current.parentForkId ? this.forks.get(current.parentForkId) : undefined;
		}
		return lineage;
	}

	list(): ForkRecord[] {
		return Array.from(this.forks.values());
	}
}
