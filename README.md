# Gate Life

A narrative web RPG where a party of 0-4 human players and NPC agents navigate dimensional gates, blending chat-driven storytelling with a Rifts-inspired tactical combat system.

## Quick Start

```bash
npm install
npm run dev
```

Server runs on port 3001, client on port 5173.

## Architecture

- `client/` — React frontend with Vite
- `server/` — Fastify backend with WebSocket + SQLite
- `packages/shared/` — Shared types, constants, and dice utilities
- `class_templates/` — YAML class definitions (Dog Boy for v1)
- `docs/` — Game mechanics reference

## Tech Stack

- **Frontend**: React 19, Vite, uPlot (charts)
- **Backend**: Fastify, better-sqlite3, WebSocket
- **Shared**: TypeScript monorepo with npm workspaces
