import { gameState } from '../services/GameStateService.js';
import { listTemplates, getTemplate, loadTemplates } from '../services/ClassTemplateService.js';
import { consequenceEngine } from '../services/ConsequenceEngine.js';
import { runMigrations } from '../db/migrate.js';
import { worldClock } from '../services/WorldClockService.js';
import { characterService } from '../services/CharacterService.js';
import * as readline from 'readline';

// Initialize database and templates
runMigrations();
loadTemplates();

interface McpRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: any;
}

interface McpResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

// Access control
type AccessTier = 'character' | 'gm' | 'spectator';

interface CallerContext {
  tier: AccessTier;
  combatant_id?: string;
  campaign_id: string;
  session_id?: string;
}

function sendResponse(res: McpResponse): void {
  process.stdout.write(JSON.stringify(res) + '\n');
}

function handleRequest(req: McpRequest): void {
  try {
    switch (req.method) {
      case 'initialize':
        sendResponse({
          jsonrpc: '2.0',
          id: req.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
              resources: {},
            },
            serverInfo: {
              name: 'gate-life-mcp',
              version: '0.1.0',
            },
          },
        });
        return;

      case 'notifications/initialized':
        return;

      case 'tools/list':
        sendResponse({
          jsonrpc: '2.0',
          id: req.id,
          result: { tools: getToolList() },
        });
        return;

      case 'tools/call':
        handleToolCall(req);
        return;

      case 'resources/list':
        sendResponse({
          jsonrpc: '2.0',
          id: req.id,
          result: { resources: getResourceList() },
        });
        return;

      case 'resources/read':
        handleResourceRead(req);
        return;

      default:
        sendResponse({
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32601, message: `Method not found: ${req.method}` },
        });
    }
  } catch (err: any) {
    sendResponse({
      jsonrpc: '2.0',
      id: req.id,
      error: { code: -32000, message: err.message || 'Internal error' },
    });
  }
}

function getToolList() {
  return [
    {
      name: 'get_my_state',
      description: 'Get full snapshot of your character state: HP, SDC, ISP, hunger, thirst, fatigue, injuries, position, level, XP',
      inputSchema: {
        type: 'object',
        properties: {
          campaign_id: { type: 'string' },
          combatant_id: { type: 'string' },
        },
        required: ['campaign_id', 'combatant_id'],
      },
    },
    {
      name: 'list_my_inventory',
      description: 'List your inventory: items, quantities, equipped slots, weights, encumbrance tier',
      inputSchema: {
        type: 'object',
        properties: { combatant_id: { type: 'string' } },
        required: ['combatant_id'],
      },
    },
    {
      name: 'describe_my_injuries',
      description: 'Get structured injury list with body locations, severity, bleeding status',
      inputSchema: {
        type: 'object',
        properties: { combatant_id: { type: 'string' } },
        required: ['combatant_id'],
      },
    },
    {
      name: 'get_my_abilities',
      description: 'List available psionic powers, ISP costs, innate abilities, class actions',
      inputSchema: {
        type: 'object',
        properties: { combatant_id: { type: 'string' } },
        required: ['combatant_id'],
      },
    },
    {
      name: 'get_my_progression',
      description: 'Get level, total XP, XP to next level, level-up history',
      inputSchema: {
        type: 'object',
        properties: { combatant_id: { type: 'string' } },
        required: ['combatant_id'],
      },
    },
    {
      name: 'get_party_snapshot',
      description: 'Get party roster: names, classes, levels, HP bars, human/agent status',
      inputSchema: {
        type: 'object',
        properties: { campaign_id: { type: 'string' } },
        required: ['campaign_id'],
      },
    },
    {
      name: 'get_party_member_state',
      description: 'Get detailed state for a specific ally',
      inputSchema: {
        type: 'object',
        properties: {
          combatant_id: { type: 'string' },
          target_id: { type: 'string' },
        },
        required: ['combatant_id', 'target_id'],
      },
    },
    {
      name: 'get_current_environment',
      description: 'Get scene description, terrain, weather, time of day, ley line proximity',
      inputSchema: {
        type: 'object',
        properties: { campaign_id: { type: 'string' } },
        required: ['campaign_id'],
      },
    },
    {
      name: 'get_tactical_map',
      description: 'Get visible grid state: terrain tiles, cover, tokens, fog of war',
      inputSchema: {
        type: 'object',
        properties: {
          session_id: { type: 'string' },
          combatant_id: { type: 'string' },
        },
        required: ['session_id'],
      },
    },
    {
      name: 'sense_surroundings',
      description: 'Use Dog Boy innate psionic sensing to detect nearby threats',
      inputSchema: {
        type: 'object',
        properties: {
          combatant_id: { type: 'string' },
          session_id: { type: 'string' },
        },
        required: ['combatant_id', 'session_id'],
      },
    },
    {
      name: 'get_visible_enemies',
      description: 'List enemies you can perceive with approximate HP, position, type',
      inputSchema: {
        type: 'object',
        properties: {
          session_id: { type: 'string' },
          combatant_id: { type: 'string' },
        },
        required: ['session_id'],
      },
    },
    {
      name: 'get_session_state',
      description: 'Get current mode, world clock, round/tick, whose turn it is',
      inputSchema: {
        type: 'object',
        properties: { session_id: { type: 'string' } },
        required: ['session_id'],
      },
    },
    {
      name: 'get_turn_info',
      description: 'Get current turn order, your position in queue, remaining actions',
      inputSchema: {
        type: 'object',
        properties: {
          session_id: { type: 'string' },
          combatant_id: { type: 'string' },
        },
        required: ['session_id'],
      },
    },
    {
      name: 'query_event_log',
      description: 'Search recent game events by type, actor, time window',
      inputSchema: {
        type: 'object',
        properties: {
          campaign_id: { type: 'string' },
          session_id: { type: 'string' },
          event_type: { type: 'string' },
          actor_id: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['campaign_id'],
      },
    },
    {
      name: 'query_game_state',
      description: 'Ask a natural-language question about the game state',
      inputSchema: {
        type: 'object',
        properties: {
          campaign_id: { type: 'string' },
          combatant_id: { type: 'string' },
          question: { type: 'string' },
        },
        required: ['campaign_id', 'question'],
      },
    },
    {
      name: 'spawn_agent',
      description: 'Create a new Dog Boy agent in the party',
      inputSchema: {
        type: 'object',
        properties: {
          campaign_id: { type: 'string' },
          name: { type: 'string' },
          personality_preset: { type: 'string' },
        },
        required: ['campaign_id', 'name'],
      },
    },
    {
      name: 'respawn_agent',
      description: 'Respawn a dead agent as a fresh level 1 character',
      inputSchema: {
        type: 'object',
        properties: {
          campaign_id: { type: 'string' },
          name: { type: 'string' },
          personality_preset: { type: 'string' },
        },
        required: ['campaign_id', 'name'],
      },
    },
    {
      name: 'send_party_message',
      description: 'Post a message to the shared party chat',
      inputSchema: {
        type: 'object',
        properties: {
          campaign_id: { type: 'string' },
          session_id: { type: 'string' },
          combatant_id: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['campaign_id', 'combatant_id', 'content'],
      },
    },
  ];
}

function getResourceList() {
  return [
    {
      uri: 'gate-life://class-templates',
      name: 'Class Templates',
      description: 'Available class templates with full stat blocks, abilities, progression',
      mimeType: 'application/json',
    },
    {
      uri: 'gate-life://rules-reference',
      name: 'Rules Reference',
      description: 'Condensed game mechanics reference for agent reasoning',
      mimeType: 'text/plain',
    },
  ];
}

function handleToolCall(req: McpRequest): void {
  const params = req.params ?? {};
  const name = params.name as string;
  const args = (params.arguments ?? {}) as Record<string, any>;

  let result: any;

  switch (name) {
    case 'get_my_state': {
      const combatant = gameState.getCombatant(args.combatant_id);
      if (!combatant) { result = { error: 'Combatant not found' }; break; }
      const injuries = gameState.getInjuries(args.combatant_id);
      const penalties = consequenceEngine.computePenalties(combatant);
      result = { ...combatant, injuries, penalties, encumbrance_tier: consequenceEngine.getEncumbranceTier(combatant) };
      break;
    }

    case 'list_my_inventory': {
      const combatant = gameState.getCombatant(args.combatant_id);
      if (!combatant) { result = { error: 'Combatant not found' }; break; }
      const totalWeight = combatant.inventory.reduce((s, i) => s + i.weight * i.quantity, 0);
      const capacity = combatant.attributes.ps * 10;
      result = {
        items: combatant.inventory,
        total_weight: totalWeight,
        capacity,
        encumbrance_tier: consequenceEngine.getEncumbranceTier(combatant),
      };
      break;
    }

    case 'describe_my_injuries': {
      result = gameState.getInjuries(args.combatant_id);
      break;
    }

    case 'get_my_abilities': {
      const combatant = gameState.getCombatant(args.combatant_id);
      if (!combatant) { result = { error: 'Combatant not found' }; break; }
      const template = getTemplate(combatant.class_id);
      result = {
        psionic_powers: combatant.psionic_powers,
        isp_current: combatant.vitals.isp_current,
        isp_max: combatant.vitals.isp_max,
        innate_abilities: template?.innate_abilities || [],
        unique_actions: template?.unique_actions || [],
        pack_howl_remaining: combatant.pack_howl_remaining,
      };
      break;
    }

    case 'get_my_progression': {
      const combatant = gameState.getCombatant(args.combatant_id);
      if (!combatant) { result = { error: 'Combatant not found' }; break; }
      result = {
        level: combatant.level,
        xp: combatant.xp,
        xp_next_level: combatant.xp_next_level,
      };
      break;
    }

    case 'get_party_snapshot': {
      const party = gameState.getPartyCombatants(args.campaign_id);
      result = party.map(c => ({
        id: c.id,
        name: c.name,
        class_id: c.class_id,
        level: c.level,
        kind: c.kind,
        status: c.status,
        hp_percent: Math.round((c.vitals.hp_current / c.vitals.hp_max) * 100),
        tactical_x: c.tactical_x,
        tactical_y: c.tactical_y,
      }));
      break;
    }

    case 'get_party_member_state': {
      const target = gameState.getCombatant(args.target_id);
      if (!target) { result = { error: 'Combatant not found' }; break; }
      result = {
        id: target.id,
        name: target.name,
        class_id: target.class_id,
        level: target.level,
        kind: target.kind,
        status: target.status,
        hp_percent: Math.round((target.vitals.hp_current / target.vitals.hp_max) * 100),
        isp_percent: Math.round((target.vitals.isp_current / target.vitals.isp_max) * 100),
        tactical_x: target.tactical_x,
        tactical_y: target.tactical_y,
      };
      break;
    }

    case 'get_current_environment': {
      const campaign = gameState.getCampaign(args.campaign_id);
      if (!campaign) { result = { error: 'Campaign not found' }; break; }
      const timeOfDay = worldClock.getTimeOfDay(campaign.world_clock);
      result = {
        world_clock: campaign.world_clock,
        time_of_day: timeOfDay,
        formatted_time: worldClock.formatClock(campaign.world_clock),
        is_daytime: worldClock.isDaytime(campaign.world_clock),
      };
      break;
    }

    case 'get_tactical_map': {
      const terrain = gameState.getTerrain(args.session_id);
      const party = args.combatant_id
        ? gameState.getPartyCombatants(gameState.getSession(args.session_id)?.campaign_id || '')
        : [];
      const enemies = gameState.getSessionEnemies(args.session_id);
      result = {
        terrain: terrain.filter(t => t.revealed),
        party_positions: party.map(c => ({ id: c.id, name: c.name, x: c.tactical_x, y: c.tactical_y })),
        enemy_positions: enemies.map(e => ({ id: e.id, name: e.name, x: e.tactical_x, y: e.tactical_y, status: e.status })),
      };
      break;
    }

    case 'sense_surroundings': {
      const combatant = gameState.getCombatant(args.combatant_id);
      if (!combatant) { result = { error: 'Combatant not found' }; break; }
      const senseRange = 50 + (combatant.level * 5);
      const enemies = gameState.getSessionEnemies(args.session_id);
      result = {
        psychic_sense_range_ft: senseRange,
        detected_entities: enemies.map(e => ({
          type: e.enemy_type,
          direction: 'nearby',
          threat_level: e.hp_max > 50 ? 'high' : e.hp_max > 20 ? 'medium' : 'low',
        })),
        ley_line_interference: false,
      };
      break;
    }

    case 'get_visible_enemies': {
      const enemies = gameState.getSessionEnemies(args.session_id);
      result = enemies.map(e => ({
        id: e.id,
        name: e.name,
        type: e.enemy_type,
        hp_tier: e.hp_current > e.hp_max * 0.75 ? 'healthy' : e.hp_current > e.hp_max * 0.25 ? 'wounded' : 'critical',
        x: e.tactical_x,
        y: e.tactical_y,
        status: e.status,
      }));
      break;
    }

    case 'get_session_state': {
      const session = gameState.getSession(args.session_id);
      if (!session) { result = { error: 'Session not found' }; break; }
      const campaign = gameState.getCampaign(session.campaign_id);
      result = {
        mode: session.current_mode,
        world_clock: campaign?.world_clock,
        turn_state: session.turn_state,
      };
      break;
    }

    case 'get_turn_info': {
      const session = gameState.getSession(args.session_id);
      if (!session?.turn_state) { result = { error: 'No active turn state' }; break; }
      const ts = session.turn_state;
      const myIndex = args.combatant_id != null ? ts.turn_order.indexOf(args.combatant_id) : -1;
      result = {
        turn_order: ts.turn_order,
        current_actor_index: ts.current_actor_index,
        your_index: myIndex,
        your_actions_remaining: args.combatant_id != null ? (ts.action_budget[args.combatant_id] ?? 0) : 0,
        round: ts.round,
        tick: ts.tick,
        is_your_turn: args.combatant_id != null && ts.turn_order[ts.current_actor_index] === args.combatant_id,
      };
      break;
    }

    case 'query_event_log': {
      result = gameState.getEvents(args.campaign_id, {
        sessionId: args.session_id,
        eventType: args.event_type,
        actorId: args.actor_id,
        limit: args.limit,
      });
      break;
    }

    case 'query_game_state': {
      const question = (args.question as string).toLowerCase();
      if (question.includes('hp') || question.includes('health') || question.includes('hurt')) {
        const combatant = args.combatant_id ? gameState.getCombatant(args.combatant_id) : null;
        if (combatant) {
          result = {
            answer: `${combatant.name}: HP ${combatant.vitals.hp_current}/${combatant.vitals.hp_max}, SDC ${combatant.vitals.sdc_current}/${combatant.vitals.sdc_max}`,
            data: combatant.vitals,
          };
        } else {
          result = { answer: 'Provide combatant_id to answer health questions.', data: null };
        }
      } else if (question.includes('inventory') || question.includes('carrying') || question.includes('item')) {
        const combatant = args.combatant_id ? gameState.getCombatant(args.combatant_id) : null;
        if (combatant) {
          result = {
            answer: `Carrying ${combatant.inventory.length} items`,
            data: combatant.inventory,
          };
        } else {
          result = { answer: 'Provide combatant_id to answer inventory questions.', data: null };
        }
      } else if (question.includes('party') || question.includes('team')) {
        const party = gameState.getPartyCombatants(args.campaign_id);
        result = {
          answer: `Party has ${party.length} members: ${party.map(c => c.name).join(', ')}`,
          data: party.map(c => ({ name: c.name, level: c.level, hp_percent: Math.round((c.vitals.hp_current / c.vitals.hp_max) * 100) })),
        };
      } else {
        result = { answer: 'I can answer questions about hp, inventory, party, enemies, and more.' };
      }
      break;
    }

    case 'spawn_agent': {
      const session = gameState.getActiveSession(args.campaign_id);
      if (session?.current_mode === 'tactical') {
        result = { error: 'Cannot spawn agents during tactical mode' };
        break;
      }
      try {
        const combatant = characterService.createCharacter({
          campaignId: args.campaign_id,
          name: args.name,
          kind: 'agent',
          personalityPreset: args.personality_preset,
        });
        result = { success: true, combatant };
      } catch (err: any) {
        result = { error: err.message };
      }
      break;
    }

    case 'respawn_agent': {
      try {
        const combatant = characterService.respawnAgent({
          campaignId: args.campaign_id,
          name: args.name,
          personalityPreset: args.personality_preset,
        });
        result = { success: true, combatant };
      } catch (err: any) {
        result = { error: err.message };
      }
      break;
    }

    case 'send_party_message': {
      const session = gameState.getActiveSession(args.campaign_id);
      if (session?.current_mode === 'tactical') {
        const ts = session.turn_state;
        if (ts && ts.turn_order[ts.current_actor_index] !== args.combatant_id) {
          result = { error: 'Not your turn in tactical mode' };
          break;
        }
      }
      const msg = gameState.createMessage({
        campaign_id: args.campaign_id,
        session_id: args.session_id || gameState.getActiveSession(args.campaign_id)?.id,
        actor_id: args.combatant_id,
        message_type: 'player_speech',
        content: args.content,
        visibility: 'party',
      });
      result = { success: true, message: msg };
      break;
    }

    default:
      sendResponse({
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32601, message: `Tool not found: ${name}` },
      });
      return;
  }

  sendResponse({
    jsonrpc: '2.0',
    id: req.id,
    result: {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    },
  });
}

function handleResourceRead(req: McpRequest): void {
  const uri = req.params?.uri;

  switch (uri) {
    case 'gate-life://class-templates': {
      const templates = listTemplates();
      sendResponse({
        jsonrpc: '2.0',
        id: req.id,
        result: {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(templates, null, 2),
          }],
        },
      });
      return;
    }

    case 'gate-life://rules-reference': {
      const rulesText = `
Gate Life -- Quick Rules Reference (Rifts-inspired)

COMBAT (Melee Round = 15 seconds):
- Initiative: d20 + bonuses, re-rolled each round
- Strike: d20 + bonus. 5+ hits. Nat 20 = critical (2x damage). Nat 1 = miss.
- Defense: parry (free) or dodge (costs 1 action). Must meet/exceed strike roll. Ties to defender.
- Damage: weapon dice + PS bonus. MD hits armor MDC first. SDC cannot damage MDC.
- Roll with Impact: 1 action, d20 >= strike roll = half damage.

DAMAGE:
- SDC: normal damage. MDC: mega-damage. 1 MD = 100 SDC.
- HP + SDC = body. Armor = MDC (separate).
- 0 HP = unconscious. -PE HP = death.

PSIONICS:
- ISP pool. Recovery: 2/hr rest, 6/hr meditation.
- Save vs psionics: 12+ on d20.

DOG BOY:
- Innate: Sense psychic/magic (50ft+), super smell, keen senses.
- Starting: Sixth Sense (2 ISP), Empathy (4 ISP), See Aura (6 ISP).
- APM: 4 at level 1. Combat: +2 init, +2 parry, +2 dodge.

XP AWARDS (GM discretion):
- Playing in character: 50. Clever idea: 100. Heroic action: 50-100.
- Defeating threats: 25-400. Critical plan: 400-1000.
      `.trim();

      sendResponse({
        jsonrpc: '2.0',
        id: req.id,
        result: {
          contents: [{
            uri,
            mimeType: 'text/plain',
            text: rulesText,
          }],
        },
      });
      return;
    }

    default:
      sendResponse({
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32602, message: `Resource not found: ${uri}` },
      });
  }
}

// Main loop: read JSON-RPC from stdin
const rl = readline.createInterface({ input: process.stdin });

rl.on('line', (line) => {
  try {
    const req = JSON.parse(line.trim()) as McpRequest;
    handleRequest(req);
  } catch (err: any) {
    sendResponse({
      jsonrpc: '2.0',
      id: 0,
      error: { code: -32700, message: 'Parse error: ' + err.message },
    });
  }
});

console.error('[mcp] Gate Life MCP server started');
