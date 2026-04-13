import type { Campaign, WSMessage } from '@gate-life/shared';
import { gameState } from './GameStateService.js';

interface CheckOptions {
  sessionId: string;
  campaignId: string;
  campaign: Campaign | null;
  /** How many turns of movement to roll for (one d100 roll per turn). */
  turns: number;
  broadcast: (msg: WSMessage) => void;
  /** Called when a wandering monster encounter is triggered — allows caller to invoke AI GM narration. */
  onEncounter?: (monsterName: string) => void;
}

/**
 * Picks a random passable edge cell for spawning a wandering monster.
 * Falls back to a hard-coded position if no terrain is loaded yet.
 */
function pickSpawnCell(sessionId: string, party: Array<{ tactical_x?: number; tactical_y?: number }>): { x: number; y: number } {
  const terrain = gameState.getTerrain(sessionId);
  const impassable = new Set(terrain.filter(t => t.terrain_type === 'impassable').map(t => `${t.x},${t.y}`));

  // Compute party centroid to find the map "centre"
  const living = party.filter(c => c.tactical_x != null && c.tactical_y != null);
  const cx = living.length ? Math.round(living.reduce((s, c) => s + (c.tactical_x ?? 0), 0) / living.length) : 0;
  const cy = living.length ? Math.round(living.reduce((s, c) => s + (c.tactical_y ?? 0), 0) / living.length) : 0;

  // Try edge cells in expanding rings from radius 8 outward
  for (let radius = 8; radius <= 20; radius++) {
    const candidates: Array<{ x: number; y: number }> = [];
    for (let i = -radius; i <= radius; i++) {
      for (const [ex, ey] of [
        [cx + i, cy - radius],
        [cx + i, cy + radius],
        [cx - radius, cy + i],
        [cx + radius, cy + i],
      ]) {
        if (!impassable.has(`${ex},${ey}`)) {
          candidates.push({ x: ex, y: ey });
        }
      }
    }
    if (candidates.length > 0) {
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
  }

  // Fallback: somewhere far from centre
  return { x: cx + 12, y: cy + 12 };
}

export async function checkWanderingMonster(opts: CheckOptions): Promise<void> {
  const { sessionId, campaignId, campaign, turns, broadcast } = opts;

  const wmConfig = campaign?.gm_agent_config?.wandering_monster;
  if (!wmConfig?.enabled || !wmConfig.monster_name || wmConfig.encounter_chance <= 0) return;

  const now = new Date().toISOString();
  let triggered = false;

  for (let t = 0; t < turns; t++) {
    const roll = Math.floor(Math.random() * 100) + 1;

    // Broadcast the d100 roll — GM-only visibility handled client-side via gm_only flag
    broadcast({
      type: 'dice_roll',
      payload: {
        dice: 'd100',
        results: [roll],
        modifier: 0,
        total: roll,
        natural: roll,
        label: 'Wandering Monster Check',
        gm_only: true,
      },
      timestamp: now,
    });

    console.log(`[wandering-monster] roll=${roll} vs chance=${wmConfig.encounter_chance}% (turn ${t + 1}/${turns})`);

    if (roll <= wmConfig.encounter_chance && !triggered) {
      triggered = true;

      // Spawn the monster on a passable edge cell
      const party = gameState.getPartyCombatants(campaignId);
      const spawnPos = pickSpawnCell(sessionId, party);

      const def = wmConfig.monster_definition as any;
      const enemy = gameState.createEnemy(sessionId, {
        name: wmConfig.monster_name,
        enemy_type: def?.enemy_type ?? 'wandering_monster',
        hp_max: def?.hp_max ?? 20,
        hp_current: def?.hp_max ?? 20,
        sdc_max: def?.sdc_max ?? 0,
        sdc_current: def?.sdc_max ?? 0,
        mdc_max: def?.mdc_max ?? null,
        mdc_current: def?.mdc_max ?? null,
        apm: def?.apm ?? 2,
        initiative_bonus: def?.initiative_bonus ?? 0,
        strike_bonus: def?.strike_bonus ?? 0,
        parry_bonus: def?.parry_bonus ?? 0,
        dodge_bonus: def?.dodge_bonus ?? 0,
        damage: def?.damage ?? '1d6',
        damage_type: def?.damage_type ?? 'sdc',
        tactical_x: spawnPos.x,
        tactical_y: spawnPos.y,
        abilities: def?.abilities ?? [],
        loot_table: def?.loot_table ?? [],
      });

      console.log(`[wandering-monster] TRIGGERED — spawned ${enemy.name} at (${spawnPos.x},${spawnPos.y})`);

      // Mark wandering monsters as detected immediately — they're announced to the party
      gameState.markEnemyDetected(enemy.id);

      // Broadcast entity update so clients can show it on maps/tactical board
      broadcast({
        type: 'enemy_update',
        payload: { ...enemy, detected: true },
        timestamp: now,
      });

      // Broadcast the wandering_monster_encounter event so clients can show a special UI
      broadcast({
        type: 'wandering_monster_encounter',
        payload: {
          enemy,
          spawn_x: spawnPos.x,
          spawn_y: spawnPos.y,
          roll,
          encounter_chance: wmConfig.encounter_chance,
        },
        timestamp: now,
      });

      // Notify caller so it can trigger AI GM narration (avoids circular import)
      opts.onEncounter?.(wmConfig.monster_name);
    }
  }
}
