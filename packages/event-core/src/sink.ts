import { ProjectionStore } from "./projection.ts";
import { InMemorySignalBus, RoleHost } from "./role.ts";
import type {
	EventEnvelope,
	EventSink,
	EventStore,
	ProjectionDefinition,
	ProjectionView,
	RoleDefinition,
} from "./types.ts";

export interface DefaultEventSinkOptions<TEvent extends EventEnvelope = EventEnvelope> {
	onEventApplied?: (event: TEvent) => void;
	/** Optional projection store override. If not provided, a default ProjectionStore is created. */
	projectionStore?: ProjectionStore<TEvent>;
}

/**
 * Default EventSink implementation.
 *
 * Implements Magnitude's two-phase processing:
 * - Phase 1 (synchronous): Persist event → apply projections → extract signals
 * - Phase 2 (asynchronous): Dispatch signals → run matching roles
 *
 * On startup, call `replay()` with the event log to hydrate projection state
 * from the persisted event store. This makes projections the authoritative
 * source of truth — the entire session state can be reconstructed from the
 * event log alone.
 */
export class DefaultEventSink<TEvent extends EventEnvelope = EventEnvelope> implements EventSink<TEvent> {
	private readonly store: EventStore<TEvent>;
	private readonly _projections: ProjectionStore<TEvent>;
	private readonly roleHost: RoleHost<TEvent>;
	private readonly signalBus: InMemorySignalBus;
	private readonly onEventApplied?: (event: TEvent) => void;
	private readonly controller = new AbortController();
	private sequence = 0;

	constructor(store: EventStore<TEvent>, options: DefaultEventSinkOptions<TEvent> = {}) {
		this.store = store;
		this.onEventApplied = options.onEventApplied;
		this._projections = options.projectionStore ?? new ProjectionStore<TEvent>();
		this.signalBus = new InMemorySignalBus();
		this.roleHost = new RoleHost<TEvent>({
			projections: this._projections,
			publish: async (event) => {
				await this.publish(event);
			},
			signals: this.signalBus,
			signal: this.controller.signal,
		});
	}

	async publish(event: TEvent): Promise<void> {
		if (this.controller.signal.aborted) return;
		const appliedEvent =
			event.sequence > this.sequence ? event : ({ ...event, sequence: this.sequence + 1 } as TEvent);

		// Phase 1: Persist + apply projections (synchronous)
		await this.store.append(appliedEvent);
		this.sequence = Math.max(this.sequence, appliedEvent.sequence);
		const signals = this._projections.apply(appliedEvent);
		this.onEventApplied?.(appliedEvent);

		// Phase 2: Run roles asynchronously
		void this.roleHost.handle(appliedEvent, signals).catch(() => {
			// Role errors are non-fatal; they don't break the event pipeline
		});
	}

	replay(events: readonly TEvent[]): void {
		this._projections.replay(events);
		for (const event of events) {
			this.sequence = Math.max(this.sequence, event.sequence);
		}
	}

	projections(): ProjectionView<TEvent> {
		return this._projections;
	}

	registerProjection<TState>(definition: ProjectionDefinition<TEvent, TState>): void {
		this._projections.register(definition);
	}

	registerRole(role: RoleDefinition<TEvent>): void {
		this.roleHost.register(role);
	}

	async waitForIdle(): Promise<void> {
		await this.roleHost.waitForIdle();
	}

	getSequence(): number {
		return this.sequence;
	}

	getSignalBus(): InMemorySignalBus {
		return this.signalBus;
	}

	dispose(): void {
		this.controller.abort();
		this.signalBus.clear();
	}
}
