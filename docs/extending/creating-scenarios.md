# Creating Scenarios

## Overview

Scenarios are authored content packages that define a starting location, entities (enemies, NPCs, POIs), and optional wandering monster encounters. They can be created through the ScenarioBuilder UI or via the REST API.

## ScenarioBuilder UI

Access from the Lobby: click "Build Scenario" to open the wizard.

### Step 1: Info
- **Name**: scenario display name
- **GM Kind**: `agent` (AI GM) or `human` (player-run GM)
- **Start Location**: lat/lng on the world map (click to set)
- **Setting Designer**: AI chat to help describe the scenario setting
- **Wandering Monster Designer**: configure random encounter tables

### Step 2: Map
- Place entities on the Leaflet map using the toolbar
- Entity types: enemy, NPC, friendly, vehicle, POI, dungeon
- Each entity gets a name, position, and definition (stats/behavior)
- **Entity Chat Panel**: AI-assisted entity definition
- **Dungeon Designer**: draw polygon areas and generate dungeon layouts

### Step 3: Review
- View all placed entities
- Save or finalize the scenario

## Launching a Scenario

`POST /api/scenarios/:id/launch` creates a new campaign + session from the scenario:
1. Creates a campaign with the scenario's setting as `gm_agent_config`
2. Creates an active session
3. Spawns all `scenario_entities` as `enemies` rows (with appropriate `enemy_type`)
4. Returns the new campaign and session IDs

## Database Tables

- **`scenarios`**: id, name, description, creator_user_id, gm_kind, start_lat, start_lng
- **`scenario_entities`**: id, scenario_id, entity_type, grid_x, grid_y, lat, lng, name, definition (JSON)

## Entity Types

Defined in `content/entity-types/`. Each type specifies how it spawns when a scenario launches:
- `enemy` → hostile enemy on tactical board
- `npc` → neutral NPC (quest giver, merchant)
- `friendly` → allied NPC
- `vehicle` → vehicle entity
- `poi` → map marker (quest destination)
- `dungeon` → dungeon area with interior layout
