import { gameState } from './GameStateService.js';
import { getTemplate } from './ClassTemplateService.js';
import type { Combatant, CombatantKind, InventoryItem, PersonalityProfile } from '@gate-life/shared';
import { PARTY_MAX_SIZE } from '@gate-life/shared';
import { v4 as uuid } from 'uuid';

export class CharacterService {
  createCharacter(opts: {
    campaignId: string;
    name: string;
    kind: CombatantKind;
    controller?: string;
    personalityPreset?: string;
  }): Combatant {
    const party = gameState.getPartyCombatants(opts.campaignId);
    if (party.length >= PARTY_MAX_SIZE) {
      throw new Error(`Party is full (${PARTY_MAX_SIZE}/${PARTY_MAX_SIZE})`);
    }

    const template = getTemplate('dog_boy');
    if (!template) throw new Error('Dog Boy template not found');

    let personality: PersonalityProfile | undefined;
    if (opts.kind === 'agent') {
      const preset = opts.personalityPreset
        ? template.personality_presets.find((p: any) => p.id === opts.personalityPreset)
        : template.personality_presets[Math.floor(Math.random() * template.personality_presets.length)];
      if (preset) {
        personality = {
          preset_id: preset.id,
          temperament: preset.temperament,
          combat_preference: preset.combat_preference,
          speech_style: preset.speech_style,
          quirks: preset.quirks,
        };
      }
    }

    const inventory: InventoryItem[] = template.starting_gear.map((gear: any) => ({
      id: uuid(),
      template_id: gear.id,
      name: gear.name,
      type: gear.type,
      damage: gear.damage || gear.damage_active,
      damage_type: gear.damage_type || gear.damage_active_type,
      mdc: gear.mdc,
      weight: gear.weight || 0,
      quantity: 1,
      equipped: ['armor', 'weapon_ranged', 'weapon_melee'].includes(gear.type),
      uses: gear.uses,
      max_uses: gear.uses,
      charges: gear.charges,
      max_charges: gear.charges,
    }));

    const equipped: Record<string, string> = {};
    for (const item of inventory) {
      if (item.equipped) {
        if (item.type === 'armor') equipped.armor = item.id;
        else if (item.type === 'weapon_ranged') equipped.weapon = item.id;
        else if (item.type === 'weapon_melee') equipped.melee = item.id;
      }
    }

    const startingPowers = template.starting_psionic_powers.map((p: any) => p.id);

    // Spawn near average party position (or at 0,0 if party empty)
    const { spawnX, spawnY } = this.pickSpawnPosition(party);

    return gameState.createCombatant({
      campaign_id: opts.campaignId,
      kind: opts.kind,
      name: opts.name,
      controller: opts.controller,
      tactical_x: spawnX,
      tactical_y: spawnY,
      attributes: template.attributes,
      hp: template.base_hp,
      sdc: template.base_sdc,
      isp: template.base_isp,
      ppe: template.base_ppe,
      apm: template.combat.base_apm,
      combat_bonuses: {
        initiative_bonus: template.combat.initiative_bonus,
        strike_bonus: template.combat.strike_bonus,
        parry_bonus: template.combat.parry_bonus,
        dodge_bonus: template.combat.dodge_bonus,
        roll_with_impact_bonus: template.combat.roll_with_impact_bonus,
        damage_bonus: template.combat.damage_bonus,
      },
      armor_mdc: template.starting_gear.find((g: any) => g.type === 'armor')?.mdc ?? 0,
      psionic_powers: startingPowers,
      skills: template.skills,
      inventory,
      equipped,
      xp_next_level: template.progression.level_table[2]?.xp ?? 2000,
      personality,
    });
  }

  private pickSpawnPosition(existingParty: Combatant[]): { spawnX: number; spawnY: number } {
    const alive = existingParty.filter(c => c.status !== 'dead' && c.tactical_x != null && c.tactical_y != null);
    if (alive.length === 0) return { spawnX: 0, spawnY: 0 };

    const avgX = alive.reduce((s, c) => s + (c.tactical_x ?? 0), 0) / alive.length;
    const avgY = alive.reduce((s, c) => s + (c.tactical_y ?? 0), 0) / alive.length;

    // Scatter ±2 grid units around the average
    const offsets = [[-2, 0], [2, 0], [0, -2], [0, 2], [-1, -1], [1, 1], [-1, 1], [1, -1]];
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
      kind: 'agent',
    });
  }
}

export const characterService = new CharacterService();
