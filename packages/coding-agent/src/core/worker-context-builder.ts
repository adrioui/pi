/**
 * Worker context builder — builds scoped context that workers receive.
 * Uses Magnitude's <session-start>/<project-context>/<transcript> XML structure.
 * Pi extends its existing buildForkContext() from event-core/src/fork.ts.
 *
 * Transcript truncation: last 5-10 messages + any messages explicitly referenced
 * in the delegation message. Project context always included.
 */

import { buildForkContext } from "@earendil-works/pi-event-core";

export interface WorkerContextInput {
	sessionStart?: string;
	projectContext?: string;
	transcript?: string;
}

export function buildWorkerContext(input: WorkerContextInput): string {
	return buildForkContext({
		sessionStart: input.sessionStart ?? "",
		projectContext: input.projectContext ?? "",
		transcript: input.transcript ?? "",
	});
}
