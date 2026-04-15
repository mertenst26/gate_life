# Tactical Grid

## Overview

The tactical grid is a canvas-based combat map where each cell = 10 feet. It renders terrain, party tokens, and enemy tokens, and handles movement during tactical mode.

## Coordinate System

- **Grid units**: 1 unit = 10 feet
- **Orientation**: +X = East, +Y = North (from grid origin)
- **Grid origin**: set by campaign's `grid_origin_lat`/`grid_origin_lng`

## Terrain Types

Terrain types are defined in `content/terrain/` as YAML files:

```yaml
id: rubble
name: Rubble
movement_cost: 2.0        # Multiplier on movement (1.0 = normal)
cover: partial             # null | partial | full
elevation: 0               # Height modifier
hazard_effect: null         # null or effect ID
tile_color: "#696969"       # Hex color for canvas rendering
tile_label: "R"             # Single character label on tile
```

To add a new terrain type:
1. Create `content/terrain/<type_id>.yaml`
2. Restart server — available via `TerrainTypeRegistry`

## How Terrain is Generated

`OsmTerrainService` fetches OpenStreetMap data for the grid origin area and rasterizes it into terrain tiles. The tiles are stored in the `tactical_terrain` table.

## Movement Rules

- **SPD × 5 = feet per melee round** (Rifts rules)
- **Max grid units per turn**: `Math.round((SPD × 5) / 10)`
- Movement is validated server-side in `ws/handlers/tactical.ts`
- In tactical mode, only the active actor can move (turn-based)

## Line of Sight (LOS) & Cover

- `TacticalService.ts` handles LOS calculations
- Cover values affect dodge/parry bonuses
- Terrain elevation affects visibility

## Client Rendering

`TacticalBoard/` is split into:
- `useTacticalCanvas.ts` — draws grid, terrain tiles, tokens, handles viewport
- `useTacticalInput.ts` — click/drag handlers, move validation
- `index.tsx` — assembles hooks, manages canvas element

Terrain tiles are drawn using `tile_color` from the registry. Token positions come from `combatant.tactical_x/y` and `enemy.tactical_x/y`.
