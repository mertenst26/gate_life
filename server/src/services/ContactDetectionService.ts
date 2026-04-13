import type { TurnState, Enemy } from '@gate-life/shared';
import { gameState } from './GameStateService.js';
import { tacticalService } from './TacticalService.js';
import { broadcastToSession } from '../ws/handler.js';

// Gunfire can be heard far beyond visual range regardless of lighting.
const SOUND_RANGE_CELLS = 80; // 800 ft

/** Converts a delta vector to a human-readable compass direction. */
function toCompass(dx: number, dy: number): string {
  if (dx === 0 && dy === 0) return 'unknown direction';
  const deg = Math.atan2(dy, dx) * 180 / Math.PI;
  if (deg > -22.5  && deg <= 22.5)  return 'the east';
  if (deg > 22.5   && deg <= 67.5)  return 'the northeast';
  if (deg > 67.5   && deg <= 112.5) return 'the north';
  if (deg > 112.5  && deg <= 157.5) return 'the northwest';
  if (deg > 157.5  || deg <= -157.5) return 'the west';
  if (deg > -157.5 && deg <= -112.5) return 'the southwest';
  if (deg > -112.5 && deg <= -67.5)  return 'the south';
  return 'the southeast';
}

/**
 * Called when a ranged weapon is fired by a scenario entity (enemy, friendly,
 * vehicle) — or by an AI GM marker `<!--ENEMY_FIRE:name-->`.
 *
 * Rules:
 * - The shooter's position is revealed to every party member within SOUND_RANGE_CELLS
 *   (gun noise), regardless of LOS, facing, or time of day.
 * - A directional muzzle-flash alert is posted to party chat.
 * - If this is the first detection of a hostile entity while not in tactical
 *   mode, tactical mode is also entered.
 *
 * `shooterName` is matched case-insensitively against scenario entity names.
 * If the entity is already detected this is a no-op (avoids spam).
 */
export async function revealOnFire(
  sessionId: string,
  campaignId: string,
  shooterName: string,
): Promise<void> {
  const session = gameState.getSession(sessionId);
  if (!session) return;

  const entities = gameState.getSessionEnemies(sessionId);
  const entity = entities.find(
    e => e.name.toLowerCase().includes(shooterName.toLowerCase()),
  );
  if (!entity || entity.status === 'dead') return;

  const party = gameState.getPartyCombatants(campaignId).filter(c => c.status !== 'dead');
  if (party.length === 0) return;

  const now = new Date().toISOString();

  // Party centroid — used for directional description
  const cx = party.reduce((s, c) => s + (c.tactical_x ?? 0), 0) / party.length;
  const cy = party.reduce((s, c) => s + (c.tactical_y ?? 0), 0) / party.length;
  const ex = entity.tactical_x ?? null;
  const ey = entity.tactical_y ?? null;

  if (ex == null || ey == null) return;

  const distCells = tacticalService.getDistance({ x: cx, y: cy }, { x: ex, y: ey });
  const distFt = Math.round(distCells * 10);

  // Determine at least one party member can hear it (within sound range)
  const anyoneHears = party.some(c => {
    const d = tacticalService.getDistance(
      { x: c.tactical_x ?? 0, y: c.tactical_y ?? 0 },
      { x: ex, y: ey },
    );
    return d <= SOUND_RANGE_CELLS;
  });
  if (!anyoneHears) return;

  const direction = toCompass(ex - cx, ey - cy);
  const wasDetected = entity.detected;

  if (!wasDetected) {
    gameState.markEnemyDetected(entity.id);
    const detectedEntity: Enemy = { ...entity, detected: true };
    broadcastToSession(sessionId, {
      type: 'enemy_update',
      payload: detectedEntity,
      timestamp: now,
    });
    console.log(
      `[muzzle-flash] ${entity.name} revealed by gunfire at ${distFt} ft from ${direction}`,
    );
  }

  // Chat alert — always shown when a shot is fired, detected or not
  const locationLine = wasDetected
    ? `from ${direction} (${distFt} ft) — position already known`
    : `from ${direction} (${distFt} ft) — position revealed!`;

  const alertMsg = gameState.createMessage({
    campaign_id: campaignId,
    session_id: sessionId,
    message_type: 'system_alert',
    content: `💥 MUZZLE FLASH — Gunfire from **${entity.name}** detected ${locationLine}`,
    visibility: 'party',
  });
  broadcastToSession(sessionId, {
    type: 'chat_message',
    payload: alertMsg,
    timestamp: now,
  });

  // If this is the first sighting of a hostile entity and we're not in tactical yet, enter it
  if (!wasDetected && entity.enemy_type !== 'friendly' && entity.enemy_type !== 'poi' && entity.enemy_type !== 'neutral'
      && session.current_mode !== 'tactical') {
    const rolled = party.map(c => {
      const natural = Math.floor(Math.random() * 20) + 1;
      const bonus = c.combat?.initiative_bonus ?? 0;
      broadcastToSession(sessionId, {
        type: 'dice_roll',
        payload: { dice: 'd20', results: [natural], modifier: bonus, total: natural + bonus, natural, label: `${c.name} initiative` },
        timestamp: now,
      });
      return { id: c.id, roll: natural + bonus };
    });
    rolled.sort((a, b) => b.roll - a.roll);
    const turn_order = rolled.map(r => r.id);
    const turn_state: TurnState = {
      turn_order,
      current_actor_index: 0,
      round: 1,
      tick: 0,
      action_budget: Object.fromEntries(party.map(c => [c.id, c.combat?.apm ?? 4])),
      pending_input: { actor_id: turn_order[0], input_type: 'free_text' },
    };
    gameState.updateSessionMode(sessionId, 'tactical');
    gameState.updateTurnState(sessionId, turn_state);
    broadcastToSession(sessionId, {
      type: 'mode_change',
      payload: { mode: 'tactical', turn_state },
      timestamp: now,
    });
    const firstActorName = party.find(c => c.id === turn_order[0])?.name ?? 'Unknown';
    const combatMsg = gameState.createMessage({
      campaign_id: campaignId,
      session_id: sessionId,
      message_type: 'system_alert',
      content: `⚔ COMBAT BEGINS — Taking fire from **${entity.name}**! Initiative rolled. ${firstActorName} acts first.`,
      visibility: 'party',
    });
    broadcastToSession(sessionId, { type: 'chat_message', payload: combatMsg, timestamp: now });
  }
}

/**
 * Returns visual detection range in grid cells based on time of day.
 * Each grid cell = 10 ft.
 *   Day   (06:00–19:59): 30 cells = 300 ft
 *   Night (20:00–05:59):  6 cells =  60 ft
 */
function getVisualRange(hour: number): number {
  return hour >= 6 && hour < 20 ? 30 : 6;
}

function conditionLabel(range: number): string {
  return range < 10 ? 'dark conditions' : 'daylight';
}

/** Whether this entity type counts as a hostile combatant that triggers tactical mode. */
function isHostile(entity: Enemy): boolean {
  return entity.enemy_type !== 'friendly' && entity.enemy_type !== 'poi' && entity.enemy_type !== 'neutral';
}

/** Human-readable category label for chat alerts. */
function categoryLabel(entity: Enemy): string {
  if (entity.icon_type === 'npc') return 'NPC';
  switch (entity.enemy_type) {
    case 'friendly': return 'friendly unit';
    case 'neutral': return 'neutral';
    case 'vehicle': return 'vehicle';
    case 'poi': return 'point of interest';
    default: return 'hostile';
  }
}

/** Chat alert text when a non-combat entity is detected. */
function detectionAlertText(entity: Enemy, spotter: string, distFt: number, conditions: string): string {
  if (entity.icon_type === 'npc') {
    return `🗣 ${spotter} spots someone: **${entity.name}** at ${distFt} ft (${conditions}).`;
  }
  switch (entity.enemy_type) {
    case 'friendly':
      return `👋 ${spotter} spots a friendly unit: **${entity.name}** at ${distFt} ft (${conditions}).`;
    case 'neutral':
      return `👤 ${spotter} notices **${entity.name}** at ${distFt} ft (${conditions}).`;
    case 'vehicle':
      return `🚗 ${spotter} spots a vehicle: **${entity.name}** at ${distFt} ft (${conditions}).`;
    case 'poi':
      return `📍 ${spotter} discovers: **${entity.name}** at ${distFt} ft (${conditions}).`;
    default:
      return `⚠ ${spotter} has ${entity.name} in sight at ${distFt} ft (${conditions}).`;
  }
}

/**
 * Checks whether any living party combatant can see any scenario entity
 * (enemy, friendly, vehicle, POI) via line-of-sight within the current
 * visual range.
 *
 * - Hostile enemies → enter tactical mode (initiative rolled, mode_change broadcast)
 * - All other types → chat alert + mark detected, broadcast enemy_update
 *
 * Already-detected entities are skipped to avoid re-alerting.
 */
export async function checkContactAndEnterTactical(
  sessionId: string,
  campaignId: string,
): Promise<void> {
  const session = gameState.getSession(sessionId);
  if (!session) return;

  const allEntities = gameState.getSessionEnemies(sessionId).filter(e => e.status !== 'dead');
  if (allEntities.length === 0) return;

  const party = gameState.getPartyCombatants(campaignId).filter(c => c.status !== 'dead');
  if (party.length === 0) return;

  const terrain = gameState.getTerrain(sessionId);
  const campaign = gameState.getCampaign(campaignId);
  const hour = campaign?.world_clock?.hour ?? 12;
  const visualRange = getVisualRange(hour);
  const conditions = conditionLabel(visualRange);
  const now = new Date().toISOString();

  // Find the first hostile contact (for tactical mode trigger)
  let hostileContact: { entity: Enemy; spotter: typeof party[0]; distFt: number } | null = null;

  for (const entity of allEntities) {
    if (entity.tactical_x == null || entity.tactical_y == null) continue;
    const entityPos = { x: entity.tactical_x, y: entity.tactical_y };

    for (const combatant of party) {
      if (combatant.tactical_x == null || combatant.tactical_y == null) continue;
      const combatantPos = { x: combatant.tactical_x, y: combatant.tactical_y };

      const dist = tacticalService.getDistance(combatantPos, entityPos);
      if (dist > visualRange) continue;

      // Facing arc: detection fires when EITHER observer can see the other
      // within their 180° forward hemisphere.  No facing = omnidirectional.
      const partySeesEntity = tacticalService.isInFacingArc(combatantPos, combatant.facing, entityPos);
      const entitySeeesParty = tacticalService.isInFacingArc(entityPos, entity.facing, combatantPos);
      if (!partySeesEntity && !entitySeeesParty) continue;

      if (!tacticalService.hasLineOfSight(combatantPos, entityPos, terrain)) continue;

      const distFt = Math.round(dist * 10);

      if (entity.detected) continue; // already known

      // Mark detected immediately so subsequent calls don't re-alert
      gameState.markEnemyDetected(entity.id);

      const detectedEntity: Enemy = { ...entity, detected: true };

      // Broadcast updated entity to clients
      broadcastToSession(sessionId, {
        type: 'enemy_update',
        payload: detectedEntity,
        timestamp: now,
      });

      if (isHostile(entity) && session.current_mode !== 'tactical') {
        // Store for tactical trigger below (we want to enter tactical once, after all alerts)
        if (!hostileContact) {
          hostileContact = { entity, spotter: combatant, distFt };
        }
      } else if (!isHostile(entity)) {
        // Non-combat entity → chat alert only
        const alertContent = detectionAlertText(entity, combatant.name, distFt, conditions);
        console.log(`[contact-detection] ${alertContent.replace(/\*\*/g, '')}`);

        const alertMsg = gameState.createMessage({
          campaign_id: campaignId,
          session_id: sessionId,
          message_type: 'system_alert',
          content: alertContent,
          visibility: 'party',
        });
        broadcastToSession(sessionId, {
          type: 'chat_message',
          payload: alertMsg,
          timestamp: now,
        });
      }

      break; // this entity is detected; move to next entity
    }
  }

  // Enter tactical mode for first hostile contact
  if (hostileContact && session.current_mode !== 'tactical') {
    const { entity, spotter, distFt } = hostileContact;

    console.log(
      `[contact-detection] ${spotter.name} spots hostile ${entity.name} ` +
      `at ${distFt} ft in ${conditions} — switching to tactical`,
    );

    // Roll initiative for all living party members
    const rolled = party.map(c => {
      const natural = Math.floor(Math.random() * 20) + 1;
      const bonus = c.combat?.initiative_bonus ?? 0;
      broadcastToSession(sessionId, {
        type: 'dice_roll',
        payload: {
          dice: 'd20',
          results: [natural],
          modifier: bonus,
          total: natural + bonus,
          natural,
          label: `${c.name} initiative`,
        },
        timestamp: now,
      });
      return { id: c.id, roll: natural + bonus };
    });
    rolled.sort((a, b) => b.roll - a.roll);
    const turn_order = rolled.map(r => r.id);

    const turn_state: TurnState = {
      turn_order,
      current_actor_index: 0,
      round: 1,
      tick: 0,
      action_budget: Object.fromEntries(party.map(c => [c.id, c.combat?.apm ?? 4])),
      pending_input: turn_order.length > 0
        ? { actor_id: turn_order[0], input_type: 'free_text' }
        : undefined,
    };

    gameState.updateSessionMode(sessionId, 'tactical');
    gameState.updateTurnState(sessionId, turn_state);

    broadcastToSession(sessionId, {
      type: 'mode_change',
      payload: { mode: 'tactical', turn_state },
      timestamp: now,
    });

    const firstActorName = party.find(c => c.id === turn_order[0])?.name ?? 'Unknown';
    const catLabel = categoryLabel(entity);
    const alertMsg = gameState.createMessage({
      campaign_id: campaignId,
      session_id: sessionId,
      message_type: 'system_alert',
      content:
        `⚔ CONTACT! ${spotter.name} has ${catLabel} **${entity.name}** in sight ` +
        `(${distFt} ft, ${conditions}) — COMBAT BEGINS. ${firstActorName} acts first.`,
      visibility: 'party',
    });
    broadcastToSession(sessionId, {
      type: 'chat_message',
      payload: alertMsg,
      timestamp: now,
    });
  }
}
