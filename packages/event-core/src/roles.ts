export type ModelTier = "fast" | "smart" | "smart+thinking" | "smart+high-temp+thinking";

export interface RoleDef {
	name: string;
	tier: ModelTier;
	maxThoughtChars: number;
	toolkit: "workerBase" | "criticBase" | "observerToolkit" | "compactToolkit";
	webTools: boolean;
	spawnable: boolean;
	icon: string;
}

export const SPAWNABLE_ROLES = new Set(["scout", "architect", "engineer", "critic", "scientist", "artisan"]);

export const ROLE_DEFINITIONS: Record<string, RoleDef> = {
	leader: {
		name: "leader",
		tier: "smart",
		maxThoughtChars: 20000,
		toolkit: "workerBase",
		webTools: true,
		spawnable: false,
		icon: "L",
	},
	scout: {
		name: "scout",
		tier: "fast",
		maxThoughtChars: 2000,
		toolkit: "workerBase",
		webTools: true,
		spawnable: true,
		icon: "S",
	},
	architect: {
		name: "architect",
		tier: "smart+thinking",
		maxThoughtChars: 20000,
		toolkit: "workerBase",
		webTools: true,
		spawnable: true,
		icon: "A",
	},
	engineer: {
		name: "engineer",
		tier: "fast",
		maxThoughtChars: 20000,
		toolkit: "workerBase",
		webTools: false,
		spawnable: true,
		icon: "E",
	},
	critic: {
		name: "critic",
		tier: "smart+thinking",
		maxThoughtChars: 20000,
		toolkit: "criticBase",
		webTools: false,
		spawnable: true,
		icon: "C",
	},
	scientist: {
		name: "scientist",
		tier: "smart+thinking",
		maxThoughtChars: 20000,
		toolkit: "workerBase",
		webTools: true,
		spawnable: true,
		icon: "N",
	},
	artisan: {
		name: "artisan",
		tier: "smart",
		maxThoughtChars: 20000,
		toolkit: "workerBase",
		webTools: false,
		spawnable: true,
		icon: "R",
	},
	observer: {
		name: "observer",
		tier: "fast",
		maxThoughtChars: 3000,
		toolkit: "observerToolkit",
		webTools: false,
		spawnable: false,
		icon: "O",
	},
	compact: {
		name: "compact",
		tier: "smart",
		maxThoughtChars: 6000,
		toolkit: "compactToolkit",
		webTools: false,
		spawnable: false,
		icon: "K",
	},
};
