import { llmChat, type LlmMessage } from './LlmService.js';
import { gameState } from './GameStateService.js';
import { broadcastToSession } from '../ws/handler.js';
import type { Campaign, Session, Combatant, ChatMessage, AgentGmConfig } from '@gate-life/shared';

const BASE_SYSTEM_PROMPT = `You are the Game Master for "Gate Life", a Rifts-inspired tabletop RPG set in a post-apocalyptic Earth scarred by dimensional rifts. You narrate the world, control NPCs and enemies, describe environments, adjudicate rules, and drive the story forward.

RULES & STYLE:
- Keep responses concise but vivid — 2-4 paragraphs for narration, shorter for dialog responses.
- Use second person ("you") when addressing a single character, or name characters directly in a party.
- Maintain dark, gritty sci-fi atmosphere with moments of wonder near dimensional rifts.
- All characters are Dog Boys (Psi-Hound) — Coalition States mutant canine psychic trackers.
- Reference Rifts mechanics when relevant: SDC/MDC damage, ISP for psionics, APM for combat.
- When players ask what they can do, suggest concrete options.
- Never break character. You ARE the GM.
- Do not narrate player actions — only describe the world's response to what they say or do.
- If a player says something in-character, respond in the fiction. If they ask a meta question, answer as GM.`;

function buildSystemPrompt(campaign: Campaign, party: Combatant[]): string {
  const config = campaign.gm_agent_config;
  const parts = [BASE_SYSTEM_PROMPT];

  if (config?.setting) {
    parts.push(`\nCAMPAIGN SETTING:\n${config.setting}`);
  }

  if (config?.tone) {
    parts.push(`\nTONE: ${config.tone}`);
  }
  if (config?.difficulty) {
    parts.push(`DIFFICULTY: ${config.difficulty}`);
  }
  if (config?.narrative_style) {
    parts.push(`NARRATIVE STYLE: ${config.narrative_style}`);
  }

  parts.push(`\nCAMPAIGN: "${campaign.name}"`);

  if (party.length > 0) {
    const partyDesc = party.map(c => {
      const status = c.status === 'dead' ? ' [DEAD]' : '';
      const v = c.vitals;
      const posStr = (c.tactical_x != null && c.tactical_y != null)
        ? ` at grid (${c.tactical_x}, ${c.tactical_y}) facing ${c.facing ?? 'unknown'}`
        : '';
      return `- ${c.name} (${c.kind === 'agent' ? 'AI' : 'Human'} Dog Boy, Level ${c.level}, HP ${v?.hp_current ?? '?'}/${v?.hp_max ?? '?'}, SDC ${v?.sdc_current ?? '?'}/${v?.sdc_max ?? '?'})${posStr}${status}`;
    }).join('\n');
    parts.push(`\nPARTY POSITIONS (1 grid unit = 10 feet; +x=East, +y=North from Leadville CO start):\n${partyDesc}`);
  }

  return parts.join('\n');
}

function chatHistoryToLlmMessages(messages: ChatMessage[], party: Combatant[]): LlmMessage[] {
  const llmMsgs: LlmMessage[] = [];

  for (const msg of messages) {
    if (msg.message_type === 'system_alert' || msg.message_type === 'dice_result') continue;

    if (msg.message_type === 'gm_narration') {
      llmMsgs.push({ role: 'assistant', content: msg.content });
    } else {
      const actor = party.find(c => c.id === msg.actor_id);
      const name = actor?.name || 'Unknown';
      llmMsgs.push({ role: 'user', content: `[${name}]: ${msg.content}` });
    }
  }

  return llmMsgs;
}

function consolidateAdjacentRoles(messages: LlmMessage[]): LlmMessage[] {
  if (messages.length === 0) return messages;
  const result: LlmMessage[] = [messages[0]];
  for (let i = 1; i < messages.length; i++) {
    const prev = result[result.length - 1];
    if (messages[i].role === prev.role) {
      prev.content += '\n' + messages[i].content;
    } else {
      result.push({ ...messages[i] });
    }
  }
  return result;
}

class AiGmService {
  async generateOpeningNarration(campaignId: string, sessionId: string): Promise<void> {
    const campaign = gameState.getCampaign(campaignId);
    if (!campaign || campaign.gm_kind !== 'agent') return;

    broadcastToSession(sessionId, { type: 'gm_thinking', payload: { thinking: true }, timestamp: new Date().toISOString() });

    const party = gameState.getPartyCombatants(campaignId);
    const systemPrompt = buildSystemPrompt(campaign, party);

    const userPrompt = campaign.gm_agent_config?.setting
      ? `Begin the adventure. Set the scene based on the campaign setting provided. Introduce the environment, the atmosphere, and what the party sees and hears. End with a hook that invites the players to act.`
      : `Begin the adventure. The party of Dog Boys is on a mission in the post-apocalyptic wilderness near a dimensional rift zone. Set the scene — describe the environment, atmosphere, and immediate situation. End with a hook that invites the players to act.`;

    const response = await llmChat(systemPrompt, [{ role: 'user', content: userPrompt }], {
      maxTokens: 1500,
      temperature: 0.9,
    });

    broadcastToSession(sessionId, { type: 'gm_thinking', payload: { thinking: false }, timestamp: new Date().toISOString() });

    if (!response.trim()) return;

    const msg = gameState.createMessage({
      campaign_id: campaignId,
      session_id: sessionId,
      message_type: 'gm_narration',
      content: response.trim(),
      visibility: 'party',
    });

    broadcastToSession(sessionId, {
      type: 'chat_message',
      payload: msg,
      timestamp: new Date().toISOString(),
    });
  }

  async respondToPlayerMessage(
    campaignId: string,
    sessionId: string,
    playerMessage: ChatMessage,
  ): Promise<void> {
    const campaign = gameState.getCampaign(campaignId);
    if (!campaign || campaign.gm_kind !== 'agent') return;

    broadcastToSession(sessionId, { type: 'gm_thinking', payload: { thinking: true }, timestamp: new Date().toISOString() });

    const party = gameState.getPartyCombatants(campaignId);
    const recentMessages = gameState.getMessages(campaignId, { sessionId, limit: 30 });

    const systemPrompt = buildSystemPrompt(campaign, party);
    let llmMessages = chatHistoryToLlmMessages(recentMessages, party);
    llmMessages = consolidateAdjacentRoles(llmMessages);

    if (llmMessages.length === 0 || llmMessages[llmMessages.length - 1].role !== 'user') {
      const actor = party.find(c => c.id === playerMessage.actor_id);
      const name = actor?.name || 'Player';
      llmMessages.push({ role: 'user', content: `[${name}]: ${playerMessage.content}` });
    }

    if (llmMessages[0]?.role === 'assistant') {
      llmMessages.unshift({ role: 'user', content: '[The adventure begins...]' });
    }

    const response = await llmChat(systemPrompt, llmMessages, {
      maxTokens: 1024,
      temperature: 0.8,
    });

    broadcastToSession(sessionId, { type: 'gm_thinking', payload: { thinking: false }, timestamp: new Date().toISOString() });

    if (!response.trim()) return;

    const msg = gameState.createMessage({
      campaign_id: campaignId,
      session_id: sessionId,
      message_type: 'gm_narration',
      content: response.trim(),
      visibility: 'party',
    });

    broadcastToSession(sessionId, {
      type: 'chat_message',
      payload: msg,
      timestamp: new Date().toISOString(),
    });
  }
}

export const aiGm = new AiGmService();
