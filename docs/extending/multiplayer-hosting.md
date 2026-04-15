# Multiplayer Hosting

## How It Works

Gate Life uses a shared server model: all players connect to the same Fastify server via WebSocket.

### User Identity

Each browser generates a persistent `userId` stored in `localStorage` on first visit (format: `player-<uuid>`). This ID is sent with every `join_session` WebSocket message.

### Starting a Game

1. **Host creates a campaign** via the Lobby (or launches a scenario)
2. **Host creates their character** — the combatant is assigned their `user_id`
3. **Host shares the campaign ID** with other players (or they see it in the campaign list)

### Joining a Game

1. **Player opens the Lobby** and sees the campaign in the list
2. **Player selects role** (player, spectator, or GM)
3. **Player claims a combatant** — either creates a new character or claims an unclaimed one
4. WebSocket `join_session` binds their connection to the session

### Spectators

Added via `POST /api/sessions/:id/spectator`. Spectators see the full game state but cannot issue commands or move characters.

## Running the Server

```bash
# Development (both server + client with hot reload)
npm run dev

# Server only
cd server && npm run dev

# Client only  
cd client && npm run dev
```

Default ports:
- Server: `http://localhost:3003`
- Client: `http://localhost:5173` (proxies `/api` and `/ws` to server)

### For LAN Play

Set the server to listen on all interfaces (already configured: `host: '0.0.0.0'`). Other players connect to `http://<host-ip>:5173`.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3003` | Server port |
| `DB_PATH` | `server/data/gate_life.db` | SQLite database path |
| `ANTHROPIC_API_KEY` | — | Required for AI GM features |

## Data Ownership

- Each `combatant` row has a `user_id` column that tracks who controls it
- The `claimCombatant(combatantId, userId)` method ensures a combatant can only be claimed once
- Agent combatants (`kind: "agent"`) have no `user_id` — they are AI-controlled
