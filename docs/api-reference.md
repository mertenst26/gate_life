# API Reference

## REST Endpoints

### Campaigns (`/api/campaigns`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/campaigns` | List all campaigns |
| `GET` | `/api/campaigns/:id` | Get campaign by ID |
| `POST` | `/api/campaigns` | Create campaign + initial session |
| `DELETE` | `/api/campaigns/:id` | Delete campaign |
| `POST` | `/api/campaigns/start-narration` | Trigger AI GM opening narration |

**POST /api/campaigns** body:
```json
{ "name": "...", "gm_kind": "agent|human", "gm_user_id": "...", "gm_agent_config": {...}, "grid_origin_lat": 0.0, "grid_origin_lng": 0.0 }
```

### Sessions (`/api/sessions`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/sessions/:id` | Get session |
| `GET` | `/api/sessions/campaign/:campaignId/active` | Get active session for campaign |
| `POST` | `/api/sessions/:id/mode` | Set session mode |
| `POST` | `/api/sessions/:id/spectator` | Add spectator user |

### Combatants (`/api/combatants`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/combatants?campaign_id=` | List party combatants |
| `GET` | `/api/combatants/:id` | Get combatant + injuries |
| `POST` | `/api/combatants` | Create character |
| `POST` | `/api/combatants/respawn` | Respawn agent |
| `PATCH` | `/api/combatants/:id/vitals` | Update vitals |
| `PATCH` | `/api/combatants/:id/position` | Set grid position |
| `POST` | `/api/combatants/:id/xp` | Add XP |
| `GET` | `/api/combatants/:id/vitals/history` | Vital sample history |
| `DELETE` | `/api/combatants/:id` | Delete combatant |

### Messages (`/api/messages`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/messages?campaign_id=&session_id=&limit=&before=` | List messages |
| `POST` | `/api/messages` | Create message (optional WS broadcast) |

### Actions (`/api/actions`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/actions` | Process combat action |
| `POST` | `/api/actions/end-turn` | End current turn |
| `POST` | `/api/actions/mode` | Transition mode |
| `POST` | `/api/actions/travel-leg` | Travel leg execution |
| `POST` | `/api/actions/rest-shift` | Rest period |
| `POST` | `/api/actions/award-xp` | Award XP to party |
| `POST` | `/api/actions/trade` | Trade items between party members |
| `POST` | `/api/actions/heal` | Heal ally |
| `POST` | `/api/actions/formation` | Set party formation |
| `POST` | `/api/actions/banter` | Party banter prompt |
| `POST` | `/api/actions/eat` | Consume rations |
| `POST` | `/api/actions/drink` | Consume water |
| `POST` | `/api/actions/use-item` | Use item ability |
| `POST` | `/api/actions/agent-turn` | Execute agent turn |

### State (`/api/state`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/state/campaign/:campaignId` | Full campaign state (campaign, session, party, world_npcs) |
| `GET` | `/api/state/session/:sessionId/enemies` | Session enemies |
| `GET` | `/api/state/session/:sessionId/terrain` | Session terrain tiles |
| `GET` | `/api/state/session/:sessionId/events` | Game events |
| `GET` | `/api/state/templates` | All class templates |

### Terrain (`/api/terrain`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/terrain?session_id=&cx=&cy=&radius=` | OSM terrain bundle for area |

### Scenarios (`/api/scenarios`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/scenarios` | List scenarios |
| `GET` | `/api/scenarios/:id` | Get scenario + entities |
| `POST` | `/api/scenarios` | Create scenario |
| `PUT` | `/api/scenarios/:id` | Update scenario |
| `DELETE` | `/api/scenarios/:id` | Delete scenario |
| `POST` | `/api/scenarios/:id/launch` | Launch scenario as new campaign |
| `POST` | `/api/scenarios/setting-chat` | AI setting assistant |
| `POST` | `/api/scenarios/:id/entities/chat` | AI entity definition |
| `POST` | `/api/scenarios/:id/entities` | Create entity |
| `PUT` | `/api/scenarios/:id/entities/:entityId` | Update entity |
| `DELETE` | `/api/scenarios/:id/entities/:entityId` | Delete entity |
| `POST` | `/api/scenarios/:id/wandering-monster/chat` | AI wandering monster config |
| `PUT` | `/api/scenarios/:id/wandering-monster` | Save wandering monster config |

## WebSocket

See [websocket-messages.md](extending/websocket-messages.md) for the full WebSocket protocol reference including all inbound and outbound message types with payload schemas.
