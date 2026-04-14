import type { Combatant, Enemy } from "@gate-life/shared";
import { gameState } from "./GameStateService.js";
import { tacticalService } from "./TacticalService.js";

/**
 * MovementDetectionService
 *
 * Handles enemy detection during movement in travel/conversation mode.
 * Checks each step along the path to see if enemies become visible,
 * stopping movement at the point of first contact.
 */

/** Returns visual detection range in grid cells based on time of day. */
function getVisualRange(hour: number): number {
	return hour >= 6 && hour < 20 ? 30 : 6; // Day: 300ft, Night: 60ft
}

/** Whether this entity type counts as a hostile combatant that triggers tactical mode. */
function isHostile(entity: Enemy): boolean {
	return (
		entity.enemy_type !== "friendly" &&
		entity.enemy_type !== "poi" &&
		entity.enemy_type !== "neutral"
	);
}

export interface MovementResult {
	/** Final position after movement (may be stopped early due to contact) */
	finalX: number;
	finalY: number;
	/** Distance actually moved in grid units */
	actualDistance: number;
	/** True if movement was stopped due to enemy contact */
	contactMade: boolean;
	/** The enemy that was detected (if any) */
	detectedEnemy?: Enemy;
	/** Distance to detected enemy in feet */
	distanceToEnemy?: number;
	/** The combatant who spotted the enemy */
	spotter?: Combatant;
}

/**
 * Simulates movement along a path, checking for enemy visibility at each step.
 * Returns the final position (which may be before the intended destination if contact is made).
 *
 * @param startX - Starting X coordinate
 * @param startY - Starting Y coordinate
 * @param dx - Total intended X displacement
 * @param dy - Total intended Y displacement
 * @param sessionId - Session ID
 * @param campaignId - Campaign ID
 * @returns MovementResult with final position and contact info
 */
export async function checkMovementForContact(
	startX: number,
	startY: number,
	dx: number,
	dy: number,
	sessionId: string,
	campaignId: string,
): Promise<MovementResult> {
	const session = gameState.getSession(sessionId);
	if (!session) {
		return {
			finalX: startX + dx,
			finalY: startY + dy,
			actualDistance: Math.abs(dx) + Math.abs(dy),
			contactMade: false,
		};
	}

	const allEnemies = gameState.getSessionEnemies(sessionId);
	const allEntities = allEnemies.filter(
		(e) => e.status !== "dead" && !e.detected,
	);

	console.log(
		`[movement-detection] Checking movement from (${startX},${startY}) by (${dx},${dy})`,
	);
	console.log(
		`[movement-detection] Total enemies: ${allEnemies.length}, Undetected: ${allEntities.length}`,
	);

	if (allEntities.length === 0) {
		// No undetected enemies, proceed with full movement
		console.log(
			`[movement-detection] No undetected enemies - full movement allowed`,
		);
		return {
			finalX: startX + dx,
			finalY: startY + dy,
			actualDistance: Math.abs(dx) + Math.abs(dy),
			contactMade: false,
		};
	}

	const party = gameState
		.getPartyCombatants(campaignId)
		.filter((c) => c.status !== "dead");
	if (party.length === 0) {
		return {
			finalX: startX + dx,
			finalY: startY + dy,
			actualDistance: Math.abs(dx) + Math.abs(dy),
			contactMade: false,
		};
	}

	const terrain = gameState.getTerrain(sessionId);
	const campaign = gameState.getCampaign(campaignId);
	const hour = campaign?.world_clock?.hour ?? 12;
	const visualRange = getVisualRange(hour);

	// Calculate step size (check every grid cell along the path)
	const totalDistance = Math.sqrt(dx * dx + dy * dy);
	const steps = Math.ceil(totalDistance);

	if (steps === 0) {
		return {
			finalX: startX + dx,
			finalY: startY + dy,
			actualDistance: 0,
			contactMade: false,
		};
	}

	// Normalized direction
	const stepX = dx / steps;
	const stepY = dy / steps;

	// Check each step along the path
	for (let step = 1; step <= steps; step++) {
		const checkX = Math.round(startX + stepX * step);
		const checkY = Math.round(startY + stepY * step);

		// Update all party member positions to this step (for multi-character parties)
		// We check if ANY party member can see ANY enemy from this position
		for (const combatant of party) {
			const combatantOffsetX = checkX - startX;
			const combatantOffsetY = checkY - startY;
			const combatantCheckX = (combatant.tactical_x ?? 0) + combatantOffsetX;
			const combatantCheckY = (combatant.tactical_y ?? 0) + combatantOffsetY;
			const combatantPos = { x: combatantCheckX, y: combatantCheckY };

			for (const entity of allEntities) {
				if (entity.tactical_x == null || entity.tactical_y == null) continue;
				const entityPos = { x: entity.tactical_x, y: entity.tactical_y };

				const dist = tacticalService.getDistance(combatantPos, entityPos);
				if (dist > visualRange) continue;

				// Check facing arc: detection fires when EITHER observer can see the other
				const partySeesEntity = tacticalService.isInFacingArc(
					combatantPos,
					combatant.facing,
					entityPos,
				);
				const entitySeesParty = tacticalService.isInFacingArc(
					entityPos,
					entity.facing,
					combatantPos,
				);
				if (!partySeesEntity && !entitySeesParty) continue;

				if (!tacticalService.hasLineOfSight(combatantPos, entityPos, terrain))
					continue;

				// Contact made! Stop movement at the previous step
				const stopStep = Math.max(0, step - 1);
				const finalX = Math.round(startX + stepX * stopStep);
				const finalY = Math.round(startY + stepY * stopStep);
				const actualDistance = Math.sqrt(
					(finalX - startX) ** 2 + (finalY - startY) ** 2,
				);
				const distFt = Math.round(dist * 10);

				console.log(
					`[movement-detection] ${combatant.name} spotted ${entity.name} at step ${step}/${steps} ` +
						`(${distFt}ft away) — stopping movement at (${finalX}, ${finalY})`,
				);

				return {
					finalX,
					finalY,
					actualDistance,
					contactMade: true,
					detectedEnemy: entity,
					distanceToEnemy: distFt,
					spotter: combatant,
				};
			}
		}
	}

	// No contact made, proceed with full movement
	return {
		finalX: startX + dx,
		finalY: startY + dy,
		actualDistance: totalDistance,
		contactMade: false,
	};
}
