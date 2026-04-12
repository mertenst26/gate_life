import { FastifyInstance } from 'fastify';
import { gameState } from '../services/GameStateService.js';
import { characterService } from '../services/CharacterService.js';
import { aiGm } from '../services/AiGmService.js';
import { broadcastToSession } from '../ws/handler.js';

export async function combatantRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { campaign_id: string } }>('/', async (req) => {
    return gameState.getPartyCombatants(req.query.campaign_id);
  });

  app.get<{ Params: { id: string } }>('/:id', async (req) => {
    const combatant = gameState.getCombatant(req.params.id);
    if (!combatant) return app.httpErrors.notFound('Combatant not found');
    const injuries = gameState.getInjuries(req.params.id);
    return { ...combatant, injuries };
  });

  app.post<{ Body: { campaign_id: string; name: string; kind: string; controller?: string; personality_preset?: string } }>('/', async (req) => {
    const { campaign_id, name, kind, controller, personality_preset } = req.body;
    const combatant = characterService.createCharacter({
      campaignId: campaign_id,
      name,
      kind: kind as any,
      controller,
      personalityPreset: personality_preset,
    });

    // Auto-transition session out of charCreate on first human character
    const session = gameState.getActiveSession(campaign_id);
    if (session && session.current_mode === 'charCreate') {
      gameState.updateSessionMode(session.id, 'conversation');

      // Broadcast the mode change so the client updates immediately
      broadcastToSession(session.id, {
        type: 'mode_change',
        payload: { mode: 'conversation', turn_state: null },
        timestamp: new Date().toISOString(),
      });

      // Broadcast updated party so all clients see the new member
      const party = gameState.getPartyCombatants(campaign_id);
      broadcastToSession(session.id, {
        type: 'party_update',
        payload: party,
        timestamp: new Date().toISOString(),
      });

      // Trigger AI GM opening narration
      const campaign = gameState.getCampaign(campaign_id);
      if (campaign?.gm_kind === 'agent') {
        aiGm.generateOpeningNarration(campaign_id, session.id)
          .catch(err => console.error('[aiGm] Opening narration failed:', err));
      }
    }

    return combatant;
  });

  app.post<{ Body: { campaign_id: string; name: string; personality_preset?: string } }>('/respawn', async (req) => {
    const { campaign_id, name, personality_preset } = req.body;
    return characterService.respawnAgent({ campaignId: campaign_id, name, personalityPreset: personality_preset });
  });

  app.patch<{ Params: { id: string }; Body: Record<string, any> }>('/:id/vitals', async (req) => {
    gameState.updateCombatantVitals(req.params.id, req.body);
    return { success: true };
  });

  app.patch<{ Params: { id: string }; Body: { x: number; y: number; facing?: string } }>('/:id/position', async (req) => {
    gameState.updateCombatantPosition(req.params.id, req.body.x, req.body.y, req.body.facing);
    return { success: true };
  });

  app.post<{ Params: { id: string }; Body: { xp: number } }>('/:id/xp', async (req) => {
    return gameState.updateCombatantXP(req.params.id, req.body.xp);
  });

  app.get<{ Params: { id: string } }>('/:id/vitals/history', async (req) => {
    return gameState.getVitalSamples(req.params.id);
  });
}
