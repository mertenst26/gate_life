/**
 * AgentTurnExecutor — drives a single agent combatant's tactical turn.
 *
 * Flow (with visible delays between steps):
 *   1. Think briefly (1 s)
 *   2. Decide: move toward nearest enemy or party centroid
 *   3. Move and broadcast combatant_update
 *   4. If an enemy is in range, attack and broadcast dice + damage results
 *   5. Speak a personality-appropriate line to party chat
 *   6. Caller advances the turn
 */

import { gameState } from './GameStateService.js';
import { broadcastToSession, pendingAgentOrders } from '../ws/handler.js';
import { rollStrike, rollDefense, rollDamage } from '@gate-life/shared';
import type { Combatant, WSMessage } from '@gate-life/shared';
import { parseMovement } from './MovementParser.js';

// Max attack range for Dog Boy ranged weapon (M-16 equivalent: 1,600 ft = 160 grid units)
const RANGED_ATTACK_RANGE = 60; // conservative — keep it realistic for tactical grid
const MELEE_RANGE = 1;

// How far an agent may stray from the party centroid (grid units).
// Keeps agents always visible in the shared viewport.
const MAX_LEASH = 6;

// ── Geometry helpers ───────────────────────────────────────────────────────────
function dist(ax: number, ay: number, bx: number, by: number) {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

function stepToward(
  cx: number, cy: number,
  tx: number, ty: number,
  maxSteps: number,
): [number, number] {
  const d = dist(cx, cy, tx, ty);
  if (d === 0) return [cx, cy];
  const ratio = Math.min(maxSteps / d, 1);
  return [
    Math.round(cx + (tx - cx) * ratio),
    Math.round(cy + (ty - cy) * ratio),
  ];
}

function partyCentroid(party: Combatant[], excludeId: string): [number, number] {
  const others = party.filter(c => c.id !== excludeId && c.status === 'alive');
  if (others.length === 0) return [0, 0];
  const sx = others.reduce((s, c) => s + (c.tactical_x ?? 0), 0) / others.length;
  const sy = others.reduce((s, c) => s + (c.tactical_y ?? 0), 0) / others.length;
  return [Math.round(sx), Math.round(sy)];
}

function facingFromDelta(dx: number, dy: number): string {
  if (dx === 0 && dy === 0) return 'north';
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  if (angle > -22.5 && angle <= 22.5)   return 'east';
  if (angle > 22.5  && angle <= 67.5)   return 'northeast';
  if (angle > 67.5  && angle <= 112.5)  return 'north';
  if (angle > 112.5 && angle <= 157.5)  return 'northwest';
  if (angle > 157.5 || angle <= -157.5) return 'west';
  if (angle > -157.5 && angle <= -112.5) return 'southwest';
  if (angle > -112.5 && angle <= -67.5) return 'south';
  return 'southeast';
}

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

// ── Dialog by personality ─────────────────────────────────────────────────────
function pickDialog(agent: Combatant, situation: 'move' | 'attack' | 'miss' | 'hold'): string {
  const name = agent.name;
  const style  = agent.personality?.speech_style   ?? 'terse';
  const quirks = agent.personality?.quirks          ?? [];
  const pref   = agent.personality?.combat_preference ?? 'aggressive';

  const tables: Record<string, Record<string, string[]>> = {
    move: {
      terse:  [`${name} advances.`, `${name} moves up.`, `Moving.`],
      formal: [`${name} repositions strategically.`, `"Adjusting position," ${name} reports.`],
      slang:  [`"I'm on it!" ${name} barks.`, `${name} dashes forward.`],
      poetic: [`${name} flows across the ground like smoke.`, `"The pack moves as one," ${name} murmurs.`],
    },
    attack: {
      terse:  [`${name} fires!`, `${name} attacks!`, `"Engaging!"`, `${name} snarls and opens fire.`],
      formal: [`"Engaging target," ${name} announces.`, `${name} takes aim and fires.`],
      slang:  [`"Get some!" ${name} howls.`, `"Eat this!" ${name} barks.`],
      poetic: [`"Your time ends here," ${name} growls.`, `${name} howls as the shot rings out.`],
    },
    miss: {
      terse:  [`${name} misses.`, `"Damn!" ${name} growls.`, `"Missed!"`],
      formal: [`"Target evaded," ${name} reports.`, `${name} adjusts aim.`],
      slang:  [`"Ugh, slippery one!" ${name} barks.`, `"Next time!" ${name} says.`],
      poetic: [`${name} curses under their breath.`, `"The wind shifted," ${name} mutters.`],
    },
    hold: {
      terse:  [`${name} holds position.`, `"Holding."`, `${name} waits.`],
      formal: [`${name} maintains watch on the perimeter.`, `"No threats detected. Standing by."`],
      slang:  [`"All clear up here," ${name} says.`, `${name} sniffs the air.`],
      poetic: [`${name} listens to the silence.`, `"The rift is quiet tonight," ${name} murmurs.`],
    },
  };

  // Quirk overrides
  if (situation === 'attack' && quirks.includes('always first to charge'))
    return `${name} charges forward, snarling, and opens fire!`;
  if (situation === 'attack' && quirks.includes('makes jokes mid-combat'))
    return `"Here comes the pain!" ${name} barks, pulling the trigger.`;
  if (situation === 'hold' && pref === 'defensive' && quirks.includes('protective of pack'))
    return `${name} keeps watch, eyes scanning for threats to the pack.`;

  const pool = tables[situation]?.[style] ?? tables[situation]?.terse ?? [`${name} acts.`];
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Main executor ─────────────────────────────────────────────────────────────
export async function executeAgentTurn(
  agent: Combatant,
  sessionId: string,
  campaignId: string,
): Promise<void> {
  if (agent.status !== 'alive') return;

  const bcast = (msg: WSMessage) => broadcastToSession(sessionId, msg);
  const now = () => new Date().toISOString();

  // 1 s pause so the UI can show the highlight before anything happens
  await sleep(1000);

  const session  = gameState.getSession(sessionId);
  if (!session || session.current_mode !== 'tactical') return;

  const party   = gameState.getPartyCombatants(campaignId);
  const enemies = gameState.getSessionEnemies(sessionId);
  const aliveEnemies = enemies.filter(e => (e as any).status !== 'dead');

  const cx = agent.tactical_x ?? 0;
  const cy = agent.tactical_y ?? 0;
  const maxMove = Math.max(1, Math.round(agent.attributes.spd_bipedal * 5 / 10));

  const [pcx, pcy] = partyCentroid(party, agent.id);
  const toParty = dist(cx, cy, pcx, pcy);

  // ── Execute pending player-issued order (replaces AI movement this turn) ────
  let orderExecuted = false;
  const pendingOrder = pendingAgentOrders.get(agent.id);
  if (pendingOrder) {
    pendingAgentOrders.delete(agent.id);
    const movement = parseMovement(pendingOrder, agent.attributes.spd_bipedal, agent.attributes.spd_quadruped, true);
    if (movement) {
      const clampedGrid = Math.min(movement.distance_grid, maxMove);
      const ratio = movement.distance_grid > 0 ? clampedGrid / movement.distance_grid : 1;
      const newX = Math.round(cx + movement.dx * ratio);
      const newY = Math.round(cy + movement.dy * ratio);
      const facing = facingFromDelta(newX - cx, newY - cy);
      const updated = gameState.updateCombatantPosition(agent.id, newX, newY, facing);
      if (updated) bcast({ type: 'combatant_update', payload: updated, timestamp: now() });

      const confirmMsg = gameState.createMessage({
        campaign_id: campaignId, session_id: sessionId,
        actor_id: agent.id,
        message_type: 'npc_dialog',
        content: pickDialog(agent, 'move'),
        visibility: 'party',
      });
      bcast({ type: 'chat_message', payload: confirmMsg, timestamp: now() });
      console.log(`[directed] ${agent.name} executed order "${pendingOrder}" → grid (${newX},${newY})`);
      await sleep(600);
      orderExecuted = true;
    }
  }

  // ── Decide AI movement target (only when no player order was consumed) ──────
  let moveTarget: [number, number] | null = null;
  let nearestEnemy: typeof aliveEnemies[0] | null = null;

  if (!orderExecuted && toParty > MAX_LEASH) {
    moveTarget = [pcx, pcy];
  } else if (!orderExecuted && aliveEnemies.length > 0) {
    // Find nearest enemy
    nearestEnemy = aliveEnemies.reduce((best, e) => {
      const db = dist(cx, cy, e.tactical_x ?? 0, e.tactical_y ?? 0);
      const bb = dist(cx, cy, best.tactical_x ?? 0, best.tactical_y ?? 0);
      return db < bb ? e : best;
    });
    const ed = dist(cx, cy, nearestEnemy.tactical_x ?? 0, nearestEnemy.tactical_y ?? 0);

    if (ed > RANGED_ATTACK_RANGE) {
      // Too far to shoot — move closer, but only if it won't break the leash
      moveTarget = [nearestEnemy.tactical_x ?? 0, nearestEnemy.tactical_y ?? 0];
    } else if (ed > MELEE_RANGE + 1) {
      // In ranged range — close to optimal distance
      const optimalRange = Math.round(RANGED_ATTACK_RANGE * 0.4);
      if (ed > optimalRange) {
        moveTarget = [nearestEnemy.tactical_x ?? 0, nearestEnemy.tactical_y ?? 0];
      }
    }
    // Already adjacent — no need to advance
  } else if (!orderExecuted) {
    // No enemies — drift back toward centroid if more than 2 cells away
    if (toParty > 2) {
      moveTarget = [pcx, pcy];
    }
  }

  // ── Execute movement ────────────────────────────────────────────────────────
  // If a player order moved the agent, refresh position from DB for attack range checks
  const agentNow = orderExecuted ? (gameState.getCombatant(agent.id) ?? agent) : agent;
  let newX = agentNow.tactical_x ?? cx;
  let newY = agentNow.tactical_y ?? cy;

  if (moveTarget) {
    // Gap: stay 1.5 cells from enemies, 1.5 cells from friendly party members
    const gap = nearestEnemy ? MELEE_RANGE + 0.5 : 1.5;
    const targetDist = dist(cx, cy, moveTarget[0], moveTarget[1]);
    const effectiveMax = Math.max(0, Math.min(maxMove, targetDist - gap));
    [newX, newY] = stepToward(cx, cy, moveTarget[0], moveTarget[1], effectiveMax);

    // Hard clamp: never land more than MAX_LEASH cells from party centroid
    if (dist(newX, newY, pcx, pcy) > MAX_LEASH) {
      [newX, newY] = stepToward(cx, cy, pcx, pcy, Math.min(maxMove, toParty - 1.5));
    }

    // Avoid landing on a cell already occupied by a party member
    const occupied = party
      .filter(c => c.id !== agent.id && c.status === 'alive')
      .map(c => `${c.tactical_x ?? 0},${c.tactical_y ?? 0}`);
    if (occupied.includes(`${newX},${newY}`)) {
      // Try adjacent cells in cardinal directions
      const candidates: [number, number][] = [
        [newX + 1, newY], [newX - 1, newY],
        [newX, newY + 1], [newX, newY - 1],
        [newX + 1, newY + 1], [newX - 1, newY - 1],
        [newX + 1, newY - 1], [newX - 1, newY + 1],
      ];
      const free = candidates.find(([ax, ay]) => !occupied.includes(`${ax},${ay}`));
      if (free) { [newX, newY] = free; }
      else { newX = cx; newY = cy; } // can't move — stay put
    }

    if (newX !== cx || newY !== cy) {
      const facing = facingFromDelta(newX - cx, newY - cy);
      const updated = gameState.updateCombatantPosition(agent.id, newX, newY, facing);
      if (updated) {
        bcast({ type: 'combatant_update', payload: updated, timestamp: now() });
      }

      // Post move dialog
      const moveMsg = gameState.createMessage({
        campaign_id: campaignId,
        session_id: sessionId,
        actor_id: agent.id,
        message_type: 'npc_dialog',
        content: pickDialog(agent, 'move'),
        visibility: 'party',
      });
      bcast({ type: 'chat_message', payload: moveMsg, timestamp: now() });

      await sleep(800);
    }
  }

  // ── Execute attack (if enemy in range) ────────────────────────────────────
  // When the move phase was player-directed, nearestEnemy wasn't computed yet
  if (orderExecuted && aliveEnemies.length > 0) {
    nearestEnemy = aliveEnemies.reduce((best, e) => {
      const db = dist(newX, newY, e.tactical_x ?? 0, e.tactical_y ?? 0);
      const bb = dist(newX, newY, best.tactical_x ?? 0, best.tactical_y ?? 0);
      return db < bb ? e : best;
    });
  }

  if (nearestEnemy) {
    const ex  = nearestEnemy.tactical_x ?? 0;
    const ey  = nearestEnemy.tactical_y ?? 0;
    const eDist = dist(newX, newY, ex, ey);

    if (eDist <= RANGED_ATTACK_RANGE) {
      // Weapon data
      const weapon = agent.inventory.find(i => i.equipped && (i.type === 'weapon_ranged' || i.type === 'weapon_melee'));
      const damageDice = weapon?.damage ?? '2d6';
      const damageType = weapon?.damage_type ?? 'sdc';

      // Strike roll
      const strikeRoll = rollStrike(agent.combat.strike_bonus);
      const defenseRoll = rollDefense(nearestEnemy.dodge_bonus);
      const hit = !strikeRoll.fumble && strikeRoll.total >= 5 && strikeRoll.total > defenseRoll.total;

      if (hit) {
        const dmgRoll = rollDamage(damageDice, agent.combat.damage_bonus ?? 0);
        const totalDmg = strikeRoll.critical ? dmgRoll.total * 2 : dmgRoll.total;

        // Apply damage to enemy
        const newHp = Math.max(-999, nearestEnemy.hp_current - totalDmg);
        const died  = newHp <= 0;
        gameState.updateEnemyHp(nearestEnemy.id, newHp, died ? 'dead' : undefined);

        // Broadcast hit narrative
        const narrative = strikeRoll.critical
          ? `${agent.name} lands a CRITICAL HIT on ${nearestEnemy.name}! [d20: ${strikeRoll.natural}+${strikeRoll.modifier}=${strikeRoll.total}] → [${damageDice}: ${dmgRoll.natural}×2 = ${totalDmg} ${damageType.toUpperCase()}]${died ? ' — TARGET DOWN!' : ''}`
          : `${agent.name} hits ${nearestEnemy.name}! [d20: ${strikeRoll.natural}+${strikeRoll.modifier}=${strikeRoll.total}] → [${damageDice}: ${dmgRoll.natural} = ${totalDmg} ${damageType.toUpperCase()}]${died ? ' — TARGET DOWN!' : ''}`;

        const hitMsg = gameState.createMessage({
          campaign_id: campaignId, session_id: sessionId,
          actor_id: agent.id,
          message_type: 'system_alert',
          content: `⚔ ${narrative}`,
          visibility: 'party',
        });
        bcast({ type: 'chat_message', payload: hitMsg, timestamp: now() });
        bcast({ type: 'enemy_update', payload: { id: nearestEnemy.id, hp_current: newHp, status: died ? 'dead' : nearestEnemy.status }, timestamp: now() });

        const speechMsg = gameState.createMessage({
          campaign_id: campaignId, session_id: sessionId,
          actor_id: agent.id,
          message_type: 'npc_dialog',
          content: pickDialog(agent, 'attack'),
          visibility: 'party',
        });
        bcast({ type: 'chat_message', payload: speechMsg, timestamp: now() });

      } else {
        const reason = strikeRoll.fumble ? 'fumbles!' : `misses (${strikeRoll.total} vs ${defenseRoll.total})`;
        const missMsg = gameState.createMessage({
          campaign_id: campaignId, session_id: sessionId,
          actor_id: agent.id,
          message_type: 'system_alert',
          content: `⚔ ${agent.name} ${reason}`,
          visibility: 'party',
        });
        bcast({ type: 'chat_message', payload: missMsg, timestamp: now() });

        const speechMsg = gameState.createMessage({
          campaign_id: campaignId, session_id: sessionId,
          actor_id: agent.id,
          message_type: 'npc_dialog',
          content: pickDialog(agent, 'miss'),
          visibility: 'party',
        });
        bcast({ type: 'chat_message', payload: speechMsg, timestamp: now() });
      }

      await sleep(600);
    }
  } else if (!moveTarget) {
    // Holding position — say something
    const holdMsg = gameState.createMessage({
      campaign_id: campaignId, session_id: sessionId,
      actor_id: agent.id,
      message_type: 'npc_dialog',
      content: pickDialog(agent, 'hold'),
      visibility: 'party',
    });
    bcast({ type: 'chat_message', payload: holdMsg, timestamp: now() });
    await sleep(400);
  }
}
