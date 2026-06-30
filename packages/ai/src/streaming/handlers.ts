/**
 * Pure handler functions that convert tokens + current frame state into Ops.
 * No side effects: all mutations are returned as ops for the machine to apply.
 */

import type { Frame, Op } from "./machine.ts";
import type { Token } from "./tokenizer.ts";

export interface HandlerContext {
	pendingValue: string | undefined;
}

export function handleToken(token: Token, frame: Frame | undefined, _ctx: HandlerContext): Op[] {
	if (!frame) return [];
	const ops: Op[] = [];

	switch (token.type) {
		case "object_start":
			ops.push({ type: "push", frame: { type: "object", expectingKey: true, children: [] } });
			break;
		case "array_start":
			ops.push({ type: "push", frame: { type: "array", expectingKey: false, children: [] } });
			break;
		case "object_end": {
			ops.push({ type: "pop", result: { value: undefined, key: frame.type === "object" ? frame.key : undefined } });
			break;
		}
		case "array_end": {
			ops.push({ type: "pop", result: { value: undefined, key: undefined } });
			break;
		}
		case "string":
			if (frame.type === "object" && frame.expectingKey) {
				ops.push({
					type: "replace",
					frame: { ...frame, key: token.value, expectingKey: false },
				});
			} else {
				ops.push({
					type: "emit",
					result: { value: token.value, key: frame.type === "object" ? frame.key : undefined },
				});
			}
			break;
		case "number":
			ops.push({
				type: "emit",
				result: { value: Number.parseFloat(token.value), key: frame.type === "object" ? frame.key : undefined },
			});
			break;
		case "literal": {
			const litValue = token.value === "true" ? true : token.value === "false" ? false : null;
			ops.push({ type: "emit", result: { value: litValue, key: frame.type === "object" ? frame.key : undefined } });
			break;
		}
		case "comma":
			if (frame.type === "object") {
				ops.push({ type: "replace", frame: { ...frame, key: undefined, expectingKey: true } });
			}
			break;
		default:
			break;
	}

	return ops;
}
