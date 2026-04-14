import { FastifyInstance } from 'fastify';
import { scenarioBuilder } from '../services/ScenarioBuilderService.js';
import { gameState } from '../services/GameStateService.js';
import { DEFAULT_GRID_ORIGIN_LAT, DEFAULT_GRID_ORIGIN_LNG } from '../services/OsmTerrainService.js';
import type {
  CreateScenarioRequest, EntityChatRequest, QuestGiverProgressEntry, ScenarioContext, ScenarioEntityType, WanderingMonsterConfig,
} from '@gate-life/shared';

function buildScenarioContext(
  entities: { entity_type: string; name: string; definition: Record<string, unknown> }[],
): ScenarioContext {
  const pois = entities
    .filter(e => e.entity_type === 'poi')
    .map(e => ({ name: e.name }));
  const quest_givers = entities
    .filter(e => e.entity_type === 'npc')
    .map(e => {
      const d = e.definition;
      const priorities = Array.isArray(d.priorities) ? (d.priorities as string[]) : [];
      const raw = Array.isArray(d.priority_mission_pois) ? (d.priority_mission_pois as (string | null)[]) : [];
      const priority_mission_pois = priorities.map((_, i) => (i < raw.length ? raw[i] ?? null : null));
      return { name: e.name, priorities, priority_mission_pois };
    });
  return { pois, quest_givers };
}

function initialQuestGiverProgress(ctx: ScenarioContext): Record<string, QuestGiverProgressEntry> {
  const out: Record<string, QuestGiverProgressEntry> = {};
  for (const g of ctx.quest_givers) {
    out[g.name] = { next_priority_index: 0 };
  }
  return out;
}

export async function scenarioRoutes(app: FastifyInstance) {
  app.get('/', async () => {
    return scenarioBuilder.listScenarios();
  });

  // Setting design chat — no scenario ID required, just lat/lng + message history
  app.post<{
    Body: { lat: number; lng: number; messages: Array<{ role: 'user' | 'assistant'; content: string }> };
  }>('/setting-chat', async (req) => {
    const { lat, lng, messages } = req.body;
    return scenarioBuilder.chatSetting(lat, lng, messages);
  });

  app.get<{ Params: { id: string } }>('/:id', async (req) => {
    const scenario = scenarioBuilder.getScenario(req.params.id);
    if (!scenario) return app.httpErrors.notFound('Scenario not found');
    const entities = scenarioBuilder.getScenarioEntities(req.params.id);
    return { ...scenario, entities };
  });

  app.post<{ Body: CreateScenarioRequest }>('/', async (req) => {
    const { name, description, gm_kind, start_lat, start_lng } = req.body;
    return scenarioBuilder.createScenario(
      { name, description, gm_kind, start_lat, start_lng },
      'system',
    );
  });

  app.put<{ Params: { id: string }; Body: Partial<CreateScenarioRequest> }>('/:id', async (req) => {
    const scenario = scenarioBuilder.getScenario(req.params.id);
    if (!scenario) return app.httpErrors.notFound('Scenario not found');
    return scenarioBuilder.updateScenario(req.params.id, req.body);
  });

  app.delete<{ Params: { id: string } }>('/:id', async (req) => {
    scenarioBuilder.deleteScenario(req.params.id);
    return { ok: true };
  });

  // Wandering monster AI chat
  app.post<{
    Params: { id: string };
    Body: { messages: Array<{ role: 'user' | 'assistant'; content: string }> };
  }>('/:id/wandering-monster/chat', async (req) => {
    const scenario = scenarioBuilder.getScenario(req.params.id);
    if (!scenario) return app.httpErrors.notFound('Scenario not found');
    return scenarioBuilder.chatWanderingMonster(req.params.id, req.body.messages);
  });

  // Save wandering monster config directly
  app.put<{
    Params: { id: string };
    Body: { wandering_monster_config: WanderingMonsterConfig | null };
  }>('/:id/wandering-monster', async (req) => {
    const scenario = scenarioBuilder.getScenario(req.params.id);
    if (!scenario) return app.httpErrors.notFound('Scenario not found');
    return scenarioBuilder.updateScenario(req.params.id, {
      wandering_monster_config: req.body.wandering_monster_config ?? undefined,
    });
  });

  // Entity chat: AI-assisted entity definition
  app.post<{ Params: { id: string }; Body: EntityChatRequest }>('/:id/entities/chat', async (req) => {
    const scenario = scenarioBuilder.getScenario(req.params.id);
    if (!scenario) return app.httpErrors.notFound('Scenario not found');

    const { entity_type, messages } = req.body;
    const result = await scenarioBuilder.chatDefineEntity(entity_type, messages);
    return result;
  });

  // Save a finalized entity
  app.post<{
    Params: { id: string };
    Body: { entity_type: ScenarioEntityType; lat: number; lng: number; grid_x: number; grid_y: number; name: string; definition: Record<string, unknown> };
  }>('/:id/entities', async (req) => {
    const scenario = scenarioBuilder.getScenario(req.params.id);
    if (!scenario) return app.httpErrors.notFound('Scenario not found');

    const { entity_type, lat, lng, grid_x, grid_y, name, definition } = req.body;
    return scenarioBuilder.createEntity(req.params.id, {
      entity_type, lat, lng, grid_x, grid_y, name, definition,
    });
  });

  app.put<{
    Params: { id: string; entityId: string };
    Body: { name?: string; definition?: Record<string, unknown>; lat?: number; lng?: number; grid_x?: number; grid_y?: number };
  }>('/:id/entities/:entityId', async (req) => {
    console.log('[route PUT entity] body keys:', Object.keys(req.body), 'lat:', req.body.lat, 'lng:', req.body.lng, 'grid_x:', req.body.grid_x, 'grid_y:', req.body.grid_y);
    const updated = scenarioBuilder.updateEntity(req.params.id, req.params.entityId, req.body);
    if (!updated) return app.httpErrors.notFound('Entity not found');
    console.log('[route PUT entity] result lat:', updated.lat, 'lng:', updated.lng);
    return updated;
  });

  app.delete<{ Params: { id: string; entityId: string } }>('/:id/entities/:entityId', async (req) => {
    scenarioBuilder.deleteEntity(req.params.entityId);
    return { ok: true };
  });

  // Launch: create a campaign + session seeded from the scenario
  app.post<{ Params: { id: string } }>('/:id/launch', async (req) => {
    const scenario = scenarioBuilder.getScenario(req.params.id);
    if (!scenario) return app.httpErrors.notFound('Scenario not found');

    const entities = scenarioBuilder.getScenarioEntities(req.params.id);

    const startLatN = Number(scenario.start_lat);
    const startLngN = Number(scenario.start_lng);
    const start_lat = Number.isFinite(startLatN) ? startLatN : DEFAULT_GRID_ORIGIN_LAT;
    const start_lng = Number.isFinite(startLngN) ? startLngN : DEFAULT_GRID_ORIGIN_LNG;

    const locationHint = scenarioBuilder.getLocationHint(start_lat, start_lng);
    const settingText = scenario.description
      ? `${scenario.description}\n\nLOCATION: ${locationHint}`
      : `LOCATION: ${locationHint}\nThe scenario starts at approximately ${start_lat.toFixed(4)}°N, ${Math.abs(start_lng).toFixed(4)}°W.`;

    const scenario_context = buildScenarioContext(entities);
    const quest_giver_progress = initialQuestGiverProgress(scenario_context);

    const scenarioPartyExcludedAgentNames = entities
      .filter(e => e.entity_type === 'npc' || e.entity_type === 'friendly')
      .map(e => e.name.trim())
      .filter((n): n is string => n.length > 0);

    const campaign = gameState.createCampaign({
      name: scenario.name,
      gm_kind: scenario.gm_kind,
      grid_origin_lat: start_lat,
      grid_origin_lng: start_lng,
      gm_agent_config: {
        setting: settingText,
        grid_origin_lat: start_lat,
        grid_origin_lng: start_lng,
        scenario_party_excluded_agent_names: scenarioPartyExcludedAgentNames,
        scenario_context,
        quest_giver_progress,
        ...(scenario.wandering_monster_config?.enabled
          ? { wandering_monster: scenario.wandering_monster_config }
          : {}),
      },
    });
    const session = gameState.createSession(campaign.id);
    // Persist grid origin on the session so the client map matches the scenario even if campaign JSON is delayed
    gameState.updateSessionTerrainOrigin(session.id, start_lat, start_lng);

    for (const entity of entities) {
      const def = entity.definition as any;

      if (entity.entity_type === 'npc') {
        const d = def as Record<string, unknown>;
        // Scenario NPCs are world entities (session enemies), not party combatants — same table as other map tokens.
        const npcEnemy = gameState.createEnemy(session.id, {
          name: entity.name,
          enemy_type: 'neutral',
          icon_type: 'npc',
          hp_max: typeof d.hp_max === 'number' ? d.hp_max : 20,
          hp_current: typeof d.hp_max === 'number' ? d.hp_max : 20,
          sdc_max: typeof d.sdc_max === 'number' ? d.sdc_max : 0,
          sdc_current: typeof d.sdc_max === 'number' ? d.sdc_max : 0,
          mdc_max: typeof d.mdc_max === 'number' ? d.mdc_max : undefined,
          mdc_current: typeof d.mdc_max === 'number' ? d.mdc_max : undefined,
          apm: typeof d.apm === 'number' ? d.apm : 2,
          initiative_bonus: typeof d.initiative_bonus === 'number' ? d.initiative_bonus : 0,
          strike_bonus: typeof d.strike_bonus === 'number' ? d.strike_bonus : 0,
          parry_bonus: typeof d.parry_bonus === 'number' ? d.parry_bonus : 0,
          dodge_bonus: typeof d.dodge_bonus === 'number' ? d.dodge_bonus : 0,
          damage: typeof d.damage === 'string' ? d.damage : '1d4',
          damage_type: ((d.damage_type as string) ?? 'sdc') as 'sdc' | 'md',
          tactical_x: entity.grid_x,
          tactical_y: entity.grid_y,
          abilities: Array.isArray(d.abilities) ? (d.abilities as string[]) : [],
          loot_table: [],
        });
        // Show quest-relevant NPCs on the map from session start (no fog-of-war for them).
        gameState.markEnemyDetected(npcEnemy.id);
      } else if (entity.entity_type === 'enemy') {
        gameState.createEnemy(session.id, {
          name: entity.name,
          enemy_type: def.enemy_type ?? 'unknown',
          hp_max: def.hp_max ?? 20,
          hp_current: def.hp_max ?? 20,
          sdc_max: def.sdc_max ?? 0,
          sdc_current: def.sdc_max ?? 0,
          mdc_max: def.mdc_max ?? null,
          mdc_current: def.mdc_max ?? null,
          apm: def.apm ?? 2,
          initiative_bonus: def.initiative_bonus ?? 0,
          strike_bonus: def.strike_bonus ?? 0,
          parry_bonus: def.parry_bonus ?? 0,
          dodge_bonus: def.dodge_bonus ?? 0,
          damage: def.damage ?? '1d6',
          damage_type: def.damage_type ?? 'sdc',
          tactical_x: entity.grid_x,
          tactical_y: entity.grid_y,
          abilities: def.abilities ?? [],
          loot_table: def.loot_table ?? [],
        });
      } else if (entity.entity_type === 'friendly') {
        // Friendly unit → enemies table with entity_type='friendly', not hostile
        gameState.createEnemy(session.id, {
          name: entity.name,
          enemy_type: 'friendly',
          hp_max: def.hp_max ?? 20,
          hp_current: def.hp_max ?? 20,
          sdc_max: def.sdc_max ?? 0,
          sdc_current: def.sdc_max ?? 0,
          mdc_max: def.mdc_max ?? null,
          mdc_current: def.mdc_max ?? null,
          apm: def.apm ?? 2,
          initiative_bonus: def.initiative_bonus ?? 0,
          strike_bonus: def.strike_bonus ?? 0,
          parry_bonus: def.parry_bonus ?? 0,
          dodge_bonus: def.dodge_bonus ?? 0,
          damage: def.damage ?? '1d4',
          damage_type: def.damage_type ?? 'sdc',
          tactical_x: entity.grid_x,
          tactical_y: entity.grid_y,
          abilities: def.abilities ?? [],
          loot_table: [],
        });
      } else if (entity.entity_type === 'vehicle') {
        const vehicleCfg = def.vehicle_config as Record<string, unknown> | undefined;
        const vehicleSpeed = (vehicleCfg?.speed as number | undefined) ?? 15;
        const vehicleType = (def.vehicle_type as string | undefined) ?? 'transport';
        const isTransport = vehicleType.includes('transport') || vehicleType.includes('lifter') || vehicleType.includes('vtol') || vehicleType.includes('gunship');
        gameState.createEnemy(session.id, {
          name: entity.name,
          enemy_type: 'vehicle',
          icon_type: vehicleType,
          hp_max: def.hp_max as number ?? 10,
          hp_current: def.hp_max as number ?? 10,
          sdc_max: def.sdc_max as number ?? 0,
          sdc_current: def.sdc_max as number ?? 0,
          mdc_max: def.mdc_max as number ?? 100,
          mdc_current: def.mdc_max as number ?? 100,
          apm: def.apm as number ?? 2,
          initiative_bonus: def.initiative_bonus as number ?? 0,
          strike_bonus: def.strike_bonus as number ?? 0,
          parry_bonus: def.parry_bonus as number ?? 0,
          dodge_bonus: def.dodge_bonus as number ?? 0,
          damage: (def.weapons as string[] | undefined)?.[0] ?? '1d6',
          damage_type: 'md',
          tactical_x: entity.grid_x,
          tactical_y: entity.grid_y,
          abilities: def.weapons as string[] ?? [],
          loot_table: [],
          support_config: {
            unit_type: isTransport ? 'transport' : 'gunship',
            speed: vehicleSpeed,
            fuel: vehicleCfg?.fuel as number ?? 100,
            max_fuel: vehicleCfg?.max_fuel as number ?? 100,
            can_extract: isTransport,
          },
        });
      } else if (entity.entity_type === 'poi') {
        // POI → enemies table with enemy_type='poi', minimal stats
        gameState.createEnemy(session.id, {
          name: entity.name,
          enemy_type: 'poi',
          hp_max: 1,
          hp_current: 1,
          sdc_max: 0,
          sdc_current: 0,
          mdc_max: undefined,
          mdc_current: undefined,
          apm: 0,
          initiative_bonus: 0,
          strike_bonus: 0,
          parry_bonus: 0,
          dodge_bonus: 0,
          damage: '0',
          damage_type: 'sdc',
          tactical_x: entity.grid_x,
          tactical_y: entity.grid_y,
          abilities: [],
          loot_table: (def.loot ?? []).map((item: string) => ({ item_id: item, chance: 100, quantity_min: 1, quantity_max: 1 })),
        });
      } else if (entity.entity_type === 'dungeon') {
        // Dungeon is a map overlay — stored in enemies table with enemy_type='dungeon', not a combatant
        gameState.createEnemy(session.id, {
          name: entity.name,
          enemy_type: 'dungeon',
          hp_max: 1,
          hp_current: 1,
          sdc_max: 0,
          sdc_current: 0,
          mdc_max: undefined,
          mdc_current: undefined,
          apm: 0,
          initiative_bonus: 0,
          strike_bonus: 0,
          parry_bonus: 0,
          dodge_bonus: 0,
          damage: '0',
          damage_type: 'sdc',
          tactical_x: entity.grid_x,
          tactical_y: entity.grid_y,
          abilities: [],
          loot_table: [],
        });
      }
    }

    return { campaign, session: gameState.getSession(session.id)!, scenario_id: scenario.id };
  });
}
