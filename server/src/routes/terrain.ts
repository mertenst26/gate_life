import type { FastifyInstance } from "fastify";
import { gameState } from "../services/GameStateService.js";
import {
	DEFAULT_GRID_ORIGIN_LAT,
	DEFAULT_GRID_ORIGIN_LNG,
	fetchTerrain,
} from "../services/OsmTerrainService.js";

export async function terrainRoutes(app: FastifyInstance) {
	app.get<{
		Querystring: {
			session_id: string;
			cx?: string;
			cy?: string;
			radius?: string;
		};
	}>("/", async (req) => {
		const { session_id, cx, cy, radius } = req.query;
		console.log(
			`[terrain-route] GET /terrain?session_id=${session_id}&cx=${cx}&cy=${cy}&radius=${radius}`,
		);

		if (!session_id) return app.httpErrors.badRequest("session_id is required");

		const centerX = parseInt(cx ?? "0", 10);
		const centerY = parseInt(cy ?? "0", 10);
		const r = parseInt(radius ?? "60", 10);

		const session = gameState.getSession(session_id);
		if (!session) {
			console.log(`[terrain-route] Session ${session_id} not found`);
			return app.httpErrors.notFound("Session not found");
		}

		const campaign = gameState.getCampaign(session.campaign_id);
		const cfg = campaign?.gm_agent_config;
		const latCol = Number(campaign?.grid_origin_lat);
		const lngCol = Number(campaign?.grid_origin_lng);
		const latCfg = Number(cfg?.grid_origin_lat);
		const lngCfg = Number(cfg?.grid_origin_lng);
		const olat = Number.isFinite(latCol)
			? latCol
			: Number.isFinite(latCfg)
				? latCfg
				: DEFAULT_GRID_ORIGIN_LAT;
		const olng = Number.isFinite(lngCol)
			? lngCol
			: Number.isFinite(lngCfg)
				? lngCfg
				: DEFAULT_GRID_ORIGIN_LNG;

		console.log(
			`[terrain-route] Using grid origin (${olat}, ${olng}) for campaign ${session.campaign_id.slice(0, 8)}`,
		);

		const result = await fetchTerrain(
			session_id,
			centerX,
			centerY,
			r,
			olat,
			olng,
		);
		console.log(
			`[terrain-route] Returning ${result.tiles.length} tiles, ${result.buildings.length} buildings, ${result.roads.length} roads`,
		);
		return result;
	});
}
