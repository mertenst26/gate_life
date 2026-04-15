import type {
	AgentGmConfig,
	Campaign,
	ChatMessage,
	Combatant,
	CombatantStatus,
	CreateCampaignRequest,
	CreateCombatantRequest,
	Enemy,
	GameEvent,
	GameMode,
	Injury,
	InventoryItem,
	SendMessageRequest,
	SupportUnitConfig,
	TacticalTile,
	TurnState,
	VitalSample,
	WorldClock,
} from "@gate-life/shared";
import { v4 as uuid } from "uuid";
import { getDb } from "../db/connection.js";
import { campaignSessionService } from "./CampaignSessionService.js";
import { enemyService } from "./EnemyService.js";

/**
 * Central facade for all game state DB access.
 * Delegates campaign/session ops to CampaignSessionService and
 * enemy ops to EnemyService, keeping the `gameState.*` API stable.
 */
export class GameStateService {
	// ── Campaigns (delegated) ──

	createCampaign(req: CreateCampaignRequest): Campaign {
		return campaignSessionService.createCampaign(req);
	}
	getCampaign(id: string): Campaign | null {
		return campaignSessionService.getCampaign(id);
	}
	listCampaigns(): Campaign[] {
		return campaignSessionService.listCampaigns();
	}
	deleteCampaign(id: string): void {
		return campaignSessionService.deleteCampaign(id);
	}
	updateWorldClock(campaignId: string, clock: WorldClock): void {
		return campaignSessionService.updateWorldClock(campaignId, clock);
	}
	mergeGmAgentConfig(campaignId: string, patch: Partial<AgentGmConfig>): void {
		return campaignSessionService.mergeGmAgentConfig(campaignId, patch);
	}

	// ── Sessions (delegated) ──

	createSession(campaignId: string): import("@gate-life/shared").Session {
		return campaignSessionService.createSession(campaignId);
	}
	getSession(id: string): import("@gate-life/shared").Session | null {
		return campaignSessionService.getSession(id);
	}
	getActiveSession(campaignId: string): import("@gate-life/shared").Session | null {
		return campaignSessionService.getActiveSession(campaignId);
	}
	updateSessionMode(sessionId: string, mode: GameMode): void {
		return campaignSessionService.updateSessionMode(sessionId, mode);
	}
	updateTurnState(sessionId: string, turnState: TurnState | null): void {
		return campaignSessionService.updateTurnState(sessionId, turnState);
	}
	addSpectator(sessionId: string, userId: string): void {
		return campaignSessionService.addSpectator(sessionId, userId);
	}

	// ── Enemies (delegated) ──

	createEnemy(
		sessionId: string,
		enemy: Partial<Enemy> & { name: string; enemy_type: string; hp_max: number },
	): Enemy {
		return enemyService.createEnemy(sessionId, enemy);
	}
	getEnemy(id: string): Enemy | null {
		return enemyService.getEnemy(id);
	}
	getSessionEnemies(sessionId: string): Enemy[] {
		return enemyService.getSessionEnemies(sessionId);
	}
	updateEnemySupportConfig(id: string, config: SupportUnitConfig): void {
		return enemyService.updateEnemySupportConfig(id, config);
	}
	markEnemyDetected(id: string): void {
		return enemyService.markEnemyDetected(id);
	}
	markPoiQuestReveal(id: string): void {
		return enemyService.markPoiQuestReveal(id);
	}
	updateEnemyHp(id: string, hp: number, status?: CombatantStatus): void {
		return enemyService.updateEnemyHp(id, hp, status);
	}
	updateEnemyPosition(id: string, x: number, y: number, facing?: string): void {
		return enemyService.updateEnemyPosition(id, x, y, facing);
	}

	// ── Combatants ──

	createCombatant(
		req: CreateCombatantRequest & {
			attributes?: Record<string, number>;
			hp?: number;
			sdc?: number;
			isp?: number;
			ppe?: number;
			apm?: number;
			combat_bonuses?: Record<string, number>;
			psionic_powers?: string[];
			skills?: string[];
			inventory?: InventoryItem[];
			equipped?: Record<string, string>;
			armor_mdc?: number;
			xp_next_level?: number;
			personality?: any;
			tactical_x?: number;
			tactical_y?: number;
			party_member?: boolean;
			user_id?: string;
		},
	): Combatant {
		const db = getDb();
		const id = uuid();
		const now = new Date().toISOString();
		const partyMember = req.party_member === false ? 0 : 1;

		db.prepare(`
      INSERT INTO combatants (
        id, campaign_id, kind, controller, class_id, name, personality,
        iq, me, ma, ps, pp, pe, pb, spd_bipedal, spd_quadruped,
        hp_current, hp_max, sdc_current, sdc_max, isp_current, isp_max, ppe_current, ppe_max,
        armor_mdc_current, armor_mdc_max,
        apm, initiative_bonus, strike_bonus, parry_bonus, dodge_bonus, roll_with_impact_bonus, damage_bonus,
        psionic_powers, skills, inventory, equipped,
        xp_next_level, tactical_x, tactical_y, party_member, user_id,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?
      )
    `).run(
			id,
			req.campaign_id,
			req.kind,
			req.controller || null,
			"dog_boy",
			req.name,
			req.personality ? JSON.stringify(req.personality) : null,
			req.attributes?.iq ?? 10,
			req.attributes?.me ?? 11,
			req.attributes?.ma ?? 9,
			req.attributes?.ps ?? 12,
			req.attributes?.pp ?? 12,
			req.attributes?.pe ?? 13,
			req.attributes?.pb ?? 7,
			req.attributes?.spd_bipedal ?? 22,
			req.attributes?.spd_quadruped ?? 40,
			req.hp ?? 13,
			req.hp ?? 13,
			req.sdc ?? 40,
			req.sdc ?? 40,
			req.isp ?? 21,
			req.isp ?? 21,
			req.ppe ?? 18,
			req.ppe ?? 18,
			req.armor_mdc ?? 70,
			req.armor_mdc ?? 70,
			req.apm ?? 4,
			req.combat_bonuses?.initiative_bonus ?? 2,
			req.combat_bonuses?.strike_bonus ?? 0,
			req.combat_bonuses?.parry_bonus ?? 2,
			req.combat_bonuses?.dodge_bonus ?? 2,
			req.combat_bonuses?.roll_with_impact_bonus ?? 0,
			req.combat_bonuses?.damage_bonus ?? 0,
			JSON.stringify(req.psionic_powers ?? []),
			JSON.stringify(req.skills ?? []),
			JSON.stringify(req.inventory ?? []),
			JSON.stringify(req.equipped ?? {}),
			req.xp_next_level ?? 2000,
			req.tactical_x ?? 0,
			req.tactical_y ?? 0,
			partyMember,
			req.user_id || null,
			now,
			now,
		);

		return this.getCombatant(id)!;
	}

	getCombatant(id: string): Combatant | null {
		const db = getDb();
		const row = db
			.prepare("SELECT * FROM combatants WHERE id = ?")
			.get(id) as any;
		if (!row) return null;
		return this.rowToCombatant(row);
	}

	deleteCombatant(id: string): void {
		const db = getDb();
		db.prepare("DELETE FROM combatants WHERE id = ?").run(id);
	}

	getPartyCombatants(campaignId: string): Combatant[] {
		const db = getDb();
		const rows = db
			.prepare(
				"SELECT * FROM combatants WHERE campaign_id = ? AND status != 'dead' AND COALESCE(party_member, 1) = 1 ORDER BY created_at",
			)
			.all(campaignId) as any[];
		return rows.map((r) => this.rowToCombatant(r));
	}

	getWorldNpcCombatants(campaignId: string): Combatant[] {
		const db = getDb();
		const rows = db
			.prepare(
				"SELECT * FROM combatants WHERE campaign_id = ? AND status != 'dead' AND party_member = 0 ORDER BY created_at",
			)
			.all(campaignId) as any[];
		return rows.map((r) => this.rowToCombatant(r));
	}

	getAllCombatants(campaignId: string): Combatant[] {
		const db = getDb();
		const rows = db
			.prepare(
				"SELECT * FROM combatants WHERE campaign_id = ? ORDER BY created_at",
			)
			.all(campaignId) as any[];
		return rows.map((r) => this.rowToCombatant(r));
	}

	updateCombatantVitals(
		id: string,
		updates: Partial<{
			hp_current: number;
			sdc_current: number;
			isp_current: number;
			ppe_current: number;
			armor_mdc_current: number;
			hunger: number;
			thirst: number;
			fatigue: number;
			internal_temp: number;
			pulse_bpm: number;
			status: CombatantStatus;
		}>,
	): void {
		const db = getDb();
		const fields = Object.entries(updates)
			.map(([k]) => `${k} = ?`)
			.join(", ");
		const values = Object.values(updates);
		db.prepare(
			`UPDATE combatants SET ${fields}, updated_at = ? WHERE id = ?`,
		).run(...values, new Date().toISOString(), id);
	}

	updateCombatantPosition(
		id: string,
		x: number,
		y: number,
		facing?: string,
	): Combatant | null {
		const db = getDb();
		db.prepare(
			"UPDATE combatants SET tactical_x = ?, tactical_y = ?, facing = ?, updated_at = ? WHERE id = ?",
		).run(x, y, facing || null, new Date().toISOString(), id);
		return this.getCombatant(id);
	}

	updateCombatantXP(
		id: string,
		xpGain: number,
	): { leveled_up: boolean; new_level?: number } {
		const db = getDb();
		const combatant = this.getCombatant(id);
		if (!combatant) return { leveled_up: false };

		const newXp = combatant.xp + xpGain;
		let leveledUp = false;
		let newLevel = combatant.level;

		if (newXp >= combatant.xp_next_level && combatant.level < 15) {
			newLevel = combatant.level + 1;
			leveledUp = true;
		}

		db.prepare(
			"UPDATE combatants SET xp = ?, level = ?, updated_at = ? WHERE id = ?",
		).run(newXp, newLevel, new Date().toISOString(), id);

		return {
			leveled_up: leveledUp,
			new_level: leveledUp ? newLevel : undefined,
		};
	}

	updateCombatantInventory(id: string, inventory: InventoryItem[]): void {
		const db = getDb();
		db.prepare(
			"UPDATE combatants SET inventory = ?, updated_at = ? WHERE id = ?",
		).run(JSON.stringify(inventory), new Date().toISOString(), id);
	}

	updateCombatantPowers(id: string, powers: string[]): void {
		const db = getDb();
		db.prepare(
			"UPDATE combatants SET psionic_powers = ?, updated_at = ? WHERE id = ?",
		).run(JSON.stringify(powers), new Date().toISOString(), id);
	}

	updatePackHowl(id: string, remaining: number): void {
		const db = getDb();
		db.prepare(
			"UPDATE combatants SET pack_howl_remaining = ?, updated_at = ? WHERE id = ?",
		).run(remaining, new Date().toISOString(), id);
	}

	killCombatant(id: string): void {
		this.updateCombatantVitals(id, { status: "dead", hp_current: 0 });
	}

	/** Claim an unclaimed combatant for a specific user. Returns true if successful. */
	claimCombatant(combatantId: string, userId: string): boolean {
		const db = getDb();
		const result = db.prepare(
			"UPDATE combatants SET user_id = ?, updated_at = ? WHERE id = ? AND (user_id IS NULL OR user_id = ?)",
		).run(userId, new Date().toISOString(), combatantId, userId);
		return result.changes > 0;
	}

	/** Get combatants in a campaign that no user has claimed. */
	getUnclaimedCombatants(campaignId: string): Combatant[] {
		const db = getDb();
		const rows = db
			.prepare(
				"SELECT * FROM combatants WHERE campaign_id = ? AND kind = 'human' AND (user_id IS NULL OR user_id = '') AND status != 'dead' ORDER BY created_at",
			)
			.all(campaignId) as any[];
		return rows.map((r) => this.rowToCombatant(r));
	}

	// ── Injuries ──

	addInjury(combatantId: string, injury: Omit<Injury, "id">): Injury {
		const db = getDb();
		const id = uuid();
		db.prepare(`
      INSERT INTO injuries (id, combatant_id, body_location, severity, injury_type, bleeding, pain_level, healing_progress)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, combatantId, injury.body_location, injury.severity, injury.injury_type, injury.bleeding ? 1 : 0, injury.pain_level, injury.healing_progress);
		return { id, ...injury };
	}

	getInjuries(combatantId: string): Injury[] {
		const db = getDb();
		const rows = db.prepare("SELECT * FROM injuries WHERE combatant_id = ?").all(combatantId) as any[];
		return rows.map((r) => ({ ...r, bleeding: Boolean(r.bleeding) }));
	}

	removeInjury(injuryId: string): void {
		const db = getDb();
		db.prepare("DELETE FROM injuries WHERE id = ?").run(injuryId);
	}

	// ── Messages ──

	createMessage(req: SendMessageRequest): ChatMessage {
		const db = getDb();
		const id = uuid();
		const now = new Date().toISOString();
		db.prepare(`
      INSERT INTO messages (id, campaign_id, session_id, actor_id, message_type, content, visibility, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.campaign_id, req.session_id || null, req.actor_id || null, req.message_type, req.content, req.visibility || "party", now);
		return {
			id,
			campaign_id: req.campaign_id,
			session_id: req.session_id,
			actor_id: req.actor_id,
			message_type: req.message_type,
			content: req.content,
			visibility: req.visibility || "party",
			created_at: now,
		};
	}

	getMessages(campaignId: string, opts?: { sessionId?: string; limit?: number; before?: string }): ChatMessage[] {
		const db = getDb();
		let query = "SELECT * FROM messages WHERE campaign_id = ?";
		const params: any[] = [campaignId];
		if (opts?.sessionId) { query += " AND session_id = ?"; params.push(opts.sessionId); }
		if (opts?.before) { query += " AND created_at < ?"; params.push(opts.before); }
		query += " ORDER BY created_at DESC LIMIT ?";
		params.push(opts?.limit || 50);
		const rows = db.prepare(query).all(...params) as any[];
		return rows.reverse();
	}

	// ── Game Events ──

	logEvent(event: Omit<GameEvent, "id" | "created_at">): GameEvent {
		const db = getDb();
		const id = uuid();
		const now = new Date().toISOString();
		db.prepare(`
      INSERT INTO game_events (id, campaign_id, session_id, event_type, actor_id, target_id, data, narrative, visibility, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, event.campaign_id, event.session_id || null, event.event_type, event.actor_id || null, event.target_id || null, event.data ? JSON.stringify(event.data) : null, event.narrative || null, event.visibility || "party", now);
		return { id, ...event, created_at: now };
	}

	getEvents(campaignId: string, opts?: { sessionId?: string; eventType?: string; actorId?: string; limit?: number }): GameEvent[] {
		const db = getDb();
		let query = "SELECT * FROM game_events WHERE campaign_id = ?";
		const params: any[] = [campaignId];
		if (opts?.sessionId) { query += " AND session_id = ?"; params.push(opts.sessionId); }
		if (opts?.eventType) { query += " AND event_type = ?"; params.push(opts.eventType); }
		if (opts?.actorId) { query += " AND actor_id = ?"; params.push(opts.actorId); }
		query += " ORDER BY created_at DESC LIMIT ?";
		params.push(opts?.limit || 100);
		return (db.prepare(query).all(...params) as any[]).reverse().map((r) => ({ ...r, data: r.data ? JSON.parse(r.data) : undefined }));
	}

	// ── Tactical Terrain ──

	clearTerrain(sessionId: string): void {
		const db = getDb();
		db.prepare("DELETE FROM tactical_terrain WHERE session_id = ?").run(sessionId);
		db.prepare(`UPDATE sessions SET terrain_origin_lat = NULL, terrain_origin_lng = NULL, updated_at = ? WHERE id = ?`).run(new Date().toISOString(), sessionId);
	}

	updateSessionTerrainOrigin(sessionId: string, originLat: number, originLng: number): void {
		const db = getDb();
		db.prepare(`UPDATE sessions SET terrain_origin_lat = ?, terrain_origin_lng = ?, updated_at = ? WHERE id = ?`).run(originLat, originLng, new Date().toISOString(), sessionId);
	}

	setTerrain(sessionId: string, tiles: TacticalTile[]): void {
		const db = getDb();
		const stmt = db.prepare(`
      INSERT OR REPLACE INTO tactical_terrain (session_id, x, y, terrain_type, cover, elevation, revealed, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
		const batch = db.transaction((t: TacticalTile[]) => {
			for (const tile of t) {
				stmt.run(sessionId, tile.x, tile.y, tile.terrain_type, tile.cover || null, tile.elevation, tile.revealed ? 1 : 0, tile.metadata ? JSON.stringify(tile.metadata) : null);
			}
		});
		batch(tiles);
	}

	getTerrain(sessionId: string): TacticalTile[] {
		const db = getDb();
		const rows = db.prepare("SELECT * FROM tactical_terrain WHERE session_id = ?").all(sessionId) as any[];
		return rows.map((r) => ({ x: r.x, y: r.y, terrain_type: r.terrain_type, cover: r.cover || null, elevation: r.elevation, revealed: Boolean(r.revealed), metadata: r.metadata ? JSON.parse(r.metadata) : undefined }));
	}

	revealTerrain(sessionId: string, positions: Array<{ x: number; y: number }>): void {
		const db = getDb();
		const stmt = db.prepare("UPDATE tactical_terrain SET revealed = 1 WHERE session_id = ? AND x = ? AND y = ?");
		for (const pos of positions) { stmt.run(sessionId, pos.x, pos.y); }
	}

	// ── Vital Samples ──

	recordVitalSample(combatantId: string, pulseBpm: number, internalTemp: number): void {
		const db = getDb();
		db.prepare("INSERT INTO vital_samples (combatant_id, pulse_bpm, internal_temp) VALUES (?, ?, ?)").run(combatantId, pulseBpm, internalTemp);
	}

	getVitalSamples(combatantId: string, limit = 300): VitalSample[] {
		const db = getDb();
		const rows = db.prepare("SELECT * FROM vital_samples WHERE combatant_id = ? ORDER BY sampled_at DESC LIMIT ?").all(combatantId, limit) as any[];
		return rows.reverse();
	}

	pruneVitalSamples(olderThanMinutes = 30): void {
		const db = getDb();
		db.prepare("DELETE FROM vital_samples WHERE sampled_at < datetime('now', '-' || ? || ' minutes')").run(olderThanMinutes);
	}

	// ── Private helpers ──

	private rowToCombatant(row: any): Combatant {
		return {
			id: row.id,
			campaign_id: row.campaign_id,
			session_id: row.session_id,
			kind: row.kind,
			controller: row.controller,
			class_id: row.class_id,
			name: row.name,
			status: row.status,
			personality: row.personality ? JSON.parse(row.personality) : undefined,
			attributes: { iq: row.iq, me: row.me, ma: row.ma, ps: row.ps, pp: row.pp, pe: row.pe, pb: row.pb, spd_bipedal: row.spd_bipedal, spd_quadruped: row.spd_quadruped },
			vitals: { hp_current: row.hp_current, hp_max: row.hp_max, sdc_current: row.sdc_current, sdc_max: row.sdc_max, isp_current: row.isp_current, isp_max: row.isp_max, ppe_current: row.ppe_current, ppe_max: row.ppe_max, armor_mdc_current: row.armor_mdc_current, armor_mdc_max: row.armor_mdc_max },
			combat: { initiative_bonus: row.initiative_bonus, strike_bonus: row.strike_bonus, parry_bonus: row.parry_bonus, dodge_bonus: row.dodge_bonus, roll_with_impact_bonus: row.roll_with_impact_bonus, damage_bonus: row.damage_bonus, apm: row.apm },
			needs: { hunger: row.hunger, thirst: row.thirst, fatigue: row.fatigue },
			internal_temp: row.internal_temp,
			pulse_bpm: row.pulse_bpm,
			tactical_x: row.tactical_x,
			tactical_y: row.tactical_y,
			facing: row.facing,
			elevation: row.elevation,
			level: row.level,
			xp: row.xp,
			xp_next_level: row.xp_next_level,
			psionic_powers: JSON.parse(row.psionic_powers),
			skills: JSON.parse(row.skills),
			inventory: JSON.parse(row.inventory),
			equipped: JSON.parse(row.equipped),
			status_effects: JSON.parse(row.status_effects),
			injuries: [],
			pack_howl_remaining: row.pack_howl_remaining,
			party_member: row.party_member === undefined || row.party_member === null ? true : row.party_member === 1,
		};
	}
}

export const gameState = new GameStateService();
