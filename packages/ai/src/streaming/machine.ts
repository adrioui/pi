/**
 * Operation-based stack machine for incremental JSON frame management.
 *
 * Uses operations as data (Op type) applied through a single apply() method.
 * Frames are immutable: created fresh in handlers, never mutated in place.
 * Parser-level snapshot/restore handles per-chunk validation rollback and full
 * parser resets.
 */

export type FrameType = "root" | "object" | "array";

export interface Frame {
	readonly type: FrameType;
	/** Key being accumulated (for object frames). */
	readonly key?: string;
	/** Whether we're expecting a key (true) or a value (false) in an object. */
	readonly expectingKey: boolean;
	/** Completed children. */
	readonly children: ReadonlyArray<{ key?: string; value: unknown }>;
}

export type Op =
	| { type: "push"; frame: Frame }
	| { type: "pop"; result: { value: unknown; key?: string } }
	| { type: "replace"; frame: Frame }
	| { type: "emit"; result: { value: unknown; key?: string } };

export interface MachineSnapshot {
	stack: Frame[];
	rootValue: unknown;
	hasRoot: boolean;
}

export class StackMachine {
	private stack: Frame[] = [];
	private rootValue: unknown = undefined;
	private hasRoot = false;

	constructor() {
		this.stack.push({ type: "root", expectingKey: false, children: [] });
	}

	apply(ops: Op[]): void {
		for (const op of ops) {
			switch (op.type) {
				case "push":
					this.stack.push(op.frame);
					break;
				case "pop": {
					const frame = this.stack.pop();
					if (frame) {
						const value =
							frame.type === "object"
								? this.childrenToObject(frame.children)
								: [...frame.children.map((c) => c.value)];
						const parent = this.peek();
						const key = parent?.type === "object" ? parent.key : undefined;
						this.completeValue({ value, key });
					}
					break;
				}
				case "replace": {
					this.stack[this.stack.length - 1] = op.frame;
					break;
				}
				case "emit":
					this.completeValue(op.result);
					break;
			}
		}
	}

	peek(): Frame | undefined {
		return this.stack[this.stack.length - 1];
	}

	get depth(): number {
		return Math.max(0, this.stack.length - 1);
	}

	get isComplete(): boolean {
		return this.hasRoot && this.stack.length <= 1;
	}

	snapshot(): MachineSnapshot {
		return {
			stack: [...this.stack],
			rootValue: this.rootValue,
			hasRoot: this.hasRoot,
		};
	}

	restore(snap: MachineSnapshot): void {
		this.stack = [...snap.stack];
		this.rootValue = snap.rootValue;
		this.hasRoot = snap.hasRoot;
	}

	buildPartial(): unknown {
		if (this.hasRoot) return this.rootValue;
		if (this.stack.length <= 1) return undefined;

		let inner: unknown;
		for (let i = this.stack.length - 1; i >= 1; i--) {
			const frame = this.stack[i]!;
			if (frame.type === "object") {
				const partial = this.childrenToObject(frame.children);
				if (inner !== undefined && frame.key !== undefined && !frame.expectingKey) {
					partial[frame.key] = inner;
				}
				inner = partial;
			} else if (frame.type === "array") {
				const partial = [...frame.children.map((c) => c.value)];
				if (inner !== undefined) {
					partial.push(inner);
				}
				inner = partial;
			}
		}
		return inner;
	}

	private completeValue(result: { value: unknown; key?: string }): void {
		const current = this.peek();
		if (!current) return;

		if (current.type === "root") {
			this.rootValue = result.value;
			this.hasRoot = true;
			return;
		}

		if (current.type === "array") {
			this.stack[this.stack.length - 1] = {
				...current,
				children: [...current.children, { value: result.value }],
			};
			return;
		}

		if (current.type === "object") {
			this.stack[this.stack.length - 1] = {
				...current,
				children: [...current.children, { key: result.key, value: result.value }],
				expectingKey: true,
			};
		}
	}

	private childrenToObject(children: ReadonlyArray<{ key?: string; value: unknown }>): Record<string, unknown> {
		const obj: Record<string, unknown> = {};
		for (const child of children) {
			if (child.key !== undefined) {
				obj[child.key] = child.value;
			}
		}
		return obj;
	}
}
