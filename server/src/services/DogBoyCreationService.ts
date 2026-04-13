import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';
import { roll, rollDie } from '@gate-life/shared';
import type { ClassTemplate } from './ClassTemplateService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREATION_PATH = path.join(__dirname, '../../../class_templates/dog_boy_creation.yaml');

export interface DogBoyMutationRoll {
  name: string;
  description: string;
  d100: number;
  modifiers: Record<string, number>;
  grant_bonus_psionic?: boolean;
}

export interface DogBoyCreationResult {
  attributes: {
    iq: number;
    me: number;
    ma: number;
    ps: number;
    pp: number;
    pe: number;
    pb: number;
    spd_bipedal: number;
    spd_quadruped: number;
  };
  hp: number;
  sdc: number;
  isp: number;
  ppe: number;
  breed_name: string;
  breed_blurb?: string;
  breed_roll: number;
  mutation_rolls: DogBoyMutationRoll[];
  combat_delta: {
    initiative_bonus?: number;
    strike_bonus?: number;
    parry_bonus?: number;
    dodge_bonus?: number;
    roll_with_impact_bonus?: number;
    damage_bonus?: number;
  };
  extra_psionic_power_ids: string[];
  creation_summary: string;
}

interface CreationYaml {
  reference_note?: string;
  attribute_rolls: Record<string, string>;
  spd_bipedal: string;
  base_sdc_roll: string;
  ppe_roll: string;
  mutation_rolls: number;
  bonus_psionic_chance_percent?: number;
  breeds: Array<{ roll: [number, number]; name: string; blurb?: string; modifiers: Record<string, unknown> }>;
  mutations: Array<{
    from: number;
    to: number;
    name: string;
    description: string;
    modifiers: Record<string, unknown>;
    grant_bonus_psionic?: boolean;
  }>;
  bonus_psionic_pool: string[];
}

let cached: CreationYaml | null = null;

function loadCreation(): CreationYaml {
  if (cached) return cached;
  if (!fs.existsSync(CREATION_PATH)) {
    throw new Error(`Dog Boy creation tables not found: ${CREATION_PATH}`);
  }
  cached = YAML.parse(fs.readFileSync(CREATION_PATH, 'utf-8')) as CreationYaml;
  return cached;
}

function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  return fallback;
}

function pickBreed(d20: number, breeds: CreationYaml['breeds']): CreationYaml['breeds'][0] {
  const clamped = Math.max(1, Math.min(20, d20));
  const found = breeds.find(b => clamped >= b.roll[0] && clamped <= b.roll[1]);
  return found ?? breeds[0];
}

function pickMutation(d100: number, mutations: CreationYaml['mutations']): CreationYaml['mutations'][0] {
  const clamped = Math.max(1, Math.min(100, d100));
  const found = mutations.find(m => clamped >= m.from && clamped <= m.to);
  return found ?? mutations[0];
}

function mergeCombatDelta(
  target: DogBoyCreationResult['combat_delta'],
  mods: Record<string, unknown>,
): void {
  const keys = ['initiative_bonus', 'strike_bonus', 'parry_bonus', 'dodge_bonus', 'roll_with_impact_bonus', 'damage_bonus'] as const;
  for (const k of keys) {
    const v = mods[k];
    if (typeof v === 'number') {
      target[k] = (target[k] ?? 0) + v;
    }
  }
}

function mergeNumericAttributes(
  base: Record<string, number>,
  mods: Record<string, unknown>,
  keys: string[],
): void {
  for (const k of keys) {
    const v = mods[k];
    if (typeof v === 'number') {
      base[k] = (base[k] ?? 0) + v;
    }
  }
}

/** Palladium-style melee damage bonus from P.S. (simplified). */
function damageBonusFromPs(ps: number): number {
  if (ps < 17) return 0;
  if (ps <= 20) return 1;
  if (ps <= 23) return 2;
  if (ps <= 26) return 3;
  return 4;
}

/**
 * Full random Dog Boy creation: rolled stats, random breed stock, d100 genetic rolls,
 * optional bonus psionic — aligned with Rifts UE-style tables in `dog_boy_creation.yaml`.
 * (Verify against your rulebook; PDF page numbers vary by printing.)
 */
export function rollDogBoyCharacter(template: ClassTemplate): DogBoyCreationResult {
  const cfg = loadCreation();

  const attrs: Record<string, number> = {};
  for (const key of ['iq', 'me', 'ma', 'ps', 'pp', 'pe', 'pb'] as const) {
    const spec = cfg.attribute_rolls[key];
    if (!spec) continue;
    attrs[key] = roll(spec).total;
  }

  const spdBio = roll(cfg.spd_bipedal).total;
  attrs.spd_bipedal = spdBio;
  attrs.spd_quadruped = Math.round(spdBio * 1.75);

  const breedDie = rollDie(20);
  const breed = pickBreed(breedDie, cfg.breeds);

  const combat_delta: DogBoyCreationResult['combat_delta'] = {};
  const mutation_rolls: DogBoyMutationRoll[] = [];
  const extra_psionic_power_ids: string[] = [];
  let isp_bonus = 0;
  let ppe_bonus = 0;

  let sdc = roll(cfg.base_sdc_roll).total;

  function applyModifierBlock(mods: Record<string, unknown>): void {
    mergeNumericAttributes(attrs, mods, ['iq', 'me', 'ma', 'ps', 'pp', 'pe', 'pb']);
    if (typeof mods.sdc === 'number') sdc += mods.sdc;
    mergeCombatDelta(combat_delta, mods);
    isp_bonus += num(mods.isp_bonus);
    ppe_bonus += num(mods.ppe_bonus);
  }

  applyModifierBlock(breed.modifiers as Record<string, unknown>);

  const nMut = Math.max(0, Math.min(5, cfg.mutation_rolls ?? 2));
  for (let i = 0; i < nMut; i++) {
    const d100 = rollDie(100);
    const row = pickMutation(d100, cfg.mutations);
    const mods = { ...(row.modifiers as Record<string, unknown>) };
    mutation_rolls.push({
      name: row.name,
      description: row.description,
      d100,
      modifiers: Object.fromEntries(
        Object.entries(mods).filter(([, v]) => typeof v === 'number'),
      ) as Record<string, number>,
      grant_bonus_psionic: row.grant_bonus_psionic,
    });

    applyModifierBlock(mods);

    if (row.grant_bonus_psionic && cfg.bonus_psionic_pool?.length) {
      const pick = cfg.bonus_psionic_pool[rollDie(cfg.bonus_psionic_pool.length) - 1];
      if (pick && !extra_psionic_power_ids.includes(pick)) extra_psionic_power_ids.push(pick);
    }
  }

  const chance = cfg.bonus_psionic_chance_percent ?? 0;
  if (chance > 0 && rollDie(100) <= chance && cfg.bonus_psionic_pool?.length) {
    const pick = cfg.bonus_psionic_pool[rollDie(cfg.bonus_psionic_pool.length) - 1];
    if (pick && !extra_psionic_power_ids.includes(pick)) extra_psionic_power_ids.push(pick);
  }

  const pe = Math.round(attrs.pe ?? 10);
  const me = Math.round(attrs.me ?? 10);
  const hp = pe;
  const isp = me + 10 + isp_bonus;
  const ppe = roll(cfg.ppe_roll).total + ppe_bonus;

  const ps = Math.round(attrs.ps ?? 10);
  combat_delta.damage_bonus = (combat_delta.damage_bonus ?? 0) + damageBonusFromPs(ps);

  const unlockIds = new Set((template.unlockable_psionic_powers ?? []).map((p: { id: string }) => p.id));
  const filteredExtras = extra_psionic_power_ids.filter(id => unlockIds.has(id));

  const summaryParts = [
    `Breed (d20=${breedDie}): ${breed.name}`,
    ...mutation_rolls.map(m => `Mutation (d100=${m.d100}): ${m.name}`),
  ];
  if (filteredExtras.length) {
    summaryParts.push(`Bonus psionic(s): ${filteredExtras.join(', ')}`);
  }

  return {
    attributes: {
      iq: Math.round(attrs.iq ?? 10),
      me,
      ma: Math.round(attrs.ma ?? 10),
      ps,
      pp: Math.round(attrs.pp ?? 10),
      pe,
      pb: Math.round(attrs.pb ?? 10),
      spd_bipedal: Math.round(attrs.spd_bipedal ?? 22),
      spd_quadruped: Math.round(attrs.spd_quadruped ?? 40),
    },
    hp,
    sdc: Math.max(1, Math.round(sdc)),
    isp: Math.max(1, isp),
    ppe: Math.max(0, ppe),
    breed_name: breed.name,
    breed_blurb: breed.blurb,
    breed_roll: breedDie,
    mutation_rolls,
    combat_delta,
    extra_psionic_power_ids: filteredExtras,
    creation_summary: summaryParts.join(' · '),
  };
}
