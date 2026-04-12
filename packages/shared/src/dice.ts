export function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

export function rollDice(count: number, sides: number): number[] {
  return Array.from({ length: count }, () => rollDie(sides));
}

export function parseDiceString(dice: string): { count: number; sides: number; modifier: number } {
  const match = dice.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (!match) throw new Error(`Invalid dice string: ${dice}`);
  return {
    count: parseInt(match[1], 10),
    sides: parseInt(match[2], 10),
    modifier: match[3] ? parseInt(match[3], 10) : 0,
  };
}

export interface DiceRollResult {
  dice: string;
  results: number[];
  modifier: number;
  total: number;
  natural: number;
  critical: boolean;
  fumble: boolean;
}

export function roll(dice: string, extraModifier = 0): DiceRollResult {
  const { count, sides, modifier } = parseDiceString(dice);
  const results = rollDice(count, sides);
  const natural = results.reduce((sum, r) => sum + r, 0);
  const total = natural + modifier + extraModifier;
  return {
    dice,
    results,
    modifier: modifier + extraModifier,
    total,
    natural,
    critical: count === 1 && sides === 20 && results[0] === 20,
    fumble: count === 1 && sides === 20 && results[0] === 1,
  };
}

export function rollInitiative(bonus: number): DiceRollResult {
  return roll('1d20', bonus);
}

export function rollStrike(bonus: number): DiceRollResult {
  return roll('1d20', bonus);
}

export function rollDefense(bonus: number): DiceRollResult {
  return roll('1d20', bonus);
}

export function rollDamage(dice: string, bonus: number): DiceRollResult {
  return roll(dice, bonus);
}

export function rollSavePsionics(meBonus: number): { roll: DiceRollResult; success: boolean } {
  const result = roll('1d20', meBonus);
  return { roll: result, success: result.total >= 12 };
}

export function rollPercentile(): number {
  return rollDie(100);
}
