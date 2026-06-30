/**
 * Typebox schema adapter for streaming validation.
 * Converts Typebox schemas (which ARE JSON Schema) into a streaming-friendly format.
 * Validates partial JSON against the schema during streaming.
 *
 * Validation rules:
 * - Don't fail on missing required fields (stream is incomplete)
 * - DO fail on wrong-type fields (string where number expected)
 * - DO fail on enum violations (value not in allowed set)
 */

import type { TSchema } from "typebox";

export interface StreamingSchemaField {
	name: string;
	type: "string" | "number" | "boolean" | "object" | "array" | "union" | "null" | "any";
	required: boolean;
	children?: StreamingSchemaField[];
	itemSchema?: StreamingSchemaField;
	enumValues?: string[];
}

export interface ValidationState {
	valid: boolean;
	issue?: string;
}

export function typeboxToStreamingSchema(schema: TSchema, name = "root"): StreamingSchemaField {
	const type = (schema as { type?: string | string[] }).type;
	const optional = Boolean((schema as { modifier?: number }).modifier === 2); // Type.Optional modifier
	const fields: StreamingSchemaField[] = [];

	if (type === "object" || (schema as { properties?: unknown }).properties) {
		const properties = (schema as { properties?: Record<string, TSchema> }).properties;
		if (properties) {
			for (const key of Object.keys(properties)) {
				fields.push(typeboxToStreamingSchema(properties[key]!, key));
			}
		}
		return {
			name,
			type: "object",
			required: !optional,
			children: fields,
		};
	}

	if (type === "array" || (schema as { items?: unknown }).items) {
		const items = (schema as { items?: TSchema }).items;
		return {
			name,
			type: "array",
			required: !optional,
			itemSchema: items ? typeboxToStreamingSchema(items, `${name}[]`) : undefined,
		};
	}

	if (Array.isArray(type)) {
		return {
			name,
			type: "union",
			required: !optional,
			children: type.map((t) => ({ name: `${name}.${t}`, type: t as StreamingSchemaField["type"], required: true })),
		};
	}

	// Detect unions of literals (Type.Union([Type.Literal(...), ...]) → anyOf)
	const anyOf = (schema as { anyOf?: TSchema[] }).anyOf;
	if (anyOf && anyOf.length > 0) {
		const literals = anyOf.map((s) => (s as { const?: unknown }).const).filter((v) => v !== undefined);
		if (literals.length === anyOf.length) {
			return {
				name,
				type: "string",
				required: !optional,
				enumValues: literals.map(String),
			};
		}
		return {
			name,
			type: "union",
			required: !optional,
			children: anyOf.map((s) => typeboxToStreamingSchema(s, `${name}_item`)),
		};
	}

	const enumValues = (schema as { enum?: unknown[] }).enum;
	if (enumValues) {
		return {
			name,
			type: type as StreamingSchemaField["type"],
			required: !optional,
			enumValues: enumValues.map(String),
		};
	}

	return {
		name,
		type: (type as StreamingSchemaField["type"]) ?? "any",
		required: !optional,
	};
}

export function validatePartialAgainstSchema(partial: unknown, schema: StreamingSchemaField): ValidationState {
	if (partial === undefined || partial === null) {
		return { valid: true };
	}

	if (schema.type === "object" && schema.children) {
		if (typeof partial !== "object" || Array.isArray(partial)) {
			return { valid: false, issue: `Field "${schema.name}" expected type object` };
		}
		const obj = partial as Record<string, unknown>;
		for (const child of schema.children) {
			if (!(child.name in obj)) {
				continue;
			}
			const result = validatePartialAgainstSchema(obj[child.name], child);
			if (!result.valid) return result;
		}
		return { valid: true };
	}

	if (schema.type === "array" && schema.itemSchema) {
		if (!Array.isArray(partial)) {
			return { valid: false, issue: `Field "${schema.name}" expected type array` };
		}
		for (const item of partial) {
			const result = validatePartialAgainstSchema(item, schema.itemSchema);
			if (!result.valid) return result;
		}
		return { valid: true };
	}

	if (schema.enumValues) {
		const value = String(partial);
		if (!schema.enumValues.includes(value)) {
			return {
				valid: false,
				issue: `Field "${schema.name}" must be one of: ${schema.enumValues.join(", ")}`,
			};
		}
		return { valid: true };
	}

	if (schema.type === "string" && typeof partial !== "string") {
		return { valid: false, issue: `Field "${schema.name}" expected type string, got ${typeof partial}` };
	}
	if (schema.type === "number" && typeof partial !== "number") {
		return { valid: false, issue: `Field "${schema.name}" expected type number, got ${typeof partial}` };
	}
	if (schema.type === "boolean" && typeof partial !== "boolean") {
		return { valid: false, issue: `Field "${schema.name}" expected type boolean, got ${typeof partial}` };
	}

	return { valid: true };
}
