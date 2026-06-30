/**
 * GBNF (Grammar-Based Sampling Format) compiler for Typebox schemas.
 *
 * Converts Typebox schemas into GBNF grammar rules that can be injected into
 * llama.cpp/vLLM requests for grammar-constrained generation.
 *
 * Typebox → GBNF mapping:
 * - Type.Object({...}) → root ::= "{" ws "\"key\"" ws ":" ws value ws "}"
 * - Type.Optional(...) → (...)?
 * - Type.Union([...]) → alternatives joined with |
 * - Type.Array(...) → array ::= "[" ws (item (ws "," ws item)*)? ws "]"
 * - Type.Number() → [0-9]+ ("." [0-9]+)?
 * - Type.Boolean() → "true" | "false"
 * - Enum (Type.Literal) → quoted string literals joined with |
 * - Nested objects → generate named rule, reference it
 */

import type { TSchema } from "typebox";

interface GbnfContext {
	rules: Map<string, string>;
	seenRefs: Set<string>;
	counter: number;
}

export function typeboxToGbnf(schema: TSchema, rootName = "root"): string {
	const ctx: GbnfContext = {
		rules: new Map(),
		seenRefs: new Set(),
		counter: 0,
	};

	const rootRule = compileSchema(schema, rootName, ctx);
	ctx.rules.set(rootName, rootRule);

	const lines: string[] = [];
	for (const [name, rule] of ctx.rules) {
		lines.push(`${name} ::= ${rule}`);
	}
	return lines.join("\n");
}

function compileSchema(schema: TSchema, name: string, ctx: GbnfContext): string {
	const type = (schema as { type?: string | string[] }).type;

	if (type === "object" || (schema as { properties?: unknown }).properties) {
		return compileObject(schema, name, ctx);
	}

	if (type === "array" || (schema as { items?: unknown }).items) {
		return compileArray(schema, name, ctx);
	}

	if (Array.isArray(type)) {
		const alternatives = type.map((t) => compilePrimitive(t as string, schema)).filter(Boolean);
		return alternatives.length > 0 ? alternatives.join(" | ") : '""';
	}

	const enumValues = (schema as { enum?: unknown[] }).enum;
	if (enumValues) {
		return enumValues.map((v) => `"${escapeString(String(v))}"`).join(" | ");
	}

	return compilePrimitive(type as string, schema);
}

function compileObject(schema: TSchema, name: string, ctx: GbnfContext): string {
	const properties = (schema as { properties?: Record<string, TSchema> }).properties ?? {};
	const required = (schema as { required?: string[] }).required ?? Object.keys(properties);

	const parts: string[] = ['"{"'];
	let first = true;

	for (const key of Object.keys(properties)) {
		const isRequired = required.includes(key);
		const childSchema = properties[key]!;
		const childType = (childSchema as { type?: string }).type;

		if (first) {
			parts.push("ws");
		} else {
			parts.push('ws ","');
			parts.push("ws");
		}
		first = false;

		parts.push(`"\\"${key}\\""`);
		parts.push('ws ":"');
		parts.push("ws");

		if (childType === "object" || childType === "array") {
			const childName = `${name}_${key}`;
			if (!ctx.rules.has(childName) && !ctx.seenRefs.has(childName)) {
				ctx.seenRefs.add(childName);
				const childRule = compileSchema(childSchema, childName, ctx);
				ctx.rules.set(childName, childRule);
			}
			if (isRequired) {
				parts.push(childName);
			} else {
				parts.push(`(${childName})?`);
			}
		} else {
			const primitive = compileSchema(childSchema, `${name}_${key}`, ctx);
			if (isRequired) {
				parts.push(primitive);
			} else {
				parts.push(`(${primitive})?`);
			}
		}
	}

	parts.push('ws "}"');
	return parts.join(" ");
}

function compileArray(schema: TSchema, name: string, ctx: GbnfContext): string {
	const items = (schema as { items?: TSchema }).items;
	if (!items) return '"[" ws "]"';

	const itemType = (items as { type?: string }).type;
	if (itemType === "object" || itemType === "array") {
		const itemName = `${name}_item`;
		if (!ctx.rules.has(itemName) && !ctx.seenRefs.has(itemName)) {
			ctx.seenRefs.add(itemName);
			const itemRule = compileSchema(items, itemName, ctx);
			ctx.rules.set(itemName, itemRule);
		}
		return `"[" ws (${itemName} (ws "," ws ${itemName})*)? ws "]"`;
	}

	const primitive = compileSchema(items, `${name}_item`, ctx);
	return `"[" ws (${primitive} (ws "," ws ${primitive})*)? ws "]"`;
}

function compilePrimitive(type: string, _schema: TSchema): string {
	switch (type) {
		case "string":
			return "string";
		case "number":
		case "integer":
			return "number";
		case "boolean":
			return '"true" | "false"';
		case "null":
			return '"null"';
		case "any":
		case "unknown":
			return "value";
		default:
			return '""';
	}
}

function escapeString(s: string): string {
	return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
