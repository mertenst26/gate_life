import { FastifyInstance } from 'fastify';
import { fetchTerrain } from '../services/OsmTerrainService.js';

export async function terrainRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: { session_id: string; cx?: string; cy?: string; radius?: string };
  }>('/', async (req) => {
    const { session_id, cx, cy, radius } = req.query;
    if (!session_id) return app.httpErrors.badRequest('session_id is required');

    const centerX = parseInt(cx ?? '0', 10);
    const centerY = parseInt(cy ?? '0', 10);
    const r = parseInt(radius ?? '60', 10);

    const result = await fetchTerrain(session_id, centerX, centerY, r);
    return result;
  });
}
