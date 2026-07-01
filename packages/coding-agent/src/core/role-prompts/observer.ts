export const JUSTIFICATION_VALUES = ["difficulty", "churn", "frustration"] as const;

export const JUSTIFICATION_TEMPLATES = {
	difficulty: "System has detected a high-difficulty task...",
	churn: "System has detected a high level of churn...",
	frustration: "System has detected user frustration...",
} as const;
