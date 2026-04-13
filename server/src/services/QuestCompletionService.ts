import type { GameEvent, ScenarioContext } from '@gate-life/shared';
import { gameState } from './GameStateService.js';
import { progressionService } from './ProgressionService.js';
import { broadcastToSession } from '../ws/handler.js';

/** XP per priority row convincingly completed (shared quest reward to whole party). */
const XP_PER_MISSION = 150;

function norm(s: string): string {
  return s.toLowerCase().trim();
}

function findQuestGiver(ctx: ScenarioContext, rawName: string) {
  const n = norm(rawName);
  const exact = ctx.quest_givers.find(g => norm(g.name) === n);
  if (exact) return exact;
  return ctx.quest_givers.find(
    g => norm(g.name).includes(n) || n.includes(norm(g.name)),
  );
}

export function extractQuestCompleteMarkers(content: string): Array<{ giver: string; mission1Based: number }> {
  const out: Array<{ giver: string; mission1Based: number }> = [];
  const re = /<!--QUEST_COMPLETE:([^:]+):(\d+)-->/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const giver = m[1].trim();
    const mission1Based = parseInt(m[2], 10);
    if (giver && Number.isFinite(mission1Based) && mission1Based >= 1) {
      out.push({ giver, mission1Based });
    }
  }
  return out;
}

/**
 * Validates <!--QUEST_COMPLETE:Name:N-->, advances progress, awards XP to all living party members,
 * broadcasts game_event + combatant_update.
 */
export function processQuestCompleteMarkers(sessionId: string, campaignId: string, response: string): void {
  const markers = extractQuestCompleteMarkers(response);
  if (markers.length === 0) return;

  const campaign = gameState.getCampaign(campaignId);
  const ctx = campaign?.gm_agent_config?.scenario_context;
  if (!ctx?.quest_givers?.length) return;

  const now = new Date().toISOString();

  for (const { giver: giverRaw, mission1Based } of markers) {
    const giver = findQuestGiver(ctx, giverRaw);
    if (!giver) {
      console.warn(`[quest-complete] unknown quest giver "${giverRaw}"`);
      continue;
    }

    const key = giver.name;
    const prios = giver.priorities ?? [];
    if (prios.length === 0) continue;

    const baseCfg = gameState.getCampaign(campaignId)?.gm_agent_config;
    const progressState = { ...(baseCfg?.quest_giver_progress ?? {}) };
    const entry = { ...(progressState[key] ?? { next_priority_index: 0 }) };
    const expected1Based = entry.next_priority_index + 1;

    if (mission1Based !== expected1Based) {
      console.warn(
        `[quest-complete] ignored — ${key}: marker mission ${mission1Based}, expected ${expected1Based} (next_priority_index=${entry.next_priority_index})`,
      );
      continue;
    }
    if (mission1Based > prios.length) {
      console.warn(`[quest-complete] ignored — mission ${mission1Based} out of range for ${key}`);
      continue;
    }

    entry.next_priority_index = entry.next_priority_index + 1;
    progressState[key] = entry;
    gameState.mergeGmAgentConfig(campaignId, { quest_giver_progress: progressState });

    const party = gameState.getPartyCombatants(campaignId).filter(c => c.status !== 'dead');
    const allEvents: GameEvent[] = [];
    const label = prios[mission1Based - 1] ?? `mission ${mission1Based}`;
    const reason = `Quest — ${key}: ${label}`.slice(0, 200);

    for (const c of party) {
      const ev = progressionService.awardXP(c.id, XP_PER_MISSION, reason, campaignId, sessionId);
      allEvents.push(...ev);
      const updated = gameState.getCombatant(c.id);
      if (updated) {
        broadcastToSession(sessionId, {
          type: 'combatant_update',
          payload: updated,
          timestamp: now,
        });
      }
    }

    if (allEvents.length > 0) {
      broadcastToSession(sessionId, {
        type: 'game_event',
        payload: { events: allEvents },
        timestamp: now,
      });
    }

    const more = entry.next_priority_index < prios.length;
    const nextHint = more
      ? ` Next open mission from **${key}** when they offer it: "${prios[entry.next_priority_index]}".`
      : ` **${key}** has no further missions in their list.`;

    const alertMsg = gameState.createMessage({
      campaign_id: campaignId,
      session_id: sessionId,
      message_type: 'system_alert',
      content:
        `⭐ Quest logged — **${key}** acknowledges mission ${mission1Based} complete. ` +
        `+${XP_PER_MISSION} XP to each party member.${nextHint}`,
      visibility: 'party',
    });
    broadcastToSession(sessionId, { type: 'chat_message', payload: alertMsg, timestamp: now });

    console.log(`[quest-complete] ${key} mission ${mission1Based} — next_priority_index=${entry.next_priority_index}`);
  }
}
