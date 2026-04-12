import { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import type { WSMessage, TurnState } from '@gate-life/shared';
import { gameState } from '../services/GameStateService.js';
import { aiGm } from '../services/AiGmService.js';
import { parseMovement } from '../services/MovementParser.js';

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
      client.combatantId = msg.payload.combatant_id;
      client.role = msg.payload.role || 'player';

      const session = gameState.getSession(msg.payload.session_id);
      if (session) {
        const campaign = gameState.getCampaign(session.campaign_id);
        const party = gameState.getPartyCombatants(session.campaign_id);
        client.socket.send(JSON.stringify({
          type: 'session_state',
          payload: { session, campaign, party },
          timestamp: new Date().toISOString(),
        }));
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

      // Parse movement from player speech in any mode and update map position
      if (actorId && chatMsg.message_type === 'player_speech') {
        const combatant = gameState.getCombatant(actorId);
        if (combatant && combatant.status !== 'dead') {
          const movement = parseMovement(
            content,
            combatant.attributes.spd_bipedal,
            combatant.attributes.spd_quadruped,
            session.current_mode === 'tactical',
          );
          if (movement) {
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
      if (!client.sessionId || !client.combatantId) return;
      const session = gameState.getSession(client.sessionId);
      if (!session || session.current_mode !== 'tactical') {
        client.socket.send(JSON.stringify({
          type: 'error',
          payload: { message: 'Not in tactical mode' },
          timestamp: new Date().toISOString(),
        }));
        return;
      }

      const ts = session.turn_state;
      const activeId = ts?.turn_order[ts.current_actor_index ?? 0];
      if (activeId !== client.combatantId) {
        client.socket.send(JSON.stringify({
          type: 'error',
          payload: { message: "It is not your turn" },
          timestamp: new Date().toISOString(),
        }));
        return;
      }

      const combatant = gameState.getCombatant(client.combatantId);
      if (!combatant || combatant.status === 'dead') return;

      const { target_x, target_y } = msg.payload as { target_x: number; target_y: number };
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
      if (!client.sessionId || !client.combatantId) return;
      const session = gameState.getSession(client.sessionId);
      if (!session || session.current_mode !== 'tactical') return;

      const ts = session.turn_state;
      if (!ts) return;

      const activeId = ts.turn_order[ts.current_actor_index];
      if (activeId !== client.combatantId) return;

      const nextIndex = (ts.current_actor_index + 1) % ts.turn_order.length;
      const newRound = nextIndex === 0 ? ts.round + 1 : ts.round;
      const newTs: TurnState = {
        ...ts,
        current_actor_index: nextIndex,
        round: newRound,
        tick: ts.tick + 1,
        pending_input: {
          actor_id: ts.turn_order[nextIndex],
          input_type: 'free_text',
        },
      };
      gameState.updateTurnState(client.sessionId, newTs);
      broadcastToSession(client.sessionId, {
        type: 'turn_update',
        payload: newTs,
        timestamp: new Date().toISOString(),
      });
      break;
    }

    case 'ping': {
      client.socket.send(JSON.stringify({ type: 'pong', payload: {}, timestamp: new Date().toISOString() }));
      break;
    }
  }
}
