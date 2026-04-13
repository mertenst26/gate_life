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

  console.log('[db] Schema applied successfully');
}
