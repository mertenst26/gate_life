import { FastifyInstance } from 'fastify';
import { fetchTerrain, DEFAULT_GRID_ORIGIN_LAT, DEFAULT_GRID_ORIGIN_LNG } from '../services/OsmTerrainService.js';
import { gameState } from '../services/GameStateService.js';

export async function terrainRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: { session_id: string; cx?: string; cy?: string; radius?: string };
  }>('/', async (req) => {
    const { session_id, cx, cy, radius } = req.query;
    if (!session_id) return app.httpErrors.badRequest('session_id is required');

    const centerX = parseInt(cx ?? '0', 10);
    const centerY = parseInt(cy ?? '0', 10);
    const r = parseInt(radius ?? '60', 10);

    const session = gameState.getSession(session_id);
    if (!session) return app.httpErrors.notFound('Session not found');

    const campaign = gameState.getCampaign(session.campaign_id);
    const cfg = campaign?.gm_agent_config;
    const olat = typeof cfg?.grid_origin_lat === 'number' ? cfg.grid_origin_lat : DEFAULT_GRID_ORIGIN_LAT;
    const olng = typeof cfg?.grid_origin_lng === 'number' ? cfg.grid_origin_lng : DEFAULT_GRID_ORIGIN_LNG;

    const result = await fetchTerrain(session_id, centerX, centerY, r, olat, olng);
    return result;
  });
}
