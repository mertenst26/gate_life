import { useEffect, useState } from 'react';

export interface DiceRollEvent {
  dice: string;
  results: number[];
  modifier: number;
  total: number;
  natural: number;
  critical?: boolean;
  fumble?: boolean;
  label?: string;
  gm_only?: boolean;
}

interface Props {
  roll: DiceRollEvent;
  onDismiss: () => void;
}

/** Returns the face character for a d6-style die icon given a value 1-6. */
function dieFace(n: number): string {
  const faces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  return faces[Math.min(n, 6) - 1] ?? '🎲';
}

/** Returns a generic polyhedral die emoji. */
function dieEmoji(dice: string): string {
  if (dice.includes('20')) return '🎲';
  if (dice.includes('12')) return '🔮';
  if (dice.includes('10') || dice.includes('100')) return '💠';
  if (dice.includes('8')) return '🔷';
  if (dice.includes('6')) return '🎲';
  if (dice.includes('4')) return '🔺';
  return '🎲';
}

export function DiceRollWidget({ roll, onDismiss }: Props) {
  const [phase, setPhase] = useState<'rolling' | 'result'>('rolling');

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('result'), 600);
    const t2 = setTimeout(() => onDismiss(), 3200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onDismiss]);

  const isCrit = roll.critical || roll.natural === 20;
  const isFumble = roll.fumble || roll.natural === 1;
  const is100 = roll.dice.includes('100');

  const resultClass = isCrit ? 'dice-crit' : isFumble ? 'dice-fumble' : '';

  return (
    <div className={`dice-roll-overlay ${phase === 'result' ? 'dice-reveal' : ''} ${resultClass}`}>
      <div className="dice-roll-inner">
        {roll.label && (
          <div className="dice-label">{roll.label}</div>
        )}

        <div className={`dice-face-row ${phase === 'rolling' ? 'dice-spinning' : ''}`}>
          {roll.results.map((r, i) => (
            <span key={i} className="dice-face">
              {is100
                ? <span className="dice-number-face">{r}</span>
                : roll.dice.includes('6')
                  ? dieFace(r)
                  : <span className="dice-number-face">{dieEmoji(roll.dice)}{r}</span>
              }
            </span>
          ))}
        </div>

        {phase === 'result' && (
          <div className="dice-result-row">
            <span className="dice-total">{roll.total}</span>
            {roll.modifier !== 0 && (
              <span className="dice-modifier text-dim">
                ({roll.natural} {roll.modifier > 0 ? '+' : ''}{roll.modifier})
              </span>
            )}
            {isCrit && <span className="dice-outcome dice-outcome-crit">CRITICAL!</span>}
            {isFumble && !isCrit && <span className="dice-outcome dice-outcome-fumble">FUMBLE</span>}
          </div>
        )}
      </div>
    </div>
  );
}
