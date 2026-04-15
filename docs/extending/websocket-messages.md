# WebSocket Messages

## Connection

Client connects to `/ws` and sends `join_session` to bind to a game session.

## Inbound Messages (Client → Server)

### `join_session`
```json
{ "type": "join_session", "payload": { "session_id": "...", "user_id": "...", "combatant_id": "...", "role": "player" } }
```
Response: `session_state` with full game state.

### `register_combatant`
```json
{ "type": "register_combatant", "payload": { "combatant_id": "..." } }
```
Response: `pong` with `{ registered: combatant_id }`.

### `chat_message`
```json
{ "type": "chat_message", "payload": { "content": "...", "actor_id": "...", "message_type": "player_speech", "visibility": "party" } }
```
Triggers: broadcast, movement parsing, agent commands, AI GM reply.

### `tactical_move`
```json
{ "type": "tactical_move", "payload": { "target_x": 5, "target_y": 3, "combatant_id": "..." } }
```
Validates turn order and movement range. Response: `combatant_update` or `error`.

### `end_turn`
```json
{ "type": "end_turn", "payload": {} }
```
Advances turn order. May trigger agent turns and wandering monsters.

### `follow_response`
```json
{ "type": "follow_response", "payload": { "request_id": "...", "accepted": true } }
```
Accept/decline an NPC follow request.

### `ping`
```json
{ "type": "ping" }
```
Response: `pong`.

## Outbound Messages (Server → Client)

| Type | Payload | When |
|------|---------|------|
| `session_state` | `{ session, campaign, party, world_npcs, detectedEntities }` | After `join_session` |
| `chat_message` | `ChatMessage` object | Any chat, system alert, GM narration |
| `combatant_update` | `Combatant` object | Position/vitals/status change |
| `party_update` | `Combatant[]` | Party roster change |
| `enemy_update` | `Enemy` object | Enemy detected/damaged/killed |
| `mode_change` | `{ mode, turn_state? }` | Session mode transition |
| `turn_update` | `TurnState` object | Turn advancement |
| `dice_roll` | `{ dice, results, modifier, total, natural, label }` | Initiative/attack/damage rolls |
| `gm_thinking` | `{ thinking: boolean }` | AI GM processing indicator |
| `agent_thinking` | `{ agent_id, thinking: boolean }` | Agent processing indicator |
| `vital_sample` | `{ combatant_id, pulse_bpm, internal_temp }` | Periodic vitals update |
| `item_received` | `{ recipient, item }` | Item added to inventory |
| `error` | `{ message }` | Validation error |

## Adding a New Message Type

1. Add the type to the `WSMessage` type union in `packages/shared/src/types.ts`
2. Add a handler case in `ws/handlers/` (appropriate file based on domain)
3. Add the handler dispatch in `ws/handler.ts`'s `handleClientMessage` switch
4. On the client, subscribe in `useWebSocket.ts` and dispatch to `GameContext`
