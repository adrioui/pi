import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { EventEnvelope, EventListOptions, EventStore } from "./types.ts";

export class InMemoryEventStore<TEvent extends EventEnvelope = EventEnvelope> implements EventStore<TEvent> {
	private readonly events: TEvent[] = [];

	append(event: TEvent): void {
		this.events.push(event);
	}

	appendMany(events: readonly TEvent[]): void {
		for (const event of events) {
			this.events.push(event);
		}
	}

	list(options?: EventListOptions): TEvent[] {
		let results = this.events;
		if (options?.afterSequence !== undefined) {
			results = results.filter((event) => event.sequence > options.afterSequence!);
		}
		if (options?.limit !== undefined) {
			results = results.slice(-options.limit);
		}
		return [...results];
	}
}

export class JsonlEventStore<TEvent extends EventEnvelope = EventEnvelope> implements EventStore<TEvent> {
	private readonly filePath: string;

	constructor(filePath: string) {
		this.filePath = filePath;
	}

	append(event: TEvent): void {
		this.ensureFile();
		appendFileSync(this.filePath, `${JSON.stringify(event)}\n`);
	}

	appendMany(events: readonly TEvent[]): void {
		if (events.length === 0) return;
		this.ensureFile();
		appendFileSync(this.filePath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
	}

	list(options?: EventListOptions): TEvent[] {
		if (!existsSync(this.filePath)) {
			return [];
		}
		const content = readFileSync(this.filePath, "utf-8");
		if (content.trim().length === 0) {
			return [];
		}
		let events = content
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0)
			.map((line) => JSON.parse(line) as TEvent);
		if (options?.afterSequence !== undefined) {
			events = events.filter((event) => event.sequence > options.afterSequence!);
		}
		if (options?.limit !== undefined) {
			events = events.slice(-options.limit);
		}
		return events;
	}

	rewrite(events: readonly TEvent[]): void {
		this.ensureDirectory();
		writeFileSync(
			this.filePath,
			events.map((event) => JSON.stringify(event)).join("\n") + (events.length > 0 ? "\n" : ""),
		);
	}

	private ensureFile(): void {
		this.ensureDirectory();
		if (!existsSync(this.filePath)) {
			writeFileSync(this.filePath, "");
		}
	}

	private ensureDirectory(): void {
		const folder = dirname(this.filePath);
		if (!existsSync(folder)) {
			mkdirSync(folder, { recursive: true });
		}
	}
}
