import { parse as partialParse } from "partial-json";

const VALID_JSON_ESCAPES = new Set(['"', "\\", "/", "b", "f", "n", "r", "t", "u"]);

function isControlCharacter(char: string): boolean {
	const codePoint = char.codePointAt(0);
	return codePoint !== undefined && codePoint >= 0x00 && codePoint <= 0x1f;
}

function escapeControlCharacter(char: string): string {
	switch (char) {
		case "\b":
			return "\\b";
		case "\f":
			return "\\f";
		case "\n":
			return "\\n";
		case "\r":
			return "\\r";
		case "\t":
			return "\\t";
		default:
			return `\\u${char.codePointAt(0)?.toString(16).padStart(4, "0") ?? "0000"}`;
	}
}

/**
 * Repairs malformed JSON string literals by:
 * - escaping raw control characters inside strings
 * - doubling backslashes before invalid escape characters
 */
export function repairJson(json: string): string {
	let repaired = "";
	let inString = false;

	for (let index = 0; index < json.length; index++) {
		const char = json[index];

		if (!inString) {
			repaired += char;
			if (char === '"') {
				inString = true;
			}
			continue;
		}

		if (char === '"') {
			repaired += char;
			inString = false;
			continue;
		}

		if (char === "\\") {
			const nextChar = json[index + 1];
			if (nextChar === undefined) {
				repaired += "\\\\";
				continue;
			}

			if (nextChar === "u") {
				const unicodeDigits = json.slice(index + 2, index + 6);
				if (/^[0-9a-fA-F]{4}$/.test(unicodeDigits)) {
					repaired += `\\u${unicodeDigits}`;
					index += 5;
					continue;
				}
			}

			if (VALID_JSON_ESCAPES.has(nextChar)) {
				repaired += `\\${nextChar}`;
				index += 1;
				continue;
			}

			repaired += "\\\\";
			continue;
		}

		repaired += isControlCharacter(char) ? escapeControlCharacter(char) : char;
	}

	return repaired;
}

export function parseJsonWithRepair<T>(json: string): T {
	try {
		return JSON.parse(json) as T;
	} catch (error) {
		const repairedJson = repairJson(json);
		if (repairedJson !== json) {
			return JSON.parse(repairedJson) as T;
		}
		throw error;
	}
}

/**
 * Attempts to parse potentially incomplete JSON during streaming.
 * Always returns a valid object, even if the JSON is incomplete.
 *
 * @param partialJson The partial JSON string from streaming
 * @returns Parsed object or empty object if parsing fails
 */
export function parseStreamingJson<T = Record<string, unknown>>(partialJson: string | undefined): T {
	if (!partialJson || partialJson.trim() === "") {
		return {} as T;
	}

	try {
		return parseJsonWithRepair<T>(partialJson);
	} catch {
		try {
			const result = partialParse(partialJson);
			return (result ?? {}) as T;
		} catch {
			try {
				const result = partialParse(repairJson(partialJson));
				return (result ?? {}) as T;
			} catch {
				return {} as T;
			}
		}
	}
}

/**
 * Result of validating a streaming JSON input against a schema.
 */
export interface StreamingValidationResult {
	/** Whether the partial JSON is structurally valid so far */
	isValid: boolean;
	/** The parsed object (even if partial) */
	parsed: Record<string, unknown>;
	/** Accumulated validation warnings (non-blocking) */
	warnings: string[];
	/** Fatal validation errors (blocking) */
	errors: string[];
}

/**
 * Validate a partial JSON string against a minimal schema during streaming.
 *
 * Performs tier-1 validation only:
 * - Well-formedness: Can the partial JSON be parsed?
 * - Required fields: Do required fields exist (when the JSON is complete enough)?
 * - Type checking: Are present fields the correct type?
 *
 * Returns a validation result with parsed data, warnings, and errors.
 * This is intended for early detection of malformed tool inputs during streaming.
 */
export function validateStreamingToolInput(
	partialJson: string | undefined,
	schema?: {
		required?: string[];
		properties?: Record<string, { type: string }>;
	},
): StreamingValidationResult {
	const warnings: string[] = [];
	const errors: string[] = [];

	if (!partialJson || partialJson.trim() === "") {
		return { isValid: true, parsed: {}, warnings, errors };
	}

	const parsed = parseStreamingJson<Record<string, unknown>>(partialJson);

	// If we got an empty object back from parseStreamingJson, the input was malformed
	if (Object.keys(parsed).length === 0 && partialJson.trim().length > 2) {
		// Only warn for non-trivial inputs that failed to parse
		warnings.push(`Partial JSON could not be parsed: ${partialJson.slice(0, 100)}`);
	}

	if (!schema) {
		return { isValid: errors.length === 0, parsed, warnings, errors };
	}

	// Check required fields (only if the JSON appears to be a complete object)
	const looksComplete = partialJson.trim().endsWith("}");
	if (looksComplete && schema.required) {
		for (const field of schema.required) {
			if (parsed[field] === undefined) {
				errors.push(`Missing required field: ${field}`);
			}
		}
	} else if (!looksComplete && schema.required) {
		// For incomplete JSON, warn about missing required fields that aren't yet present
		for (const field of schema.required) {
			if (parsed[field] === undefined) {
				warnings.push(`Required field not yet present: ${field}`);
			}
		}
	}

	// Check types for present fields
	if (schema.properties) {
		for (const [field, expected] of Object.entries(schema.properties)) {
			const value = parsed[field];
			if (value === undefined) continue;

			const actualType = typeof value;
			let typeValid = true;

			switch (expected.type) {
				case "string":
					typeValid = actualType === "string";
					break;
				case "number":
					typeValid = actualType === "number";
					break;
				case "boolean":
					typeValid = actualType === "boolean";
					break;
				case "object":
					typeValid = actualType === "object" && value !== null && !Array.isArray(value);
					break;
				case "array":
					typeValid = Array.isArray(value);
					break;
			}

			if (!typeValid) {
				errors.push(`Field "${field}" expected type ${expected.type}, got ${actualType}`);
			}
		}
	}

	return { isValid: errors.length === 0, parsed, warnings, errors };
}
