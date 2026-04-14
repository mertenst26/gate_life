import type { VehicleConfig } from "@gate-life/shared";

interface VehiclePreset {
	name: string;
	description: string;
	enemy_type: string;
	icon_type: string;
	hp_max: number;
	sdc_max: number;
	mdc_max: number;
	apm: number;
	initiative_bonus: number;
	strike_bonus: number;
	parry_bonus: number;
	dodge_bonus: number;
	damage: string;
	damage_type: "sdc" | "md";
	abilities: string[];
	vehicle_config: VehicleConfig;
}

export const VEHICLE_PRESETS: Record<string, VehiclePreset> = {
	coalition_light_gunship: {
		name: "Coalition Light Gunship",
		description:
			"Fast attack VTOL with twin rail guns and missile pods. Crew: pilot, co-pilot/gunner.",
		enemy_type: "vehicle",
		icon_type: "gunship",
		hp_max: 0,
		sdc_max: 0,
		mdc_max: 180,
		apm: 3,
		initiative_bonus: 2,
		strike_bonus: 6,
		parry_bonus: 0,
		dodge_bonus: 4,
		damage: "6d6×10",
		damage_type: "md",
		abilities: ["Aerial mobility", "Missile barrage", "Strafing run"],
		vehicle_config: {
			include_crew: true,
			crew: [
				{
					role: "Pilot",
					hp_max: 24,
					sdc_max: 30,
					mdc_max: 70,
					skills: [
						"Pilot: Jet",
						"Pilot: Helicopter",
						"Navigation",
						"Radio: Basic",
					],
				},
				{
					role: "Co-Pilot / Gunner",
					hp_max: 22,
					sdc_max: 28,
					mdc_max: 70,
					skills: [
						"Weapon Systems",
						"Targeting",
						"Radio: Basic",
						"Read Sensory Equipment",
					],
				},
			],
			speed: 50, // 500 ft per round
			fuel: 100,
			max_fuel: 100,
			capacity: 0, // No passenger space
		},
	},
	coalition_apc: {
		name: "Coalition APC (Armored Personnel Carrier)",
		description:
			"Heavily armored troop transport with mounted laser turret. Crew: driver, gunner. Capacity: 12 troops.",
		enemy_type: "vehicle",
		icon_type: "vehicle",
		hp_max: 0,
		sdc_max: 0,
		mdc_max: 250,
		apm: 2,
		initiative_bonus: 0,
		strike_bonus: 4,
		parry_bonus: 0,
		dodge_bonus: 2,
		damage: "4d6×10",
		damage_type: "md",
		abilities: ["Heavy armor", "Troop deployment", "Smoke screen"],
		vehicle_config: {
			include_crew: true,
			crew: [
				{
					role: "Driver",
					hp_max: 26,
					sdc_max: 32,
					mdc_max: 70,
					skills: ["Pilot: Tanks & APCs", "Navigation", "Radio: Basic"],
				},
				{
					role: "Gunner",
					hp_max: 24,
					sdc_max: 30,
					mdc_max: 70,
					skills: ["Weapon Systems", "Targeting", "Radio: Basic"],
				},
			],
			speed: 20, // 200 ft per round
			fuel: 150,
			max_fuel: 150,
			capacity: 12,
		},
	},
	coalition_transport_vtol: {
		name: "Coalition Transport VTOL",
		description:
			"Large cargo/troop transport with defensive weapons. Crew: pilot, co-pilot, crew chief, 2 door gunners. Capacity: 24 troops or 8 tons cargo.",
		enemy_type: "vehicle",
		icon_type: "transport",
		hp_max: 0,
		sdc_max: 0,
		mdc_max: 220,
		apm: 2,
		initiative_bonus: 1,
		strike_bonus: 3,
		parry_bonus: 0,
		dodge_bonus: 2,
		damage: "3d6×10",
		damage_type: "md",
		abilities: ["VTOL capability", "Heavy lift", "Defensive turrets"],
		vehicle_config: {
			include_crew: true,
			crew: [
				{
					role: "Pilot",
					hp_max: 25,
					sdc_max: 30,
					mdc_max: 70,
				},
				{
					role: "Co-Pilot",
					hp_max: 24,
					sdc_max: 28,
					mdc_max: 70,
				},
				{
					role: "Crew Chief",
					hp_max: 28,
					sdc_max: 35,
					mdc_max: 70,
				},
				{
					role: "Door Gunner (Port)",
					hp_max: 22,
					sdc_max: 26,
					mdc_max: 70,
				},
				{
					role: "Door Gunner (Starboard)",
					hp_max: 22,
					sdc_max: 26,
					mdc_max: 70,
				},
			],
			speed: 40, // 400 ft per round
			fuel: 200,
			max_fuel: 200,
			capacity: 24,
		},
	},
	hover_cycle: {
		name: "Hover Cycle",
		description: "One-person hover bike, fast and maneuverable. No crew slots.",
		enemy_type: "vehicle",
		icon_type: "vehicle",
		hp_max: 0,
		sdc_max: 0,
		mdc_max: 45,
		apm: 4,
		initiative_bonus: 4,
		strike_bonus: 2,
		parry_bonus: 0,
		dodge_bonus: 6,
		damage: "2d6×10",
		damage_type: "md",
		abilities: ["High speed", "Extreme maneuverability"],
		vehicle_config: {
			include_crew: false, // Rider is separate
			crew: [],
			speed: 80, // 800 ft per round
			fuel: 50,
			max_fuel: 50,
			capacity: 0,
		},
	},
	spider_skull_walker: {
		name: "Spider Skull Walker",
		description:
			"CS medium assault mech with four legs. Crew: pilot, gunner. Heavy firepower platform.",
		enemy_type: "vehicle",
		icon_type: "vehicle",
		hp_max: 0,
		sdc_max: 0,
		mdc_max: 320,
		apm: 3,
		initiative_bonus: 1,
		strike_bonus: 5,
		parry_bonus: 0,
		dodge_bonus: 3,
		damage: "1d4×100",
		damage_type: "md",
		abilities: [
			"All-terrain mobility",
			"Plasma cannon",
			"Mini-missile launcher",
		],
		vehicle_config: {
			include_crew: true,
			crew: [
				{
					role: "Pilot",
					hp_max: 28,
					sdc_max: 36,
					mdc_max: 70,
					skills: ["Pilot: Mecha", "Navigation", "Radio: Basic"],
				},
				{
					role: "Gunner",
					hp_max: 26,
					sdc_max: 34,
					mdc_max: 70,
					skills: ["Weapon Systems", "Targeting", "Radio: Basic"],
				},
			],
			speed: 30, // 300 ft per round
			fuel: 120,
			max_fuel: 120,
			capacity: 0,
		},
	},
};

export function getVehiclePreset(presetKey: string): VehiclePreset | null {
	return VEHICLE_PRESETS[presetKey] || null;
}

export function listVehiclePresets(): Array<{
	key: string;
	name: string;
	description: string;
}> {
	return Object.entries(VEHICLE_PRESETS).map(([key, preset]) => ({
		key,
		name: preset.name,
		description: preset.description,
	}));
}
