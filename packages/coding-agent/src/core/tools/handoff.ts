import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";
import { SessionManager } from "../session-manager.ts";

const handoffSchema = Type.Object({
	goal: Type.String({ description: "Goal for the new handoff session." }),
	follow: Type.Optional(Type.Boolean({ description: "Create the session and ask the user to follow it manually." })),
	mode: Type.Optional(Type.String({ description: "Optional mode label to record for the handoff." })),
});

export type HandoffInput = Static<typeof handoffSchema>;

export function createHandoffToolDefinition(cwd: string): ToolDefinition<typeof handoffSchema> {
	return {
		name: "handoff",
		label: "handoff",
		description: "Create a new session fork with a goal for continued work.",
		promptSnippet: "Create a new handoff session with a goal",
		parameters: handoffSchema,
		async execute(
			_toolCallId: string,
			params: HandoffInput,
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<unknown>> {
			const sourceFile = ctx.sessionManager.getSessionFile();
			if (!sourceFile) {
				throw new Error("Cannot handoff from an in-memory session.");
			}
			const fork = SessionManager.forkFrom(sourceFile, cwd, ctx.sessionManager.getSessionDir());
			const text = [
				`Created handoff session ${fork.getSessionId()}.`,
				`Goal: ${params.goal}`,
				params.mode ? `Mode: ${params.mode}` : undefined,
				params.follow ? "Use the session switcher to follow the new session." : undefined,
			]
				.filter((line): line is string => Boolean(line))
				.join("\n");
			return {
				content: [{ type: "text", text }],
				details: { sessionId: fork.getSessionId(), sessionFile: fork.getSessionFile(), goal: params.goal },
			};
		},
	};
}
