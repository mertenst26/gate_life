import type {
	AgentGmConfig,
	Campaign,
	GameMode,
	Session,
	TurnState,
	WorldClock,
} from "@gate-life/shared";
import { v4 as uuid } from "uuid";
import { getDb } from "../db/connection.js";

function coerceGridCoord(v: unknown): number | null | undefined {
	if (v === undefined) return undefined;
	if (v === null || v === "") return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

function normalizeGmAgentConfig(raw: unknown): AgentGmConfig | undefined {
	if (raw == null || typeof raw !== "object") return undefined;
	const cfg = { ...(raw as AgentGmConfig) };
	const lat = Number(cfg.grid_origin_lat as unknown as number);
	const lng = Number(cfg.grid_origin_lng as unknown as number);
	if (Number.isFinite(lat)) cfg.grid_origin_lat = lat;
	else delete cfg.grid_origin_lat;
	if (Number.isFinite(lng)) cfg.grid_origin_lng = lng;
	else delete cfg.grid_origin_lng;
	return cfg;
}

export function parseCampaignRow(row: any): Campaign {
	return {
		...row,
		world_clock: JSON.parse(row.world_clock),
		gm_agent_config: row.gm_agent_config
			? normalizeGmAgentConfig(JSON.parse(row.gm_agent_config))
			: undefined,
		grid_origin_lat: coerceGridCoord(row.grid_origin_lat),
		grid_origin_lng: coerceGridCoord(row.grid_origin_lng),
	};
}

export function parseSessionRow(row: any): Session {
	return {
		...row,
		active: Boolean(row.active),
		turn_state: row.turn_state ? JSON.parse(row.turn_state) : undefined,
		spectator_user_ids: JSON.parse(row.spectator_user_ids),
	};
}

export class CampaignSessionService {
	// ── Campaigns ──

	createCampaign(req: {
		name: string;
		gm_kind: string;
		gm_user_id?: string;
		gm_agent_config?: AgentGmConfig;
		grid_origin_lat?: number | null;
		grid_origin_lng?: number | null;
	}): Campaign {
		const db = getDb();
		const id = uuid();
		const now = new Date().toISOString();
		const gridLat =
			req.grid_origin_lat != null && Number.isFinite(Number(req.grid_origin_lat))
				? Number(req.grid_origin_lat)
				: null;
		const gridLng =
			req.grid_origin_lng != null && Number.isFinite(Number(req.grid_origin_lng))
				? Number(req.grid_origin_lng)
				: null;
		db.prepare(`
      INSERT INTO campaigns (id, name, creator_user_id, gm_kind, gm_user_id, gm_agent_config, grid_origin_lat, grid_origin_lng, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
			id,
			req.name,
			req.gm_user_id || "system",
			req.gm_kind,
			req.gm_user_id || null,
			req.gm_agent_config ? JSON.stringify(req.gm_agent_config) : null,
			gridLat,
			gridLng,
			now,
			now,
		);
		return this.getCampaign(id)!;
	}

	getCampaign(id: string): Campaign | null {
		const db = getDb();
		const row = db
			.prepare("SELECT * FROM campaigns WHERE id = ?")
			.get(id) as any;
		if (!row) return null;
		return parseCampaignRow(row);
	}

	listCampaigns(): Campaign[] {
		const db = getDb();
		const rows = db
			.prepare("SELECT * FROM campaigns ORDER BY created_at DESC")
			.all() as any[];
		return rows.map(parseCampaignRow);
	}

	deleteCampaign(id: string): void {
		const db = getDb();
		db.prepare("DELETE FROM campaigns WHERE id = ?").run(id);
	}

	updateWorldClock(campaignId: string, clock: WorldClock): void {
		const db = getDb();
		db.prepare(
			"UPDATE campaigns SET world_clock = ?, updated_at = ? WHERE id = ?",
		).run(JSON.stringify(clock), new Date().toISOString(), campaignId);
	}

	mergeGmAgentConfig(campaignId: string, patch: Partial<AgentGmConfig>): void {
		const c = this.getCampaign(campaignId);
		if (!c) return;
		const base = c.gm_agent_config ?? {};
		const merged: AgentGmConfig = { ...base, ...patch };
		if (patch.quest_giver_progress != null) {
			merged.quest_giver_progress = {
				...(base.quest_giver_progress ?? {}),
				...patch.quest_giver_progress,
			};
		}
		const db = getDb();
		db.prepare(
			"UPDATE campaigns SET gm_agent_config = ?, updated_at = ? WHERE id = ?",
		).run(JSON.stringify(merged), new Date().toISOString(), campaignId);
	}

	// ── Sessions ──

	createSession(campaignId: string): Session {
		const db = getDb();
		const id = uuid();
		const now = new Date().toISOString();
		db.prepare(`
      INSERT INTO sessions (id, campaign_id, current_mode, active, created_at, updated_at)
      VALUES (?, ?, 'charCreate', 1, ?, ?)
    `).run(id, campaignId, now, now);
		return this.getSession(id)!;
	}

	getSession(id: string): Session | null {
		const db = getDb();
		const row = db
			.prepare("SELECT * FROM sessions WHERE id = ?")
			.get(id) as any;
		if (!row) return null;
		return parseSessionRow(row);
	}

	getActiveSession(campaignId: string): Session | null {
		const db = getDb();
		const row = db
			.prepare("SELECT * FROM sessions WHERE campaign_id = ? AND active = 1")
			.get(campaignId) as any;
		if (!row) return null;
		return parseSessionRow(row);
	}

	updateSessionMode(sessionId: string, mode: GameMode): void {
		const db = getDb();
		db.prepare(
			"UPDATE sessions SET current_mode = ?, updated_at = ? WHERE id = ?",
		).run(mode, new Date().toISOString(), sessionId);
	}

	updateTurnState(sessionId: string, turnState: TurnState | null): void {
		const db = getDb();
		db.prepare(
			"UPDATE sessions SET turn_state = ?, updated_at = ? WHERE id = ?",
		).run(
			turnState ? JSON.stringify(turnState) : null,
			new Date().toISOString(),
			sessionId,
		);
	}

	addSpectator(sessionId: string, userId: string): void {
		const session = this.getSession(sessionId);
		if (!session) return;
		const specs = session.spectator_user_ids;
		if (!specs.includes(userId)) {
			specs.push(userId);
			const db = getDb();
			db.prepare(
				"UPDATE sessions SET spectator_user_ids = ?, updated_at = ? WHERE id = ?",
			).run(JSON.stringify(specs), new Date().toISOString(), sessionId);
		}
	}
}

export const campaignSessionService = new CampaignSessionService();
