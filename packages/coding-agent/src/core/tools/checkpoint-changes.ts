/**
 * checkpoint_changes tool: Show what files changed since a previous snapshot.
 *
 * Inspired by Magnitude's checkpoint_changes tool which lets the agent
 * inspect its own changes since a turn boundary. Operates on the private
 * snapshot system, not the user's git repository.
 */

import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";
import { diffSnapshotAgainstWorktree, listSnapshots } from "../snapshot.ts";

const checkpointChangesSchema = Type.Object({
	since: Type.String({
		description:
			"Identifier of the snapshot to compare against. Use the snapshot's message ID (UUID) or the tree OID.",
	}),
	glob: Type.Optional(
		Type.String({
			description: "Optional glob pattern to restrict the diff to matching files (e.g. '*.ts', 'src/**').",
		}),
	),
});

export type CheckpointChangesInput = Static<typeof checkpointChangesSchema>;

/**
 * Create the checkpoint_changes tool definition.
 */
export function createCheckpointChangesToolDefinition(
	cwd: string,
	sessionId: string,
): ToolDefinition<typeof checkpointChangesSchema> {
	return {
		name: "checkpoint_changes",
		label: "Checkpoint Changes",
		description:
			"Show what files changed since a previous snapshot. " +
			"Operates on the private snapshot system, not the user's git repository. " +
			"Use the snapshot's message ID or tree OID to identify the baseline.",
		promptSnippet: "Show changes since a previous snapshot",
		promptGuidelines: [
			"Use checkpoint_changes to inspect what you changed before deciding to roll back.",
			"Pass a glob pattern to restrict the diff to specific files.",
		],
		parameters: checkpointChangesSchema,
		execute: async (
			_toolCallId: string,
			params: Static<typeof checkpointChangesSchema>,
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			_ctx: ExtensionContext,
		): Promise<AgentToolResult<unknown>> => {
			try {
				// Resolve the snapshot: the 'since' param can be a message ID (UUID)
				// or a tree OID. Try to find it in the session snapshots first.
				let fromTreeOID = params.since;

				const snapshots = listSnapshots(cwd, sessionId);
				const matchingSnapshot = snapshots.find((s) => s.messageId === params.since || s.treeOID === params.since);
				if (matchingSnapshot) {
					fromTreeOID = matchingSnapshot.treeOID;
				}

				if (snapshots.length === 0) {
					return {
						content: [{ type: "text" as const, text: "No snapshots available for this session." }],
						details: { since: params.since },
					};
				}

				// Compare against the current worktree to capture mid-turn changes
				const { changedFiles, diff } = diffSnapshotAgainstWorktree(cwd, fromTreeOID, params.glob);

				if (changedFiles.length === 0) {
					return {
						content: [{ type: "text" as const, text: "No files changed since the specified snapshot." }],
						details: { since: params.since, treeOID: fromTreeOID },
					};
				}

				const summary = `Changed files (${changedFiles.length}):\n${changedFiles.map((f) => `  ${f}`).join("\n")}`;
				const diffText = diff ? `\n\nDiff:\n${diff}` : "";

				return {
					content: [{ type: "text" as const, text: `${summary}${diffText}` }],
					details: { since: params.since, treeOID: fromTreeOID, changedFiles },
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text" as const, text: `Failed to get checkpoint changes: ${message}` }],
					details: { since: params.since, error: message },
				};
			}
		},
	};
}
