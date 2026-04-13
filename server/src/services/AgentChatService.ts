/**
 * AgentChatService — LLM-driven conversational responses for AI party members.
 *
 * When a player addresses an agent directly (e.g. "uu - what's your favorite color?")
 * and the message is NOT a movement/action command, this service generates an
 * in-character reply that matches the agent's personality profile.
 */

import { llmChat, type LlmMessage } from './LlmService.js';
import { gameState } from './GameStateService.js';
import { broadcastToSession } from '../ws/handler.js';
import type { Combatant, ChatMessage } from '@gate-life/shared';

function buildAgentSystemPrompt(agent: Combatant, party: Combatant[], isTactical = false): string {
  const p = agent.personality;
  const styleDesc: Record<string, string> = {
    terse:  'You speak in short, clipped sentences. Few words. Military cadence.',
    formal: 'You speak formally and precisely, like a trained Coalition soldier filing a report.',
    slang:  'You speak in casual street slang, energetic and expressive.',
    poetic: 'You speak with a quiet, almost lyrical quality — thoughtful and evocative.',
  };

  const v = agent.vitals;
  const partyDesc = party
    .filter(c => c.id !== agent.id && c.status !== 'dead')
    .map(c => `- ${c.name} (${c.kind === 'agent' ? 'AI' : 'Human'} Dog Boy)`)
    .join('\n');

  return `You are ${agent.name}, an AI-controlled Dog Boy (Psi-Hound mutant) in a post-apocalyptic Rifts RPG party.

CHARACTER:
- Class: Dog Boy (Coalition States Psi-Hound tracker)
- Level ${agent.level}, HP ${v?.hp_current ?? '?'}/${v?.hp_max ?? '?'}
- You are a mutant dog shaped by Coalition military conditioning — loyal, instinct-driven, street-smart.

PERSONALITY:
- Speech style: ${p?.speech_style ?? 'terse'} — ${styleDesc[p?.speech_style ?? 'terse'] ?? ''}
${p?.quirks?.length ? `- Quirks: ${p.quirks.join(', ')}` : ''}
${p?.combat_preference ? `- Combat preference: ${p.combat_preference}` : ''}

SQUAD MEMBERS:
${partyDesc || '- (none)'}

CURRENT MODE: ${isTactical ? 'TACTICAL COMBAT — keep replies terse, combat-focused.' : 'OPEN CONVERSATION — relax, be yourself, speak freely within your personality.'}

RULES:
- Respond in first person as ${agent.name}. Stay in character at ALL times.
- Keep replies SHORT — 1 to 3 sentences maximum.
- Match your speech style. ${isTactical ? 'Be clipped and combat-focused.' : 'You can be more expressive and personal outside of combat.'}
- You are a party member, NOT the Game Master. Never narrate the world or control other characters.
- If asked about game mechanics or your status, answer from your character's perspective ("I've got maybe 40 hit points left, feeling rough").
- No asterisks, no stage directions, no quotation marks around your whole reply. Just speak.
- You have genuine opinions, preferences, fears, and memories. Answer questions as this specific character would.`;
}

function recentAgentMessages(campaignId: string, sessionId: string, party: Combatant[]): LlmMessage[] {
  const msgs = gameState.getMessages(campaignId, { sessionId, limit: 20 });
  const result: LlmMessage[] = [];

  for (const msg of msgs) {
    if (msg.message_type === 'system_alert' || msg.message_type === 'dice_result') continue;
    const actor = party.find(c => c.id === msg.actor_id);
    const name = actor?.name ?? 'Unknown';
    // Everything is "user" context from the agent's perspective
    result.push({ role: 'user', content: `[${name}]: ${msg.content}` });
  }

  // Anthropic requires alternating roles — consolidate adjacent user messages
  if (result.length === 0) return result;
  const consolidated: LlmMessage[] = [result[0]];
  for (let i = 1; i < result.length; i++) {
    const prev = consolidated[consolidated.length - 1];
    if (result[i].role === prev.role) {
      prev.content += '\n' + result[i].content;
    } else {
      consolidated.push({ ...result[i] });
    }
  }
  return consolidated;
}

class AgentChatService {
  async respondToDirectMessage(
    agent: Combatant,
    playerMessage: ChatMessage,
    sessionId: string,
    campaignId: string,
  ): Promise<void> {
    const session = gameState.getSession(sessionId);
    const isTactical = session?.current_mode === 'tactical';
    const party = gameState.getPartyCombatants(campaignId);
    const systemPrompt = buildAgentSystemPrompt(agent, party, isTactical);

    // Show thinking indicator attributed to this agent
    broadcastToSession(sessionId, {
      type: 'agent_thinking',
      payload: { actor_id: agent.id, thinking: true },
      timestamp: new Date().toISOString(),
    });

    let history = recentAgentMessages(campaignId, sessionId, party);

    // Ensure the conversation ends with the player's message as a user turn
    const playerActor = party.find(c => c.id === playerMessage.actor_id);
    const playerName = playerActor?.name ?? 'Player';
    const lastUserMsg = `[${playerName}]: ${playerMessage.content}`;

    if (history.length === 0 || history[history.length - 1].role !== 'user') {
      history.push({ role: 'user', content: lastUserMsg });
    }
    // Anthropic requires first message to be 'user'
    if (history[0]?.role === 'assistant') {
      history.unshift({ role: 'user', content: '[The squad is assembled.]' });
    }

    let reply = '';
    try {
      reply = await llmChat(systemPrompt, history, { maxTokens: 256, temperature: 0.85 });
    } catch (err) {
      console.error(`[agentChat] ${agent.name} LLM error:`, err);
    }

    broadcastToSession(sessionId, {
      type: 'agent_thinking',
      payload: { actor_id: agent.id, thinking: false },
      timestamp: new Date().toISOString(),
    });

    if (!reply.trim()) return;

    const msg = gameState.createMessage({
      campaign_id: campaignId,
      session_id: sessionId,
      actor_id: agent.id,
      message_type: 'npc_dialog',
      content: reply.trim(),
      visibility: 'party',
    });

    broadcastToSession(sessionId, {
      type: 'chat_message',
      payload: msg,
      timestamp: new Date().toISOString(),
    });
  }
}

export const agentChat = new AgentChatService();
