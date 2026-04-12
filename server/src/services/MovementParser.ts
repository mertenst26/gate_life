/**
 * MovementParser — extracts movement intent from natural language chat messages
 * and validates it against character statistics.
 *
 * Grid coordinate system:
 *   (0, 0) = Leadville, CO (campaign start)
 *   +x = East,  -x = West
 *   +y = North, -y = South
 *   1 grid unit = 10 feet
 *
 * Dog Boy bipedal SPD 22, APM 4:
 *   Walk per action : SPD × 5  ÷ APM = 27.5 ft ≈ 3 grid units
 *   Run  per action : SPD × 10 ÷ APM = 55 ft   ≈ 6 grid units
 *   Sprint (quad)   : SPD_q × 10 ÷ APM = 100 ft = 10 grid units
 */

const FEET_PER_GRID = 10;

// Direction → unit vector [dx, dy]
const DIRS: Record<string, [number, number]> = {
  north: [0, 1],   n: [0, 1],
  south: [0, -1],  s: [0, -1],
  east:  [1, 0],   e: [1, 0],
  west:  [-1, 0],  w: [-1, 0],
  northeast: [1, 1],  ne: [1, 1],
  northwest: [-1, 1], nw: [-1, 1],
  southeast: [1, -1], se: [1, -1],
  southwest: [-1, -1], sw: [-1, -1],
  forward: [0, 1],  advance: [0, 1],  charge: [0, 1],
  back: [0, -1], backward: [0, -1], retreat: [0, -1],
};

export type MovePace = 'walk' | 'run' | 'sprint';

export interface ParsedMovement {
  dx: number;
  dy: number;
  distance_grid: number;  // grid units
  distance_ft: number;
  pace: MovePace;
  direction_label: string;
  apm_cost: number;
}

// Max grid units per action by pace (Dog Boy defaults — overridden by stats)
function maxGridPerAction(pace: MovePace, spd_bipedal: number, spd_quadruped: number): number {
  switch (pace) {
    case 'walk':   return Math.ceil((spd_bipedal * 5) / 4 / FEET_PER_GRID);   // ~3
    case 'run':    return Math.ceil((spd_bipedal * 10) / 4 / FEET_PER_GRID);  // ~6
    case 'sprint': return Math.ceil((spd_quadruped * 10) / 4 / FEET_PER_GRID); // 10
  }
}

function apmCost(pace: MovePace): number {
  return pace === 'sprint' ? 2 : 1;
}

// Generous travel defaults outside tactical mode (no turn limits)
const TRAVEL_DEFAULT_GRID: Record<MovePace, number> = {
  walk:   50,   // ~150m — a few minutes on foot
  run:    150,  // ~450m — running for a stretch
  sprint: 300,  // ~900m — full sprint
};

export function parseMovement(
  text: string,
  spd_bipedal = 22,
  spd_quadruped = 40,
  isTactical = false,
): ParsedMovement | null {
  const lower = text.toLowerCase();

  // Detect pace
  let pace: MovePace = 'walk';
  if (/\bsprint|four.leg|quadrupe|all fours\b/i.test(text)) pace = 'sprint';
  else if (/\brun|dash|charge|rush|hurry|fast\b/i.test(text)) pace = 'run';

  // Detect direction
  let dirKey: string | null = null;
  for (const key of Object.keys(DIRS)) {
    const re = new RegExp(`\\b${key}\\b`, 'i');
    if (re.test(text)) { dirKey = key; break; }
  }

  // Also catch combined like "move north-east" or "go SW"
  if (!dirKey) {
    const match = lower.match(/\b(n\.?e|n\.?w|s\.?e|s\.?w)\b/);
    if (match) {
      const m = match[1].replace('.', '');
      const map: Record<string, string> = { ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest' };
      dirKey = map[m] || null;
    }
  }

  // Must have movement intent + direction
  const hasMoveVerb = /\b(move|go|walk|run|dash|sprint|advance|retreat|head|travel|step|push|fall back|charge|rush)\b/i.test(text);
  if (!hasMoveVerb || !dirKey) return null;

  const [ux, uy] = DIRS[dirKey];
  // Normalize diagonal to unit length in grid (keep integer, so diag = 1 each axis)

  // Detect explicit distance in feet or meters
  let distance_ft: number | null = null;
  const feetMatch = text.match(/(\d+)\s*(?:feet|foot|ft)/i);
  const meterMatch = text.match(/(\d+)\s*(?:meters?|m)\b/i);
  const gridMatch = text.match(/(\d+)\s*(?:squares?|grids?|spaces?|tiles?)\b/i);

  if (feetMatch)  distance_ft = parseInt(feetMatch[1]);
  else if (meterMatch) distance_ft = Math.round(parseInt(meterMatch[1]) * 3.281);
  else if (gridMatch)  distance_ft = parseInt(gridMatch[1]) * FEET_PER_GRID;

  let distance_grid: number;
  if (distance_ft !== null) {
    // Explicit distance — always honour exactly; GM narrates APM cost in tactical mode
    distance_grid = Math.max(1, Math.round(distance_ft / FEET_PER_GRID));
    distance_ft = distance_grid * FEET_PER_GRID;
  } else if (isTactical) {
    // Tactical mode, no distance stated: cap to one action's movement
    const actionGrid = maxGridPerAction(pace, spd_bipedal, spd_quadruped);
    distance_grid = actionGrid;
    distance_ft = actionGrid * FEET_PER_GRID;
  } else {
    // Outside tactical: generous travel distance, no turn-based limit
    distance_grid = TRAVEL_DEFAULT_GRID[pace];
    distance_ft = distance_grid * FEET_PER_GRID;
  }

  const dx = ux * distance_grid;
  const dy = uy * distance_grid;

  return {
    dx, dy,
    distance_grid,
    distance_ft,
    pace,
    direction_label: dirKey,
    apm_cost: apmCost(pace),
  };
}
