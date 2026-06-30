/**
 * Lifecycle hooks for multi-agent coordination.
 * coordinatorOnSpawn: guidance for the leader when a worker is spawned.
 * coordinatorOnIdle: guidance for the leader when a worker finishes.
 */

export const COORDINATOR_ON_SPAWN: Record<string, string> = {
	scout: "If there are other areas to investigate, spawn additional scouts in parallel.",
	architect: "",
	engineer: "If there are other independent changes to make, spawn additional engineers in parallel.",
	critic: "",
	scientist: "",
	artisan: "",
};

export const COORDINATOR_ON_IDLE: Record<string, string> = {
	scout: "Review the scout's findings for relevance and completeness.",
	architect: "Review the architect's plan for completeness and alignment with requirements.",
	engineer: "Review the engineer's work for correctness and quality.",
	critic: "Review the critic's findings and address any issues identified.",
	scientist: "Review the scientist's diagnosis and determine next steps.",
	artisan: "",
};
