/**
 * Fork-Worker Runtime Adapter - Phase 0.
 *
 * Runtime adapter that publishes agent_created, agent_finished, task, and goal
 * events via the SessionOrchestrator's publishRuntimeEvent. This replaces
 * the shared throw-stub in role-control-tool.ts with actual event publishing.
 *
 * Mirrors Magnitude's fork-worker runtime: each role tool call publishes
 * the appropriate event-core event, which projections and roles react to.
 * Role model selection uses AgentModelResolver for tier-based routing.
 */

import { randomUUID } from "node:crypto";
import { SPAWNABLE_ROLES } from "@earendil-works/pi-event-core";

export type PublishFn = (type: string, payload: Record<string, unknown>) => Promise<void>;

export interface ForkRuntimeOptions {
	/** The session ID (used as the parent fork ID). */
	sessionId: string;
	/** The publish function from SessionOrchestrator. */
	publish: PublishFn;
	/** Current session sequence (for event ordering). */
	getSequence: () => number;
	/** Optional model resolver for role-based model selection when spawning workers. */
	resolveModel?: (role: string) => { provider: string; id: string } | undefined;
}

export interface SpawnWorkerInput {
	role: string;
	message?: string;
	taskId?: string;
	context?: string;
}

export interface MessageWorkerInput {
	workerId: string;
	message: string;
}

export interface KillWorkerInput {
	workerId: string;
	reason?: string;
}

export interface CreateTaskInput {
	title: string;
	parentId?: string;
	assignee?: string;
}

export interface UpdateTaskInput {
	taskId: string;
	status: "pending" | "working" | "completed" | "cancelled";
}

export interface FinishGoalInput {
	goalText?: string;
	evidence?: string;
}

export interface PassInput {
	message?: string;
}

export interface EscalateInput {
	justification: string;
	message?: string;
}

export interface ReassignWorkerInput {
	taskId: string;
	workerId: string;
}

export interface MessageAdvisorInput {
	message: string;
}

/**
 * Fork-worker runtime adapter.
 *
 * Each method corresponds to one of the 10 role tools and publishes
 * the appropriate event-core event via the orchestrator's publish function.
 */
export class ForkRuntime {
	private readonly sessionId: string;
	private readonly publish: PublishFn;
	private readonly getSequence: () => number;
	private readonly resolveModel?: (role: string) => { provider: string; id: string } | undefined;

	constructor(options: ForkRuntimeOptions) {
		this.sessionId = options.sessionId;
		this.publish = options.publish;
		this.getSequence = options.getSequence;
		this.resolveModel = options.resolveModel;
	}

	/**
	 * Spawn a worker agent. Publishes an `agent_created` event.
	 * The role must be spawnable (in SPAWNABLE_ROLES).
	 */
	async spawnWorker(input: SpawnWorkerInput): Promise<{ forkId: string; agentId: string }> {
		if (!SPAWNABLE_ROLES.has(input.role)) {
			throw new Error(`Role "${input.role}" is not spawnable. Spawnable roles: ${[...SPAWNABLE_ROLES].join(", ")}`);
		}
		const forkId = randomUUID();
		const agentId = randomUUID();
		const model = this.resolveModel?.(input.role);
		await this.publish("agent_created", {
			forkId,
			parentForkId: this.sessionId,
			agentId,
			name: input.role,
			role: input.role,
			context: input.context ?? input.message ?? "",
			mode: "spawn",
			taskId: input.taskId,
			message: input.message,
			model: model ? { provider: model.provider, id: model.id } : undefined,
		});
		return { forkId, agentId };
	}

	/**
	 * Send a message to a worker. Publishes a `worker_messaged` event.
	 */
	async messageWorker(input: MessageWorkerInput): Promise<void> {
		await this.publish("worker_messaged", {
			workerId: input.workerId,
			message: input.message,
			sessionId: this.sessionId,
		});
	}

	/**
	 * Kill a worker. Publishes an `agent_finished` event with killed status.
	 */
	async killWorker(input: KillWorkerInput): Promise<void> {
		await this.publish("agent_finished", {
			agentId: input.workerId,
			forkId: input.workerId,
			willRetry: false,
			killed: true,
			reason: input.reason ?? "killed by leader",
		});
	}

	/**
	 * Create a task in the task graph. Publishes a `task.created` event.
	 */
	async createTask(input: CreateTaskInput): Promise<{ taskId: string }> {
		const taskId = randomUUID();
		await this.publish("task.created", {
			taskId,
			title: input.title,
			parentId: input.parentId ?? null,
			assignee: input.assignee ?? null,
		});
		return { taskId };
	}

	/**
	 * Update a task's status. Publishes a `task.status_changed` event.
	 */
	async updateTask(input: UpdateTaskInput): Promise<void> {
		await this.publish("task.status_changed", {
			taskId: input.taskId,
			status: input.status,
		});
	}

	/**
	 * Mark the current goal as finished. Publishes a `goal.finished` event.
	 */
	async finishGoal(input: FinishGoalInput): Promise<void> {
		await this.publish("goal.finished", {
			goalText: input.goalText,
			evidence: input.evidence,
		});
	}

	/**
	 * Pass the turn (no action needed). Publishes a `turn_passed` event.
	 */
	async pass(input: PassInput): Promise<void> {
		await this.publish("turn_passed", {
			message: input.message ?? "pass",
			sessionId: this.sessionId,
		});
	}

	/**
	 * Escalate to the observer/advisor. Publishes an `escalation_requested` event.
	 */
	async escalate(input: EscalateInput): Promise<void> {
		await this.publish("escalation_requested", {
			justification: input.justification,
			message: input.message,
			sessionId: this.sessionId,
		});
	}

	/**
	 * Reassign a task to a different worker. Publishes a `task.assigned` event.
	 */
	async reassignWorker(input: ReassignWorkerInput): Promise<void> {
		await this.publish("task.assigned", {
			taskId: input.taskId,
			assignee: input.workerId,
		});
	}

	/**
	 * Send a message to the advisor. Publishes an `advisor_messaged` event.
	 */
	async messageAdvisor(input: MessageAdvisorInput): Promise<void> {
		await this.publish("advisor_messaged", {
			message: input.message,
			sessionId: this.sessionId,
		});
	}
}
