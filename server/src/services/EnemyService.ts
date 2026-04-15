import type {
	CombatantStatus,
	Enemy,
	SupportUnitConfig,
} from "@gate-life/shared";
import { v4 as uuid } from "uuid";
import { getDb } from "../db/connection.js";

export class EnemyService {
	createEnemy(
		sessionId: string,
		enemy: Partial<Enemy> & {
			name: string;
			enemy_type: string;
			hp_max: number;
		},
	): Enemy {
		const db = getDb();
		const id = uuid();

		let finalName = enemy.name;
		const existingEnemies = this.getSessionEnemies(sessionId);
		const sameNameEnemies = existingEnemies.filter((e) =>
			e.name.startsWith(enemy.name),
		);
		if (sameNameEnemies.length > 0) {
			const numbers = sameNameEnemies
				.map((e) => {
					const match = e.name.match(new RegExp(`^${enemy.name}\\s+(\\d+)$`));
					return match ? parseInt(match[1], 10) : e.name === enemy.name ? 1 : 0;
				})
				.filter((n) => n > 0);
			const nextNum = numbers.length > 0 ? Math.max(...numbers) + 1 : 2;
			finalName = `${enemy.name} ${nextNum}`;
		}

		db.prepare(`
      INSERT INTO enemies (id, session_id, name, enemy_type, icon_type, hp_current, hp_max, sdc_current, sdc_max,
        mdc_current, mdc_max, apm, initiative_bonus, strike_bonus, parry_bonus, dodge_bonus,
        damage, damage_type, tactical_x, tactical_y, abilities, loot_table, support_config)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
			id,
			sessionId,
			finalName,
			enemy.enemy_type,
			enemy.icon_type ?? null,
			enemy.hp_current ?? enemy.hp_max,
			enemy.hp_max,
			enemy.sdc_current ?? enemy.sdc_max ?? 0,
			enemy.sdc_max ?? 0,
			enemy.mdc_current ?? null,
			enemy.mdc_max ?? null,
			enemy.apm ?? 2,
			enemy.initiative_bonus ?? 0,
			enemy.strike_bonus ?? 0,
			enemy.parry_bonus ?? 0,
			enemy.dodge_bonus ?? 0,
			enemy.damage ?? "1d6",
			enemy.damage_type ?? "sdc",
			enemy.tactical_x ?? null,
			enemy.tactical_y ?? null,
			JSON.stringify(enemy.abilities ?? []),
			JSON.stringify(enemy.loot_table ?? []),
			enemy.support_config ? JSON.stringify(enemy.support_config) : null,
		);
		return this.getEnemy(id)!;
	}

	getEnemy(id: string): Enemy | null {
		const db = getDb();
		const row = db.prepare("SELECT * FROM enemies WHERE id = ?").get(id) as any;
		if (!row) return null;
		return this.parseEnemyRow(row);
	}

	getSessionEnemies(sessionId: string): Enemy[] {
		const db = getDb();
		const rows = db
			.prepare("SELECT * FROM enemies WHERE session_id = ?")
			.all(sessionId) as any[];
		return rows.map((r) => this.parseEnemyRow(r));
	}

	parseEnemyRow(r: any): Enemy {
		return {
			...r,
			facing: r.facing ?? undefined,
			icon_type: r.icon_type ?? undefined,
			abilities: JSON.parse(r.abilities ?? "[]"),
			loot_table: JSON.parse(r.loot_table ?? "[]"),
			detected: Boolean(r.detected),
			quest_poi: Boolean(r.quest_poi),
			support_config: r.support_config
				? JSON.parse(r.support_config)
				: undefined,
		};
	}

	updateEnemySupportConfig(id: string, config: SupportUnitConfig): void {
		const db = getDb();
		db.prepare("UPDATE enemies SET support_config = ? WHERE id = ?").run(
			JSON.stringify(config),
			id,
		);
	}

	markEnemyDetected(id: string): void {
		const db = getDb();
		db.prepare("UPDATE enemies SET detected = 1 WHERE id = ?").run(id);
	}

	markPoiQuestReveal(id: string): void {
		const db = getDb();
		db.prepare(
			"UPDATE enemies SET detected = 1, quest_poi = 1 WHERE id = ?",
		).run(id);
	}

	updateEnemyHp(id: string, hp: number, status?: CombatantStatus): void {
		const db = getDb();
		if (status) {
			db.prepare(
				"UPDATE enemies SET hp_current = ?, status = ? WHERE id = ?",
			).run(hp, status, id);
		} else {
			db.prepare("UPDATE enemies SET hp_current = ? WHERE id = ?").run(hp, id);
		}
	}

	updateEnemyPosition(id: string, x: number, y: number, facing?: string): void {
		const db = getDb();
		if (facing) {
			db.prepare(
				"UPDATE enemies SET tactical_x = ?, tactical_y = ?, facing = ? WHERE id = ?",
			).run(x, y, facing, id);
		} else {
			db.prepare(
				"UPDATE enemies SET tactical_x = ?, tactical_y = ? WHERE id = ?",
			).run(x, y, id);
		}
	}
}

export const enemyService = new EnemyService();
