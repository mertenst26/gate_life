import { gameState } from './GameStateService.js';
import { consequenceEngine } from './ConsequenceEngine.js';
import { getDb } from '../db/connection.js';
import { broadcastToSession } from '../ws/handler.js';
import { rollInitiative, rollStrike, rollDefense, rollDamage, roll } from '@gate-life/shared';
import type { TurnState, DiceRollResult, Combatant, Enemy, GameEvent, SupportUnitConfig } from '@gate-life/shared';
import { STRIKE_HIT_MINIMUM, NATURAL_CRIT, NATURAL_FUMBLE, MELEE_ROUND_SECONDS } from '@gate-life/shared';

interface ActionResult {
  events: GameEvent[];
  turnState: TurnState | null;
  roundEnded: boolean;
}

export class TurnEngine {
  // ── Combat lifecycle ──

  startCombat(sessionId: string, campaignId: string): TurnState {
    gameState.updateSessionMode(sessionId, 'tactical');

    const party = gameState.getPartyCombatants(campaignId);
    const enemies = gameState.getSessionEnemies(sessionId);

    const combatants = [
      ...party.map(c => ({ id: c.id, bonus: c.combat.initiative_bonus, apm: c.combat.apm })),
      ...enemies.map(e => ({ id: e.id, bonus: e.initiative_bonus, apm: e.apm })),
    ];

    const turnOrder = this.rollInitiativeOrder(combatants, campaignId, sessionId);
    const actionBudget: Record<string, number> = {};
    for (const c of combatants) {
      actionBudget[c.id] = c.apm;
    }

    const turnState: TurnState = {
      turn_order: turnOrder,
      current_actor_index: 0,
      round: 1,
      tick: 1,
      action_budget: actionBudget,
      pending_input: {
        actor_id: turnOrder[0],
        input_type: 'action_selection',
        available_actions: ['strike', 'parry', 'dodge', 'power', 'move', 'use_item'],
      },
    };

    gameState.updateTurnState(sessionId, turnState);

    gameState.logEvent({
      campaign_id: campaignId,
      session_id: sessionId,
      event_type: 'combat_start',
      data: { turn_order: turnOrder, round: 1 },
      narrative: 'Combat begins! Roll initiative!',
      visibility: 'party',
    });

    return turnState;
  }

  endCombat(sessionId: string): void {
    const session = gameState.getSession(sessionId);
    if (!session) return;

    gameState.updateSessionMode(sessionId, 'conversation');
    gameState.updateTurnState(sessionId, null);

    // Reset pack howl charges for all party members
    const party = gameState.getPartyCombatants(session.campaign_id);
    for (const c of party) {
      gameState.updatePackHowl(c.id, 1);
    }

    gameState.logEvent({
      campaign_id: session.campaign_id,
      session_id: sessionId,
      event_type: 'combat_end',
      narrative: 'Combat has ended.',
      visibility: 'party',
    });
  }

  // ── Action processing ──

  processAction(
    sessionId: string,
    actorId: string,
    actionType: string,
    targetId?: string,
    data?: Record<string, unknown>,
  ): ActionResult {
    const session = gameState.getSession(sessionId);
    if (!session?.turn_state) {
      return { events: [], turnState: null, roundEnded: false };
    }

    const ts = { ...session.turn_state };
    const currentActorId = ts.turn_order[ts.current_actor_index];
    if (currentActorId !== actorId) {
      throw new Error('Not your turn');
    }

    const events: GameEvent[] = [];

    switch (actionType) {
      case 'strike':
        events.push(...this.handleStrike(session.campaign_id, sessionId, actorId, targetId!, data));
        break;
      case 'move':
        events.push(...this.handleMove(session.campaign_id, sessionId, actorId, data));
        break;
      case 'power':
        events.push(...this.handlePower(session.campaign_id, sessionId, actorId, targetId, data));
        break;
      case 'use_item':
        events.push(...this.handleUseItem(session.campaign_id, sessionId, actorId, data));
        break;
      case 'guard_ally':
        events.push(...this.handleGuardAlly(session.campaign_id, sessionId, actorId, targetId!));
        break;
      case 'pack_howl':
        events.push(...this.handlePackHowl(session.campaign_id, sessionId, actorId));
        break;
      case 'roll_with_impact':
        break; // handled as a defense response
      default:
        events.push(gameState.logEvent({
          campaign_id: session.campaign_id,
          session_id: sessionId,
          event_type: actionType,
          actor_id: actorId,
          target_id: targetId,
          data: data as Record<string, unknown>,
          visibility: 'party',
        }));
    }

    // Consume action
    ts.action_budget[actorId] = (ts.action_budget[actorId] || 0) - 1;

    let roundEnded = false;

    if (ts.action_budget[actorId] <= 0) {
      // Advance to next actor
      const advanced = this.advanceToNextActor(ts, session.campaign_id, sessionId);
      roundEnded = advanced.roundEnded;

      if (roundEnded) {
        // Process end-of-round effects
        const roundEvents = this.processEndOfRound(session.campaign_id, sessionId);
        events.push(...roundEvents);
      }
    }

    // Update pending input
    ts.pending_input = {
      actor_id: ts.turn_order[ts.current_actor_index],
      input_type: 'action_selection',
      available_actions: ['strike', 'parry', 'dodge', 'power', 'move', 'use_item'],
    };

    gameState.updateTurnState(sessionId, ts);
    return { events, turnState: ts, roundEnded };
  }

  endTurn(sessionId: string): TurnState | null {
    const session = gameState.getSession(sessionId);
    if (!session?.turn_state) return null;

    const ts = { ...session.turn_state };
    ts.action_budget[ts.turn_order[ts.current_actor_index]] = 0;

    const { roundEnded } = this.advanceToNextActor(ts, session.campaign_id, sessionId);

    if (roundEnded) {
      this.processEndOfRound(session.campaign_id, sessionId);
    }

    ts.pending_input = {
      actor_id: ts.turn_order[ts.current_actor_index],
      input_type: 'action_selection',
      available_actions: ['strike', 'parry', 'dodge', 'power', 'move', 'use_item'],
    };

    gameState.updateTurnState(sessionId, ts);
    return ts;
  }

  // ── Combat actions ──

  private handleStrike(campaignId: string, sessionId: string, attackerId: string, targetId: string, data?: Record<string, unknown>): GameEvent[] {
    const events: GameEvent[] = [];

    const attacker = this.getActor(attackerId);
    const target = this.getActor(targetId);
    if (!attacker || !target) return events;

    const weaponDice = (data?.weapon_damage as string) || '1d6';
    const damageType = (data?.damage_type as string) || 'sdc';

    // Strike roll
    const strikeRoll = rollStrike(attacker.strike_bonus);

    // Natural 1 always misses
    if (strikeRoll.fumble) {
      events.push(gameState.logEvent({
        campaign_id: campaignId, session_id: sessionId,
        event_type: 'strike_fumble', actor_id: attackerId, target_id: targetId,
        data: { roll: strikeRoll },
        narrative: `${attacker.name} fumbles! [d20: ${strikeRoll.natural}] -- Critical miss!`,
        visibility: 'party',
      }));
      return events;
    }

    // Check if strike hits (5+ after bonuses)
    if (strikeRoll.total < STRIKE_HIT_MINIMUM) {
      events.push(gameState.logEvent({
        campaign_id: campaignId, session_id: sessionId,
        event_type: 'strike_miss', actor_id: attackerId, target_id: targetId,
        data: { roll: strikeRoll },
        narrative: `${attacker.name} attacks ${target.name} -- [d20: ${strikeRoll.natural} + ${strikeRoll.modifier} = ${strikeRoll.total}] -- Miss!`,
        visibility: 'party',
      }));
      return events;
    }

    const isCrit = strikeRoll.critical;

    // Defender response (parry is free, dodge costs action)
    const session = gameState.getSession(sessionId);
    const ts = session?.turn_state;
    const defenderBudget = ts?.action_budget[targetId] ?? 0;

    // Try parry first (free)
    const parryRoll = rollDefense(target.parry_bonus);
    const parrySuccess = parryRoll.total >= strikeRoll.total;
    const canParryCrit = isCrit && parryRoll.natural === NATURAL_CRIT;

    if (parrySuccess && (!isCrit || canParryCrit)) {
      events.push(gameState.logEvent({
        campaign_id: campaignId, session_id: sessionId,
        event_type: 'parry_success', actor_id: targetId, target_id: attackerId,
        data: { strike_roll: strikeRoll, parry_roll: parryRoll },
        narrative: `${target.name} parries! [d20: ${parryRoll.natural} + ${parryRoll.modifier} = ${parryRoll.total}] vs ${strikeRoll.total} -- Blocked!`,
        visibility: 'party',
      }));
      return events;
    }

    // If parry failed and defender has actions, try dodge
    if (defenderBudget > 0 && !parrySuccess) {
      const dodgeRoll = rollDefense(target.dodge_bonus);
      const dodgeSuccess = dodgeRoll.total >= strikeRoll.total;
      const canDodgeCrit = isCrit && dodgeRoll.natural === NATURAL_CRIT;

      if (dodgeSuccess && (!isCrit || canDodgeCrit)) {
        // Consume dodge action
        if (ts) {
          ts.action_budget[targetId] = defenderBudget - 1;
        }

        events.push(gameState.logEvent({
          campaign_id: campaignId, session_id: sessionId,
          event_type: 'dodge_success', actor_id: targetId, target_id: attackerId,
          data: { strike_roll: strikeRoll, dodge_roll: dodgeRoll },
          narrative: `${target.name} dodges! [d20: ${dodgeRoll.natural} + ${dodgeRoll.modifier} = ${dodgeRoll.total}] vs ${strikeRoll.total} -- Evaded!`,
          visibility: 'party',
        }));
        return events;
      }
    }

    // Hit! Calculate damage
    const damageRoll = rollDamage(weaponDice, attacker.damage_bonus);
    let totalDamage = damageRoll.total;
    if (isCrit) totalDamage *= 2;

    events.push(gameState.logEvent({
      campaign_id: campaignId, session_id: sessionId,
      event_type: isCrit ? 'critical_hit' : 'strike_hit',
      actor_id: attackerId, target_id: targetId,
      data: { strike_roll: strikeRoll, damage_roll: damageRoll, total_damage: totalDamage, damage_type: damageType, critical: isCrit },
      narrative: `${attacker.name} ${isCrit ? 'CRITICALLY ' : ''}hits ${target.name}! [d20: ${strikeRoll.natural} + ${strikeRoll.modifier} = ${strikeRoll.total}] -- [${weaponDice}: ${damageRoll.natural}${isCrit ? ' x2' : ''} = ${totalDamage} ${damageType.toUpperCase()}]`,
      visibility: 'party',
    }));

    // Apply damage
    const damageEvents = this.applyDamage(campaignId, sessionId, targetId, totalDamage, damageType);
    events.push(...damageEvents);

    return events;
  }

  private applyDamage(campaignId: string, sessionId: string, targetId: string, amount: number, damageType: string): GameEvent[] {
    const events: GameEvent[] = [];
    const target = this.getActor(targetId);
    if (!target) return events;

    if (damageType === 'md') {
      // MD hits armor first
      if (target.armor_mdc_current > 0) {
        const armorAbsorbed = Math.min(target.armor_mdc_current, amount);
        const newArmorMdc = target.armor_mdc_current - armorAbsorbed;
        const overflow = amount - armorAbsorbed;

        if (target.isCombatant) {
          gameState.updateCombatantVitals(targetId, { armor_mdc_current: newArmorMdc });
        }

        if (newArmorMdc <= 0) {
          events.push(gameState.logEvent({
            campaign_id: campaignId, session_id: sessionId,
            event_type: 'armor_destroyed', actor_id: targetId,
            narrative: `${target.name}'s armor is destroyed!`,
            visibility: 'party',
          }));
        }

        if (overflow > 0) {
          // Overflow MD (converted to SDC: x100) hits body
          const bodyDamage = overflow * 100;
          events.push(...this.applyBodyDamage(campaignId, sessionId, targetId, bodyDamage));
        }
        return events;
      }

      // No armor, MD hits body directly (x100 SDC)
      events.push(...this.applyBodyDamage(campaignId, sessionId, targetId, amount * 100));
    } else {
      // SDC cannot damage MDC armor
      if (target.armor_mdc_current > 0) {
        events.push(gameState.logEvent({
          campaign_id: campaignId, session_id: sessionId,
          event_type: 'damage_absorbed', actor_id: targetId,
          narrative: `SDC attack bounces off ${target.name}'s MDC armor!`,
          visibility: 'party',
        }));
        return events;
      }

      events.push(...this.applyBodyDamage(campaignId, sessionId, targetId, amount));
    }

    return events;
  }

  private applyBodyDamage(campaignId: string, sessionId: string, targetId: string, amount: number): GameEvent[] {
    const events: GameEvent[] = [];
    const target = this.getActor(targetId);
    if (!target) return events;

    let remaining = amount;

    // SDC absorbs first
    if (target.sdc_current > 0) {
      const sdcAbsorbed = Math.min(target.sdc_current, remaining);
      remaining -= sdcAbsorbed;
      const newSdc = target.sdc_current - sdcAbsorbed;

      if (target.isCombatant) {
        gameState.updateCombatantVitals(targetId, { sdc_current: newSdc });
      } else {
        gameState.updateEnemyHp(targetId, target.hp_current, undefined);
      }
    }

    // Remaining hits HP
    if (remaining > 0) {
      const newHp = target.hp_current - remaining;

      if (target.isCombatant) {
        gameState.updateCombatantVitals(targetId, { hp_current: newHp });
      } else {
        const status = newHp <= 0 ? 'dead' : undefined;
        gameState.updateEnemyHp(targetId, newHp, status);
      }

      // Check death/unconscious
      if (newHp <= 0) {
        const deathThreshold = target.isCombatant ? -(target.pe || 13) : 0;
        if (newHp <= deathThreshold) {
          if (target.isCombatant) {
            gameState.killCombatant(targetId);
          }
          events.push(gameState.logEvent({
            campaign_id: campaignId, session_id: sessionId,
            event_type: 'death', actor_id: targetId,
            narrative: `${target.name} has been killed!`,
            visibility: 'party',
          }));
        } else {
          if (target.isCombatant) {
            gameState.updateCombatantVitals(targetId, { status: 'unconscious' });
          }
          events.push(gameState.logEvent({
            campaign_id: campaignId, session_id: sessionId,
            event_type: 'unconscious', actor_id: targetId,
            narrative: `${target.name} falls unconscious!`,
            visibility: 'party',
          }));
        }
      }
    }

    return events;
  }

  private handleMove(campaignId: string, sessionId: string, actorId: string, data?: Record<string, unknown>): GameEvent[] {
    const x = data?.x as number ?? 0;
    const y = data?.y as number ?? 0;
    const facing = data?.facing as string;

    const actor = this.getActor(actorId);
    if (!actor) return [];

    if (actor.isCombatant) {
      gameState.updateCombatantPosition(actorId, x, y, facing);
    } else {
      gameState.updateEnemyPosition(actorId, x, y);
    }

    return [gameState.logEvent({
      campaign_id: campaignId, session_id: sessionId,
      event_type: 'move', actor_id: actorId,
      data: { x, y, facing },
      narrative: `${actor.name} moves to (${x}, ${y}).`,
      visibility: 'party',
    })];
  }

  private handlePower(campaignId: string, sessionId: string, actorId: string, targetId?: string, data?: Record<string, unknown>): GameEvent[] {
    const powerId = data?.power_id as string;
    if (!powerId) return [];

    const actor = this.getActor(actorId);
    if (!actor || !actor.isCombatant) return [];

    const combatant = gameState.getCombatant(actorId);
    if (!combatant) return [];

    // Lookup ISP cost from a simple map (could be enhanced to load from template)
    const ispCosts: Record<string, number> = {
      sixth_sense: 2, empathy: 4, see_aura: 6, sense_evil: 2,
      sense_magic: 3, telepathy: 4, mind_block: 4, see_invisible: 4,
      presence_sense: 4, clairvoyance: 4, read_dimensional_portal: 6,
      total_recall: 2, sense_time: 2,
    };

    const cost = ispCosts[powerId] ?? 0;
    if (combatant.vitals.isp_current < cost) {
      return [gameState.logEvent({
        campaign_id: campaignId, session_id: sessionId,
        event_type: 'power_failed', actor_id: actorId,
        data: { power_id: powerId, reason: 'insufficient_isp' },
        narrative: `${actor.name} doesn't have enough ISP to use ${powerId}!`,
        visibility: 'party',
      })];
    }

    gameState.updateCombatantVitals(actorId, {
      isp_current: combatant.vitals.isp_current - cost,
    });

    return [gameState.logEvent({
      campaign_id: campaignId, session_id: sessionId,
      event_type: 'power_used', actor_id: actorId, target_id: targetId,
      data: { power_id: powerId, isp_cost: cost },
      narrative: `${actor.name} uses ${powerId}! (${cost} ISP spent)`,
      visibility: 'party',
    })];
  }

  private handleUseItem(campaignId: string, sessionId: string, actorId: string, data?: Record<string, unknown>): GameEvent[] {
    const itemId = data?.item_id as string;
    if (!itemId) return [];

    const actor = this.getActor(actorId);
    return [gameState.logEvent({
      campaign_id: campaignId, session_id: sessionId,
      event_type: 'use_item', actor_id: actorId,
      data: { item_id: itemId },
      narrative: `${actor?.name || 'Unknown'} uses an item.`,
      visibility: 'party',
    })];
  }

  private handleGuardAlly(campaignId: string, sessionId: string, actorId: string, allyId: string): GameEvent[] {
    return [gameState.logEvent({
      campaign_id: campaignId, session_id: sessionId,
      event_type: 'guard_ally', actor_id: actorId, target_id: allyId,
      narrative: `${this.getActor(actorId)?.name} guards ${this.getActor(allyId)?.name}!`,
      visibility: 'party',
    })];
  }

  private handlePackHowl(campaignId: string, sessionId: string, actorId: string): GameEvent[] {
    const combatant = gameState.getCombatant(actorId);
    if (!combatant || combatant.pack_howl_remaining <= 0) {
      return [gameState.logEvent({
        campaign_id: campaignId, session_id: sessionId,
        event_type: 'pack_howl_failed', actor_id: actorId,
        narrative: `${combatant?.name || 'Unknown'} has already used Pack Howl this rest!`,
        visibility: 'party',
      })];
    }

    gameState.updatePackHowl(actorId, 0);

    return [gameState.logEvent({
      campaign_id: campaignId, session_id: sessionId,
      event_type: 'pack_howl', actor_id: actorId,
      data: { bonus: 2, duration_rounds: 1 },
      narrative: `${combatant.name} lets out a mighty PACK HOWL! All Dog Boys gain +2 to all rolls for 1 round!`,
      visibility: 'party',
    })];
  }

  // ── Turn management ──

  private rollInitiativeOrder(
    combatants: Array<{ id: string; bonus: number; apm: number }>,
    campaignId: string,
    sessionId: string,
  ): string[] {
    const rolls: Array<{ id: string; roll: DiceRollResult }> = combatants.map(c => ({
      id: c.id,
      roll: rollInitiative(c.bonus),
    }));

    // Re-roll ties
    rolls.sort((a, b) => {
      if (b.roll.total !== a.roll.total) return b.roll.total - a.roll.total;
      // Tie: re-roll
      const rerollA = rollInitiative(0);
      const rerollB = rollInitiative(0);
      return rerollB.total - rerollA.total;
    });

    // Log initiative rolls
    for (const r of rolls) {
      const actor = this.getActor(r.id);
      gameState.logEvent({
        campaign_id: campaignId, session_id: sessionId,
        event_type: 'initiative_roll', actor_id: r.id,
        data: { roll: r.roll },
        narrative: `${actor?.name} rolls initiative: [d20: ${r.roll.natural} + ${r.roll.modifier} = ${r.roll.total}]`,
        visibility: 'party',
      });
    }

    return rolls.map(r => r.id);
  }

  private advanceToNextActor(ts: TurnState, campaignId: string, sessionId: string): { roundEnded: boolean } {
    let nextIndex = (ts.current_actor_index + 1) % ts.turn_order.length;
    let roundEnded = false;

    // Skip dead actors
    let attempts = 0;
    while (attempts < ts.turn_order.length) {
      if (nextIndex === 0 && ts.current_actor_index !== 0) {
        roundEnded = true;
        ts.round += 1;

        // Re-roll initiative for new round
        const combatants = ts.turn_order.map(id => {
          const actor = this.getActor(id);
          return { id, bonus: actor?.initiative_bonus ?? 0, apm: actor?.apm ?? 2 };
        }).filter(c => {
          const actor = this.getActor(c.id);
          return actor && actor.status !== 'dead';
        });

        const newOrder = this.rollInitiativeOrder(combatants, campaignId, sessionId);
        ts.turn_order = newOrder;
        ts.action_budget = {};
        for (const c of combatants) {
          ts.action_budget[c.id] = c.apm;
        }
        nextIndex = 0;
        break;
      }

      const actorId = ts.turn_order[nextIndex];
      const actor = this.getActor(actorId);
      if (actor && actor.status !== 'dead' && actor.status !== 'unconscious') {
        break;
      }
      nextIndex = (nextIndex + 1) % ts.turn_order.length;
      attempts++;
    }

    ts.current_actor_index = nextIndex;
    ts.tick += 1;
    return { roundEnded };
  }

  private processEndOfRound(campaignId: string, sessionId: string): GameEvent[] {
    const events: GameEvent[] = [];
    const party = gameState.getPartyCombatants(campaignId);

    for (const combatant of party) {
      if (combatant.status === 'dead') continue;
      const roundEvents = consequenceEngine.processRoundEnd(campaignId, sessionId, combatant);
      events.push(...roundEvents);
    }

    // Advance world clock by 15 seconds
    const campaign = gameState.getCampaign(campaignId);
    if (campaign) {
      const clock = { ...campaign.world_clock };
      clock.minute += MELEE_ROUND_SECONDS / 60;
      if (clock.minute >= 60) {
        clock.minute -= 60;
        clock.hour += 1;
        if (clock.hour >= 24) {
          clock.hour -= 24;
          clock.day += 1;
        }
      }
      gameState.updateWorldClock(campaignId, clock);
    }

    // Move inbound support vehicles toward their destination
    const inboundEvents = this.advanceInboundVehicles(campaignId, sessionId);
    events.push(...inboundEvents);

    return events;
  }

  /**
   * Each round, advance any inbound support vehicles one step toward their destination.
   * Handles takeoff delay, per-round movement, and arrival narration.
   */
  private advanceInboundVehicles(campaignId: string, sessionId: string): GameEvent[] {
    const events: GameEvent[] = [];
    const db = getDb();

    const enemies = gameState.getSessionEnemies(sessionId);
    const inbound = enemies.filter(
      (e) => e.support_config?.inbound && e.status !== 'dead',
    );

    for (const unit of inbound) {
      const cfg = unit.support_config as SupportUnitConfig;
      const destX = cfg.destination_x ?? unit.tactical_x ?? 0;
      const destY = cfg.destination_y ?? unit.tactical_y ?? 0;
      const speed = cfg.speed ?? 15;

      // Takeoff delay: count down before moving
      if (cfg.takeoff_rounds_remaining && cfg.takeoff_rounds_remaining > 0) {
        const newTakeoff = cfg.takeoff_rounds_remaining - 1;
        const updatedCfg: SupportUnitConfig = { ...cfg, takeoff_rounds_remaining: newTakeoff };

        db.prepare('UPDATE enemies SET support_config = ? WHERE id = ?').run(
          JSON.stringify(updatedCfg),
          unit.id,
        );

        const remaining = newTakeoff;
        if (remaining === 0) {
          // Last takeoff round — announce departure
          const freshUnit = gameState.getEnemy(unit.id)!;
          broadcastToSession(sessionId, {
            type: 'enemy_update',
            payload: freshUnit,
            timestamp: new Date().toISOString(),
          });
          events.push(
            gameState.logEvent({
              campaign_id: campaignId,
              session_id: sessionId,
              event_type: 'support_inbound',
              actor_id: unit.id,
              narrative: `${unit.name} has lifted off and is moving to your position at ${speed * 10} ft/round.`,
              visibility: 'party',
            }),
          );
        }
        continue;
      }

      // Move toward destination
      const curX = unit.tactical_x ?? 0;
      const curY = unit.tactical_y ?? 0;
      const dx = destX - curX;
      const dy = destY - curY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= 1) {
        // Arrived
        const arrivedCfg: SupportUnitConfig = {
          ...cfg,
          inbound: false,
          takeoff_rounds_remaining: 0,
          destination_x: undefined,
          destination_y: undefined,
        };
        db.prepare(
          'UPDATE enemies SET tactical_x = ?, tactical_y = ?, support_config = ? WHERE id = ?',
        ).run(destX, destY, JSON.stringify(arrivedCfg), unit.id);

        const arrivedUnit = gameState.getEnemy(unit.id)!;
        broadcastToSession(sessionId, {
          type: 'enemy_update',
          payload: arrivedUnit,
          timestamp: new Date().toISOString(),
        });

        events.push(
          gameState.logEvent({
            campaign_id: campaignId,
            session_id: sessionId,
            event_type: 'support_arrived',
            actor_id: unit.id,
            narrative: `${unit.name} has arrived on scene and is ready for extraction or support.`,
            visibility: 'party',
          }),
        );
        continue;
      }

      // Step toward destination by up to `speed` grid units
      const stepFraction = Math.min(speed / dist, 1);
      const newX = Math.round(curX + dx * stepFraction);
      const newY = Math.round(curY + dy * stepFraction);

      db.prepare(
        'UPDATE enemies SET tactical_x = ?, tactical_y = ? WHERE id = ?',
      ).run(newX, newY, unit.id);

      const movedUnit = gameState.getEnemy(unit.id)!;
      broadcastToSession(sessionId, {
        type: 'enemy_update',
        payload: movedUnit,
        timestamp: new Date().toISOString(),
      });
    }

    return events;
  }

  // ── Actor abstraction ──

  private getActor(id: string): ActorView | null {
    const combatant = gameState.getCombatant(id);
    if (combatant) {
      return {
        id: combatant.id,
        name: combatant.name,
        isCombatant: true,
        status: combatant.status,
        hp_current: combatant.vitals.hp_current,
        sdc_current: combatant.vitals.sdc_current,
        armor_mdc_current: combatant.vitals.armor_mdc_current,
        strike_bonus: combatant.combat.strike_bonus,
        parry_bonus: combatant.combat.parry_bonus,
        dodge_bonus: combatant.combat.dodge_bonus,
        damage_bonus: combatant.combat.damage_bonus,
        initiative_bonus: combatant.combat.initiative_bonus,
        apm: combatant.combat.apm,
        pe: combatant.attributes.pe,
      };
    }

    const db = getDb();
    const row = db.prepare('SELECT * FROM enemies WHERE id = ?').get(id) as any;
    if (row) {
      return {
        id: row.id,
        name: row.name,
        isCombatant: false,
        status: row.status,
        hp_current: row.hp_current,
        sdc_current: row.sdc_current,
        armor_mdc_current: row.mdc_current ?? 0,
        strike_bonus: row.strike_bonus,
        parry_bonus: row.parry_bonus,
        dodge_bonus: row.dodge_bonus,
        damage_bonus: 0,
        initiative_bonus: row.initiative_bonus,
        apm: row.apm,
        pe: 10,
      };
    }

    return null;
  }
}

interface ActorView {
  id: string;
  name: string;
  isCombatant: boolean;
  status: string;
  hp_current: number;
  sdc_current: number;
  armor_mdc_current: number;
  strike_bonus: number;
  parry_bonus: number;
  dodge_bonus: number;
  damage_bonus: number;
  initiative_bonus: number;
  apm: number;
  pe: number;
}

export const turnEngine = new TurnEngine();
