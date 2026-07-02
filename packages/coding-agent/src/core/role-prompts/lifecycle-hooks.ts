/**
 * Lifecycle hooks for multi-agent coordination.
 * coordinatorOnSpawn: guidance for the leader when a worker is spawned.
 * coordinatorOnIdle: guidance for the leader when a worker finishes.
 */

export const COORDINATOR_ON_SPAWN: Record<string, string> = {
	scout: "If this is part of a bounded worker set, wait for the requested workers and do not broaden. Only spawn additional scouts for concrete independent gaps required by the user's task.",
	architect: "Review the architect's design for completeness before proceeding to implementation.",
	engineer:
		"If this is part of a bounded worker set, wait for the requested workers and do not broaden. Only spawn additional engineers for concrete independent changes required by the user's task.",
	critic: "Consider whether the critic's findings require immediate action or can be deferred.",
	scientist: "Review the scientist's findings and determine if further investigation is needed.",
	artisan: "Review the artisan's output for quality and alignment with requirements.",
};

export const COORDINATOR_ON_IDLE: Record<string, string> = {
	scout: "Review the scout's findings for relevance and completeness.",
	architect: "Review the architect's plan for completeness and alignment with requirements.",
	engineer: "Review the engineer's work for correctness and quality.",
	critic: "Review the critic's findings and address any issues identified.",
	scientist: "Review the scientist's diagnosis and determine next steps.",
	artisan: "Review the artisan's output for quality and alignment with requirements.",
};
