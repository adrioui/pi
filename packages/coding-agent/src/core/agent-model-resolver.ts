import type { Api } from "@earendil-works/pi-ai";
import type { Model } from "@earendil-works/pi-ai/compat";
import { ROLE_DEFINITIONS } from "@earendil-works/pi-event-core";
import type { AgentSessionServices } from "./agent-session-services.ts";
import { resolvePreferredAuxModel } from "./aux-model.ts";
import { getTierModelIds } from "./model-tier-config.ts";

export class AgentModelResolver {
	private readonly services: AgentSessionServices;

	constructor(services: AgentSessionServices) {
		this.services = services;
	}

	resolve(roleId: string, _agentId?: string): Model<Api> | undefined {
		const tier = ROLE_DEFINITIONS[roleId]?.tier ?? "smart";
		const available = this.services.modelRegistry.getAvailable();
		for (const id of getTierModelIds(tier)) {
			const match = available.find((model) => model.id === id || `${model.provider}/${model.id}` === id);
			if (match) return match as Model<Api>;
		}
		return resolvePreferredAuxModel(this.services);
	}
}
