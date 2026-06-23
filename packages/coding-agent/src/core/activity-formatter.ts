import type { ImageContent, TextContent } from "@earendil-works/pi-ai";

export interface ToolResultForModel {
	content: (TextContent | ImageContent)[];
	details: unknown;
}

/** Maximum size for tool results (100KB). */
const MAX_TOOL_RESULT_BYTES = 100 * 1024;

/** Truncate content from the tail, keeping the last N bytes. */
function truncateTail(content: string, maxBytes: number): { text: string; truncated: boolean } {
	if (Buffer.byteLength(content, "utf-8") <= maxBytes) {
		return { text: content, truncated: false };
	}

	const bytes = Buffer.from(content, "utf-8");
	const truncatedBytes = bytes.slice(-maxBytes);
	let text = truncatedBytes.toString("utf-8");

	// Ensure we don't start in the middle of a multi-byte character
	// by finding the first valid UTF-8 boundary
	const firstValidBoundary = text.indexOf("");
	if (firstValidBoundary > 0) {
		text = text.slice(firstValidBoundary);
	}

	return { text, truncated: true };
}

export function formatToolResultForModel(
	toolName: string,
	args: unknown,
	result: ToolResultForModel,
	isError: boolean,
): (TextContent | ImageContent)[] | undefined {
	if (isError) {
		return undefined;
	}
	const text = result.content
		.filter((content) => content.type === "text")
		.map((content) => content.text ?? "")
		.join("\n")
		.trim();
	if (text.length === 0) {
		return undefined;
	}

	if (toolName === "read") {
		return undefined;
	}

	if (toolName === "bash") {
		if (text.startsWith("[bash]")) {
			return undefined;
		}
		const command = getStringArg(args, "command");
		const header = command ? `[bash] $ ${command}` : "[bash]";
		const { text: truncatedText, truncated } = truncateTail(text, MAX_TOOL_RESULT_BYTES);
		const finalText = truncated
			? `${header}\n... [truncated, showing last ${formatSize(MAX_TOOL_RESULT_BYTES)}]\n${truncatedText}`
			: `${header}\n${truncatedText}`;
		return [{ type: "text", text: finalText }];
	}

	if (toolName === "edit") {
		if (text.startsWith("[edit]")) {
			return undefined;
		}
		const path = getStringArg(args, "file_path") ?? getStringArg(args, "path");
		const header = path ? `[edit] ${path}` : "[edit]";
		const { text: truncatedText, truncated } = truncateTail(text, MAX_TOOL_RESULT_BYTES);
		const finalText = truncated
			? `${header}\n... [truncated, showing last ${formatSize(MAX_TOOL_RESULT_BYTES)}]\n${truncatedText}`
			: `${header}\n${truncatedText}`;
		return [{ type: "text", text: finalText }];
	}

	if (toolName === "write") {
		if (text.startsWith("[write]")) {
			return undefined;
		}
		const path = getStringArg(args, "file_path") ?? getStringArg(args, "path");
		const header = path ? `[write] ${path}` : "[write]";
		const { text: truncatedText, truncated } = truncateTail(text, MAX_TOOL_RESULT_BYTES);
		const finalText = truncated
			? `${header}\n... [truncated, showing last ${formatSize(MAX_TOOL_RESULT_BYTES)}]\n${truncatedText}`
			: `${header}\n${truncatedText}`;
		return [{ type: "text", text: finalText }];
	}

	if (toolName === "grep") {
		if (text.startsWith("[grep]")) {
			return undefined;
		}
		const query = getStringArg(args, "pattern") ?? getStringArg(args, "query");
		const header = query ? `[grep] ${query}` : "[grep]";
		const { text: truncatedText, truncated } = truncateTail(text, MAX_TOOL_RESULT_BYTES);
		const finalText = truncated
			? `${header}\n... [truncated, showing last ${formatSize(MAX_TOOL_RESULT_BYTES)}]\n${truncatedText}`
			: `${header}\n${truncatedText}`;
		return [{ type: "text", text: finalText }];
	}

	if (toolName === "find") {
		if (text.startsWith("[find]")) {
			return undefined;
		}
		const pattern = getStringArg(args, "pattern") ?? getStringArg(args, "glob");
		const header = pattern ? `[find] ${pattern}` : "[find]";
		const { text: truncatedText, truncated } = truncateTail(text, MAX_TOOL_RESULT_BYTES);
		const finalText = truncated
			? `${header}\n... [truncated, showing last ${formatSize(MAX_TOOL_RESULT_BYTES)}]\n${truncatedText}`
			: `${header}\n${truncatedText}`;
		return [{ type: "text", text: finalText }];
	}

	if (toolName === "ls") {
		if (text.startsWith("[ls]")) {
			return undefined;
		}
		const dir = getStringArg(args, "path") ?? getStringArg(args, "directory");
		const header = dir ? `[ls] ${dir}` : "[ls]";
		const { text: truncatedText, truncated } = truncateTail(text, MAX_TOOL_RESULT_BYTES);
		const finalText = truncated
			? `${header}\n... [truncated, showing last ${formatSize(MAX_TOOL_RESULT_BYTES)}]\n${truncatedText}`
			: `${header}\n${truncatedText}`;
		return [{ type: "text", text: finalText }];
	}

	return undefined;
}

function formatSize(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes}B`;
	} else if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)}KB`;
	} else {
		return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
	}
}

function getStringArg(args: unknown, key: string): string | undefined {
	if (!args || typeof args !== "object") {
		return undefined;
	}
	const value = (args as Record<string, unknown>)[key];
	return typeof value === "string" ? value : undefined;
}
