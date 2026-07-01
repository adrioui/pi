/**
 * Formats validation errors as steering messages for the corrective feedback loop.
 *
 * When mid-stream validation fails, the orchestrator aborts the current stream
 * and injects this feedback so the agent retries with corrected arguments.
 */

import type { ValidationState } from "./typebox-schema-adapter.ts";

export function formatCorrectiveFeedback(issue: ValidationState): string {
	const lines = [
		"Tool call validation failed during streaming:",
		`- ${issue.fieldPath ? `Field "${issue.fieldPath}": ` : ""}${issue.issue ?? "Unknown validation error"}`,
		"",
		"The tool call was aborted. Please retry with valid arguments.",
	];
	return lines.join("\n");
}
