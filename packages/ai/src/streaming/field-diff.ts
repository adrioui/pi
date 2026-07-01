/**
 * Field-level diffing for streaming JSON parsing.
 * Maintains a Map<path, {seenText, complete}> and emits field_start/field_delta/field_end events.
 */

export interface FieldDiffEvent {
	type: "field_start" | "field_delta" | "field_end";
	path: string;
	value?: unknown;
	complete: boolean;
}

export interface FieldDiffSnapshot {
	seen: Map<string, { seenText: string; complete: boolean }>;
}

export class FieldDiffer {
	private readonly seen = new Map<string, { seenText: string; complete: boolean }>();

	snapshot(): FieldDiffSnapshot {
		return { seen: new Map(this.seen) };
	}

	restore(snap: FieldDiffSnapshot): void {
		this.seen.clear();
		for (const [k, v] of snap.seen) {
			this.seen.set(k, { ...v });
		}
	}

	walkAndDiff(partial: unknown, basePath = ""): FieldDiffEvent[] {
		const events: FieldDiffEvent[] = [];
		this.diffValue(partial, basePath, events);
		return events;
	}

	private diffValue(value: unknown, path: string, events: FieldDiffEvent[]): void {
		if (value === null || value === undefined) {
			return;
		}

		if (typeof value === "object") {
			if (Array.isArray(value)) {
				for (let i = 0; i < value.length; i++) {
					const childPath = `${path}[${i}]`;
					this.diffValue(value[i], childPath, events);
				}
			} else {
				const obj = value as Record<string, unknown>;
				for (const key of Object.keys(obj)) {
					const childPath = path ? `${path}.${key}` : key;
					const childValue = obj[key];

					if (typeof childValue === "object" && childValue !== null) {
						const existing = this.seen.get(childPath);
						if (!existing) {
							events.push({ type: "field_start", path: childPath, value: undefined, complete: false });
							this.seen.set(childPath, { seenText: "", complete: false });
						}
						this.diffValue(childValue, childPath, events);
						const entry = this.seen.get(childPath);
						if (entry && !entry.complete) {
							events.push({ type: "field_end", path: childPath, value: childValue, complete: true });
							entry.complete = true;
						}
					} else {
						const text = String(childValue ?? "");
						const existing = this.seen.get(childPath);
						if (!existing) {
							events.push({ type: "field_start", path: childPath, value: childValue, complete: false });
							events.push({ type: "field_end", path: childPath, value: childValue, complete: true });
							this.seen.set(childPath, { seenText: text, complete: true });
						} else if (text !== existing.seenText) {
							events.push({ type: "field_delta", path: childPath, value: childValue, complete: true });
							events.push({ type: "field_end", path: childPath, value: childValue, complete: true });
							existing.seenText = text;
							existing.complete = true;
						}
					}
				}
			}
		}
	}
}
