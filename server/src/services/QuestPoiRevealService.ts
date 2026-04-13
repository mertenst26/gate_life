import type { Enemy } from '@gate-life/shared';
import { gameState } from './GameStateService.js';
import { broadcastToSession } from '../ws/handler.js';

function norm(s: string): string {
  return s.toLowerCase().trim();
}

/** Find a session POI whose name matches the marker (exact, then substring). */
function findPoiByName(entities: Enemy[], rawName: string): Enemy | undefined {
  const n = norm(rawName);
  if (!n) return undefined;
  const pois = entities.filter(e => e.enemy_type === 'poi' && e.status !== 'dead');
  const exact = pois.find(e => norm(e.name) === n);
  if (exact) return exact;
  return pois.find(
    e => norm(e.name).includes(n) || n.includes(norm(e.name)),
  );
}

/**
 * Reveal a scenario POI on the world/tactical map as a quest destination (yellow).
 * Idempotent: if already detected, still sets quest_poi for yellow styling.
 */
export function revealQuestPoiByName(
  sessionId: string,
  campaignId: string,
  rawName: string,
): void {
  const entities = gameState.getSessionEnemies(sessionId);
  const poi = findPoiByName(entities, rawName);
  if (!poi) {
    console.warn(`[quest-poi] No POI matched "${rawName}" in session ${sessionId.slice(-4)}`);
    return;
  }

  gameState.markPoiQuestReveal(poi.id);
  const updated = gameState.getEnemy(poi.id);
  if (!updated) return;

  const now = new Date().toISOString();
  broadcastToSession(sessionId, {
    type: 'enemy_update',
    payload: updated,
    timestamp: now,
  });

  const msg = gameState.createMessage({
    campaign_id: campaignId,
    session_id: sessionId,
    message_type: 'system_alert',
    content: `📌 Quest marker — **${updated.name}** is now marked on your map.`,
    visibility: 'party',
  });
  broadcastToSession(sessionId, { type: 'chat_message', payload: msg, timestamp: now });
}

export function extractRevealPoiMarkers(content: string): string[] {
  const names: string[] = [];
  const re = /<!--REVEAL_POI:([\s\S]*?)-->/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const name = m[1].trim();
    if (name) names.push(name);
  }
  return names;
}
