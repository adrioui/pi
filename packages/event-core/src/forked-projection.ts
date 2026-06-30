/**
 * Forked Projection Store — per-worker projection scoping for safe parallel execution.
 *
 * Global projections see ALL events. Forked projections see only their fork's events.
 * `forkId` is extracted from `event.payload` (NOT from EventEnvelope which has no forkId field):
 * `payload.forkId ?? payload.workerId`.
 *
 * Events without forkId are treated as main fork (leader): applied to both global store and main fork store.
 * Events with forkId are applied to both global store and the specific fork store.
 *
 * `forFork(forkId)` clones forkedProjectionDefs into each new fork store.
 * Without this cloning, `apply()` would be a no-op because the fork store has no registered definitions.
 */

import { ProjectionStore } from "./projection.ts";
import type { EventEnvelope, ProjectionDefinition, ProjectionSnapshot, ProjectionView, Signal } from "./types.ts";

const MAIN_FORK = "__main__";

function extractForkId(event: EventEnvelope): string {
	const payload = event.payload as Record<string, unknown> | null;
	if (!payload) return MAIN_FORK;
	const forkId = payload.forkId ?? payload.workerId;
	return typeof forkId === "string" ? forkId : MAIN_FORK;
}

export class ForkedProjectionStore<TEvent extends EventEnvelope = EventEnvelope> implements ProjectionView<TEvent> {
	private readonly globalStore: ProjectionStore<TEvent>;
	private readonly forkStores = new Map<string, ProjectionStore<TEvent>>();
	private readonly forkedProjectionDefs: ProjectionDefinition<TEvent, unknown>[] = [];

	constructor() {
		this.globalStore = new ProjectionStore<TEvent>();
	}

	register<TState>(definition: ProjectionDefinition<TEvent, TState>): void {
		this.globalStore.register(definition);
	}

	registerGlobal<TState>(definition: ProjectionDefinition<TEvent, TState>): void {
		this.globalStore.register(definition);
	}

	registerForked<TState>(definition: ProjectionDefinition<TEvent, TState>): void {
		this.forkedProjectionDefs.push(definition as ProjectionDefinition<TEvent, unknown>);
		for (const store of this.forkStores.values()) {
			store.register(definition);
		}
	}

	forFork(forkId: string): ProjectionStore<TEvent> {
		let store = this.forkStores.get(forkId);
		if (!store) {
			store = new ProjectionStore<TEvent>();
			for (const def of this.forkedProjectionDefs) {
				store.register(def);
			}
			this.forkStores.set(forkId, store);
		}
		return store;
	}

	apply(event: TEvent): Signal[] {
		const signals = this.globalStore.apply(event);
		const forkId = extractForkId(event);
		const forkStore = this.forFork(forkId);
		forkStore.apply(event);
		return signals;
	}

	replay(events: readonly TEvent[]): void {
		this.globalStore.replay(events);
		for (const [forkId, store] of this.forkStores) {
			const forkEvents = events.filter((e) => extractForkId(e) === forkId);
			store.replay(forkEvents);
		}
	}

	getForkView(forkId: string): ProjectionView<TEvent> {
		const store = this.forFork(forkId);
		return {
			get: <TState>(name: string): TState | undefined => store.get<TState>(name),
			getLastSequence: (name: string): number | undefined => store.getLastSequence(name),
			snapshots: (): ProjectionSnapshot[] => store.snapshots(),
		};
	}

	get<TState>(name: string): TState | undefined {
		return this.globalStore.get<TState>(name);
	}

	getLastSequence(name: string): number | undefined {
		return this.globalStore.getLastSequence(name);
	}

	snapshots(): ProjectionSnapshot[] {
		return this.globalStore.snapshots();
	}
}
