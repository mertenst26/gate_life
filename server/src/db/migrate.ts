import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './connection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function hasColumn(table: string, column: string): boolean {
  const db = getDb();
  const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return cols.some(c => c.name === column);
}

export function runMigrations(): void {
  const db = getDb();

  // Apply base schema (idempotent — CREATE TABLE IF NOT EXISTS)
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);

  // Additive column migrations — safe to run repeatedly
  if (!hasColumn('campaigns', 'deleted_at')) {
    db.exec('ALTER TABLE campaigns ADD COLUMN deleted_at TEXT');
    console.log('[db] Migration: added campaigns.deleted_at');
  }
  if (!hasColumn('scenarios', 'deleted_at')) {
    db.exec('ALTER TABLE scenarios ADD COLUMN deleted_at TEXT');
    console.log('[db] Migration: added scenarios.deleted_at');
  }
  if (!hasColumn('scenarios', 'wandering_monster_config')) {
    db.exec('ALTER TABLE scenarios ADD COLUMN wandering_monster_config TEXT');
    console.log('[db] Migration: added scenarios.wandering_monster_config');
  }

  // Expand scenario_entities.entity_type CHECK constraint to include new types.
  // SQLite can't ALTER a constraint, so we recreate the table if it has the old definition.
  const seInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='scenario_entities'")
    .get() as { sql: string } | undefined;
  if (seInfo && seInfo.sql.includes("'enemy', 'npc'") && !seInfo.sql.includes("'friendly'")) {
    db.exec(`
      CREATE TABLE scenario_entities_new (
        id TEXT PRIMARY KEY,
        scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL CHECK (entity_type IN ('enemy', 'npc', 'friendly', 'vehicle', 'poi')),
        grid_x INTEGER NOT NULL DEFAULT 0,
        grid_y INTEGER NOT NULL DEFAULT 0,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        name TEXT NOT NULL,
        definition TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO scenario_entities_new SELECT * FROM scenario_entities;
      DROP TABLE scenario_entities;
      ALTER TABLE scenario_entities_new RENAME TO scenario_entities;
    `);
    console.log('[db] Migration: expanded scenario_entities.entity_type to include friendly/vehicle/poi');
  }

  // Expand entity_type CHECK to include 'dungeon'
  const seInfo2 = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='scenario_entities'")
    .get() as { sql: string } | undefined;
  if (seInfo2 && !seInfo2.sql.includes("'dungeon'")) {
    db.exec(`
      CREATE TABLE scenario_entities_new (
        id TEXT PRIMARY KEY,
        scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL CHECK (entity_type IN ('enemy', 'npc', 'friendly', 'vehicle', 'poi', 'dungeon')),
        grid_x INTEGER NOT NULL DEFAULT 0,
        grid_y INTEGER NOT NULL DEFAULT 0,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        name TEXT NOT NULL,
        definition TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO scenario_entities_new SELECT * FROM scenario_entities;
      DROP TABLE scenario_entities;
      ALTER TABLE scenario_entities_new RENAME TO scenario_entities;
    `);
    console.log('[db] Migration: expanded scenario_entities.entity_type to include dungeon');
  }

  // Add detected column to enemies table for contact-detection tracking
  if (!hasColumn('enemies', 'detected')) {
    db.exec('ALTER TABLE enemies ADD COLUMN detected INTEGER NOT NULL DEFAULT 0');
    console.log('[db] Migration: added enemies.detected');
  }

  // Add facing column to enemies table
  if (!hasColumn('enemies', 'facing')) {
    db.exec('ALTER TABLE enemies ADD COLUMN facing TEXT');
    console.log('[db] Migration: added enemies.facing');
  }

  if (!hasColumn('enemies', 'quest_poi')) {
    db.exec('ALTER TABLE enemies ADD COLUMN quest_poi INTEGER NOT NULL DEFAULT 0');
    console.log('[db] Migration: added enemies.quest_poi');
  }

  if (!hasColumn('enemies', 'icon_type')) {
    db.exec('ALTER TABLE enemies ADD COLUMN icon_type TEXT');
    console.log('[db] Migration: added enemies.icon_type');
  }

  if (!hasColumn('enemies', 'support_config')) {
    db.exec('ALTER TABLE enemies ADD COLUMN support_config TEXT');
    console.log('[db] Migration: added enemies.support_config');
  }

  // Legacy rows: enemy_type 'npc' → mechanical 'neutral' + icon_type 'npc'
  db.exec(`
    UPDATE enemies SET icon_type = 'npc', enemy_type = 'neutral'
    WHERE enemy_type = 'npc' AND (icon_type IS NULL OR icon_type = '')
  `);

  if (!hasColumn('combatants', 'party_member')) {
    db.exec('ALTER TABLE combatants ADD COLUMN party_member INTEGER NOT NULL DEFAULT 1');
    console.log('[db] Migration: added combatants.party_member');
  }

  if (!hasColumn('sessions', 'terrain_origin_lat')) {
    db.exec('ALTER TABLE sessions ADD COLUMN terrain_origin_lat REAL');
    db.exec('ALTER TABLE sessions ADD COLUMN terrain_origin_lng REAL');
    console.log('[db] Migration: added sessions.terrain_origin_*');
  }

  if (!hasColumn('campaigns', 'grid_origin_lat')) {
    db.exec('ALTER TABLE campaigns ADD COLUMN grid_origin_lat REAL');
    db.exec('ALTER TABLE campaigns ADD COLUMN grid_origin_lng REAL');
    console.log('[db] Migration: added campaigns.grid_origin_*');
  }

  // Backfill from gm_agent_config JSON for campaigns created before dedicated columns existed
  try {
    db.exec(`
      UPDATE campaigns SET
        grid_origin_lat = CAST(json_extract(gm_agent_config, '$.grid_origin_lat') AS REAL),
        grid_origin_lng = CAST(json_extract(gm_agent_config, '$.grid_origin_lng') AS REAL)
      WHERE gm_agent_config IS NOT NULL
        AND grid_origin_lat IS NULL
        AND grid_origin_lng IS NULL
        AND json_extract(gm_agent_config, '$.grid_origin_lat') IS NOT NULL
    `);
  } catch {
    /* json_extract unavailable on very old SQLite — skip */
  }

  if (!hasColumn('combatants', 'user_id')) {
    db.exec('ALTER TABLE combatants ADD COLUMN user_id TEXT');
    console.log('[db] Migration: added combatants.user_id');
  }

  console.log('[db] Schema applied successfully');
}
