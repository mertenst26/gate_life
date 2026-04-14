import type {
	Combatant,
	Enemy,
	GameEvent,
	InventoryItem,
	ItemAbility,
	SupportUnitConfig,
} from "@gate-life/shared";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/connection.js";
import { broadcastToSession } from "../ws/handler.js";
import { gameState } from "./GameStateService.js";

export class ItemAbilityService {
	/**
	 * Use an item's special ability
	 * @returns GameEvent array describing the outcome
	 */
	useItemAbility(
		campaignId: string,
		sessionId: string,
		combatantId: string,
		itemId: string,
		abilityIndex: number,
		targetData?: Record<string, unknown>,
	): GameEvent[] {
		const events: GameEvent[] = [];
		const combatant = gameState.getCombatant(combatantId);
		if (!combatant) {
			console.warn(`[ItemAbility] Combatant ${combatantId} not found`);
			return events;
		}

		const item = combatant.inventory.find((i) => i.id === itemId);
		if (!item || !item.abilities || item.abilities.length === 0) {
			console.warn(
				`[ItemAbility] Item ${itemId} not found or has no abilities`,
			);
			return events;
		}

		const ability = item.abilities[abilityIndex];
		if (!ability) {
			console.warn(
				`[ItemAbility] Ability index ${abilityIndex} not found on item ${item.name}`,
			);
			return events;
		}

		// Check cooldown
		const session = gameState.getSession(sessionId);
		const currentRound = session?.turn_state?.round ?? 0;
		if (
			ability.cooldown_rounds &&
			ability.last_used_round !== undefined &&
			currentRound - ability.last_used_round < ability.cooldown_rounds
		) {
			const remaining =
				ability.cooldown_rounds - (currentRound - ability.last_used_round);
			events.push(
				gameState.logEvent({
					campaign_id: campaignId,
					session_id: sessionId,
					event_type: "item_use_failed",
					actor_id: combatantId,
					narrative: `${combatant.name} tries to use ${ability.name}, but it's on cooldown for ${remaining} more rounds.`,
					visibility: "party",
				}),
			);
			return events;
		}

		// Check uses remaining
		if (
			ability.uses !== null &&
			ability.uses !== undefined &&
			ability.uses <= 0
		) {
			events.push(
				gameState.logEvent({
					campaign_id: campaignId,
					session_id: sessionId,
					event_type: "item_use_failed",
					actor_id: combatantId,
					narrative: `${combatant.name} tries to use ${ability.name}, but it has no uses remaining.`,
					visibility: "party",
				}),
			);
			return events;
		}

		// Execute ability based on type
		switch (ability.ability_type) {
			case "spawn_support":
				return this.executeSpawnSupport(
					campaignId,
					sessionId,
					combatant,
					item,
					ability,
					abilityIndex,
					targetData,
				);
			case "heal":
				return this.executeHeal(
					campaignId,
					sessionId,
					combatant,
					item,
					ability,
					abilityIndex,
					targetData,
				);
			case "teleport":
			case "buff":
			case "damage":
			case "reveal":
			case "custom":
			default:
				events.push(
					gameState.logEvent({
						campaign_id: campaignId,
						session_id: sessionId,
						event_type: "item_use_failed",
						actor_id: combatantId,
						narrative: `${combatant.name} uses ${item.name}'s ${ability.name}, but nothing happens. (Ability type ${ability.ability_type} not yet implemented)`,
						visibility: "party",
					}),
				);
				return events;
		}
	}

	private activateLinkedEntities(
		campaignId: string,
		sessionId: string,
		combatant: Combatant,
		item: InventoryItem,
		ability: ItemAbility,
		abilityIndex: number,
	): GameEvent[] {
		const events: GameEvent[] = [];
		const db = getDb();
		const linkedNames = ability.linked_entity_names ?? [];

		const activatedUnits: Enemy[] = [];

		// Destination: the activating combatant's current position
		const destX = combatant.tactical_x ?? 0;
		const destY = combatant.tactical_y ?? 0;

		for (const unitName of linkedNames) {
			const existing = gameState
				.getSessionEnemies(sessionId)
				.find(
					(e) =>
						e.name.toLowerCase() === unitName.toLowerCase() &&
						e.status !== "dead",
				);

			if (!existing) {
				console.warn(
					`[ItemAbility] Linked entity "${unitName}" not found in session ${sessionId}`,
				);
				continue;
			}

			// Build updated support_config: keep existing speed, set inbound + destination
			const speed = existing.support_config?.speed ?? 15;
			// Takeoff delay: 2 rounds for VTOL/aircraft, 1 for ground vehicles
			const isAir =
				(existing.support_config?.unit_type ?? "transport") !== "reinforcement";
			const takeoffRounds = isAir ? 2 : 1;

			const updatedConfig: import("@gate-life/shared").SupportUnitConfig = {
				...(existing.support_config ?? {
					unit_type: "transport",
				}),
				speed,
				inbound: true,
				takeoff_rounds_remaining: takeoffRounds,
				destination_x: destX,
				destination_y: destY,
				summoned_by: combatant.id,
				summoned_by_item: item.id,
			};

			// Mark detected + persist updated support_config (vehicle stays at its current position)
			db.prepare(
				`UPDATE enemies SET detected = 1, support_config = ? WHERE id = ?`,
			).run(JSON.stringify(updatedConfig), existing.id);

			const unit = gameState.getEnemy(existing.id)!;
			activatedUnits.push(unit);

			broadcastToSession(sessionId, {
				type: "enemy_update",
				payload: unit,
				timestamp: new Date().toISOString(),
			});
		}

		if (activatedUnits.length === 0) {
			events.push(
				gameState.logEvent({
					campaign_id: campaignId,
					session_id: sessionId,
					event_type: "item_use_failed",
					actor_id: combatant.id,
					narrative: `${combatant.name} activates ${item.name}, but no linked support units could be reached.`,
					visibility: "party",
				}),
			);
			return events;
		}

		this.consumeAbilityUse(combatant.id, item.id, abilityIndex, sessionId);

		const unitList = activatedUnits.map((u) => u.name).join(", ");
		const speed = activatedUnits[0].support_config?.speed ?? 15;
		const ftPerRound = speed * 10;
		// Calculate rough ETA based on furthest unit distance
		const maxDist = Math.max(
			...activatedUnits.map((u) => {
				const dx = (u.tactical_x ?? 0) - destX;
				const dy = (u.tactical_y ?? 0) - destY;
				return Math.sqrt(dx * dx + dy * dy);
			}),
		);
		const etaRounds = Math.ceil(maxDist / speed) + 2; // +2 for takeoff

		events.push(
			gameState.logEvent({
				campaign_id: campaignId,
				session_id: sessionId,
				event_type: "support_spawned",
				actor_id: combatant.id,
				data: {
					item_name: item.name,
					ability_name: ability.name,
					units: activatedUnits.map((u) => ({ id: u.id, name: u.name })),
					destination: { x: destX, y: destY },
					eta_rounds: etaRounds,
				},
				narrative: `${combatant.name} activates ${item.name}! ${unitList} respond${activatedUnits.length === 1 ? "s" : ""} to the beacon signal. At ${ftPerRound} ft/round they are approximately ${etaRounds} rounds out — prepare a landing zone.`,
				visibility: "party",
			}),
		);

		broadcastToSession(sessionId, {
			type: "support_units_spawned",
			payload: {
				summoner: combatant.name,
				item: item.name,
				units: activatedUnits,
				eta_rounds: etaRounds,
			},
			timestamp: new Date().toISOString(),
		});

		return events;
	}

	private executeSpawnSupport(
		campaignId: string,
		sessionId: string,
		combatant: Combatant,
		item: InventoryItem,
		ability: ItemAbility,
		abilityIndex: number,
		targetData?: Record<string, unknown>,
	): GameEvent[] {
		// If the ability has specific linked entity names, activate those
		// pre-placed scenario units instead of spawning generic ones.
		if (ability.linked_entity_names && ability.linked_entity_names.length > 0) {
			return this.activateLinkedEntities(
				campaignId,
				sessionId,
				combatant,
				item,
				ability,
				abilityIndex,
			);
		}

		const events: GameEvent[] = [];
		const config = ability.config ?? {};
		const unitType = (config.unit_type as string) ?? "reinforcement";
		const minCount = (config.unit_count_min as number) ?? 1;
		const maxCount = (config.unit_count_max as number) ?? 1;
		const count =
			minCount === maxCount
				? minCount
				: Math.floor(Math.random() * (maxCount - minCount + 1)) + minCount;

		console.log(
			`[ItemAbility] Spawning ${count} ${unitType} units for ${combatant.name}`,
		);

		const spawnedUnits: Enemy[] = [];
		const db = getDb();

		for (let i = 0; i < count; i++) {
			const unitName = `${unitType.charAt(0).toUpperCase() + unitType.slice(1)} ${i + 1}`;

			// Determine stats based on unit type
			let stats = {
				hp_max: 50,
				sdc_max: 100,
				mdc_max: 50,
				apm: 4,
				initiative_bonus: 3,
				strike_bonus: 5,
				parry_bonus: 0,
				dodge_bonus: 4,
				damage: "4d6×10",
				damage_type: "md" as const,
			};

			if (unitType === "gunship") {
				stats = {
					hp_max: 100,
					sdc_max: 0,
					mdc_max: 150,
					apm: 2,
					initiative_bonus: 2,
					strike_bonus: 6,
					parry_bonus: 0,
					dodge_bonus: 3,
					damage: "6d6×10",
					damage_type: "md",
				};
			}

			const supportConfig: SupportUnitConfig = {
				unit_type: unitType as any,
				fuel: 100,
				max_fuel: 100,
				summoned_by: combatant.id,
				summoned_by_item: item.id,
				action_range: 200, // 200 grid units = 2000 ft
				strike_damage: stats.damage,
				can_extract: unitType === "gunship" || unitType === "transport",
			};

			// Spawn near the combatant
			const spawnX =
				(combatant.tactical_x ?? 0) + Math.floor(Math.random() * 6) - 3;
			const spawnY =
				(combatant.tactical_y ?? 0) + Math.floor(Math.random() * 6) - 3;

			const enemy: Enemy = {
				id: uuidv4(),
				session_id: sessionId,
				name: unitName,
				enemy_type: "friendly",
				icon_type: unitType,
				hp_current: stats.hp_max,
				hp_max: stats.hp_max,
				sdc_current: stats.sdc_max,
				sdc_max: stats.sdc_max,
				mdc_current: stats.mdc_max,
				mdc_max: stats.mdc_max,
				apm: stats.apm,
				initiative_bonus: stats.initiative_bonus,
				strike_bonus: stats.strike_bonus,
				parry_bonus: stats.parry_bonus,
				dodge_bonus: stats.dodge_bonus,
				damage: stats.damage,
				damage_type: stats.damage_type,
				tactical_x: spawnX,
				tactical_y: spawnY,
				facing: "north",
				status: "alive",
				abilities: [],
				loot_table: [],
				detected: true,
				support_config: supportConfig,
			};

			// Insert into database
			db.prepare(
				`INSERT INTO enemies (
          id, session_id, name, enemy_type, icon_type,
          hp_current, hp_max, sdc_current, sdc_max, mdc_current, mdc_max,
          apm, initiative_bonus, strike_bonus, parry_bonus, dodge_bonus,
          damage, damage_type, tactical_x, tactical_y, facing, status,
          abilities, loot_table, detected
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			).run(
				enemy.id,
				enemy.session_id,
				enemy.name,
				enemy.enemy_type,
				enemy.icon_type,
				enemy.hp_current,
				enemy.hp_max,
				enemy.sdc_current,
				enemy.sdc_max,
				enemy.mdc_current,
				enemy.mdc_max,
				enemy.apm,
				enemy.initiative_bonus,
				enemy.strike_bonus,
				enemy.parry_bonus,
				enemy.dodge_bonus,
				enemy.damage,
				enemy.damage_type,
				enemy.tactical_x,
				enemy.tactical_y,
				enemy.facing,
				enemy.status,
				JSON.stringify(enemy.abilities),
				JSON.stringify(enemy.loot_table),
				enemy.detected ? 1 : 0,
			);

			spawnedUnits.push(enemy);

			// Broadcast enemy_update
			broadcastToSession(sessionId, {
				type: "enemy_update",
				payload: enemy,
				timestamp: new Date().toISOString(),
			});
		}

		// Consume ability use
		this.consumeAbilityUse(combatant.id, item.id, abilityIndex, sessionId);

		// Create event
		events.push(
			gameState.logEvent({
				campaign_id: campaignId,
				session_id: sessionId,
				event_type: "support_spawned",
				actor_id: combatant.id,
				data: {
					item_name: item.name,
					ability_name: ability.name,
					unit_type: unitType,
					count,
					units: spawnedUnits.map((u) => ({ id: u.id, name: u.name })),
				},
				narrative: `${combatant.name} activates ${item.name}! ${count} ${unitType}${count > 1 ? "s" : ""} arrive${count === 1 ? "s" : ""} on scene.`,
				visibility: "party",
			}),
		);

		// Broadcast support_units_spawned with detailed config
		broadcastToSession(sessionId, {
			type: "support_units_spawned",
			payload: {
				summoner: combatant.name,
				item: item.name,
				units: spawnedUnits,
			},
			timestamp: new Date().toISOString(),
		});

		if (unitType === "gunship") {
			// Also send gunship_available to enable targeting UI
			broadcastToSession(sessionId, {
				type: "gunship_available",
				payload: {
					combatantId: combatant.id,
					gunships: spawnedUnits.map((u) => ({
						id: u.id,
						name: u.name,
						fuel: u.support_config?.fuel ?? 100,
						max_fuel: u.support_config?.max_fuel ?? 100,
					})),
				},
				timestamp: new Date().toISOString(),
			});
		}

		return events;
	}

	private executeHeal(
		campaignId: string,
		sessionId: string,
		combatant: Combatant,
		item: InventoryItem,
		ability: ItemAbility,
		abilityIndex: number,
		targetData?: Record<string, unknown>,
	): GameEvent[] {
		const events: GameEvent[] = [];
		const config = ability.config ?? {};
		const healAmount = (config.heal_amount as number) ?? 10;
		const targetId = (targetData?.targetId as string) ?? combatant.id;

		const target = gameState.getCombatant(targetId);
		if (!target) {
			events.push(
				gameState.logEvent({
					campaign_id: campaignId,
					session_id: sessionId,
					event_type: "item_use_failed",
					actor_id: combatant.id,
					narrative: `${combatant.name} tries to use ${item.name}, but the target is not found.`,
					visibility: "party",
				}),
			);
			return events;
		}

		const newHp = Math.min(
			target.vitals.hp_max,
			target.vitals.hp_current + healAmount,
		);
		gameState.updateCombatantVitals(targetId, { hp_current: newHp });

		this.consumeAbilityUse(combatant.id, item.id, abilityIndex, sessionId);

		events.push(
			gameState.logEvent({
				campaign_id: campaignId,
				session_id: sessionId,
				event_type: "heal_ally",
				actor_id: combatant.id,
				target_id: targetId,
				data: { item_name: item.name, heal_amount: healAmount },
				narrative: `${combatant.name} uses ${item.name} on ${target.name}, healing ${healAmount} HP.`,
				visibility: "party",
			}),
		);

		return events;
	}

	private consumeAbilityUse(
		combatantId: string,
		itemId: string,
		abilityIndex: number,
		sessionId?: string,
	): void {
		const combatant = gameState.getCombatant(combatantId);
		if (!combatant) return;

		const updatedInventory = combatant.inventory.map((i) => {
			if (i.id !== itemId || !i.abilities) return i;

			const updatedAbilities = i.abilities.map((a, idx) => {
				if (idx !== abilityIndex) return a;

				const session = sessionId ? gameState.getSession(sessionId) : null;
				const currentRound = session?.turn_state?.round ?? 0;

				return {
					...a,
					uses: a.uses !== null && a.uses !== undefined ? a.uses - 1 : a.uses,
					last_used_round: currentRound,
				};
			});

			return {
				...i,
				abilities: updatedAbilities,
				uses:
					i.uses !== undefined && i.uses !== null && i.uses > 0
						? i.uses - 1
						: i.uses,
			};
		});

		// Remove item if all uses consumed
		const finalInventory = updatedInventory.filter((i) => {
			if (i.id !== itemId) return true;
			// Keep if has unlimited uses (uses is null/undefined) or has uses remaining
			return i.uses === null || i.uses === undefined || i.uses > 0;
		});

		gameState.updateCombatantInventory(combatantId, finalInventory);
	}
}

export const itemAbilityService = new ItemAbilityService();
