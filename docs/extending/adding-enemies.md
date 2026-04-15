# Adding Enemy Types

## Quick Start

1. Create `content/enemies/<enemy_id>.yaml`
2. Restart the server — the enemy type is available via `EnemyTypeRegistry`

## YAML Schema

```yaml
id: shambling_corpse       # Unique identifier
name: Shambling Corpse      # Display name
enemy_type: hostile         # hostile | neutral | friendly | poi
icon_type: zombie           # Used by client iconRegistry
hp_max: 25
sdc_max: 30
mdc_max: null               # null if not MDC-based
apm: 2
initiative_bonus: -1
strike_bonus: 1
parry_bonus: 0
dodge_bonus: -2
damage: "2d6"
damage_type: sdc            # sdc | md
abilities: []               # Array of ItemAbility-shaped objects
loot_table:
  - name: Tattered Rags
    weight: 1
    rarity: common
behavior_hints: "Slow movement. Attacks nearest target."
```

## Usage in Scenarios

When building a scenario, the `ScenarioBuilderService` can reference these templates. When a scenario is launched, entities are spawned as `enemies` rows in the database with stats from the template.

## Damage Types

- **SDC** (Structural Damage Capacity): standard damage, depletes SDC pool then HP
- **MD** (Mega Damage): depletes MDC pool if present; if no MDC, 1 MD = 100 SDC

## Abilities

Follow the `ItemAbility` shape from `packages/shared/src/types.ts`. Common ability types: `ranged_attack`, `melee_attack`, `heal`, `spawn_support`, `buff`.

## Registry API

```typescript
import { getEnemyType, listEnemyTypes } from "./services/EnemyTypeRegistry.js";

const zombie = getEnemyType("shambling_corpse");
const allTypes = listEnemyTypes();
```
