# Adding Items

## Quick Start

1. Create `content/items/<item_id>.yaml`
2. Restart the server — the item template is available via `ItemRegistry`

## YAML Schema

```yaml
id: coalition_laser_rifle
name: Coalition CA-3 Laser Rifle
type: weapon_ranged         # weapon_melee | weapon_ranged | armor | consumable | ammo | misc | special
damage: "4d6"               # Dice formula
damage_type: md              # sdc | md
weight: 6
value: 12000
rarity: uncommon             # common | uncommon | rare | legendary
description: "Standard-issue Coalition States laser rifle."
abilities:                   # Optional array of special abilities
  - ability_type: ranged_attack
    name: Fire
    description: "Standard laser shot"
    config:
      range_ft: 1600
      payload_count: 30
```

## Item Types

| Type | Description |
|------|-------------|
| `weapon_melee` | Melee weapon (damage, strike bonus) |
| `weapon_ranged` | Ranged weapon (damage, range, ammo) |
| `armor` | Protective gear (MDC value) |
| `consumable` | Single/limited use items (rations, medkits) |
| `ammo` | Ammunition for ranged weapons |
| `misc` | General items |
| `special` | Items with unique abilities (beacons, artifacts) |

## Abilities

Items can have abilities that are resolved by `ItemAbilityService`. Common types:
- `ranged_attack` — fire a ranged weapon
- `melee_attack` — melee strike
- `heal` — restore HP/SDC
- `spawn_support` — summon allies (config: `unit_count_min`, `unit_count_max`, `unit_type`)
- `buff` — temporary stat boost

## Using in Class Templates

Reference items by their template ID in a class template's `starting_gear`:

```yaml
starting_gear:
  - id: coalition_laser_rifle
    name: Coalition CA-3 Laser Rifle
    type: weapon_ranged
    damage: "4d6"
    damage_type: md
    weight: 6
```

## Registry API

```typescript
import { getItemTemplate, listItemTemplates } from "./services/ItemRegistry.js";
```
