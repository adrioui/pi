import { existsSync, readFileSync } from "node:fs";

export interface SessionReaderMessage {
	role: "user" | "assistant";
	text: string;
}

export interface SessionReaderResult {
	path: string;
	messages: SessionReaderMessage[];
	text: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function extractText(value: unknown): string {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		return value
			.map((part) => {
				const record = asRecord(part);
				return record?.type === "text" && typeof record.text === "string" ? record.text : "";
			})
			.filter((text) => text.length > 0)
			.join("\n");
	}
	const record = asRecord(value);
	if (record) {
		return extractText(record.content ?? record.text ?? record.message);
	}
	return "";
}

function extractMessage(entry: unknown): SessionReaderMessage | undefined {
	const record = asRecord(entry);
	if (!record) return undefined;

	const nestedMessage = asRecord(record.message);
	const roleValue = nestedMessage?.role ?? record.role ?? record.type;
	const role =
		roleValue === "user" || roleValue === "human" ? "user" : roleValue === "assistant" ? "assistant" : undefined;
	if (!role) return undefined;

	const text = extractText(
		nestedMessage?.content ?? nestedMessage?.text ?? record.content ?? record.text ?? record.message,
	).trim();
	if (!text) return undefined;
	return { role, text };
}

export function readSessionContext(
	path: string,
	options?: { maxMessages?: number; maxChars?: number },
): SessionReaderResult {
	if (!existsSync(path)) {
		throw new Error(`Session file not found: ${path}`);
	}

	const maxMessages = options?.maxMessages ?? 80;
	const maxChars = options?.maxChars ?? 40_000;
	const messages: SessionReaderMessage[] = [];

	for (const line of readFileSync(path, "utf-8").split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const message = extractMessage(JSON.parse(trimmed) as unknown);
			if (message) messages.push(message);
		} catch {
			// Ignore malformed lines so partially-written sessions can still provide context.
		}
	}

	const selected = messages.slice(-maxMessages);
	let text = selected.map((message) => `${message.role.toUpperCase()}:\n${message.text}`).join("\n\n");
	if (text.length > maxChars) {
		text = text.slice(text.length - maxChars);
		text = `[Truncated to last ${maxChars} characters]\n${text}`;
	}

	return { path, messages: selected, text };
}
