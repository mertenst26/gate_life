import { v4 as uuid } from 'uuid';
import { getDb } from '../db/connection.js';
import { llmChat, type LlmMessage } from './LlmService.js';
import type {
  Scenario, ScenarioEntity, ScenarioEntityType,
  CreateScenarioRequest, EntityChatResponse, SuggestionGroup,
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
  const entityLabel = entityType === 'enemy' ? 'Enemy' : 'NPC';

  const statShape = entityType === 'enemy'
    ? JSON.stringify({
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
      }, null, 2)
    : JSON.stringify({
        name: 'string',
        class_id: 'string',
        personality: 'string description',
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
    `Keep prose to one short paragraph before questions or the stat block.`,
    ``,
    `QUICK-PICK SUGGESTIONS: On rounds 1 and 2 only, after your questions append a \`\`\`suggestions block — one object per question with a "question" label and 3–5 short (2–4 word) chips:`,
    '```suggestions',
    `[`,
    `  { "question": "Setting", "chips": ["Urban ruins", "Wilderness", "Coalition base", "Rift site"] },`,
    `  { "question": "Difficulty", "chips": ["Easy", "Medium", "Hard", "Boss"] },`,
    `  { "question": "Type", "chips": ["D-Bee raider", "Coalition soldier", "Wild animal", "Rogue robot"] }`,
    `]`,
    '```',
    `Rules: one group per question, 3–5 chips, 2–4 words each. For difficulty always use exactly: "Easy", "Medium", "Hard", "Boss". Do NOT include a suggestions block when outputting the final \`\`\`json stat block.`,
  ].join('\n');
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
      INSERT INTO scenarios (id, name, description, creator_user_id, gm_kind, start_lat, start_lng, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.name, req.description || null, userId, req.gm_kind, req.start_lat, req.start_lng, now);
    return this.getScenario(id)!;
  }

  getScenario(id: string): Scenario | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(id) as any;
    if (!row) return null;
    return row as Scenario;
  }

  listScenarios(): Scenario[] {
    const db = getDb();
    return db.prepare('SELECT * FROM scenarios ORDER BY created_at DESC').all() as Scenario[];
  }

  updateScenario(id: string, updates: Partial<Pick<Scenario, 'name' | 'description' | 'gm_kind' | 'start_lat' | 'start_lng'>>): Scenario | null {
    const db = getDb();
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined) { fields.push(`${k} = ?`); values.push(v); }
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
