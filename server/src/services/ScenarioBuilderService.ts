import { v4 as uuid } from 'uuid';
import { getDb } from '../db/connection.js';
import { llmChat, type LlmMessage } from './LlmService.js';
import type {
  Scenario, ScenarioEntity, ScenarioEntityType,
  CreateScenarioRequest, EntityChatResponse, SuggestionGroup, WanderingMonsterConfig,
} from '@gate-life/shared';

const RULES_CONTEXT = `
Gate Life -- Quick Rules Reference (Rifts-inspired)

COMBAT (Melee Round = 15 seconds):
- Initiative: d20 + bonuses, re-rolled each round
- Strike: d20 + bonus. 5+ hits. Nat 20 = critical (2x damage). Nat 1 = miss.
- Defense: parry (free) or dodge (costs 1 action). Must meet/exceed strike roll. Ties to defender.
- Damage: weapon dice + PS bonus. MD hits armor MDC first. SDC cannot damage MDC.
- Roll with Impact: 1 action, d20 >= strike roll = half damage.

DAMAGE:
- SDC: normal damage. MDC: mega-damage. 1 MD = 100 SDC.
- HP + SDC = body. Armor = MDC (separate).
- 0 HP = unconscious. -PE HP = death.

PSIONICS:
- ISP pool. Recovery: 2/hr rest, 6/hr meditation.
- Save vs psionics: 12+ on d20.

DOG BOY:
- Innate: Sense psychic/magic (50ft+), super smell, keen senses.
- Starting: Sixth Sense (2 ISP), Empathy (4 ISP), See Aura (6 ISP).
- APM: 4 at level 1. Combat: +2 init, +2 parry, +2 dodge.
`.trim();

function buildEntitySystemPrompt(entityType: ScenarioEntityType): string {
  const labelMap: Record<ScenarioEntityType, string> = {
    enemy: 'Enemy',
    npc: 'NPC',
    friendly: 'Friendly Unit',
    vehicle: 'Vehicle',
    poi: 'Point of Interest',
  };
  const entityLabel = labelMap[entityType] ?? entityType;

  const enemyShape = JSON.stringify({
    name: 'string',
    enemy_type: "string (e.g. 'brodkil', 'coalition_grunt', 'wild_animal')",
    hp_max: 'number',
    sdc_max: 'number',
    mdc_max: 'number | null',
    apm: 'number',
    initiative_bonus: 'number',
    strike_bonus: 'number',
    parry_bonus: 'number',
    dodge_bonus: 'number',
    damage: "dice string (e.g. '2d6+4')",
    damage_type: '"sdc" | "md"',
    abilities: ['string'],
    loot_table: [],
  }, null, 2);

  const npcShape = JSON.stringify({
    name: 'string',
    class_id: 'string',
    personality: 'string description',
    priorities: ['string — what the NPC is trying to accomplish; quest-giver NPCs achieve this by assigning it to the players as a mission. e.g. "Find someone to recover the stolen medical shipment", "Refer all strangers to Commander Voss", "Guard the east entrance"'],
    priority_mission_pois: ['optional — same length as priorities; each entry is either a scenario POI name to reveal on the map when that mission is accepted, or null'],
    hp_max: 'number',
    sdc_max: 'number',
    isp_max: 'number',
    ppe_max: 'number',
    armor_mdc_max: 'number',
    apm: 'number',
    initiative_bonus: 'number',
    strike_bonus: 'number',
    parry_bonus: 'number',
    dodge_bonus: 'number',
    psionic_powers: ['string'],
    skills: ['string'],
    inventory: [{ name: 'string', type: 'string' }],
  }, null, 2);

  const friendlyShape = JSON.stringify({
    name: 'string',
    unit_type: "string (e.g. 'coalition_patrol', 'freedom_fighter', 'mercenary')",
    faction: 'string',
    disposition: "string (e.g. 'allied', 'neutral_friendly', 'cautious')",
    hp_max: 'number',
    sdc_max: 'number',
    mdc_max: 'number | null',
    apm: 'number',
    initiative_bonus: 'number',
    strike_bonus: 'number',
    parry_bonus: 'number',
    dodge_bonus: 'number',
    damage: "dice string (e.g. '2d6+4')",
    damage_type: '"sdc" | "md"',
    abilities: ['string'],
    description: 'string — brief visual description for detection alert',
  }, null, 2);

  const vehicleShape = JSON.stringify({
    name: 'string',
    vehicle_type: "string (e.g. 'hover_cycle', 'apc', 'glitter_boy_mech', 'civilian_truck')",
    faction: 'string',
    mdc_max: 'number',
    mdc_current: 'number',
    crew: 'number',
    speed_mph: 'number',
    weapons: ['string'],
    description: 'string — brief visual description for detection alert',
  }, null, 2);

  const poiShape = JSON.stringify({
    name: 'string',
    poi_type: "string (e.g. 'rift_tear', 'crashed_spacecraft', 'supply_cache', 'ruins', 'ambush_site')",
    description: 'string — narrative description revealed when party detects this location',
    interactive: 'boolean — can party interact with it?',
    loot: ['string'],
    hazards: ['string'],
  }, null, 2);

  const statShape = entityType === 'enemy' ? enemyShape
    : entityType === 'npc' ? npcShape
    : entityType === 'friendly' ? friendlyShape
    : entityType === 'vehicle' ? vehicleShape
    : poiShape;

  return [
    `You are a game design assistant for "Gate Life", a Rifts-inspired tactical RPG.`,
    ``,
    `The admin is placing a new ${entityLabel} on the scenario map. You have EXACTLY TWO rounds of questions, then you MUST produce the final stat block — no exceptions.`,
    ``,
    `ROUND RULES (strictly enforced):`,
    `- Round 1 (your first response): Ask exactly 3 questions covering the most important unknowns (type, setting, difficulty).`,
    `- Round 2 (your second response): Ask exactly 3 follow-up questions to fill remaining gaps.`,
    `- Round 3+ (third response onward): Output the final \`\`\`json stat block immediately. NO more questions. Infer every missing detail from context and Rifts lore.`,
    ``,
    `If the admin's very first message already answers most questions, skip early to the stat block — but never exceed two question rounds.`,
    ``,
    RULES_CONTEXT,
    ``,
    `STAT BLOCK — when ready, wrap the ${entityLabel} in \`\`\`json fences:`,
    '```json',
    statShape,
    '```',
    ``,
    entityType === 'npc'
      ? [
          `NPC PRIORITIES — CRITICAL CONCEPT:`,
          `Priorities are this NPC's goals — what they are trying to accomplish in the scenario.`,
          `An NPC achieves their priorities in ONE of two ways:`,
          `  1. DIRECTLY — they do it themselves (e.g. "Guard the gate", "Report intruders to command")`,
          `  2. BY DELEGATION — they assign it to the player as a mission/quest (e.g. "Hire someone to recover stolen cargo", "Find agents willing to escort the convoy")`,
          ``,
          `Quest-giver NPCs primarily use delegation: their priorities ARE the missions they offer to players.`,
          `For example: a desperate survivor NPC might have priority "Find medicine for the settlement" — when players meet her, she asks them to retrieve it.`,
          ``,
          `ALWAYS include a "priorities" array of 1–4 entries. Each entry is a short verb phrase describing ONE goal.`,
          `ORDER MATTERS: list priorities top-to-bottom in the JSON array — the FIRST entry is the mission they lead with in play; the AI GM advances to the second only after the first is addressed, then the third, and so on.`,
          `COMPLETION: players must CONVINCE this NPC in play that each mission is done — proof and evidence beat a bare story; the NPC decides when to grant credit.`,
          `Ask about priorities if not specified — they are the core of how this NPC drives scenario flow.`,
        ].join('\n')
      : null,
    ``,
    `Keep prose to one short paragraph before questions or the stat block.`,
    ``,
    `QUICK-PICK SUGGESTIONS: On rounds 1 and 2 only, after your questions append a \`\`\`suggestions block — one object per question with a "question" label and 3–5 short (2–4 word) chips:`,
    '```suggestions',
    entityType === 'enemy'
      ? `[\n  { "question": "Setting", "chips": ["Urban ruins", "Wilderness", "Coalition base", "Rift site"] },\n  { "question": "Difficulty", "chips": ["Easy", "Medium", "Hard", "Boss"] },\n  { "question": "Type", "chips": ["D-Bee raider", "Coalition soldier", "Wild animal", "Rogue robot"] }\n]`
      : entityType === 'npc'
      ? `[\n  { "question": "Role", "chips": ["Quest giver", "Guard / sentry", "Merchant", "Informant", "Boss / commander"] },\n  { "question": "Disposition", "chips": ["Friendly", "Cautious", "Suspicious", "Desperate"] },\n  { "question": "Priorities", "chips": ["Assign a mission", "Guard area", "Direct to boss", "Trade intel", "Protect someone"] }\n]`
      : entityType === 'friendly'
      ? `[\n  { "question": "Faction", "chips": ["Freedom Fighters", "Mercenary", "Coalition", "Wilderness Scout"] },\n  { "question": "Role", "chips": ["Infantry", "Sniper", "Medic", "Heavy weapons"] },\n  { "question": "Readiness", "chips": ["Alert", "Patrolling", "Fortified", "Pinned down"] }\n]`
      : entityType === 'vehicle'
      ? `[\n  { "question": "Faction", "chips": ["Coalition", "D-Bee", "Bandits", "Abandoned"] },\n  { "question": "Type", "chips": ["Hover bike", "APC", "Giant robot", "Civilian truck"] },\n  { "question": "Condition", "chips": ["Operational", "Damaged", "Wrecked", "Concealed"] }\n]`
      : `[\n  { "question": "Type", "chips": ["Rift tear", "Crashed ship", "Supply cache", "Ancient ruins"] },\n  { "question": "Danger", "chips": ["Safe", "Hazardous", "Trapped", "Unstable rift"] },\n  { "question": "Value", "chips": ["Tactical info", "Loot", "Shelter", "Story hook"] }\n]`,
    '```',
    `Rules: one group per question, 3–5 chips, 2–4 words each. For enemy difficulty always use exactly: "Easy", "Medium", "Hard", "Boss". Do NOT include a suggestions block when outputting the final \`\`\`json stat block.`,
  ].filter(s => s !== null).join('\n');
}


function extractJsonBlock(text: string): Record<string, unknown> | null {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

function extractSuggestions(text: string): SuggestionGroup[] {
  const match = text.match(/```suggestions\s*([\s\S]*?)```/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1].trim());
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((g: any) => g && typeof g.question === 'string' && Array.isArray(g.chips))
      .slice(0, 6)
      .map((g: any) => ({
        question: String(g.question).slice(0, 40),
        chips: g.chips.map(String).slice(0, 6),
      }));
  } catch {
    return [];
  }
}

/** Remove all fenced code blocks that aren't meant to be shown to the user. */
function cleanReply(text: string): string {
  return text
    .replace(/```suggestions[\s\S]*?```/g, '')
    .replace(/```json[\s\S]*?```/g, '')
    .trim();
}

class ScenarioBuilderService {
  // ── Scenarios ──

  createScenario(req: CreateScenarioRequest, userId: string): Scenario {
    const db = getDb();
    const id = uuid();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO scenarios (id, name, description, creator_user_id, gm_kind, start_lat, start_lng, wandering_monster_config, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, req.name, req.description || null, userId, req.gm_kind, req.start_lat, req.start_lng,
      req.wandering_monster_config ? JSON.stringify(req.wandering_monster_config) : null,
      now,
    );
    return this.getScenario(id)!;
  }

  getScenario(id: string): Scenario | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(id) as any;
    if (!row) return null;
    return {
      ...row,
      wandering_monster_config: row.wandering_monster_config
        ? JSON.parse(row.wandering_monster_config)
        : undefined,
    } as Scenario;
  }

  listScenarios(): Scenario[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM scenarios ORDER BY created_at DESC').all() as any[];
    return rows.map(row => ({
      ...row,
      wandering_monster_config: row.wandering_monster_config
        ? JSON.parse(row.wandering_monster_config)
        : undefined,
    }));
  }

  updateScenario(
    id: string,
    updates: Partial<Pick<Scenario, 'name' | 'description' | 'gm_kind' | 'start_lat' | 'start_lng' | 'wandering_monster_config'>>,
  ): Scenario | null {
    const db = getDb();
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [k, v] of Object.entries(updates)) {
      if (v === undefined) continue;
      if (k === 'wandering_monster_config') {
        fields.push('wandering_monster_config = ?');
        values.push(v ? JSON.stringify(v) : null);
      } else {
        fields.push(`${k} = ?`);
        values.push(v);
      }
    }
    if (fields.length === 0) return this.getScenario(id);
    values.push(id);
    db.prepare(`UPDATE scenarios SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getScenario(id);
  }

  deleteScenario(id: string): void {
    const db = getDb();
    db.prepare('DELETE FROM scenarios WHERE id = ?').run(id);
  }

  // ── Entities ──

  getScenarioEntities(scenarioId: string): ScenarioEntity[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM scenario_entities WHERE scenario_id = ? ORDER BY created_at').all(scenarioId) as any[];
    return rows.map(r => ({ ...r, definition: JSON.parse(r.definition) }));
  }

  createEntity(scenarioId: string, entity: Omit<ScenarioEntity, 'id' | 'scenario_id'>): ScenarioEntity {
    const db = getDb();
    const id = uuid();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO scenario_entities (id, scenario_id, entity_type, grid_x, grid_y, lat, lng, name, definition, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, scenarioId, entity.entity_type, entity.grid_x, entity.grid_y,
      entity.lat, entity.lng, entity.name, JSON.stringify(entity.definition), now);
    const row = db.prepare('SELECT * FROM scenario_entities WHERE id = ?').get(id) as any;
    return { ...row, definition: JSON.parse(row.definition) };
  }

  updateEntity(
    scenarioId: string,
    entityId: string,
    updates: { name?: string; definition?: Record<string, unknown>; lat?: number; lng?: number; grid_x?: number; grid_y?: number },
  ): ScenarioEntity | null {
    const db = getDb();
    const fields: string[] = [];
    const values: unknown[] = [];
    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    if (updates.definition !== undefined) { fields.push('definition = ?'); values.push(JSON.stringify(updates.definition)); }
    if (updates.lat !== undefined) { fields.push('lat = ?'); values.push(updates.lat); }
    if (updates.lng !== undefined) { fields.push('lng = ?'); values.push(updates.lng); }
    if (updates.grid_x !== undefined) { fields.push('grid_x = ?'); values.push(updates.grid_x); }
    if (updates.grid_y !== undefined) { fields.push('grid_y = ?'); values.push(updates.grid_y); }
    console.log('[updateEntity] fields:', fields, 'values:', values.slice(0, fields.length));
    if (fields.length === 0) {
      const row = db.prepare('SELECT * FROM scenario_entities WHERE id = ? AND scenario_id = ?').get(entityId, scenarioId) as any;
      return row ? { ...row, definition: JSON.parse(row.definition) } : null;
    }
    values.push(entityId, scenarioId);
    const sql = `UPDATE scenario_entities SET ${fields.join(', ')} WHERE id = ? AND scenario_id = ?`;
    console.log('[updateEntity] SQL:', sql, '| bind values:', values);
    db.prepare(sql).run(...values);
    const row = db.prepare('SELECT * FROM scenario_entities WHERE id = ?').get(entityId) as any;
    console.log('[updateEntity] after update — lat:', row?.lat, 'lng:', row?.lng);
    return row ? { ...row, definition: JSON.parse(row.definition) } : null;
  }

  deleteEntity(entityId: string): void {
    const db = getDb();
    db.prepare('DELETE FROM scenario_entities WHERE id = ?').run(entityId);
  }

  // ── Location helpers ──

  /**
   * Returns a plain-English description of the real-world geography at the given coords.
   * This is used to ground both the setting designer chat and GM narration.
   */
  getLocationHint(lat: number, lng: number): string {
    // Leadville, CO — highest incorporated city in the US, historic silver mining town
    if (lat >= 39.1 && lat <= 39.4 && lng >= -106.55 && lng <= -106.1) {
      return 'Leadville, Colorado — once the highest incorporated city in the United States at 10,152 ft elevation. A 19th-century silver and lead mining boom town with Victorian brick storefronts, ornate saloons, and sprawling mine shafts. Now ruined by the Rifts: the old Harrison Avenue main street lies cracked and overgrown, the Tabor Opera House is a shattered shell, and ancient mineshafts act as conduits for rift energy. The thin high-altitude air crackles with dimensional static.';
    }
    // Rockies / I-70 corridor
    if (lat >= 39.4 && lat <= 39.8 && lng >= -106.4 && lng <= -105.8) {
      return 'The Colorado Rockies east of the Continental Divide — a high-altitude corridor once threaded by Interstate 70. The old interstate is buckled and grown over, ski resort towers dot the ridgelines like broken teeth, and Eisenhower Tunnel (now a dimensional conduit) hums with rift energy. Alpine forests are half-crystallised by magical fallout.';
    }
    // Colorado Rockies general
    if (lat >= 37 && lat <= 41 && lng >= -109 && lng <= -104) {
      return 'The Colorado Rocky Mountains — jagged peaks, narrow mountain passes, and alpine valleys. Remnants of old mining towns, ski resorts, and mountain highways scar the landscape, now twisted by decades of rift energy and crystal growths.';
    }
    // Generic fallback
    return `Coordinates ${lat.toFixed(4)}°N, ${Math.abs(lng).toFixed(4)}°W. Use the real-world geography of this location as inspiration — what was there before the Rifts, and how dimensional cataclysm transformed it over 300 years.`;
  }

  // ── AI Chat for scenario setting design ──

  async chatSetting(
    lat: number,
    lng: number,
    messages: LlmMessage[],
  ): Promise<{ reply: string; suggestions: string[] }> {
    const locationHint = this.getLocationHint(lat, lng);

    const systemPrompt = [
      `You are a creative writing assistant for "Gate Life" — a Rifts-inspired post-apocalyptic tabletop RPG.`,
      ``,
      `WORLD LORE: Post-apocalyptic Earth ~300 years after the "Coming of the Rifts". Dimensional tears devastated civilization, releasing magic, monsters, and alien life. The Coalition States enforces human supremacy through military force. Characters are Dog Boys (Psi-Hound) — genetically engineered canine-human mutants.`,
      ``,
      `SCENARIO START LOCATION: ${locationHint}`,
      ``,
      `YOUR JOB:`,
      `- Write a vivid 2-3 paragraph setting description for the GM's use, grounded in the REAL geography above.`,
      `- Be specific: name recognizable ruins (old storefronts, mine headframes, mountain passes, collapsed buildings), describe rift energy effects, the smell, the light, the danger.`,
      `- Set the mood: gritty, dangerous, sci-fi with dimensional weirdness.`,
      `- Close with a situation the party finds themselves in when the scenario opens.`,
      ``,
      `After your setting text, append exactly this line with 4 suggestion chips the designer can click to refine:`,
      `<!--SUGGESTIONS:["chip 1","chip 2","chip 3","chip 4"]-->`,
      `Make chips specific to the real location and Rifts world — e.g. "Add a crashed Coalition APC on Harrison Ave", "Set it at twilight with a rift crackling over the mine headframe", "Include a survivor camp in the Tabor Opera House ruins".`,
      `Never skip the SUGGESTIONS block.`,
    ].join('\n');

    const raw = await llmChat(systemPrompt, messages, { maxTokens: 900, temperature: 0.85 });

    const sugMatch = raw.match(/<!--SUGGESTIONS:(.*?)-->/s);
    let suggestions: string[] = [];
    if (sugMatch) {
      try { suggestions = JSON.parse(sugMatch[1].trim()); } catch { /* ignore */ }
    }
    const reply = raw.replace(/<!--SUGGESTIONS:.*?-->/s, '').trim();
    return { reply, suggestions };
  }

  // ── AI Chat for wandering monster design ──

  async chatWanderingMonster(
    scenarioId: string,
    messages: LlmMessage[],
  ): Promise<{ reply: string; config?: WanderingMonsterConfig; suggestions?: SuggestionGroup[] }> {
    const scenario = this.getScenario(scenarioId);
    const locationHint = scenario
      ? this.getLocationHint(scenario.start_lat, scenario.start_lng)
      : 'Unknown location';

    const entityStatShape = JSON.stringify({
      name: 'string',
      enemy_type: "string (e.g. 'street_thug', 'patrol_squad', 'wild_animal')",
      hp_max: 'number',
      sdc_max: 'number',
      mdc_max: 'number | null',
      apm: 'number',
      initiative_bonus: 'number',
      strike_bonus: 'number',
      parry_bonus: 'number',
      dodge_bonus: 'number',
      damage: "dice string (e.g. '2d6+4')",
      damage_type: '"sdc" | "md"',
      abilities: ['string'],
      loot_table: [],
    }, null, 2);

    const systemPrompt = [
      `You are a game design assistant for "Gate Life", a Rifts-inspired tactical RPG.`,
      ``,
      `The GM is configuring a WANDERING MONSTER for a scenario — a roaming threat that has a percent chance to appear per turn of movement.`,
      ``,
      `SCENARIO LOCATION: ${locationHint}`,
      scenario?.description ? `SCENARIO DESCRIPTION: ${scenario.description}` : '',
      ``,
      RULES_CONTEXT,
      ``,
      `YOUR JOB:`,
      `- Recommend a suitable wandering monster type for this location and scenario.`,
      `- Suggest an appropriate encounter_chance (1–100) based on how dangerous/permissive the environment is.`,
      `  - Safe civilian area: 2–10%  | Wilderness: 10–25% | Hostile territory: 25–50% | Enemy base: 40–70%`,
      `- Include a short 1-2 sentence rationale (the "notes" field).`,
      ``,
      `RESPONSE RULES (strictly enforced):`,
      `- Round 1: Ask exactly 2 clarifying questions about threat level and environment type, then provide quick-pick SUGGESTIONS.`,
      `- Round 2+: Output the final \`\`\`json block immediately. No more questions.`,
      `- If the first message already answers enough, skip straight to the stat block.`,
      ``,
      `When ready, output a \`\`\`json block in this EXACT shape:`,
      '```json',
      JSON.stringify({
        encounter_chance: 15,
        monster_name: 'string',
        notes: 'string — 1–2 sentence rationale for the GM',
        monster_definition: JSON.parse(entityStatShape),
      }, null, 2),
      '```',
      ``,
      `On round 1 only, after your questions append a \`\`\`suggestions block:`,
      '```suggestions',
      `[`,
      `  { "question": "Environment", "chips": ["Open wilderness", "Urban ruins", "Coalition patrol zone", "Enemy base", "Rift site"] },`,
      `  { "question": "Threat level", "chips": ["Low (5%)", "Medium (20%)", "High (40%)", "Extreme (60%)"] }`,
      `]`,
      '```',
    ].filter(Boolean).join('\n');

    const raw = await llmChat(systemPrompt, messages, { maxTokens: 1400, temperature: 0.75 });

    // Try to parse a wandering monster config from the JSON block
    const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/);
    let config: WanderingMonsterConfig | undefined;
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1].trim());
        if (parsed.encounter_chance && parsed.monster_name && parsed.monster_definition) {
          config = {
            enabled: true,
            encounter_chance: Number(parsed.encounter_chance),
            monster_name: String(parsed.monster_name),
            monster_definition: parsed.monster_definition,
            notes: parsed.notes ? String(parsed.notes) : undefined,
          };
        }
      } catch { /* ignore parse errors */ }
    }

    const suggestions = config ? [] : extractSuggestions(raw);
    const reply = cleanReply(raw);
    return { reply, config, suggestions };
  }

  // ── AI Chat for entity definition ──

  async chatDefineEntity(
    entityType: ScenarioEntityType,
    messages: LlmMessage[],
  ): Promise<EntityChatResponse> {
    const systemPrompt = buildEntitySystemPrompt(entityType);
    const raw = await llmChat(systemPrompt, messages, { maxTokens: 1800, temperature: 0.7 });

    const definition = extractJsonBlock(raw);
    const suggestions = definition ? [] : extractSuggestions(raw);
    const name = definition?.name as string | undefined;
    const reply = cleanReply(raw);

    return { reply, definition: definition ?? undefined, name, suggestions };
  }
}

export const scenarioBuilder = new ScenarioBuilderService();
