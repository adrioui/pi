import { describe, expect, it } from "vitest";
import { type EventEnvelope, ForkedProjectionStore, type ProjectionDefinition } from "../src/index.ts";

type TestEvent = EventEnvelope<string, Record<string, unknown>>;

function makeEvent(type: string, payload: Record<string, unknown>, sequence: number): TestEvent {
	return {
		id: `evt-${sequence}`,
		stream: "test",
		sequence,
		type,
		timestamp: new Date().toISOString(),
		sessionId: "test-session",
		payload,
	};
}

function createTestProjection(name: string): ProjectionDefinition<TestEvent, { count: number }> {
	return {
		name,
		initialState: { count: 0 },
		reduce: (state, _event) => ({ count: state.count + 1 }),
	};
}

describe("ForkedProjectionStore", () => {
	it("global projections see ALL events", () => {
		const store = new ForkedProjectionStore<TestEvent>();
		store.registerGlobal(createTestProjection("Global"));

		store.apply(makeEvent("test", { forkId: "fork1" }, 1));
		store.apply(makeEvent("test", { forkId: "fork2" }, 2));
		store.apply(makeEvent("test", {}, 3)); // main fork

		expect(store.get<{ count: number }>("Global")?.count).toBe(3);
	});

	it("forked projections see only their fork's events", () => {
		const store = new ForkedProjectionStore<TestEvent>();
		store.registerForked(createTestProjection("Forked"));

		store.forFork("fork1");
		store.forFork("fork2");

		store.apply(makeEvent("test", { forkId: "fork1" }, 1));
		store.apply(makeEvent("test", { forkId: "fork2" }, 2));
		store.apply(makeEvent("test", { forkId: "fork1" }, 3));

		const fork1View = store.getForkView("fork1");
		expect(fork1View.get<{ count: number }>("Forked")?.count).toBe(2);

		const fork2View = store.getForkView("fork2");
		expect(fork2View.get<{ count: number }>("Forked")?.count).toBe(1);
	});

	it("events without forkId go to main fork", () => {
		const store = new ForkedProjectionStore<TestEvent>();
		store.registerForked(createTestProjection("Forked"));
		store.forFork("__main__");

		store.apply(makeEvent("test", {}, 1));

		const mainView = store.getForkView("__main__");
		expect(mainView.get<{ count: number }>("Forked")?.count).toBe(1);
	});

	it("forFork clones projection definitions (apply is not a no-op)", () => {
		const store = new ForkedProjectionStore<TestEvent>();
		store.registerForked(createTestProjection("Forked"));

		store.apply(makeEvent("test", { forkId: "newfork" }, 1));

		const view = store.getForkView("newfork");
		expect(view.get<{ count: number }>("Forked")?.count).toBe(1);
	});
});
