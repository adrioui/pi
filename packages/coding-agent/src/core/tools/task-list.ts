import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import { getAgentDir } from "../../config.ts";
import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";

const TASK_STATUSES = ["pending", "in_progress", "done", "blocked"] as const;
type TaskStatus = (typeof TASK_STATUSES)[number];

interface PersistentTask {
	id: string;
	title: string;
	status: TaskStatus;
	dependsOn: string[];
	parentID?: string;
	createdSessionId: string;
}

interface TaskStore {
	tasks: PersistentTask[];
}

const taskListSchema = Type.Object({
	operation: Type.Union(
		[Type.Literal("create"), Type.Literal("update"), Type.Literal("list"), Type.Literal("delete")],
		{ description: "Task-list operation to perform" },
	),
	id: Type.Optional(Type.String({ description: "Task id for update/delete. Generated for create when omitted." })),
	title: Type.Optional(Type.String({ description: "Task title for create/update." })),
	status: Type.Optional(
		Type.Union(
			TASK_STATUSES.map((status) => Type.Literal(status)),
			{
				description: "Task status for create/update.",
			},
		),
	),
	dependsOn: Type.Optional(Type.Array(Type.String(), { description: "Task ids this task depends on." })),
	parentID: Type.Optional(Type.String({ description: "Optional parent task id." })),
});

export type TaskListInput = Static<typeof taskListSchema>;

function taskStorePath(sessionId: string): string {
	return join(getAgentDir(), "tasks", sessionId, "tasks.json");
}

function readStore(sessionId: string): TaskStore {
	const path = taskStorePath(sessionId);
	if (!existsSync(path)) {
		return { tasks: [] };
	}
	const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
	if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { tasks?: unknown }).tasks)) {
		return { tasks: [] };
	}
	return parsed as TaskStore;
}

function writeStore(sessionId: string, store: TaskStore): void {
	const path = taskStorePath(sessionId);
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, JSON.stringify(store, null, 2), "utf-8");
}

function formatTasks(tasks: PersistentTask[]): string {
	if (tasks.length === 0) {
		return "No tasks.";
	}
	return tasks
		.map((task) => {
			const deps = task.dependsOn.length > 0 ? ` dependsOn=${task.dependsOn.join(",")}` : "";
			const parent = task.parentID ? ` parentID=${task.parentID}` : "";
			return `- ${task.id} [${task.status}] ${task.title}${deps}${parent}`;
		})
		.join("\n");
}

function result(text: string, details: unknown): AgentToolResult<unknown> {
	return { content: [{ type: "text", text }], details };
}

export function createTaskListToolDefinition(): ToolDefinition<typeof taskListSchema> {
	return {
		name: "task_list",
		label: "task_list",
		description:
			"Persist and update a session task list with dependencies. Supports create, update, list, and delete operations.",
		promptSnippet: "Persist and update a task list with dependencies",
		promptGuidelines: [
			"Use task_list to track multi-step work, dependency order, blockers, and completion state across turns.",
		],
		parameters: taskListSchema,
		async execute(_toolCallId, params: TaskListInput, _signal, _onUpdate, ctx: ExtensionContext) {
			const sessionId = ctx.sessionManager.getSessionId();
			const store = readStore(sessionId);

			if (params.operation === "list") {
				return result(formatTasks(store.tasks), { tasks: store.tasks });
			}

			if (params.operation === "create") {
				if (!params.title) {
					throw new Error("title is required for create");
				}
				const task: PersistentTask = {
					id: params.id ?? `T-${Date.now().toString(36)}-${store.tasks.length + 1}`,
					title: params.title,
					status: params.status ?? "pending",
					dependsOn: params.dependsOn ?? [],
					parentID: params.parentID,
					createdSessionId: sessionId,
				};
				store.tasks.push(task);
				writeStore(sessionId, store);
				return result(`Created task ${task.id}.\n${formatTasks(store.tasks)}`, { task, tasks: store.tasks });
			}

			const taskIndex = store.tasks.findIndex((task) => task.id === params.id);
			if (!params.id || taskIndex === -1) {
				throw new Error("existing task id is required");
			}

			if (params.operation === "delete") {
				const [deleted] = store.tasks.splice(taskIndex, 1);
				writeStore(sessionId, store);
				return result(`Deleted task ${deleted?.id}.\n${formatTasks(store.tasks)}`, {
					task: deleted,
					tasks: store.tasks,
				});
			}

			const existing = store.tasks[taskIndex]!;
			const updated: PersistentTask = {
				...existing,
				title: params.title ?? existing.title,
				status: params.status ?? existing.status,
				dependsOn: params.dependsOn ?? existing.dependsOn,
				parentID: params.parentID ?? existing.parentID,
			};
			store.tasks[taskIndex] = updated;
			writeStore(sessionId, store);
			return result(`Updated task ${updated.id}.\n${formatTasks(store.tasks)}`, {
				task: updated,
				tasks: store.tasks,
			});
		},
	};
}
