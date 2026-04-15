# Adding a Character Class

## Quick Start

1. Create `class_templates/<class_id>.yaml` with the required fields
2. Optionally create `class_templates/<class_id>_creation.yaml` for rolled creation
3. Restart the server — the class appears in `GET /api/state/templates`

## YAML Template Schema

Copy `class_templates/dog_boy.yaml` as a reference. Required top-level fields:

```yaml
id: my_class              # Unique identifier (used as class_id)
name: My Class            # Display name
description: "..."        # Flavor text
attributes:               # Base attribute scores
  iq: 10
  me: 11
  ma: 9
  ps: 12
  pp: 12
  pe: 13
  pb: 7
  spd_bipedal: 22
  spd_quadruped: 0        # 0 if not applicable
base_hp: 13
base_sdc: 40
base_isp: 0               # 0 if no psionics
base_ppe: 0
combat:
  base_apm: 4
  initiative_bonus: 2
  strike_bonus: 0
  parry_bonus: 2
  dodge_bonus: 2
  roll_with_impact_bonus: 0
  damage_bonus: 0
innate_abilities: []
starting_psionic_powers: []
unlockable_psionic_powers: []
skills: ["Speak: American"]
starting_gear: []          # Array of item objects
unique_actions: []
progression:
  hp_per_level: 3
  isp_per_level: 0
  level_table:
    1: { xp: 0 }
    2: { xp: 2000 }
  max_level: 15
personality_presets: []     # Array for AI agent personalities
```

## Optional: Rolled Creation

If you want random breed/mutation rolls (like Dog Boy), create `class_templates/<class_id>_creation.yaml` and add a handler in `CharacterCreationService.ts`:

```typescript
if (classId === "my_class") {
  return rollMyClassCharacter(template);
}
```

Without a creation YAML, `CharacterCreationService` uses the base template attributes with small random variance.

## How It Works

- `ClassTemplateService` loads all `*.yaml` from `class_templates/` at server startup
- `CharacterCreationService.rollCharacter(classId)` dispatches to class-specific logic or uses the generic fallback
- `CharacterService.createCharacter({ classId })` passes the ID through to creation
- The Lobby's class picker reads from `GET /api/state/templates`
