import { gameState } from './GameStateService.js';
import { turnEngine } from './TurnEngine.js';
import { rollDie } from '@gate-life/shared';
import type { Combatant, GameEvent, PersonalityProfile } from '@gate-life/shared';

export interface AgentDecision {
  action_type: string;
  target_id?: string;
  data?: Record<string, unknown>;
  dialog?: string;
}

export interface AgentAdapter {
  decideAction(
    combatant: Combatant,
    sessionId: string,
    campaignId: string,
    context: AgentContext,
  ): Promise<AgentDecision>;

  generateDialog(
    combatant: Combatant,
    prompt: string,
    context: AgentContext,
  ): Promise<string>;
}

export interface AgentContext {
  party: Combatant[];
  mode: string;
  enemies: Array<{ id: string; name: string; hp_current: number; tactical_x?: number; tactical_y?: number }>;
  recentEvents: GameEvent[];
  myState: Combatant;
}

export class RuleBasedAgentAdapter implements AgentAdapter {
  async decideAction(
    combatant: Combatant,
    sessionId: string,
    campaignId: string,
    context: AgentContext,
  ): Promise<AgentDecision> {
    const personality = combatant.personality;
    const combatPref = personality?.combat_preference || 'aggressive';

    if (context.mode === 'tactical') {
      return this.decideTacticalAction(combatant, context, combatPref);
    }

    return { action_type: 'wait', dialog: undefined };
  }

  private decideTacticalAction(
    combatant: Combatant,
    context: AgentContext,
    combatPref: string,
  ): AgentDecision {
    const aliveEnemies = context.enemies.filter(e => (e as any).status !== 'dead');
    if (aliveEnemies.length === 0) {
      return { action_type: 'wait' };
    }

    // Check if HP is low -- use defensive tactics
    const hpPercent = combatant.vitals.hp_current / combatant.vitals.hp_max;
    if (hpPercent < 0.25 && combatPref !== 'aggressive') {
      // Try to heal or use defensive power
      if (combatant.vitals.isp_current >= 2) {
        return {
          action_type: 'power',
          data: { power_id: 'sixth_sense' },
          dialog: this.flavorText(combatant, 'defensive'),
        };
      }
    }

    // Aggressive: attack nearest enemy
    if (combatPref === 'aggressive' || combatPref === 'support') {
      const target = this.findNearestEnemy(combatant, aliveEnemies);
      if (target) {
        const weaponData = this.getEquippedWeaponData(combatant);
        return {
          action_type: 'strike',
          target_id: target.id,
          data: weaponData,
          dialog: this.flavorText(combatant, 'attack'),
        };
      }
    }

    // Defensive: prioritize checking for wounded allies
    if (combatPref === 'defensive' || combatPref === 'support') {
      const woundedAlly = context.party.find(
        p => p.id !== combatant.id && p.vitals.hp_current < p.vitals.hp_max * 0.5 && p.status === 'alive',
      );
      if (woundedAlly) {
        return {
          action_type: 'guard_ally',
          target_id: woundedAlly.id,
          dialog: this.flavorText(combatant, 'guard'),
        };
      }
    }

    // Default: attack nearest
    const target = this.findNearestEnemy(combatant, aliveEnemies);
    if (target) {
      const weaponData = this.getEquippedWeaponData(combatant);
      return {
        action_type: 'strike',
        target_id: target.id,
        data: weaponData,
      };
    }

    return { action_type: 'wait' };
  }

  private findNearestEnemy(
    combatant: Combatant,
    enemies: Array<{ id: string; tactical_x?: number; tactical_y?: number }>,
  ): { id: string } | null {
    const cx = combatant.tactical_x ?? 0;
    const cy = combatant.tactical_y ?? 0;

    let nearest: { id: string; dist: number } | null = null;
    for (const e of enemies) {
      const ex = e.tactical_x ?? 0;
      const ey = e.tactical_y ?? 0;
      const dist = Math.abs(cx - ex) + Math.abs(cy - ey);
      if (!nearest || dist < nearest.dist) {
        nearest = { id: e.id, dist };
      }
    }
    return nearest;
  }

  private getEquippedWeaponData(combatant: Combatant): Record<string, unknown> {
    const equippedWeapon = combatant.inventory.find(
      i => i.equipped && (i.type === 'weapon_ranged' || i.type === 'weapon_melee'),
    );
    if (equippedWeapon) {
      return {
        weapon_damage: equippedWeapon.damage || '1d6',
        damage_type: equippedWeapon.damage_type || 'sdc',
      };
    }
    return { weapon_damage: '1d4', damage_type: 'sdc' };
  }

  async generateDialog(
    combatant: Combatant,
    prompt: string,
    context: AgentContext,
  ): Promise<string> {
    const personality = combatant.personality;
    const style = personality?.speech_style || 'terse';
    const name = combatant.name;

    const responses: Record<string, string[]> = {
      terse: [
        `${name} nods briefly.`,
        `"Understood," ${name} says.`,
        `${name} growls softly in agreement.`,
      ],
      formal: [
        `"I concur with this assessment," ${name} states.`,
        `"Acknowledged. I shall proceed accordingly," says ${name}.`,
        `${name} considers the situation carefully before responding.`,
      ],
      slang: [
        `"Yeah, let's do this!" ${name} barks excitedly.`,
        `"No prob, I got your back," ${name} says with a grin.`,
        `${name} wags excitedly. "Sounds like a plan!"`,
      ],
      poetic: [
        `"The path ahead is shrouded, but we press on," ${name} murmurs.`,
        `${name} gazes into the distance. "Every gate holds a story..."`,
      ],
    };

    const pool = responses[style] || responses.terse;
    return pool[rollDie(pool.length) - 1];
  }

  private flavorText(combatant: Combatant, action: string): string | undefined {
    const name = combatant.name;
    const quirks = combatant.personality?.quirks || [];

    switch (action) {
      case 'attack':
        if (quirks.includes('always first to charge')) return `${name} charges forward with a snarl!`;
        if (quirks.includes('makes jokes mid-combat')) return `"Here comes the pain!" ${name} barks.`;
        return undefined;
      case 'defensive':
        return `${name}'s hackles rise as psychic energy surges.`;
      case 'guard':
        if (quirks.includes('protective of pack')) return `${name} moves to protect a wounded packmate.`;
        return `${name} takes a defensive stance.`;
      default:
        return undefined;
    }
  }
}

export class AgentGmAdapter {
  private characterAdapter: RuleBasedAgentAdapter;

  constructor() {
    this.characterAdapter = new RuleBasedAgentAdapter();
  }

  async processAgentTurn(
    combatant: Combatant,
    sessionId: string,
    campaignId: string,
  ): Promise<GameEvent[]> {
    const events: GameEvent[] = [];
    const session = gameState.getSession(sessionId);
    if (!session) return events;

    const party = gameState.getPartyCombatants(campaignId);
    const enemies = gameState.getSessionEnemies(sessionId);
    const recentEvents = gameState.getEvents(campaignId, { sessionId, limit: 10 });

    const context: AgentContext = {
      party,
      mode: session.current_mode,
      enemies: enemies.map(e => ({
        id: e.id, name: e.name, hp_current: e.hp_current,
        tactical_x: e.tactical_x, tactical_y: e.tactical_y,
      })),
      recentEvents,
      myState: combatant,
    };

    const decision = await this.characterAdapter.decideAction(combatant, sessionId, campaignId, context);

    if (decision.dialog) {
      gameState.createMessage({
        campaign_id: campaignId,
        session_id: sessionId,
        actor_id: combatant.id,
        message_type: 'npc_dialog',
        content: decision.dialog,
        visibility: 'party',
      });
    }

    if (decision.action_type !== 'wait') {
      const result = turnEngine.processAction(
        sessionId,
        combatant.id,
        decision.action_type,
        decision.target_id,
        decision.data,
      );
      events.push(...result.events);
    }

    return events;
  }

  async respondToAddress(
    combatant: Combatant,
    prompt: string,
    sessionId: string,
    campaignId: string,
  ): Promise<string> {
    const party = gameState.getPartyCombatants(campaignId);
    const recentEvents = gameState.getEvents(campaignId, { sessionId, limit: 5 });

    const context: AgentContext = {
      party,
      mode: 'conversation',
      enemies: [],
      recentEvents,
      myState: combatant,
    };

    return this.characterAdapter.generateDialog(combatant, prompt, context);
  }
}

export const agentGm = new AgentGmAdapter();
export const agentCharacter = new RuleBasedAgentAdapter();
