import { gameState } from './GameStateService.js';
import type { Combatant, GameEvent } from '@gate-life/shared';
import {
  HUNGER_PENALTY_THRESHOLD, HUNGER_SEVERE_THRESHOLD,
  THIRST_PENALTY_THRESHOLD, THIRST_SEVERE_THRESHOLD,
  FATIGUE_PENALTY_THRESHOLD, FATIGUE_SEVERE_THRESHOLD,
} from '@gate-life/shared';

export interface ConsequencePenalties {
  roll_modifier: number;
  speed_modifier: number;
  dodge_modifier: number;
  apm_modifier: number;
  concentration_modifier: number;
}

export class ConsequenceEngine {
  computePenalties(combatant: Combatant): ConsequencePenalties {
    const p: ConsequencePenalties = {
      roll_modifier: 0,
      speed_modifier: 0,
      dodge_modifier: 0,
      apm_modifier: 0,
      concentration_modifier: 0,
    };

    // Hunger
    if (combatant.needs.hunger >= HUNGER_SEVERE_THRESHOLD) {
      p.roll_modifier -= 3;
      p.speed_modifier -= 0.5;
    } else if (combatant.needs.hunger >= HUNGER_PENALTY_THRESHOLD) {
      p.roll_modifier -= 1;
      p.speed_modifier -= 0.1;
    }

    // Thirst
    if (combatant.needs.thirst >= THIRST_SEVERE_THRESHOLD) {
      p.roll_modifier -= 4;
      p.concentration_modifier -= 4;
    } else if (combatant.needs.thirst >= THIRST_PENALTY_THRESHOLD) {
      p.roll_modifier -= 1;
      p.concentration_modifier -= 2;
    }

    // Fatigue
    if (combatant.needs.fatigue >= FATIGUE_SEVERE_THRESHOLD) {
      p.roll_modifier -= 2;
      p.apm_modifier -= 2;
    } else if (combatant.needs.fatigue >= FATIGUE_PENALTY_THRESHOLD) {
      p.apm_modifier -= 1;
    }

    // Encumbrance
    const encTier = this.getEncumbranceTier(combatant);
    switch (encTier) {
      case 'medium':
        p.dodge_modifier -= 1;
        p.speed_modifier -= 0.1;
        break;
      case 'heavy':
        p.dodge_modifier -= 3;
        p.speed_modifier -= 0.3;
        break;
      case 'overloaded':
        p.dodge_modifier -= 5;
        p.speed_modifier -= 1.0;
        break;
    }

    return p;
  }

  getEncumbranceTier(combatant: Combatant): 'light' | 'medium' | 'heavy' | 'overloaded' {
    const totalWeight = combatant.inventory.reduce((sum, item) => sum + (item.weight * item.quantity), 0);
    const capacity = combatant.attributes.ps * 10;

    const ratio = totalWeight / capacity;
    if (ratio > 1.0) return 'overloaded';
    if (ratio > 0.7) return 'heavy';
    if (ratio > 0.4) return 'medium';
    return 'light';
  }

  processRoundEnd(campaignId: string, sessionId: string, combatant: Combatant): GameEvent[] {
    const events: GameEvent[] = [];

    // Bleeding damage
    const injuries = gameState.getInjuries(combatant.id);
    const bleedingInjuries = injuries.filter(i => i.bleeding);
    if (bleedingInjuries.length > 0) {
      const bleedDamage = bleedingInjuries.length;
      const newHp = combatant.vitals.hp_current - bleedDamage;
      gameState.updateCombatantVitals(combatant.id, { hp_current: newHp });

      events.push(gameState.logEvent({
        campaign_id: campaignId,
        session_id: sessionId,
        event_type: 'bleeding_damage',
        actor_id: combatant.id,
        data: { damage: bleedDamage, injuries: bleedingInjuries.length },
        narrative: `${combatant.name} loses ${bleedDamage} HP from bleeding wounds!`,
        visibility: 'party',
      }));

      if (newHp <= 0) {
        gameState.updateCombatantVitals(combatant.id, { status: 'unconscious' });
        events.push(gameState.logEvent({
          campaign_id: campaignId,
          session_id: sessionId,
          event_type: 'unconscious',
          actor_id: combatant.id,
          narrative: `${combatant.name} falls unconscious from blood loss!`,
          visibility: 'party',
        }));
      }

      // Check death threshold
      if (newHp <= -combatant.attributes.pe) {
        gameState.killCombatant(combatant.id);
        events.push(gameState.logEvent({
          campaign_id: campaignId,
          session_id: sessionId,
          event_type: 'death',
          actor_id: combatant.id,
          narrative: `${combatant.name} has bled out and died!`,
          visibility: 'party',
        }));
      }
    }

    // Severe hunger damage
    if (combatant.needs.hunger >= HUNGER_SEVERE_THRESHOLD) {
      const newHp = combatant.vitals.hp_current - 1;
      gameState.updateCombatantVitals(combatant.id, { hp_current: newHp });
      events.push(gameState.logEvent({
        campaign_id: campaignId,
        session_id: sessionId,
        event_type: 'hunger_damage',
        actor_id: combatant.id,
        narrative: `${combatant.name} is starving! (-1 HP)`,
        visibility: 'party',
      }));
    }

    // Severe thirst damage
    if (combatant.needs.thirst >= THIRST_SEVERE_THRESHOLD) {
      const newHp = combatant.vitals.hp_current - 2;
      gameState.updateCombatantVitals(combatant.id, { hp_current: newHp });
      events.push(gameState.logEvent({
        campaign_id: campaignId,
        session_id: sessionId,
        event_type: 'thirst_damage',
        actor_id: combatant.id,
        narrative: `${combatant.name} is severely dehydrated! (-2 HP)`,
        visibility: 'party',
      }));
    }

    // Update pulse based on current state
    const basePulse = 72;
    let pulseMod = 0;
    if (combatant.vitals.hp_current < combatant.vitals.hp_max * 0.5) pulseMod += 30;
    if (combatant.vitals.hp_current < combatant.vitals.hp_max * 0.25) pulseMod += 30;
    if (bleedingInjuries.length > 0) pulseMod += 15 * bleedingInjuries.length;
    if (combatant.needs.thirst >= THIRST_SEVERE_THRESHOLD) pulseMod += 20;
    pulseMod += Math.floor(Math.random() * 20); // combat adrenaline
    gameState.updateCombatantVitals(combatant.id, {
      pulse_bpm: Math.min(220, basePulse + pulseMod),
    });

    return events;
  }

  processRestHour(campaignId: string, sessionId: string, combatant: Combatant, meditating: boolean): GameEvent[] {
    const events: GameEvent[] = [];

    // HP recovery (slow natural healing)
    if (combatant.vitals.hp_current < combatant.vitals.hp_max && combatant.vitals.hp_current > 0) {
      const healAmount = 1;
      const newHp = Math.min(combatant.vitals.hp_max, combatant.vitals.hp_current + healAmount);
      gameState.updateCombatantVitals(combatant.id, { hp_current: newHp });
    }

    // ISP recovery
    const ispRate = meditating ? 6 : 2;
    if (combatant.vitals.isp_current < combatant.vitals.isp_max) {
      const newIsp = Math.min(combatant.vitals.isp_max, combatant.vitals.isp_current + ispRate);
      gameState.updateCombatantVitals(combatant.id, { isp_current: newIsp });
    }

    // Fatigue recovery
    if (combatant.needs.fatigue > 0) {
      const newFatigue = Math.max(0, combatant.needs.fatigue - 12);
      gameState.updateCombatantVitals(combatant.id, { fatigue: newFatigue });
    }

    // Pulse settles during rest
    const restPulse = 60 + Math.floor(Math.random() * 10);
    gameState.updateCombatantVitals(combatant.id, { pulse_bpm: restPulse });

    return events;
  }

  processTravelLeg(campaignId: string, sessionId: string, combatant: Combatant): GameEvent[] {
    const events: GameEvent[] = [];

    // Increase hunger and thirst
    const hungerIncrease = 5;
    const thirstIncrease = 7;
    const fatigueIncrease = 3;

    const newHunger = Math.min(100, combatant.needs.hunger + hungerIncrease);
    const newThirst = Math.min(100, combatant.needs.thirst + thirstIncrease);
    const newFatigue = Math.min(100, combatant.needs.fatigue + fatigueIncrease);

    gameState.updateCombatantVitals(combatant.id, {
      hunger: newHunger,
      thirst: newThirst,
      fatigue: newFatigue,
    });

    // Travel pulse
    const travelPulse = 85 + Math.floor(Math.random() * 15);
    gameState.updateCombatantVitals(combatant.id, { pulse_bpm: travelPulse });

    return events;
  }
}

export const consequenceEngine = new ConsequenceEngine();
