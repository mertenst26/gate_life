import { FastifyInstance } from 'fastify';
import { gameState } from '../services/GameStateService.js';
import { broadcastToSession } from '../ws/handler.js';
import type { GameMode, TurnState } from '@gate-life/shared';

export async function sessionRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/:id', async (req) => {
    const session = gameState.getSession(req.params.id);
    if (!session) return app.httpErrors.notFound('Session not found');
    return session;
  });

  app.get<{ Params: { campaignId: string } }>('/campaign/:campaignId/active', async (req) => {
    const session = gameState.getActiveSession(req.params.campaignId);
    if (!session) return app.httpErrors.notFound('No active session');
    return session;
  });

  app.post<{ Params: { id: string }; Body: { mode: string } }>('/:id/mode', async (req) => {
    const { mode } = req.body as { mode: GameMode };
    const session = gameState.getSession(req.params.id);
    if (!session) return app.httpErrors.notFound('Session not found');

    gameState.updateSessionMode(req.params.id, mode);

    let turn_state: TurnState | null = null;

    if (mode === 'tactical') {
      // Roll initiative and build turn order
      const party = gameState.getPartyCombatants(session.campaign_id);
      const rolled = party.map(c => ({
        id: c.id,
        roll: Math.floor(Math.random() * 20) + 1 + (c.combat.initiative_bonus ?? 0),
      }));
      rolled.sort((a, b) => b.roll - a.roll);
      const turn_order = rolled.map(r => r.id);

      turn_state = {
        turn_order,
        current_actor_index: 0,
        round: 1,
        tick: 0,
        action_budget: Object.fromEntries(party.map(c => [c.id, c.combat.apm])),
        pending_input: turn_order.length > 0
          ? { actor_id: turn_order[0], input_type: 'free_text' }
          : undefined,
      };
      gameState.updateTurnState(req.params.id, turn_state);
    } else {
      gameState.updateTurnState(req.params.id, null);
    }

    broadcastToSession(req.params.id, {
      type: 'mode_change',
      payload: { mode, turn_state },
      timestamp: new Date().toISOString(),
    });

    return { success: true, mode, turn_state };
  });

  app.post<{ Params: { id: string }; Body: { user_id: string } }>('/:id/spectator', async (req) => {
    gameState.addSpectator(req.params.id, req.body.user_id);
    return { success: true };
  });
}
