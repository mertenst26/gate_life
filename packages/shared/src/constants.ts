export const PARTY_MAX_SIZE = 4;
export const MELEE_ROUND_SECONDS = 15;
export const TURN_TIMER_DEFAULT_MS = 60_000;

export const VITAL_SAMPLE_INTERVAL_MS = 1000;
export const VITAL_HISTORY_WINDOW_MS = 30 * 60 * 1000;

export const ISP_RECOVERY_REST_PER_HOUR = 2;
export const ISP_RECOVERY_MEDITATION_PER_HOUR = 6;
export const SAVE_VS_PSIONICS_TARGET = 12;

export const HUNGER_PENALTY_THRESHOLD = 75;
export const HUNGER_SEVERE_THRESHOLD = 90;
export const THIRST_PENALTY_THRESHOLD = 70;
export const THIRST_SEVERE_THRESHOLD = 90;
export const FATIGUE_PENALTY_THRESHOLD = 60;
export const FATIGUE_SEVERE_THRESHOLD = 80;

export const ENCUMBRANCE_TIERS = {
  light: { dodge_penalty: 0, speed_penalty: 0 },
  medium: { dodge_penalty: -1, speed_penalty: -0.1 },
  heavy: { dodge_penalty: -3, speed_penalty: -0.3 },
  overloaded: { dodge_penalty: -5, speed_penalty: -1.0 },
} as const;

export const MDC_TO_SDC_RATIO = 100;

export const MODE_COLORS = {
  charCreate: '#d4a574',
  conversation: '#d4a057',
  tactical: '#c0392b',
  travel: '#2980b9',
  rest: '#6c3483',
} as const;

export const XP_AWARDS = {
  playing_in_character: 50,
  clever_idea: 100,
  quick_thinking_min: 50,
  quick_thinking_max: 100,
  heroic_action_min: 50,
  heroic_action_max: 100,
  defeat_minor_threat_min: 25,
  defeat_minor_threat_max: 50,
  defeat_major_threat_min: 75,
  defeat_major_threat_max: 100,
  defeat_great_menace_min: 150,
  defeat_great_menace_max: 400,
  critical_plan_min: 400,
  critical_plan_max: 1000,
  self_sacrifice_min: 500,
  self_sacrifice_max: 700,
  skill_use: 25,
} as const;

export const NATURAL_CRIT = 20;
export const NATURAL_FUMBLE = 1;
export const STRIKE_HIT_MINIMUM = 5;
