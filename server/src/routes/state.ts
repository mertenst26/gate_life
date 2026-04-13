import { FastifyInstance } from 'fastify';
import { gameState } from '../services/GameStateService.js';
import { listTemplates } from '../services/ClassTemplateService.js';

export async function stateRoutes(app: FastifyInstance) {
  app.get<{ Params: { campaignId: string } }>('/campaign/:campaignId', async (req) => {
    const campaign = gameState.getCampaign(req.params.campaignId);
    if (!campaign) return app.httpErrors.notFound('Campaign not found');
    const session = gameState.getActiveSession(req.params.campaignId);
    const party = gameState.getPartyCombatants(req.params.campaignId);
    const world_npcs = gameState.getWorldNpcCombatants(req.params.campaignId);
    return { campaign, session, party, world_npcs };
  });

  app.get<{ Params: { sessionId: string } }>('/session/:sessionId/enemies', async (req) => {
    return gameState.getSessionEnemies(req.params.sessionId);
  });

  app.get<{ Params: { sessionId: string } }>('/session/:sessionId/terrain', async (req) => {
    return gameState.getTerrain(req.params.sessionId);
  });

  app.get<{ Params: { sessionId: string } }>('/session/:sessionId/events', async (req) => {
    const session = gameState.getSession(req.params.sessionId);
    if (!session) return app.httpErrors.notFound('Session not found');
    return gameState.getEvents(session.campaign_id, { sessionId: req.params.sessionId });
  });

  app.get('/templates', async () => {
    return listTemplates();
  });
}
