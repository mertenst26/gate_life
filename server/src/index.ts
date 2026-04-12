import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import websocket from '@fastify/websocket';
import { runMigrations } from './db/migrate.js';
import { campaignRoutes } from './routes/campaigns.js';
import { sessionRoutes } from './routes/sessions.js';
import { combatantRoutes } from './routes/combatants.js';
import { messageRoutes } from './routes/messages.js';
import { actionRoutes } from './routes/actions.js';
import { stateRoutes } from './routes/state.js';
import { terrainRoutes } from './routes/terrain.js';
import { wsHandler } from './ws/handler.js';
import { loadTemplates } from './services/ClassTemplateService.js';

const PORT = parseInt(process.env.PORT || '3003', 10);

async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(sensible);
  await app.register(websocket);

  runMigrations();
  loadTemplates();

  // REST routes
  app.register(campaignRoutes, { prefix: '/api/campaigns' });
  app.register(sessionRoutes, { prefix: '/api/sessions' });
  app.register(combatantRoutes, { prefix: '/api/combatants' });
  app.register(messageRoutes, { prefix: '/api/messages' });
  app.register(actionRoutes, { prefix: '/api/actions' });
  app.register(stateRoutes, { prefix: '/api/state' });
  app.register(terrainRoutes, { prefix: '/api/terrain' });

  // WebSocket
  app.register(wsHandler);

  app.get('/health', async () => ({ status: 'ok' }));

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`[gate_life] Server running on port ${PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
