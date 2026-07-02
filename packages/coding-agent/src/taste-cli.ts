import { type AgentSessionServices, createAgentSessionServices } from "./core/agent-session-services.ts";
import { resolvePreferredAuxModel } from "./core/aux-model.ts";
import { TasteProfileStore, type TasteScope } from "./core/taste.ts";
import { runLearnPipeline } from "./core/taste-git-history.ts";
import { resolvePath } from "./utils/paths.ts";

function takeFlag(args: string[], name: string): string | undefined {
	const index = args.indexOf(name);
	if (index === -1) return undefined;
	const value = args[index + 1];
	if (!value || value.startsWith("-")) {
		throw new Error(`${name} requires a value`);
	}
	args.splice(index, 2);
	return value;
}

function takeBooleanFlag(args: string[], name: string): boolean {
	const index = args.indexOf(name);
	if (index === -1) return false;
	args.splice(index, 1);
	return true;
}

function resolveTasteModel(services: AgentSessionServices, provider?: string, modelId?: string) {
	if (!provider && modelId?.startsWith("commandcode/")) {
		provider = "commandcode";
		modelId = modelId.slice("commandcode/".length);
	}
	if (provider && modelId) {
		const match = services.modelRegistry
			.getAvailable()
			.find((model) => model.provider === provider && model.id === modelId);
		if (!match) {
			throw new Error(`Model not available: ${provider}/${modelId}`);
		}
		return match;
	}
	if (provider) {
		const match = services.modelRegistry.getAvailable().find((model) => model.provider === provider);
		if (!match) {
			throw new Error(`No configured models available for provider "${provider}"`);
		}
		return match;
	}
	return resolvePreferredAuxModel(services);
}

export async function handleTasteCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "taste") return false;

	const [, subcommand = "status", ...rest] = args;
	const mutableArgs = [...rest];
	const provider = takeFlag(mutableArgs, "--provider");
	const modelId = takeFlag(mutableArgs, "--model");
	const maxCommits = Number.parseInt(takeFlag(mutableArgs, "--max-commits") ?? "200", 10);
	const maxSignals = Number.parseInt(takeFlag(mutableArgs, "--max-signals") ?? "50", 10);
	const branch = takeFlag(mutableArgs, "--branch");
	const project = takeBooleanFlag(mutableArgs, "--project");
	const global = takeBooleanFlag(mutableArgs, "--global");
	const scope: TasteScope = project ? "project" : global ? "global" : "auto";
	const workspace = resolvePath(mutableArgs[0] ?? process.cwd());
	const store = new TasteProfileStore(undefined, scope);

	if (subcommand === "status") {
		console.log(JSON.stringify(store.status(workspace), null, 2));
		return true;
	}

	if (subcommand === "show") {
		console.log(store.getProfile(workspace) ?? "");
		return true;
	}

	if (subcommand === "list") {
		console.log(JSON.stringify(store.listProfiles(), null, 2));
		return true;
	}

	if (subcommand === "open") {
		store.ensureWorkspace(workspace);
		console.log(store.getProfilePath(workspace));
		return true;
	}

	if (subcommand === "lint") {
		console.log(JSON.stringify(store.lint(workspace), null, 2));
		process.exitCode = store.lint(workspace).valid ? 0 : 1;
		return true;
	}

	if (subcommand === "reorganize") {
		console.log(JSON.stringify(store.reorganize(workspace), null, 2));
		return true;
	}

	if (subcommand === "learn") {
		const source = mutableArgs[0] ?? process.cwd();
		const sourceIsLocal = !/^(https?:|git@|ssh:)/.test(source);
		const cwd = sourceIsLocal ? resolvePath(source) : process.cwd();
		const services = await createAgentSessionServices({ cwd });
		const model = resolveTasteModel(services, provider, modelId);
		const result = await runLearnPipeline({
			source,
			services,
			model,
			sessionId: `taste-${Date.now()}`,
			maxCommits,
			maxSignals,
			branch,
			destinationCwd: cwd,
			scope,
		});
		console.log(JSON.stringify(result, null, 2));
		return true;
	}

	throw new Error(`Unknown taste subcommand: ${subcommand}`);
}
