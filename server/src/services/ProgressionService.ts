import { gameState } from './GameStateService.js';
import { getTemplate } from './ClassTemplateService.js';
import { getDb } from '../db/connection.js';
import { roll } from '@gate-life/shared';
import type { Combatant, GameEvent } from '@gate-life/shared';

export class ProgressionService {
  awardXP(combatantId: string, amount: number, reason: string, campaignId: string, sessionId: string): GameEvent[] {
    const events: GameEvent[] = [];
    const result = gameState.updateCombatantXP(combatantId, amount);
    const combatant = gameState.getCombatant(combatantId);
    if (!combatant) return events;

    events.push(gameState.logEvent({
      campaign_id: campaignId,
      session_id: sessionId,
      event_type: 'xp_award',
      actor_id: combatantId,
      data: { amount, reason, total_xp: combatant.xp },
      narrative: `${combatant.name} earns ${amount} XP (${reason})!`,
      visibility: 'party',
    }));

    if (result.leveled_up && result.new_level) {
      events.push(...this.processLevelUp(combatant, result.new_level, campaignId, sessionId));
    }

    return events;
  }

  private processLevelUp(combatant: Combatant, newLevel: number, campaignId: string, sessionId: string): GameEvent[] {
    const events: GameEvent[] = [];
    const template = getTemplate(combatant.class_id);
    if (!template) return events;

    // Roll HP increase
    const hpRoll = roll('1d6');
    const newHpMax = combatant.vitals.hp_max + hpRoll.total;

    // Roll ISP increase
    const ispRoll = roll('1d6');
    const newIspMax = combatant.vitals.isp_max + ispRoll.total;

    // Get next XP threshold
    const levelData = template.progression.level_table[newLevel + 1];
    const xpNextLevel = levelData?.xp ?? combatant.xp_next_level + 50000;

    // Apply level bonuses from template
    const levelBonuses = template.progression.level_table[newLevel];
    let bonusNarrative = '';

    if (levelBonuses?.bonuses) {
      bonusNarrative = ` Gains: ${levelBonuses.bonuses}.`;
    }
    if (levelBonuses?.new_power) {
      bonusNarrative += ' Unlocks a new psionic power!';
    }

    // Update combatant
    const db = getDb();
    db.prepare(`
      UPDATE combatants SET
        hp_max = ?, hp_current = hp_current + ?,
        isp_max = ?, isp_current = isp_current + ?,
        xp_next_level = ?,
        updated_at = ?
      WHERE id = ?
    `).run(newHpMax, hpRoll.total, newIspMax, ispRoll.total, xpNextLevel, new Date().toISOString(), combatant.id);

    events.push(gameState.logEvent({
      campaign_id: campaignId,
      session_id: sessionId,
      event_type: 'level_up',
      actor_id: combatant.id,
      data: {
        new_level: newLevel,
        hp_roll: hpRoll,
        isp_roll: ispRoll,
        new_hp_max: newHpMax,
        new_isp_max: newIspMax,
      },
      narrative: `${combatant.name} reaches Level ${newLevel}! (+${hpRoll.total} HP, +${ispRoll.total} ISP)${bonusNarrative}`,
      visibility: 'party',
    }));

    return events;
  }

  getLevelUpBonuses(classId: string, level: number): Record<string, unknown> | null {
    const template = getTemplate(classId);
    if (!template) return null;
    return template.progression.level_table[level] ?? null;
  }
}

export const progressionService = new ProgressionService();
