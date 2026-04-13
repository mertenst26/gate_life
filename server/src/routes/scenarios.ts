import { FastifyInstance } from 'fastify';
import { scenarioBuilder } from '../services/ScenarioBuilderService.js';
import { gameState } from '../services/GameStateService.js';
import type {
  CreateScenarioRequest, EntityChatRequest, ScenarioEntityType,
} from '@gate-life/shared';

export async function scenarioRoutes(app: FastifyInstance) {
  app.get('/', async () => {
    return scenarioBuilder.listScenarios();
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

    const campaign = gameState.createCampaign({
      name: scenario.name,
      gm_kind: scenario.gm_kind,
    });
    const session = gameState.createSession(campaign.id);

    for (const entity of entities) {
      if (entity.entity_type === 'enemy') {
        const def = entity.definition as any;
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
      } else {
        // NPC -> agent combatant
        const def = entity.definition as any;
        const combatant = gameState.createCombatant({
          campaign_id: campaign.id,
          name: entity.name,
          kind: 'agent',
        });
        // Position the NPC on the tactical grid
        if (combatant) {
          gameState.updateCombatantPosition(combatant.id, entity.grid_x, entity.grid_y);
        }
      }
    }

    return { campaign, session, scenario_id: scenario.id };
  });
}
