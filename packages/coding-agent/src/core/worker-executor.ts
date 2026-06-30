/**
 * WorkerExecutor — connects ForkRuntime.spawnWorker() (which publishes agent_created)
 * to an actual LLM agent loop.
 *
 * Registered as a role on the event sink. Reacts to:
 * - agent_created: spawns a WorkerSession
 * - worker_messaged: delivers a message to the worker
 * - agent_finished (killed): kills and cleans up the worker
 *
 * Uses concurrencyKey per fork to prevent races.
 */

import type { Model } from "@earendil-works/pi-ai";
import type { EventEnvelope, RoleDefinition } from "@earendil-works/pi-event-core";
import { DetachedProcessRegistry } from "./detached-process-registry.ts";
import { buildWorkerContext } from "./worker-context-builder.ts";
import { WorkerSession, type WorkerTool } from "./worker-session.ts";
import { filterToolsForRole } from "./worker-tools.ts";

type RuntimeEvent = EventEnvelope<string, Record<string, unknown>>;

export interface WorkerExecutorOptions {
	resolveModel: (role: string) => Model<string> | undefined;
	getSystemPrompt: (role: string) => string;
	getAllTools: () => WorkerTool[];
	getProjectContext: () => string;
	onWorkerFinished: (result: { text: string; forkId: string; agentId: string; role: string }) => void;
	onWorkerError: (error: { error: string; forkId: string; agentId: string }) => void;
}

export class WorkerExecutor {
	private readonly workers = new Map<string, WorkerSession>();
	private readonly forkWorkers = new Map<string, Set<string>>();
	private readonly detachedRegistry = new DetachedProcessRegistry();
	private readonly options: WorkerExecutorOptions;

	constructor(options: WorkerExecutorOptions) {
		this.options = options;
	}

	asRole(): RoleDefinition<RuntimeEvent> {
		return {
			name: "WorkerExecutor",
			match: (event) =>
				event.type === "agent_created" ||
				event.type === "worker_messaged" ||
				(event.type === "agent_finished" && Boolean(event.payload.killed)),
			concurrencyKey: (event) => String(event.payload.forkId ?? event.payload.workerId ?? event.id),
			run: async (ctx) => {
				if (ctx.event.type === "agent_created") {
					await this.onAgentCreated(ctx.event);
				} else if (ctx.event.type === "worker_messaged") {
					await this.onWorkerMessaged(ctx.event);
				} else if (ctx.event.type === "agent_finished" && ctx.event.payload.killed) {
					await this.onWorkerKilled(ctx.event);
				}
			},
		};
	}

	private async onAgentCreated(event: RuntimeEvent): Promise<void> {
		const payload = event.payload as {
			forkId: string;
			agentId: string;
			role: string;
			context?: string;
			message?: string;
		};

		const { forkId, agentId, role } = payload;
		const model = this.options.resolveModel(role);
		if (!model) {
			this.options.onWorkerError({ error: `No model resolved for role: ${role}`, forkId, agentId });
			return;
		}

		const systemPrompt = this.options.getSystemPrompt(role);
		const allTools = this.options.getAllTools();
		const filteredTools = filterToolsForRole(role, allTools);
		const projectContext = this.options.getProjectContext();
		const context = buildWorkerContext({
			sessionStart: payload.message ?? payload.context ?? "",
			projectContext,
			transcript: "",
		});

		const session = new WorkerSession({
			forkId,
			agentId,
			role,
			model,
			systemPrompt: `${systemPrompt}\n\n${context}`,
			initialMessage: payload.message ?? payload.context ?? "",
			tools: filteredTools,
			contextLimit: model.contextWindow ?? 128000,
			onFinished: (result) => {
				this.cleanupWorker(forkId, agentId);
				this.options.onWorkerFinished({ ...result, role });
			},
			onError: (error) => {
				this.cleanupWorker(forkId, agentId);
				this.options.onWorkerError(error);
			},
		});

		this.workers.set(agentId, session);
		let forkSet = this.forkWorkers.get(forkId);
		if (!forkSet) {
			forkSet = new Set();
			this.forkWorkers.set(forkId, forkSet);
		}
		forkSet.add(agentId);

		void session.start().catch((err) => {
			this.cleanupWorker(forkId, agentId);
			this.options.onWorkerError({
				error: `Worker session crashed: ${err instanceof Error ? err.message : String(err)}`,
				forkId,
				agentId,
			});
		});
	}

	private async onWorkerMessaged(event: RuntimeEvent): Promise<void> {
		const payload = event.payload as { workerId: string; message: string };
		const session = this.workers.get(payload.workerId);
		if (session) {
			session.deliverMessage(payload.message);
		}
	}

	private async onWorkerKilled(event: RuntimeEvent): Promise<void> {
		const payload = event.payload as { agentId: string; forkId: string };
		const session = this.workers.get(payload.agentId);
		if (session) {
			session.kill();
		}
		this.detachedRegistry.killAll(payload.forkId);
		this.cleanupWorker(payload.forkId, payload.agentId);
	}

	private cleanupWorker(forkId: string, agentId: string): void {
		this.workers.delete(agentId);
		this.forkWorkers.get(forkId)?.delete(agentId);
	}

	dispose(): void {
		for (const [, session] of this.workers) {
			session.kill();
		}
		this.workers.clear();
		this.detachedRegistry.dispose();
		this.forkWorkers.clear();
	}
}
