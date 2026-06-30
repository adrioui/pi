export interface StateTransition<TState extends string, TEvent extends string, TContext = undefined> {
	from: TState;
	event: TEvent;
	to: TState;
	reduce?: (context: TContext) => TContext;
}

export class StateMachine<TState extends string, TEvent extends string, TContext = undefined> {
	private state: TState;
	private context: TContext;
	private readonly transitions: StateTransition<TState, TEvent, TContext>[];

	constructor(
		initialState: TState,
		initialContext: TContext,
		transitions: StateTransition<TState, TEvent, TContext>[],
	) {
		this.state = initialState;
		this.context = initialContext;
		this.transitions = transitions;
	}

	send(event: TEvent): TState {
		const transition = this.transitions.find(
			(candidate) => candidate.from === this.state && candidate.event === event,
		);
		if (!transition) {
			return this.state;
		}
		if (transition.reduce) {
			this.context = transition.reduce(this.context);
		}
		this.state = transition.to;
		return this.state;
	}

	getState(): TState {
		return this.state;
	}

	getContext(): TContext {
		return this.context;
	}
}
