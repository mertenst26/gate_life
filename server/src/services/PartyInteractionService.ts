import { gameState } from './GameStateService.js';
import { roll, rollPercentile } from '@gate-life/shared';
import type { Combatant, GameEvent, InventoryItem } from '@gate-life/shared';

export class PartyInteractionService {
  tradeItem(
    campaignId: string,
    sessionId: string,
    fromId: string,
    toId: string,
    itemId: string,
    quantity: number = 1,
  ): GameEvent[] {
    const events: GameEvent[] = [];
    const from = gameState.getCombatant(fromId);
    const to = gameState.getCombatant(toId);
    if (!from || !to) return events;

    const itemIndex = from.inventory.findIndex(i => i.id === itemId);
    if (itemIndex === -1) return events;

    const item = { ...from.inventory[itemIndex] };
    const transferQty = Math.min(quantity, item.quantity);

    // Remove from sender
    const fromInventory = [...from.inventory];
    if (transferQty >= item.quantity) {
      fromInventory.splice(itemIndex, 1);
    } else {
      fromInventory[itemIndex] = { ...item, quantity: item.quantity - transferQty };
    }
    gameState.updateCombatantInventory(fromId, fromInventory);

    // Add to receiver
    const toInventory = [...to.inventory];
    const existing = toInventory.findIndex(i => i.template_id === item.template_id);
    if (existing !== -1) {
      toInventory[existing] = { ...toInventory[existing], quantity: toInventory[existing].quantity + transferQty };
    } else {
      toInventory.push({ ...item, quantity: transferQty, equipped: false });
    }
    gameState.updateCombatantInventory(toId, toInventory);

    events.push(gameState.logEvent({
      campaign_id: campaignId,
      session_id: sessionId,
      event_type: 'item_trade',
      actor_id: fromId,
      target_id: toId,
      data: { item_name: item.name, quantity: transferQty },
      narrative: `${from.name} gives ${item.name}${transferQty > 1 ? ` (x${transferQty})` : ''} to ${to.name}.`,
      visibility: 'party',
    }));

    return events;
  }

  healAlly(
    campaignId: string,
    sessionId: string,
    healerId: string,
    patientId: string,
  ): GameEvent[] {
    const events: GameEvent[] = [];
    const healer = gameState.getCombatant(healerId);
    const patient = gameState.getCombatant(patientId);
    if (!healer || !patient) return events;

    // First aid skill check (percentile)
    const skillRoll = rollPercentile();
    const skillTarget = 45 + (healer.level * 5);
    const success = skillRoll <= skillTarget;

    if (success) {
      const healAmount = roll('1d6').total + 2;
      const newHp = Math.min(patient.vitals.hp_max, patient.vitals.hp_current + healAmount);
      gameState.updateCombatantVitals(patientId, { hp_current: newHp });

      // Remove one bleeding injury if any
      const injuries = gameState.getInjuries(patientId);
      const bleeding = injuries.find(i => i.bleeding);
      if (bleeding) {
        gameState.removeInjury(bleeding.id);
      }

      events.push(gameState.logEvent({
        campaign_id: campaignId,
        session_id: sessionId,
        event_type: 'heal_ally',
        actor_id: healerId,
        target_id: patientId,
        data: { roll: skillRoll, target: skillTarget, heal_amount: healAmount },
        narrative: `${healer.name} tends to ${patient.name}'s wounds. [First Aid: ${skillRoll} vs ${skillTarget} -- Success!] Healed ${healAmount} HP.`,
        visibility: 'party',
      }));
    } else {
      events.push(gameState.logEvent({
        campaign_id: campaignId,
        session_id: sessionId,
        event_type: 'heal_failed',
        actor_id: healerId,
        target_id: patientId,
        data: { roll: skillRoll, target: skillTarget },
        narrative: `${healer.name} attempts first aid on ${patient.name}. [First Aid: ${skillRoll} vs ${skillTarget} -- Failed!]`,
        visibility: 'party',
      }));
    }

    return events;
  }

  setFormation(
    campaignId: string,
    sessionId: string,
    formation: Array<{ combatant_id: string; position: 'front' | 'middle' | 'rear' }>,
  ): GameEvent[] {
    const events: GameEvent[] = [];

    events.push(gameState.logEvent({
      campaign_id: campaignId,
      session_id: sessionId,
      event_type: 'formation_set',
      data: { formation },
      narrative: `Party formation updated: ${formation.map(f => {
        const c = gameState.getCombatant(f.combatant_id);
        return `${c?.name || 'Unknown'} (${f.position})`;
      }).join(', ')}.`,
      visibility: 'party',
    }));

    return events;
  }

  generateBanterPrompt(
    campaignId: string,
    sessionId: string,
  ): GameEvent[] {
    const events: GameEvent[] = [];
    const party = gameState.getPartyCombatants(campaignId);
    const agents = party.filter(c => c.kind === 'agent' && c.status === 'alive');

    if (agents.length === 0) return events;

    const prompts = [
      (a: Combatant) => `${a.name} sniffs the air thoughtfully. "Something's different about this place..."`,
      (a: Combatant) => `${a.name} scratches behind one ear. "Anyone else hungry?"`,
      (a: Combatant) => `${a.name} gazes at the sky. "I've got a feeling about what's on the other side of the next gate."`,
      (a: Combatant) => `${a.name} checks their gear methodically. "We should be ready for anything."`,
      (a: Combatant) => `${a.name} tilts their head, listening. "Did you hear that?"`,
    ];

    const agent = agents[Math.floor(Math.random() * agents.length)];
    const prompt = prompts[Math.floor(Math.random() * prompts.length)];

    events.push(gameState.logEvent({
      campaign_id: campaignId,
      session_id: sessionId,
      event_type: 'banter',
      actor_id: agent.id,
      narrative: prompt(agent),
      visibility: 'party',
    }));

    gameState.createMessage({
      campaign_id: campaignId,
      session_id: sessionId,
      actor_id: agent.id,
      message_type: 'npc_dialog',
      content: prompt(agent),
      visibility: 'party',
    });

    return events;
  }

  consumeRations(combatantId: string): boolean {
    const combatant = gameState.getCombatant(combatantId);
    if (!combatant) return false;

    const rations = combatant.inventory.find(
      i => i.template_id === 'field_rations' && (i.uses ?? 0) > 0
    );
    if (!rations) return false;

    const updated = combatant.inventory.map(i => {
      if (i.id === rations.id) {
        return { ...i, uses: (i.uses ?? 1) - 1 };
      }
      return i;
    }).filter(i => (i.uses ?? 1) > 0 || i.type !== 'consumable');

    gameState.updateCombatantInventory(combatantId, updated);

    const newHunger = Math.max(0, combatant.needs.hunger - 30);
    gameState.updateCombatantVitals(combatantId, { hunger: newHunger });

    return true;
  }

  drinkWater(combatantId: string): boolean {
    const combatant = gameState.getCombatant(combatantId);
    if (!combatant) return false;

    const canteen = combatant.inventory.find(i => i.template_id === 'canteen');
    if (!canteen) return false;

    const newThirst = Math.max(0, combatant.needs.thirst - 40);
    gameState.updateCombatantVitals(combatantId, { thirst: newThirst });

    return true;
  }
}

export const partyInteractions = new PartyInteractionService();
