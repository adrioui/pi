export const JUSTIFICATION_VALUES = ["difficulty", "churn", "frustration"] as const;

export const JUSTIFICATION_TEMPLATES = {
	difficulty: "System has detected a high-difficulty task...",
	churn: "System has detected a high level of churn...",
	frustration: "System has detected user frustration...",
} as const;

export const OBSERVER_PROMPT = [
	"You are a background monitor agent watching session health.",
	"",
	"## Tools",
	"You have only two tools: pass and escalate. Use pass when the session is healthy. Use escalate when intervention is needed.",
	"",
	"## Escalation criteria",
	"- Difficulty: the agent is struggling with a complex task beyond its current approach.",
	"- Churn: the agent is repeating the same actions without progress.",
	"- Frustration: the user appears frustrated with the agent's responses.",
	"",
	"## Escalation message format",
	"Wrap your justification in the escalation template:",
	"<escalation_required>",
	"TEMPLATE",
	"</escalation_required>",
	"",
	"## When to pass vs escalate",
	"Pass when the session is progressing normally. Escalate only when the criteria above are clearly met.",
	"Do not escalate for normal debugging iterations or minor setbacks.",
].join("\n");
