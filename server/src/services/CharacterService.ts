import type {
	Combatant,
	CombatantKind,
	InventoryItem,
	PersonalityProfile,
} from "@gate-life/shared";
import { PARTY_MAX_SIZE } from "@gate-life/shared";
import { v4 as uuid } from "uuid";
import { rollCharacter } from "./CharacterCreationService.js";
import { getTemplate } from "./ClassTemplateService.js";
import { gameState } from "./GameStateService.js";

export class CharacterService {
	createCharacter(opts: {
		campaignId: string;
		name: string;
		kind: CombatantKind;
		controller?: string;
		personalityPreset?: string;
		classId?: string;
	}): Combatant {
		const party = gameState.getPartyCombatants(opts.campaignId);
		if (party.length >= PARTY_MAX_SIZE) {
			throw new Error(`Party is full (${PARTY_MAX_SIZE}/${PARTY_MAX_SIZE})`);
		}

		const classId = opts.classId || "dog_boy";
		const template = getTemplate(classId);
		if (!template) throw new Error(`Class template "${classId}" not found`);

		const rolled = rollCharacter(classId);
		console.log(
			`[CharacterService] ${template.name} creation — ${rolled.creation_summary}`,
		);

		let personality: PersonalityProfile;
		if (opts.kind === "agent") {
			const preset = opts.personalityPreset
				? template.personality_presets.find(
						(p: any) => p.id === opts.personalityPreset,
					)
				: template.personality_presets[
						Math.floor(Math.random() * template.personality_presets.length)
					];
			if (preset) {
				personality = {
					preset_id: preset.id,
					temperament: preset.temperament,
					combat_preference: preset.combat_preference,
					speech_style: preset.speech_style,
					quirks: [...preset.quirks],
				};
			} else {
				personality = {
					temperament: "determined",
					combat_preference: "balanced",
					speech_style: "direct",
					quirks: [],
				};
			}
		} else {
			personality = {
				temperament: "determined",
				combat_preference: "balanced",
				speech_style: "direct",
				quirks: [],
			};
		}

		const mutationEntries = rolled.mutation_rolls.map((m) => ({
			name: m.name,
			description: m.description,
		}));
		personality.dog_boy_breed = rolled.breed_name;
		personality.dog_boy_mutations = mutationEntries;
		personality.quirks = [
			...(personality.quirks ?? []),
			`Breed stock: ${rolled.breed_name}`,
			...rolled.mutation_rolls
				.filter((m) => !/genome within|within cs norms/i.test(m.name))
				.map((m) => `Genetic: ${m.name}`),
		].slice(0, 28);

		const inventory: InventoryItem[] = template.starting_gear.map(
			(gear: any) => ({
				id: uuid(),
				template_id: gear.id,
				name: gear.name,
				type: gear.type,
				damage: gear.damage || gear.damage_active,
				damage_type: gear.damage_type || gear.damage_active_type,
				mdc: gear.mdc,
				weight: gear.weight || 0,
				quantity: 1,
				equipped: ["armor", "weapon_ranged", "weapon_melee"].includes(
					gear.type,
				),
				uses: gear.uses,
				max_uses: gear.uses,
				charges: gear.charges,
				max_charges: gear.charges,
			}),
		);

		const equipped: Record<string, string> = {};
		for (const item of inventory) {
			if (item.equipped) {
				if (item.type === "armor") equipped.armor = item.id;
				else if (item.type === "weapon_ranged") equipped.weapon = item.id;
				else if (item.type === "weapon_melee") equipped.melee = item.id;
			}
		}

		const startPowerIds = new Set(
			template.starting_psionic_powers.map((p: any) => p.id),
		);
		const bonusPsi = rolled.extra_psionic_power_ids.filter(
			(id) => !startPowerIds.has(id),
		);
		const startingPowers = [
			...template.starting_psionic_powers.map((p: any) => p.id),
			...bonusPsi,
		];

		// Spawn near average party position (or at scenario start point if party empty)
		const { spawnX, spawnY } = this.pickSpawnPosition(opts.campaignId, party);

		const cd = rolled.combat_delta;
		return gameState.createCombatant({
			campaign_id: opts.campaignId,
			kind: opts.kind,
			name: opts.name,
			controller: opts.controller,
			tactical_x: spawnX,
			tactical_y: spawnY,
			attributes: rolled.attributes,
			hp: rolled.hp,
			sdc: rolled.sdc,
			isp: rolled.isp,
			ppe: rolled.ppe,
			apm: template.combat.base_apm,
			combat_bonuses: {
				initiative_bonus:
					template.combat.initiative_bonus + (cd.initiative_bonus ?? 0),
				strike_bonus: template.combat.strike_bonus + (cd.strike_bonus ?? 0),
				parry_bonus: template.combat.parry_bonus + (cd.parry_bonus ?? 0),
				dodge_bonus: template.combat.dodge_bonus + (cd.dodge_bonus ?? 0),
				roll_with_impact_bonus:
					template.combat.roll_with_impact_bonus +
					(cd.roll_with_impact_bonus ?? 0),
				damage_bonus: template.combat.damage_bonus + (cd.damage_bonus ?? 0),
			},
			armor_mdc:
				template.starting_gear.find((g: any) => g.type === "armor")?.mdc ?? 0,
			psionic_powers: startingPowers,
			skills: template.skills,
			inventory,
			equipped,
			xp_next_level: template.progression.level_table[2]?.xp ?? 2000,
			personality,
		});
	}

	private pickSpawnPosition(
		campaignId: string,
		existingParty: Combatant[],
	): {
		spawnX: number;
		spawnY: number;
	} {
		const alive = existingParty.filter(
			(c) =>
				c.status !== "dead" && c.tactical_x != null && c.tactical_y != null,
		);

		// If party empty, use campaign's scenario start point (grid origin) instead of (0,0)
		if (alive.length === 0) {
			const campaign = gameState.getCampaign(campaignId);
			// Grid origin is the scenario start point in grid coordinates
			const startX = 0; // Grid origin is at (0,0) in tactical coordinates
			const startY = 0;
			return { spawnX: startX, spawnY: startY };
		}

		const avgX =
			alive.reduce((s, c) => s + (c.tactical_x ?? 0), 0) / alive.length;
		const avgY =
			alive.reduce((s, c) => s + (c.tactical_y ?? 0), 0) / alive.length;

		// Scatter ±2 grid units around the average
		const offsets = [
			[-2, 0],
			[2, 0],
			[0, -2],
			[0, 2],
			[-1, -1],
			[1, 1],
			[-1, 1],
			[1, -1],
		];
		const [ox, oy] = offsets[alive.length % offsets.length];
		return { spawnX: Math.round(avgX + ox), spawnY: Math.round(avgY + oy) };
	}

	respawnAgent(opts: {
		campaignId: string;
		name: string;
		personalityPreset?: string;
	}): Combatant {
		return this.createCharacter({
			...opts,
			kind: "agent",
		});
	}
}

export const characterService = new CharacterService();
