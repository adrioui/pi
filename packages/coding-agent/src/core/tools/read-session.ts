import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";
import { SessionManager } from "../session-manager.ts";

const readSessionSchema = Type.Object({
	sessionId: Type.String({ description: "Session id or id prefix to read." }),
	maxChars: Type.Optional(Type.Number({ description: "Maximum summary characters to return (default: 4000)." })),
});

export type ReadSessionInput = Static<typeof readSessionSchema>;

export function createReadSessionToolDefinition(): ToolDefinition<typeof readSessionSchema> {
	return {
		name: "read_session",
		label: "read_session",
		description: "Read a previous pi session and return a bounded condensed text summary.",
		promptSnippet: "Read a bounded summary of a previous session",
		parameters: readSessionSchema,
		async execute(
			_toolCallId: string,
			params: ReadSessionInput,
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<unknown>> {
			const maxChars = params.maxChars ?? 4000;
			const sessions = await SessionManager.listAll(ctx.sessionManager.getSessionDir());
			const session =
				sessions.find((candidate) => candidate.id === params.sessionId) ??
				sessions.find((candidate) => candidate.id.startsWith(params.sessionId));
			if (!session) {
				throw new Error(`Session not found: ${params.sessionId}`);
			}
			const summary = session.allMessagesText.slice(0, maxChars);
			const truncated = session.allMessagesText.length > maxChars;
			const text = [
				`Session: ${session.id}`,
				`Name: ${session.name ?? "(none)"}`,
				`CWD: ${session.cwd}`,
				`Modified: ${session.modified.toISOString()}`,
				"",
				summary,
				truncated ? `\n[Truncated to ${maxChars} characters]` : "",
			].join("\n");
			return { content: [{ type: "text", text }], details: { session, truncated } };
		},
	};
}
