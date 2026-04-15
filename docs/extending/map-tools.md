# Map Tools

## World Map (MapPanel)

The world map uses **Leaflet** / **react-leaflet** and shows:
- Party member positions (from `combatant.tactical_x/y` mapped to lat/lng)
- World NPCs (non-party combatants with `party_member = false`)
- Detected scenario entities (enemies, POIs, etc.)
- Grid origin marker

### Converting Grid ↔ Lat/Lng

The campaign's `grid_origin_lat`/`grid_origin_lng` defines where grid (0,0) falls on the map. Each grid unit ≈ 3.048 meters (10 feet). The conversion uses simple equirectangular projection.

## Scenario Map Panel (ScenarioMapPanel)

Used in the ScenarioBuilder for authoring:
- **Placement modes**: set-start, enemy, npc, friendly, vehicle, poi, dungeon
- Click on map → places entity at that lat/lng
- Entities appear as markers with type-specific icons
- **Dungeon polygon tool**: draw a polygon area, then use DungeonDesignerPanel to generate an interior layout

### Adding a New Placement Mode

1. Add the type to `content/entity-types/<type>.yaml`
2. Add the type to `ScenarioEntityType` union in `packages/shared/src/types.ts`
3. Add a toolbar button in `ScenarioBuilder/MapStep.tsx`
4. Add an icon mapping in `client/src/lib/iconRegistry.ts`

## Dungeon Designer Panel

AI-assisted dungeon creation:
1. Draw a polygon on the scenario map
2. Chat with AI to describe the dungeon
3. AI generates a `DungeonDefinition` (rooms, corridors, features)
4. Preview as ASCII art
5. Confirm to save as a `dungeon` entity

## Leaflet Layer Conventions

- **Tile layer**: OpenStreetMap tiles
- **Marker layers**: one per entity category (party, enemies, NPCs)
- **Polygon layers**: dungeon areas, terrain overlays
- Markers use Leaflet's default icon system with custom colors per entity type
