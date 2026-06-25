import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";
import { SessionManager } from "../session-manager.ts";

const findSessionSchema = Type.Object({
	query: Type.String({ description: "Keyword query to search across previous sessions." }),
	limit: Type.Optional(Type.Number({ description: "Maximum sessions to return (default: 10)." })),
});

export type FindSessionInput = Static<typeof findSessionSchema>;

export function createFindSessionToolDefinition(): ToolDefinition<typeof findSessionSchema> {
	return {
		name: "find_session",
		label: "find_session",
		description: "Search previous pi sessions by keyword and return matching session ids and summaries.",
		promptSnippet: "Search previous sessions by keyword",
		parameters: findSessionSchema,
		async execute(
			_toolCallId: string,
			params: FindSessionInput,
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<unknown>> {
			const limit = params.limit ?? 10;
			const query = params.query.toLowerCase();
			const sessions = await SessionManager.listAll(ctx.sessionManager.getSessionDir());
			const matches = sessions
				.filter((session) => {
					const haystack = `${session.id}\n${session.name ?? ""}\n${session.cwd}\n${session.firstMessage}\n${session.allMessagesText}`;
					return haystack.toLowerCase().includes(query);
				})
				.slice(0, limit);
			const text =
				matches.length === 0
					? "No matching sessions."
					: matches
							.map(
								(session) =>
									`- ${session.id} ${session.name ? `(${session.name}) ` : ""}${session.modified.toISOString()}\n  ${session.firstMessage.slice(0, 200)}\n  Path: ${session.path}`,
							)
							.join("\n");
			return { content: [{ type: "text", text }], details: { sessions: matches } };
		},
	};
}
