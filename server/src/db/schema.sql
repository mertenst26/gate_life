-- Gate Life unified game state database

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Campaigns
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  creator_user_id TEXT NOT NULL,
  gm_kind TEXT NOT NULL CHECK (gm_kind IN ('human', 'agent')),
  gm_user_id TEXT,
  gm_agent_config TEXT, -- JSON
  world_clock TEXT NOT NULL DEFAULT '{"day":1,"hour":8,"minute":0}', -- JSON
  deleted_at TEXT, -- soft delete timestamp; NULL = active
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  current_mode TEXT NOT NULL DEFAULT 'charCreate' CHECK (current_mode IN ('charCreate','conversation','tactical','travel','rest')),
  current_scene_id TEXT,
  turn_state TEXT, -- JSON: { turnOrder, currentActorIndex, round, tick }
  spectator_user_ids TEXT NOT NULL DEFAULT '[]', -- JSON array
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Combatants (party members -- players and agents)
CREATE TABLE IF NOT EXISTS combatants (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id),
  kind TEXT NOT NULL CHECK (kind IN ('human', 'agent')),
  controller TEXT, -- user ID or agent worker ID
  class_id TEXT NOT NULL DEFAULT 'dog_boy',
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'alive' CHECK (status IN ('alive','unconscious','dead')),
  personality TEXT, -- JSON personality profile

  -- Attributes
  iq INTEGER NOT NULL DEFAULT 10,
  me INTEGER NOT NULL DEFAULT 11,
  ma INTEGER NOT NULL DEFAULT 9,
  ps INTEGER NOT NULL DEFAULT 12,
  pp INTEGER NOT NULL DEFAULT 12,
  pe INTEGER NOT NULL DEFAULT 13,
  pb INTEGER NOT NULL DEFAULT 7,
  spd_bipedal INTEGER NOT NULL DEFAULT 22,
  spd_quadruped INTEGER NOT NULL DEFAULT 40,

  -- Vitals
  hp_current INTEGER NOT NULL DEFAULT 13,
  hp_max INTEGER NOT NULL DEFAULT 13,
  sdc_current INTEGER NOT NULL DEFAULT 40,
  sdc_max INTEGER NOT NULL DEFAULT 40,
  isp_current INTEGER NOT NULL DEFAULT 21,
  isp_max INTEGER NOT NULL DEFAULT 21,
  ppe_current INTEGER NOT NULL DEFAULT 18,
  ppe_max INTEGER NOT NULL DEFAULT 18,
  armor_mdc_current INTEGER NOT NULL DEFAULT 70,
  armor_mdc_max INTEGER NOT NULL DEFAULT 70,

  -- Combat
  apm INTEGER NOT NULL DEFAULT 4,
  initiative_bonus INTEGER NOT NULL DEFAULT 2,
  strike_bonus INTEGER NOT NULL DEFAULT 0,
  parry_bonus INTEGER NOT NULL DEFAULT 2,
  dodge_bonus INTEGER NOT NULL DEFAULT 2,
  roll_with_impact_bonus INTEGER NOT NULL DEFAULT 0,
  damage_bonus INTEGER NOT NULL DEFAULT 0,

  -- Needs (0-100)
  hunger INTEGER NOT NULL DEFAULT 0,
  thirst INTEGER NOT NULL DEFAULT 0,
  fatigue INTEGER NOT NULL DEFAULT 0,

  -- Environment/Body
  internal_temp REAL NOT NULL DEFAULT 37.0,
  pulse_bpm INTEGER NOT NULL DEFAULT 72,

  -- Tactical placement
  tactical_x INTEGER,
  tactical_y INTEGER,
  facing TEXT DEFAULT 'north',
  elevation INTEGER DEFAULT 0,

  -- Progression
  level INTEGER NOT NULL DEFAULT 1,
  xp INTEGER NOT NULL DEFAULT 0,
  xp_next_level INTEGER NOT NULL DEFAULT 2000,

  -- Abilities and inventory stored as JSON
  psionic_powers TEXT NOT NULL DEFAULT '[]', -- JSON array of power IDs
  skills TEXT NOT NULL DEFAULT '[]', -- JSON array
  inventory TEXT NOT NULL DEFAULT '[]', -- JSON array of items
  equipped TEXT NOT NULL DEFAULT '{}', -- JSON: { weapon, armor, ... }
  status_effects TEXT NOT NULL DEFAULT '[]', -- JSON array

  -- Unique action charges
  pack_howl_remaining INTEGER NOT NULL DEFAULT 1,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Injuries
CREATE TABLE IF NOT EXISTS injuries (
  id TEXT PRIMARY KEY,
  combatant_id TEXT NOT NULL REFERENCES combatants(id) ON DELETE CASCADE,
  body_location TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('minor','moderate','severe','critical')),
  injury_type TEXT NOT NULL,
  bleeding INTEGER NOT NULL DEFAULT 0,
  pain_level INTEGER NOT NULL DEFAULT 0,
  healing_progress REAL NOT NULL DEFAULT 0.0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Game events log
CREATE TABLE IF NOT EXISTS game_events (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id),
  event_type TEXT NOT NULL,
  actor_id TEXT,
  target_id TEXT,
  data TEXT, -- JSON payload
  narrative TEXT, -- human-readable description
  visibility TEXT NOT NULL DEFAULT 'party' CHECK (visibility IN ('party','gm','gm_only_agent_reasoning','system')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Chat messages
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id),
  actor_id TEXT,
  message_type TEXT NOT NULL CHECK (message_type IN ('gm_narration','player_speech','npc_dialog','dice_result','system_alert','gm_private')),
  content TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'party' CHECK (visibility IN ('party','gm','gm_only_agent_reasoning')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Vital samples (1Hz pulse/temp for charts)
CREATE TABLE IF NOT EXISTS vital_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  combatant_id TEXT NOT NULL REFERENCES combatants(id) ON DELETE CASCADE,
  pulse_bpm INTEGER NOT NULL,
  internal_temp REAL NOT NULL,
  sampled_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Enemies (for tactical encounters)
CREATE TABLE IF NOT EXISTS enemies (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  enemy_type TEXT NOT NULL,
  hp_current INTEGER NOT NULL,
  hp_max INTEGER NOT NULL,
  sdc_current INTEGER NOT NULL DEFAULT 0,
  sdc_max INTEGER NOT NULL DEFAULT 0,
  mdc_current INTEGER,
  mdc_max INTEGER,
  apm INTEGER NOT NULL DEFAULT 2,
  initiative_bonus INTEGER NOT NULL DEFAULT 0,
  strike_bonus INTEGER NOT NULL DEFAULT 0,
  parry_bonus INTEGER NOT NULL DEFAULT 0,
  dodge_bonus INTEGER NOT NULL DEFAULT 0,
  damage TEXT NOT NULL DEFAULT '1d6',
  damage_type TEXT NOT NULL DEFAULT 'sdc',
  tactical_x INTEGER,
  tactical_y INTEGER,
  status TEXT NOT NULL DEFAULT 'alive',
  abilities TEXT DEFAULT '[]', -- JSON
  loot_table TEXT DEFAULT '[]', -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tactical grid / terrain for encounters
CREATE TABLE IF NOT EXISTS tactical_terrain (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  terrain_type TEXT NOT NULL DEFAULT 'open' CHECK (terrain_type IN ('open','rough','hazardous','impassable','elevated')),
  cover TEXT CHECK (cover IN (NULL, 'partial', 'full')),
  elevation INTEGER NOT NULL DEFAULT 0,
  revealed INTEGER NOT NULL DEFAULT 0,
  metadata TEXT, -- JSON for hazard damage, etc.
  UNIQUE(session_id, x, y)
);

-- Loot tables
CREATE TABLE IF NOT EXISTS loot_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  item_type TEXT NOT NULL,
  damage TEXT,
  damage_type TEXT,
  mdc INTEGER,
  weight REAL NOT NULL DEFAULT 1.0,
  value INTEGER NOT NULL DEFAULT 0,
  properties TEXT DEFAULT '{}', -- JSON
  rarity TEXT NOT NULL DEFAULT 'common' CHECK (rarity IN ('common','uncommon','rare','legendary','artifact'))
);

-- Scenarios (reusable templates for launching campaigns)
CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  creator_user_id TEXT NOT NULL,
  gm_kind TEXT NOT NULL CHECK (gm_kind IN ('human', 'agent')),
  start_lat REAL NOT NULL DEFAULT 39.2508,
  start_lng REAL NOT NULL DEFAULT -106.2925,
  deleted_at TEXT, -- soft delete timestamp; NULL = active
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Scenario entities (pre-placed enemies and NPCs on the map)
CREATE TABLE IF NOT EXISTS scenario_entities (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('enemy', 'npc')),
  grid_x INTEGER NOT NULL DEFAULT 0,
  grid_y INTEGER NOT NULL DEFAULT 0,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  name TEXT NOT NULL,
  definition TEXT NOT NULL DEFAULT '{}', -- JSON: full stat block
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_combatants_campaign ON combatants(campaign_id);
CREATE INDEX IF NOT EXISTS idx_game_events_campaign ON game_events(campaign_id);
CREATE INDEX IF NOT EXISTS idx_game_events_session ON game_events(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_campaign ON messages(campaign_id);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_vital_samples_combatant ON vital_samples(combatant_id);
CREATE INDEX IF NOT EXISTS idx_injuries_combatant ON injuries(combatant_id);
CREATE INDEX IF NOT EXISTS idx_enemies_session ON enemies(session_id);
CREATE INDEX IF NOT EXISTS idx_tactical_terrain_session ON tactical_terrain(session_id);
CREATE INDEX IF NOT EXISTS idx_scenario_entities_scenario ON scenario_entities(scenario_id);
