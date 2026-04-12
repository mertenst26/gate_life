import { useState, useEffect } from 'react';

interface DiceAnimationProps {
  dice: string;
  result: number;
  modifier: number;
  total: number;
  critical?: boolean;
  fumble?: boolean;
  onComplete?: () => void;
}

export function DiceAnimation({ dice, result, modifier, total, critical, fumble, onComplete }: DiceAnimationProps) {
  const [phase, setPhase] = useState<'rolling' | 'result'>('rolling');
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    let frame = 0;
    const maxFrames = 15;
    const interval = setInterval(() => {
      frame++;
      setDisplayValue(Math.floor(Math.random() * 20) + 1);
      if (frame >= maxFrames) {
        clearInterval(interval);
        setDisplayValue(result);
        setPhase('result');
        onComplete?.();
      }
    }, 50);
    return () => clearInterval(interval);
  }, [result, onComplete]);

  return (
    <div className={`dice-animation ${phase} ${critical ? 'crit' : ''} ${fumble ? 'fumble' : ''}`}>
      <div className="dice-face">
        <span className="dice-label">{dice}</span>
        <span className={`dice-value ${phase === 'rolling' ? 'rolling-text' : ''}`}>
          {displayValue}
        </span>
      </div>
      {phase === 'result' && modifier !== 0 && (
        <span className="dice-modifier">
          {modifier > 0 ? '+' : ''}{modifier} = {total}
        </span>
      )}
      {critical && <span className="dice-crit">CRITICAL!</span>}
      {fumble && <span className="dice-fumble">FUMBLE!</span>}
    </div>
  );
}
