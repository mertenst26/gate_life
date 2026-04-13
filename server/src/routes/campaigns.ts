import { FastifyInstance } from 'fastify';
import { gameState } from '../services/GameStateService.js';
import { aiGm } from '../services/AiGmService.js';

export async function campaignRoutes(app: FastifyInstance) {
  app.get('/', async () => {
    return gameState.listCampaigns();
  });

  app.get<{ Params: { id: string } }>('/:id', async (req) => {
    const campaign = gameState.getCampaign(req.params.id);
    if (!campaign) return app.httpErrors.notFound('Campaign not found');
    return campaign;
  });

  app.post<{ Body: { name: string; gm_kind: string; gm_user_id?: string; gm_agent_config?: any } }>('/', async (req) => {
    const { name, gm_kind, gm_user_id, gm_agent_config } = req.body;
    const campaign = gameState.createCampaign({
      name,
      gm_kind: gm_kind as any,
      gm_user_id,
      gm_agent_config,
    });
    const session = gameState.createSession(campaign.id);
    return { campaign, session };
  });

  app.delete<{ Params: { id: string } }>('/:id', async (req) => {
    const campaign = gameState.getCampaign(req.params.id);
    if (!campaign) return app.httpErrors.notFound('Campaign not found');
    gameState.deleteCampaign(req.params.id);
    return { ok: true };
  });

  app.post<{ Body: { campaign_id: string; session_id: string } }>('/start-narration', async (req) => {
    const { campaign_id, session_id } = req.body;
    const campaign = gameState.getCampaign(campaign_id);
    if (!campaign) return app.httpErrors.notFound('Campaign not found');
    if (campaign.gm_kind !== 'agent') return { ok: true, skipped: true };

    const existing = gameState.getMessages(campaign_id, { sessionId: session_id, limit: 5 });
    const hasNarration = existing.some(m => m.message_type === 'gm_narration');
    if (hasNarration) return { ok: true, skipped: true };

    aiGm.generateOpeningNarration(campaign_id, session_id)
      .catch(err => console.error('[aiGm] Opening narration failed:', err));

    return { ok: true };
  });
}
