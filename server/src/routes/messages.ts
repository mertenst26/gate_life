import { FastifyInstance } from 'fastify';
import { gameState } from '../services/GameStateService.js';
import { broadcastToSession } from '../ws/handler.js';

export async function messageRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { campaign_id: string; session_id?: string; limit?: string; before?: string } }>('/', async (req) => {
    return gameState.getMessages(req.query.campaign_id, {
      sessionId: req.query.session_id,
      limit: req.query.limit ? parseInt(req.query.limit) : undefined,
      before: req.query.before,
    });
  });

  app.post<{ Body: { campaign_id: string; session_id?: string; actor_id?: string; message_type: string; content: string; visibility?: string } }>('/', async (req) => {
    const msg = gameState.createMessage(req.body as any);

    if (req.body.session_id) {
      broadcastToSession(req.body.session_id, {
        type: 'chat_message',
        payload: msg,
        timestamp: new Date().toISOString(),
      });
    }

    return msg;
  });
}
