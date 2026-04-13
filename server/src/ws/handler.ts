import { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import type { WSMessage, TurnState, Combatant } from '@gate-life/shared';
import { gameState } from '../services/GameStateService.js';
import { aiGm } from '../services/AiGmService.js';
import { parseMovement } from '../services/MovementParser.js';
import { executeAgentTurn } from '../services/AgentTurnExecutor.js';
import { agentChat } from '../services/AgentChatService.js';
import { checkWanderingMonster } from '../services/WanderingMonsterService.js';
import { checkContactAndEnterTactical } from '../services/ContactDetectionService.js';

// ── Directed agent command helpers ────────────────────────────────────────────

/**
 * Detects messages addressed to a named agent in the party.
 *
 * Accepted patterns (all case-insensitive):
 *   "uu - move east"         name at start + separator
 *   "uu: how are you?"       name at start + colon
 *   "whats up uu?"           name at end
 *   "hey uu, what's wrong?"  hey/hi prefix
 *   "@uu move north"         @ mention
 *   "uu?"  "uu!"             bare name with punctuation
 *
 * Returns { agent, command } where command is the text stripped of the name/prefix.
 */
function parseDirectedAgentCommand(
  content: string,
  party: Combatant[],
): { agent: Combatant; command: string } | null {
  const agents = party.filter(c => c.kind === 'agent' && c.status === 'alive');
  const text = content.trim();

  for (const agent of agents) {
    const n = agent.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // escape for regex

    // 1. Explicit separator at start: "uu - cmd", "uu: cmd", "uu, cmd", "@uu cmd"
    const sepMatch = text.match(new RegExp(`^@?${n}[\\s]*[-:,]\\s*(.+)$`, 'i'));
    if (sepMatch) return { agent, command: sepMatch[1].trim() };

    // 2. Name at end: "whats up uu?", "how are you uu", "you ok uu?"
    const endMatch = text.match(new RegExp(`^(.+?)\\s+${n}[?!.,]*$`, 'i'));
    if (endMatch) return { agent, command: endMatch[1].trim() };

    // 3. Hey/hi prefix: "hey uu what's wrong?", "hi uu, you alright?"
    const heyMatch = text.match(new RegExp(`^(?:hey|hi|yo|ok)\\s+${n}[,\\s]+(.+)$`, 'i'));
    if (heyMatch) return { agent, command: heyMatch[1].trim() };

    // 4. Bare name: "uu?" or "uu!" — treat as a status check
    const bareMatch = text.match(new RegExp(`^@?${n}[?!.]*$`, 'i'));
    if (bareMatch) return { agent, command: 'What\'s your status?' };
  }

  return null;
}


// Pending orders from human players addressed to agents.
// Cleared once the agent executes the order on their turn.
export const pendingAgentOrders = new Map<string, string>(); // agentId → raw command text

// Prevents double-triggering when multiple clients join at the same time.
const runningAgentTurns = new Set<string>(); // sessionId

/**
 * If the current active actor in the turn order is an agent, execute their turn
 * and then advance the turn order. Safe to call from both end_turn and join_session.
 */
async function triggerAgentTurnIfNeeded(sessionId: string, campaignId: string): Promise<void> {
  if (runningAgentTurns.has(sessionId)) return;

  const session = gameState.getSession(sessionId);
  const ts = session?.turn_state;
  if (!session || session.current_mode !== 'tactical' || !ts) return;

  const activeId = ts.turn_order[ts.current_actor_index ?? 0];
  const party = gameState.getPartyCombatants(campaignId);
  const actor = party.find(c => c.id === activeId);
  if (!actor || actor.kind !== 'agent') return;

  runningAgentTurns.add(sessionId);
  console.log(`[agent-turn] triggering ${actor.name}'s turn (session=${sessionId.slice(-4)})`);

  try {
    await executeAgentTurn(actor, sessionId, campaignId);
  } catch (err) {
    console.error(`[agent-turn] ${actor.name} error:`, err);
  } finally {
    runningAgentTurns.delete(sessionId);
    const latestSession = gameState.getSession(sessionId);
    const latestTs = latestSession?.turn_state;
    if (!latestTs) return;

    const afterIndex = (latestTs.current_actor_index + 1) % latestTs.turn_order.length;
    const afterTs: TurnState = {
      ...latestTs,
      current_actor_index: afterIndex,
      round: afterIndex === 0 ? latestTs.round + 1 : latestTs.round,
      tick: latestTs.tick + 1,
      pending_input: { actor_id: latestTs.turn_order[afterIndex], input_type: 'free_text' },
    };
    gameState.updateTurnState(sessionId, afterTs);
    broadcastToSession(sessionId, { type: 'turn_update', payload: afterTs, timestamp: new Date().toISOString() });
    console.log(`[agent-turn] ${actor.name} done — now actor ${afterIndex} (${afterTs.turn_order[afterIndex]})`);
  }
}

/**
 * Handle a directed message to an agent.
 *
 * Tactical mode:
 *   - Movement/action command → queue for their turn + canned ack
 *   - Conversation → LLM in-character reply
 *
 * Outside tactical (conversation, travel, rest):
 *   - Always go to LLM for a conversational reply
 *   - If the command also contains movement, execute it immediately on the world map
 */
function handleDirectedAgentMessage(
  agent: Combatant,
  command: string,
  playerMessage: { actor_id?: string; content: string; message_type: string },
  sessionId: string,
  campaignId: string,
): void {
  const session = gameState.getSession(sessionId);
  const isTactical = session?.current_mode === 'tactical';
  const movement = parseMovement(command, agent.attributes.spd_bipedal, agent.attributes.spd_quadruped, false);

  if (isTactical && movement) {
    // Tactical mode + movement order → queue for their turn, canned ack
    pendingAgentOrders.set(agent.id, command);
    console.log(`[directed] queued tactical movement for ${agent.name}: "${command}"`);

    const bcast = (msg: WSMessage) => broadcastToSession(sessionId, msg);
    const ack = gameState.createMessage({
      campaign_id: campaignId,
      session_id: sessionId,
      actor_id: agent.id,
      message_type: 'npc_dialog',
      content: buildAck(agent, command),
      visibility: 'party',
    });
    bcast({ type: 'chat_message', payload: ack, timestamp: new Date().toISOString() });
    return;
  }

  // Outside tactical (or no movement detected): conversational LLM reply
  console.log(`[directed] conversational message to ${agent.name}: "${command}"`);

  // Also execute any movement immediately when outside tactical mode
  if (!isTactical && movement) {
    const curX = agent.tactical_x ?? 0;
    const curY = agent.tactical_y ?? 0;
    const newX = curX + movement.dx;
    const newY = curY + movement.dy;
    const updated = gameState.updateCombatantPosition(agent.id, newX, newY, movement.direction_label);
    if (updated) {
      broadcastToSession(sessionId, { type: 'combatant_update', payload: updated, timestamp: new Date().toISOString() });
      console.log(`[directed] ${agent.name} moved immediately → (${newX},${newY})`);
    }
  }

  const fullMsg = {
    ...playerMessage,
    id: '',
    campaign_id: campaignId,
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    visibility: 'party' as const,
  };
  agentChat.respondToDirectMessage(agent, fullMsg as any, sessionId, campaignId)
    .catch(err => console.error(`[agentChat] ${agent.name} error:`, err));
}

function buildAck(agent: Combatant, rawCommand: string): string {
  const style = agent.personality?.speech_style ?? 'terse';
  const name  = agent.name;

  const lines: Record<string, string[]> = {
    terse:  [`"Copy." ${name} nods.`, `"Understood." ${name} readies.`, `"Roger."`, `${name} gives a quick nod.`],
    formal: [`"Order received. Will execute on my turn," ${name} reports.`, `"Understood. Standing by," ${name} says.`],
    slang:  [`"Got it!" ${name} barks.`, `"On it!" ${name} says.`, `"Yeah yeah, I hear ya."`],
    poetic: [`${name} dips their head. "As you say."`, `"When the moment comes," ${name} murmurs.`],
  };
  const pool = lines[style] ?? lines.terse;
  return pool[Math.floor(Math.random() * pool.length)];
}

interface ConnectedClient {
  socket: WebSocket;
  sessionId?: string;
  userId?: string;
  combatantId?: string;
  role: 'gm' | 'player' | 'spectator';
}

const clients: Map<string, ConnectedClient> = new Map();
let clientIdCounter = 0;

export function broadcastToSession(sessionId: string, message: WSMessage): void {
  const payload = JSON.stringify(message);
  for (const client of clients.values()) {
    if (client.sessionId === sessionId && client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(payload);
    }
  }
}

export function broadcastToAll(message: WSMessage): void {
  const payload = JSON.stringify(message);
  for (const client of clients.values()) {
    if (client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(payload);
    }
  }
}

export function getSessionClients(sessionId: string): ConnectedClient[] {
  return Array.from(clients.values()).filter(c => c.sessionId === sessionId);
}

export async function wsHandler(app: FastifyInstance) {
  app.get('/ws', { websocket: true }, (socket, req) => {
    const clientId = String(++clientIdCounter);
    const client: ConnectedClient = { socket, role: 'player' };
    clients.set(clientId, client);

    console.log(`[ws] Client ${clientId} connected`);

    socket.on('message', (rawMsg: Buffer) => {
      try {
        const msg = JSON.parse(rawMsg.toString());
        handleClientMessage(clientId, client, msg);
      } catch {
        socket.send(JSON.stringify({ type: 'error', payload: { message: 'Invalid message format' }, timestamp: new Date().toISOString() }));
      }
    });

    socket.on('close', () => {
      clients.delete(clientId);
      console.log(`[ws] Client ${clientId} disconnected`);
    });
  });
}

function directionToFacing(dir: string): string {
  const map: Record<string, string> = {
    north: 'north', n: 'north',
    south: 'south', s: 'south',
    east: 'east', e: 'east',
    west: 'west', w: 'west',
    northeast: 'northeast', ne: 'northeast',
    northwest: 'northwest', nw: 'northwest',
    southeast: 'southeast', se: 'southeast',
    southwest: 'southwest', sw: 'southwest',
    forward: 'north', advance: 'north', charge: 'north',
    back: 'south', backward: 'south', retreat: 'south',
  };
  return map[dir.toLowerCase()] || 'north';
}

function handleClientMessage(clientId: string, client: ConnectedClient, msg: any): void {
  switch (msg.type) {
    case 'join_session': {
      client.sessionId = msg.payload.session_id;
      client.userId = msg.payload.user_id;
      client.combatantId = msg.payload.combatant_id || undefined;
      client.role = msg.payload.role || 'player';
      if (!client.combatantId) {
        console.warn(`[join_session] WARNING: no combatant_id from clientId=${clientId} — will rely on register_combatant`);
      }
      console.log(`[join_session] clientId=${clientId} sessionId=${client.sessionId} combatantId=${client.combatantId} role=${client.role}`);

      const session = gameState.getSession(msg.payload.session_id);
      if (session) {
        const campaign = gameState.getCampaign(session.campaign_id);
        const party = gameState.getPartyCombatants(session.campaign_id);
        const world_npcs = gameState.getWorldNpcCombatants(session.campaign_id);
        // Include all detected scenario entities so the client can render them on maps/board
        const detectedEntities = gameState.getSessionEnemies(session.id).filter(e => e.detected);
        client.socket.send(JSON.stringify({
          type: 'session_state',
          payload: { session, campaign, party, world_npcs, detectedEntities },
          timestamp: new Date().toISOString(),
        }));

        // If the session is in tactical mode and the active actor is an agent,
        // trigger their turn (handles reconnects after server restart).
        if (session.current_mode === 'tactical') {
          setTimeout(() => {
            triggerAgentTurnIfNeeded(session.id, session.campaign_id)
              .catch(err => console.error('[agent-turn] join trigger error:', err));
          }, 1500); // brief delay so the client finishes setting up
        }
      }
      break;
    }

    case 'chat_message': {
      if (!client.sessionId) return;
      const session = gameState.getSession(client.sessionId);
      if (!session) return;

      const actorId = msg.payload.actor_id || client.combatantId;
      const content: string = msg.payload.content;

      const chatMsg = gameState.createMessage({
        campaign_id: session.campaign_id,
        session_id: client.sessionId,
        actor_id: actorId,
        message_type: msg.payload.message_type || 'player_speech',
        content,
        visibility: msg.payload.visibility || 'party',
      });

      broadcastToSession(client.sessionId, {
        type: 'chat_message',
        payload: chatMsg,
        timestamp: new Date().toISOString(),
      });

      // Check for directed agent commands FIRST so they don't fall through to the
      // movement parser (e.g. "uu - move north 10ft" would otherwise move the player).
      if (chatMsg.message_type === 'player_speech') {
        const party = gameState.getPartyCombatants(session.campaign_id);
        const directed = parseDirectedAgentCommand(content, party);
        if (directed) {
          handleDirectedAgentMessage(
            directed.agent,
            directed.command,
            { actor_id: actorId ?? undefined, content, message_type: chatMsg.message_type },
            client.sessionId,
            session.campaign_id,
          );
          break; // done — skip movement parser and AI GM
        }
      }

      // Parse movement from player speech in any mode and update position
      if (actorId && chatMsg.message_type === 'player_speech') {
        const combatant = gameState.getCombatant(actorId);
        if (combatant && combatant.status !== 'dead') {
          const isTactical = session.current_mode === 'tactical';
          const movement = parseMovement(
            content,
            combatant.attributes.spd_bipedal,
            combatant.attributes.spd_quadruped,
            isTactical,
          );
          if (movement) {
            // In tactical mode: must be this actor's turn
            if (isTactical) {
              const ts = session.turn_state;
              const activeId = ts?.turn_order[ts.current_actor_index ?? 0];
              if (activeId !== actorId) {
                // Not your turn — send a system message explaining
                const blockedMsg = gameState.createMessage({
                  campaign_id: session.campaign_id,
                  session_id: client.sessionId,
                  message_type: 'system_alert',
                  content: `⚠ Movement blocked: it is not ${combatant.name}'s turn.`,
                  visibility: 'party',
                });
                broadcastToSession(client.sessionId, { type: 'chat_message', payload: blockedMsg, timestamp: new Date().toISOString() });
                break;
              }

              // Enforce max range per turn
              const maxGridUnits = Math.round(combatant.attributes.spd_bipedal * 5 / 10);
              if (movement.distance_grid > maxGridUnits) {
                const blockedMsg = gameState.createMessage({
                  campaign_id: session.campaign_id,
                  session_id: client.sessionId,
                  message_type: 'system_alert',
                  content: `⚠ Movement blocked: ${movement.distance_grid} units exceeds max range of ${maxGridUnits} units (${maxGridUnits * 10} ft) this turn.`,
                  visibility: 'party',
                });
                broadcastToSession(client.sessionId, { type: 'chat_message', payload: blockedMsg, timestamp: new Date().toISOString() });
                break;
              }
            }

            const curX = combatant.tactical_x ?? 0;
            const curY = combatant.tactical_y ?? 0;
            const newX = curX + movement.dx;
            const newY = curY + movement.dy;
            const facing = directionToFacing(movement.direction_label);
            const updated = gameState.updateCombatantPosition(actorId, newX, newY, facing);
            if (updated) {
              broadcastToSession(client.sessionId, {
                type: 'combatant_update',
                payload: updated,
                timestamp: new Date().toISOString(),
              });
              console.log(`[move] ${combatant.name} → ${movement.direction_label} ${movement.distance_ft}ft (${movement.pace}) → grid (${newX}, ${newY})`);

              if (isTactical) {
                const confirmMsg = gameState.createMessage({
                  campaign_id: session.campaign_id,
                  session_id: client.sessionId,
                  message_type: 'system_alert',
                  content: `📍 ${combatant.name} moved ${movement.distance_ft} ft ${movement.direction_label} → grid (${newX}, ${newY}).`,
                  visibility: 'party',
                });
                broadcastToSession(client.sessionId, { type: 'chat_message', payload: confirmMsg, timestamp: new Date().toISOString() });
                // Turn does NOT auto-advance — player clicks End Turn when ready.
              } else {
                // In conversation mode: check for contact with known enemies first,
                // then check for wandering monster encounters.
                checkContactAndEnterTactical(client.sessionId!, session.campaign_id)
                  .catch(err => console.error('[contact-detection] pre-WM check error:', err));

                const spd = combatant.attributes.spd_bipedal;
                const metersPerTurn = spd * 1.524; // SPD × 5ft × 0.3048m
                const turns = Math.max(1, Math.ceil((movement.distance_ft * 0.3048) / metersPerTurn));
                const campaign = gameState.getCampaign(session.campaign_id);
                checkWanderingMonster({
                  sessionId: client.sessionId!,
                  campaignId: session.campaign_id,
                  campaign,
                  turns,
                  broadcast: (msg) => broadcastToSession(client.sessionId!, msg),
                  onEncounter: (monsterName) => {
                    // A new enemy just spawned — re-check contact detection so it can
                    // immediately trigger tactical mode if the monster is in visual range.
                    checkContactAndEnterTactical(client.sessionId!, session.campaign_id)
                      .catch(err => console.error('[contact-detection] post-WM check error:', err));
                    aiGm.narrateWanderingMonsterEncounter(session.campaign_id, client.sessionId!, monsterName)
                      .catch(err => console.error('[wandering-monster] AI narration error:', err));
                  },
                }).catch(err => console.error('[wandering-monster] chat check error:', err));
              }
            }
          }
        }
      }

      // AI GM responds to player speech
      const campaign = gameState.getCampaign(session.campaign_id);
      if (campaign?.gm_kind === 'agent' && chatMsg.message_type === 'player_speech') {
        aiGm.respondToPlayerMessage(session.campaign_id, client.sessionId, chatMsg)
          .catch(err => console.error('[aiGm] Failed to respond:', err));
      }
      break;
    }

    case 'tactical_move': {
      const { target_x, target_y, combatant_id: payloadCombatantId } = msg.payload as { target_x: number; target_y: number; combatant_id?: string };

      // Accept combatant_id from payload as a fallback if the client isn't registered yet
      if (!client.combatantId && payloadCombatantId) {
        client.combatantId = payloadCombatantId;
        console.log(`[tactical_move] auto-registered combatantId=${client.combatantId?.slice(-4)} from payload`);
      }

      console.log(`[tactical_move] combatantId=${client.combatantId?.slice(-4)} target=(${target_x},${target_y}) sessionId=${client.sessionId?.slice(-4)}`);

      if (!client.sessionId || !client.combatantId) {
        console.log('[tactical_move] rejected: not registered (combatantId missing even after payload fallback)');
        client.socket.send(JSON.stringify({ type: 'error', payload: { message: 'Not registered' }, timestamp: new Date().toISOString() }));
        return;
      }
      const session = gameState.getSession(client.sessionId);
      if (!session || session.current_mode !== 'tactical') {
        console.log(`[tactical_move] rejected: not in tactical mode (mode=${session?.current_mode})`);
        client.socket.send(JSON.stringify({ type: 'error', payload: { message: 'Not in tactical mode' }, timestamp: new Date().toISOString() }));
        return;
      }

      const ts = session.turn_state;
      const activeId = ts?.turn_order[ts.current_actor_index ?? 0];
      console.log(`[tactical_move] activeId=${activeId?.slice(-4)} combatantId=${client.combatantId?.slice(-4)} match=${activeId === client.combatantId}`);
      if (activeId !== client.combatantId) {
        client.socket.send(JSON.stringify({ type: 'error', payload: { message: "It is not your turn" }, timestamp: new Date().toISOString() }));
        return;
      }

      const combatant = gameState.getCombatant(client.combatantId);
      if (!combatant || combatant.status === 'dead') return;
      // Rifts: SPD × 5 = feet per melee round; 1 grid unit = 10 feet
      const maxGridUnits = Math.round(combatant.attributes.spd_bipedal * 5 / 10);
      const curX = combatant.tactical_x ?? 0;
      const curY = combatant.tactical_y ?? 0;
      const dist = Math.sqrt(Math.pow(target_x - curX, 2) + Math.pow(target_y - curY, 2));

      if (dist > maxGridUnits + 0.5) {
        client.socket.send(JSON.stringify({
          type: 'error',
          payload: { message: `Movement too far: max ${maxGridUnits} grid units (${maxGridUnits * 10} ft), attempted ${Math.round(dist * 10)} ft` },
          timestamp: new Date().toISOString(),
        }));
        return;
      }

      // Derive facing from direction of travel
      const dx = target_x - curX;
      const dy = target_y - curY;
      let facing = combatant.facing ?? 'north';
      if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
        if (angle > -22.5 && angle <= 22.5) facing = 'east';
        else if (angle > 22.5 && angle <= 67.5) facing = 'northeast';
        else if (angle > 67.5 && angle <= 112.5) facing = 'north';
        else if (angle > 112.5 && angle <= 157.5) facing = 'northwest';
        else if (angle > 157.5 || angle <= -157.5) facing = 'west';
        else if (angle > -157.5 && angle <= -112.5) facing = 'southwest';
        else if (angle > -112.5 && angle <= -67.5) facing = 'south';
        else facing = 'southeast';
      }

      const updated = gameState.updateCombatantPosition(client.combatantId, target_x, target_y, facing);
      console.log(`[tactical_move] position updated: ${updated?.name} → (${updated?.tactical_x},${updated?.tactical_y}) | broadcasting to session ${client.sessionId?.slice(-4)}`);
      if (updated) {
        broadcastToSession(client.sessionId, {
          type: 'combatant_update',
          payload: updated,
          timestamp: new Date().toISOString(),
        });
      }
      break;
    }

    case 'end_turn': {
      console.log(`[end_turn] combatantId=${client.combatantId} sessionId=${client.sessionId}`);
      if (!client.sessionId || !client.combatantId) {
        client.socket.send(JSON.stringify({ type: 'error', payload: { message: 'Not registered — refresh and rejoin' }, timestamp: new Date().toISOString() }));
        return;
      }
      const session = gameState.getSession(client.sessionId);
      if (!session || session.current_mode !== 'tactical') {
        client.socket.send(JSON.stringify({ type: 'error', payload: { message: `Not in tactical mode (mode=${session?.current_mode})` }, timestamp: new Date().toISOString() }));
        return;
      }

      const party = gameState.getPartyCombatants(session.campaign_id);
      let ts = session.turn_state;

      // Safeguard: stale turn_order → re-roll when IDs are missing in either direction
      // (removed members OR newly-spawned members not yet in the order)
      const partyIds = new Set(party.map(c => c.id));
      const orderIds = new Set(ts?.turn_order ?? []);
      const hasStaleIds  = ts?.turn_order.some(id => !partyIds.has(id)) ?? false;
      const hasMissingIds = party.some(c => !orderIds.has(c.id));
      const orderIsStale = !ts || hasStaleIds || hasMissingIds || ts.turn_order.length === 0;

      if (orderIsStale) {
        console.log(`[end_turn] stale turn_order detected — re-rolling initiative`);
        const rolled = party.map(c => {
          const natural = Math.floor(Math.random() * 20) + 1;
          const bonus = c.combat.initiative_bonus ?? 0;
          // Broadcast per-combatant dice roll so players see the animation
          broadcastToSession(client.sessionId!, {
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
        const freshTs: TurnState = {
          turn_order,
          current_actor_index: 0,
          round: (ts?.round ?? 0) + 1,
          tick: (ts?.tick ?? 0) + 1,
          action_budget: Object.fromEntries(party.map(c => [c.id, c.combat.apm])),
          pending_input: turn_order.length > 0 ? { actor_id: turn_order[0], input_type: 'free_text' } : undefined,
        };
        gameState.updateTurnState(client.sessionId, freshTs);
        broadcastToSession(client.sessionId, { type: 'turn_update', payload: freshTs, timestamp: new Date().toISOString() });
        return;
      }

      // ts is guaranteed non-null after the stale-check above
      const safeTs = ts!;
      const activeId = safeTs.turn_order[safeTs.current_actor_index];
      console.log(`[end_turn] activeId=${activeId} myId=${client.combatantId} match=${activeId === client.combatantId}`);
      if (activeId !== client.combatantId) {
        client.socket.send(JSON.stringify({ type: 'error', payload: { message: `Not your turn — active is ${party.find(c=>c.id===activeId)?.name ?? activeId}` }, timestamp: new Date().toISOString() }));
        return;
      }

      const nextIndex = (safeTs.current_actor_index + 1) % safeTs.turn_order.length;
      const roundIncremented = nextIndex === 0;
      const newRound = roundIncremented ? safeTs.round + 1 : safeTs.round;
      const newTs: TurnState = {
        ...safeTs,
        current_actor_index: nextIndex,
        round: newRound,
        tick: safeTs.tick + 1,
        pending_input: {
          actor_id: safeTs.turn_order[nextIndex],
          input_type: 'free_text',
        },
      };
      gameState.updateTurnState(client.sessionId, newTs);
      broadcastToSession(client.sessionId, {
        type: 'turn_update',
        payload: newTs,
        timestamp: new Date().toISOString(),
      });
      console.log(`[end_turn] advanced to actor index ${nextIndex} (${newTs.turn_order[nextIndex]})`);

      // On a new round, check for wandering monster encounter
      if (roundIncremented) {
        const campaign = gameState.getCampaign(session.campaign_id);
        checkWanderingMonster({
          sessionId: client.sessionId!,
          campaignId: session.campaign_id,
          campaign,
          turns: 1,
          broadcast: (msg) => broadcastToSession(client.sessionId!, msg),
          onEncounter: (monsterName) => {
            aiGm.narrateWanderingMonsterEncounter(session.campaign_id, client.sessionId!, monsterName)
              .catch(err => console.error('[wandering-monster] AI narration error:', err));
          },
        }).catch(err => console.error('[wandering-monster] check error:', err));
      }

      // If next actor is an AI agent, trigger their turn automatically
      triggerAgentTurnIfNeeded(client.sessionId!, session.campaign_id)
        .catch(err => console.error('[agent-turn] error:', err));

      break;
    }

    case 'register_combatant': {
      const { combatant_id } = msg.payload as { combatant_id: string };
      client.combatantId = combatant_id;
      console.log(`[register_combatant] clientId=${clientId} combatantId=${client.combatantId}`);
      client.socket.send(JSON.stringify({ type: 'pong', payload: { registered: combatant_id }, timestamp: new Date().toISOString() }));
      break;
    }

    case 'ping': {
      client.socket.send(JSON.stringify({ type: 'pong', payload: {}, timestamp: new Date().toISOString() }));
      break;
    }
  }
}
