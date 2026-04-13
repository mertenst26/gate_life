import { llmChat, type LlmMessage } from './LlmService.js';
import { gameState } from './GameStateService.js';
import { broadcastToSession } from '../ws/handler.js';
import { revealOnFire } from './ContactDetectionService.js';
import { extractRevealPoiMarkers, revealQuestPoiByName } from './QuestPoiRevealService.js';
import { processQuestCompleteMarkers } from './QuestCompletionService.js';
import {
  auditPlayerCapabilityClaims,
  formatPartyCapabilitiesSection,
} from './CharacterCapabilityService.js';
import type {
  Campaign, Combatant, ChatMessage, QuestGiverProgressEntry, ScenarioContext, TurnState,
} from '@gate-life/shared';

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
- If a player says something in-character, respond in the fiction. If they ask a meta question, answer as GM.

CAPABILITY ENFORCEMENT (inventory, skills, languages, psionics):
- The PARTY CAPABILITIES section lists each character's actual inventory items, skills (including languages/literacy), and psionic powers from the database. This is the source of truth.
- Before narrating success for using an object, tool, weapon, device, skill roll, language use, or psionic power, verify it appears on that character's list. If not on the list, they cannot succeed at using it unless the fiction provides it (found on scene, borrowed, GM grants) — default is: it fails, is absent, or they must correct themselves.
- Never assume standard loadout beyond what is listed. If a CAPABILITY AUDIT block appears for the latest message, treat those lines as high-priority hints about mismatches.
- Agents and players cannot "declare" equipment into existence — only the sheet (and explicit GM-granted scene items) counts.

COMBAT TRANSITION:
When your narration describes combat BEGINNING — the moment enemies attack, weapons are drawn in open hostility, or initiative is called — append this marker on its own line BEFORE the ACTIONS block:
<!--COMBAT-->
Rules:
- Only emit <!--COMBAT--> when a fight is actively starting RIGHT NOW in this response.
- Do NOT emit it for tense standoffs, perceived threats, or ongoing combat the party is already in.
- Do NOT emit it more than once per scene.
- If combat is NOT starting, omit this line entirely.

QUEST ACCEPTANCE — MAP POI REVEAL:
When a player clearly agrees to take on a mission from an NPC and that mission points to a specific named location (POI) listed in SCENARIO CONTEXT below, append one line per affected POI, using the EXACT POI name as written there:
<!--REVEAL_POI:Exact POI Name-->
Rules:
- Only emit when the party has just accepted the quest/mission in this exchange (not for vague maybes).
- Use the precise spelling from the Points of interest list. One marker per POI.
- If the mission does not involve a listed POI, omit this block entirely.
- Place these lines with your other meta-markers (they will be stripped from chat).

QUEST GIVERS — PRIORITY ORDER (multiple missions):
When an NPC in SCENARIO CONTEXT has more than one priority listed, that list is STRICTLY ORDERED from top to bottom.
- Lead with the **first** priority only: that is the mission they care about and pitch **until** it is clearly accepted, refused for good, completed in-fiction, or no longer possible — then move to the second priority, then the third, and so on.
- Do **not** ask the party to take a lower mission before the current (earlier) one has been addressed in play. Do not emit <!--REVEAL_POI:...--> for a later priority's POI until that mission is the one legitimately being offered and accepted under this order.
- If the party tries to jump ahead, the NPC can acknowledge later goals briefly, but should steer back to the outstanding first priority until that arc advances.

QUEST COMPLETION — CONVICTION (quest giver is the judge):
- A mission is **not** automatically complete when players claim success. It is only complete when the **quest giver NPC is convinced** in the fiction — their judgment is final.
- **Proof matters:** physical items, documents, photos, sensor data, or other hard evidence should be far more convincing than a vague or self-serving story. A thin story may be doubted, rejected, or met with demands for corroboration — play that tension.
- The NPC may still refuse credit if the proof does not match what was asked, looks fake, or the fiction demands suspicion — use discretion as GM.
- When (and only when) the NPC clearly accepts that the **current** mission per PROGRESS is fulfilled, append on its own line (exact name and mission number from PROGRESS):
<!--QUEST_COMPLETE:Exact NPC Name:missionNumber-->
missionNumber is **1-based** and must match the PROGRESS line for that NPC. The server awards XP to the party and unlocks the next priority. Never emit this marker without the NPC's in-scene acceptance. Never emit for a mission number that PROGRESS does not list as the next completable one.

RANGED WEAPON FIRE — POSITION REVEAL:
Whenever a scenario entity (enemy, vehicle, hostile NPC) fires a RANGED weapon (gun, energy weapon, missile, thrown weapon), append this marker with the exact entity name, EVEN IF the party has not yet spotted them:
<!--ENEMY_FIRE:EntityName-->
Rules:
- Use the exact name as placed in the scenario (e.g. <!--ENEMY_FIRE:Skulker--> or <!--ENEMY_FIRE:Coalition Grunt-->).
- Emit once per firing action per entity per response.
- Muzzle flash and sound mechanically reveal the shooter's grid position to the party regardless of line-of-sight or darkness.
- For MELEE-only attacks (claws, blades, unarmed), do NOT emit this marker — those do not produce sound or light that reveals position at range.
- If the entity is already detected, still emit it — it confirms the shot came from their known position.
- IMPORTANT: An attacker outside the party's visual range can still shoot them. Narrate the hit/miss without revealing where the shot came from in the text — the mechanical marker will handle the reveal.

SUGGESTED ACTIONS:
After EVERY narration or response, you MUST append exactly one line at the very end in this format (no extra whitespace, no line break inside it):
<!--ACTIONS:["action 1","action 2","action 3","action 4"]-->
- Always include 3-4 options. Write them in first person ("I...").
- Make them specific and grounded in the current scene — not generic.
- Vary the type: exploration, psionic, combat-readiness, social/communication.
- Never skip this block. It must be the absolute last thing in your response.`;

function buildSystemPrompt(
  campaign: Campaign,
  party: Combatant[],
  extra?: { wanderingMonsterTriggered?: string; capabilityAudit?: string },
): string {
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
    parts.push(`\nPARTY POSITIONS (1 grid unit = 10 feet; +x=East, +y=North from scenario start point):\n${partyDesc}`);
    parts.push(formatPartyCapabilitiesSection(party));
  }

  if (extra?.capabilityAudit) {
    parts.push(extra.capabilityAudit);
  }

  if (extra?.wanderingMonsterTriggered) {
    parts.push(`\n⚠ WANDERING MONSTER ENCOUNTER: A ${extra.wanderingMonsterTriggered} has just appeared. Incorporate this into your narration — describe how the party spots the threat approaching. This MUST trigger <!--COMBAT--> since the monster is actively hostile.`);
  }

  const ctxStr = formatScenarioContext(config?.scenario_context, config?.quest_giver_progress);
  if (ctxStr) parts.push(ctxStr);

  return parts.join('\n');
}

function formatScenarioContext(
  ctx: ScenarioContext | undefined,
  progress: Record<string, QuestGiverProgressEntry> | undefined,
): string {
  if (!ctx || (ctx.pois.length === 0 && ctx.quest_givers.length === 0)) return '';
  const lines: string[] = [
    'SCENARIO CONTEXT — exact names for <!--REVEAL_POI:...--> and <!--QUEST_COMPLETE:Name:N--> (N = 1-based mission index):',
  ];
  if (ctx.pois.length > 0) {
    lines.push('Points of interest (on the tactical/world map):');
    for (const p of ctx.pois) lines.push(`- ${p.name}`);
  }
  if (ctx.quest_givers.length > 0) {
    lines.push(
      'Quest NPCs — priorities are ORDERED. Missions unlock one at a time. Completion needs the NPC convinced (proof > story); markers must match PROGRESS.',
    );
    for (const g of ctx.quest_givers) {
      lines.push(`- ${g.name}`);
      const pri = g.priorities ?? [];
      const mp = g.priority_mission_pois ?? [];
      for (let i = 0; i < pri.length; i++) {
        const poiName = mp[i];
        const n = i + 1;
        lines.push(
          poiName
            ? `  ${n}. "${pri[i]}" → on acceptance (when this step is active), reveal POI: ${poiName}`
            : `  ${n}. "${pri[i]}"`,
        );
      }
      const nextIdx = progress?.[g.name]?.next_priority_index ?? 0;
      if (nextIdx >= pri.length) {
        lines.push(`  PROGRESS: **${g.name}** — all listed missions resolved (no further QUEST_COMPLETE).`);
      } else {
        const mission1Based = nextIdx + 1;
        lines.push(
          `  PROGRESS: next mission that can be **completed for XP** is **#${mission1Based}** of ${pri.length}: "${pri[nextIdx]}". ` +
            `Emit <!--QUEST_COMPLETE:${g.name}:${mission1Based}--> only after this NPC is convinced mission #${mission1Based} is done.`,
        );
      }
    }
  }
  return '\n\n' + lines.join('\n');
}

const ACTIONS_RE   = /<!--ACTIONS:.*?-->/gs;
const COMBAT_RE    = /<!--COMBAT-->/g;
const FIRE_RE      = /<!--ENEMY_FIRE:([^-]+)-->/g;
const REVEAL_POI_RE = /<!--REVEAL_POI:[\s\S]*?-->/g;
const QUEST_COMPLETE_RE = /<!--QUEST_COMPLETE:[^:]+:\d+-->/g;

function stripMetaMarkers(content: string): string {
  return content
    .replace(ACTIONS_RE, '')
    .replace(COMBAT_RE, '')
    .replace(FIRE_RE, '')
    .replace(REVEAL_POI_RE, '')
    .replace(QUEST_COMPLETE_RE, '')
    .trim();
}

function stripActionsBlock(content: string): string {
  return content
    .replace(ACTIONS_RE, '')
    .replace(COMBAT_RE, '')
    .replace(FIRE_RE, '')
    .replace(REVEAL_POI_RE, '')
    .replace(QUEST_COMPLETE_RE, '')
    .trim();
}

/** Extract all entity names from <!--ENEMY_FIRE:Name--> markers in a response. */
function extractFireMarkers(content: string): string[] {
  const names: string[] = [];
  let m: RegExpExecArray | null;
  const re = /<!--ENEMY_FIRE:([^-]+)-->/g;
  while ((m = re.exec(content)) !== null) {
    names.push(m[1].trim());
  }
  return names;
}

/** Replicates the initiative + mode-switch logic from POST /sessions/:id/mode */
async function enterTacticalMode(sessionId: string, campaignId: string): Promise<void> {
  const session = gameState.getSession(sessionId);
  if (!session || session.current_mode === 'tactical') return;

  console.log(`[AiGm] Combat triggered — switching session ${sessionId.slice(-4)} to tactical`);

  const party = gameState.getPartyCombatants(campaignId);
  const rolled = party.map(c => {
    const natural = Math.floor(Math.random() * 20) + 1;
    const bonus = c.combat?.initiative_bonus ?? 0;
    broadcastToSession(sessionId, {
      type: 'dice_roll',
      payload: {
        dice: 'd20',
        results: [natural],
        modifier: bonus,
        total: natural + bonus,
        natural,
        label: `${c.name} initiative`,
      },
      timestamp: new Date().toISOString(),
    });
    return { id: c.id, roll: natural + bonus };
  });
  rolled.sort((a, b) => b.roll - a.roll);
  const turn_order = rolled.map(r => r.id);

  const turn_state: TurnState = {
    turn_order,
    current_actor_index: 0,
    round: 1,
    tick: 0,
    action_budget: Object.fromEntries(party.map(c => [c.id, c.combat?.apm ?? 4])),
    pending_input: turn_order.length > 0
      ? { actor_id: turn_order[0], input_type: 'free_text' }
      : undefined,
  };

  gameState.updateSessionMode(sessionId, 'tactical');
  gameState.updateTurnState(sessionId, turn_state);

  broadcastToSession(sessionId, {
    type: 'mode_change',
    payload: { mode: 'tactical', turn_state },
    timestamp: new Date().toISOString(),
  });

  // Post a system alert so the players see a clear combat-start notification in chat
  const firstActorName = party.find(c => c.id === turn_order[0])?.name ?? 'Unknown';
  const alertMsg = gameState.createMessage({
    campaign_id: campaignId,
    session_id: sessionId,
    message_type: 'system_alert',
    content: `⚔ COMBAT BEGINS — Initiative rolled. ${firstActorName} acts first.`,
    visibility: 'party',
  });
  broadcastToSession(sessionId, {
    type: 'chat_message',
    payload: alertMsg,
    timestamp: new Date().toISOString(),
  });

  console.log(`[AiGm] Tactical mode active — turn order: ${turn_order.map(id => id.slice(-4)).join(' → ')}`);
}

function chatHistoryToLlmMessages(messages: ChatMessage[], party: Combatant[]): LlmMessage[] {
  const llmMsgs: LlmMessage[] = [];

  for (const msg of messages) {
    if (msg.message_type === 'system_alert' || msg.message_type === 'dice_result') continue;

    if (msg.message_type === 'gm_narration') {
      llmMsgs.push({ role: 'assistant', content: stripMetaMarkers(msg.content) });
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
  /**
   * Narrates a wandering monster encounter in conversation mode.
   * Includes the <!--COMBAT--> marker to trigger tactical mode.
   */
  async narrateWanderingMonsterEncounter(
    campaignId: string,
    sessionId: string,
    monsterName: string,
  ): Promise<void> {
    const campaign = gameState.getCampaign(campaignId);
    if (!campaign || campaign.gm_kind !== 'agent') return;

    broadcastToSession(sessionId, { type: 'gm_thinking', payload: { thinking: true }, timestamp: new Date().toISOString() });

    const party = gameState.getPartyCombatants(campaignId);
    const systemPrompt = buildSystemPrompt(campaign, party, { wanderingMonsterTriggered: monsterName });

    const response = await llmChat(
      systemPrompt,
      [{ role: 'user', content: `[SYSTEM]: A wandering monster (${monsterName}) has appeared. Narrate the encounter.` }],
      { maxTokens: 600, temperature: 0.85 },
    );

    broadcastToSession(sessionId, { type: 'gm_thinking', payload: { thinking: false }, timestamp: new Date().toISOString() });

    if (!response.trim()) return;

    const combatStarting = COMBAT_RE.test(response);
    const fireNames = extractFireMarkers(response);

    const msg = gameState.createMessage({
      campaign_id: campaignId,
      session_id: sessionId,
      message_type: 'gm_narration',
      content: stripMetaMarkers(response),
      visibility: 'party',
    });

    broadcastToSession(sessionId, { type: 'chat_message', payload: msg, timestamp: new Date().toISOString() });

    if (combatStarting) {
      await enterTacticalMode(sessionId, campaignId);
    }
    for (const name of fireNames) {
      revealOnFire(sessionId, campaignId, name)
        .catch(err => console.error(`[AiGm] revealOnFire error for "${name}":`, err));
    }
  }

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

    const speakingActor = party.find(c => c.id === playerMessage.actor_id);
    const audit = auditPlayerCapabilityClaims(playerMessage.content, speakingActor);
    if (audit.issues.length > 0) {
      console.log(`[AiGm] capability audit (${speakingActor?.name ?? '?'}):`, audit.issues);
    }

    const systemPrompt = buildSystemPrompt(campaign, party, {
      capabilityAudit: audit.gmInjection || undefined,
    });
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

    const combatStarting = COMBAT_RE.test(response);
    const fireNames = extractFireMarkers(response);

    const msg = gameState.createMessage({
      campaign_id: campaignId,
      session_id: sessionId,
      message_type: 'gm_narration',
      // Store with ACTIONS intact (client parses them); strip all meta-markers
      content: stripMetaMarkers(response),
      visibility: 'party',
    });

    broadcastToSession(sessionId, {
      type: 'chat_message',
      payload: msg,
      timestamp: new Date().toISOString(),
    });

    if (combatStarting) {
      console.log(`[AiGm] <!--COMBAT--> detected in response — initiating tactical mode`);
      await enterTacticalMode(sessionId, campaignId);
    }

    // Handle muzzle-flash reveals — run after COMBAT so tactical mode is set first
    for (const name of fireNames) {
      console.log(`[AiGm] <!--ENEMY_FIRE:${name}--> — triggering muzzle-flash reveal`);
      revealOnFire(sessionId, campaignId, name)
        .catch(err => console.error(`[AiGm] revealOnFire error for "${name}":`, err));
    }

    for (const poiName of extractRevealPoiMarkers(response)) {
      console.log(`[AiGm] <!--REVEAL_POI:${poiName}--> — quest POI on map`);
      revealQuestPoiByName(sessionId, campaignId, poiName);
    }

    processQuestCompleteMarkers(sessionId, campaignId, response);
  }
}

export const aiGm = new AiGmService();
