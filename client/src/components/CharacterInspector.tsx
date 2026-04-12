import type { Combatant } from '@gate-life/shared';
import { VitalsPanel } from './VitalsPanel';

function StatBar({ label, current, max, color }: { label: string; current: number; max: number; color: string }) {
  const pct = max > 0 ? (current / max) * 100 : 0;
  return (
    <div className="stat-bar-row">
      <span className="stat-label text-xs">{label}</span>
      <div className="stat-bar">
        <div className="stat-fill" style={{ width: `${Math.max(0, pct)}%`, background: color }} />
      </div>
      <span className="stat-value text-xs mono">{current}/{max}</span>
    </div>
  );
}

function NeedGauge({ label, value }: { label: string; value: number }) {
  const color = value > 90 ? 'var(--accent-red)' : value > 70 ? 'var(--accent-amber)' : 'var(--accent-green)';
  return (
    <div className="need-gauge">
      <span className="text-xs">{label}</span>
      <div className="need-bar">
        <div className="need-fill" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="text-xs mono">{value}</span>
    </div>
  );
}

export function CharacterInspector({ combatant, onClose }: { combatant: Combatant; onClose: () => void }) {
  const xpPercent = combatant.xp_next_level > 0
    ? (combatant.xp / combatant.xp_next_level) * 100
    : 0;

  return (
    <div className="inspector-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="inspector panel fade-in">
        <div className="inspector-header">
          <div>
            <h3 className="inspector-name">{combatant.name}</h3>
            <span className="text-sm text-dim">Dog Boy (Psi-Hound) &middot; Level {combatant.level}</span>
          </div>
          <div className="inspector-badges">
            <span className={`kind-badge ${combatant.kind}`}>{combatant.kind === 'agent' ? 'Agent' : 'Player'}</span>
            <button className="btn text-xs" onClick={onClose}>&#x2715;</button>
          </div>
        </div>

        <div className="inspector-body">
          <section className="inspector-section">
            <h4>Vitals</h4>
            <StatBar label="HP" current={combatant.vitals.hp_current} max={combatant.vitals.hp_max} color="var(--accent-red)" />
            <StatBar label="SDC" current={combatant.vitals.sdc_current} max={combatant.vitals.sdc_max} color="var(--accent-amber)" />
            <StatBar label="ISP" current={combatant.vitals.isp_current} max={combatant.vitals.isp_max} color="var(--accent-blue)" />
            <StatBar label="PPE" current={combatant.vitals.ppe_current} max={combatant.vitals.ppe_max} color="var(--accent-purple)" />
            <StatBar label="Armor" current={combatant.vitals.armor_mdc_current} max={combatant.vitals.armor_mdc_max} color="#607d8b" />
          </section>

          <section className="inspector-section">
            <h4>Needs</h4>
            <NeedGauge label="Hunger" value={combatant.needs.hunger} />
            <NeedGauge label="Thirst" value={combatant.needs.thirst} />
            <NeedGauge label="Fatigue" value={combatant.needs.fatigue} />
          </section>

          <section className="inspector-section">
            <h4>Body</h4>
            <div className="body-stats">
              <span className="text-sm">Temp: {combatant.internal_temp.toFixed(1)}&deg;C</span>
              <span className="text-sm">Pulse: {combatant.pulse_bpm} BPM</span>
            </div>
            <VitalsPanel combatantId={combatant.id} />
            {combatant.injuries.length > 0 && (
              <div className="injuries">
                <span className="text-xs text-dim">Injuries:</span>
                {combatant.injuries.map(inj => (
                  <div key={inj.id} className="injury-item text-xs">
                    <span className={`injury-severity ${inj.severity}`}>{inj.severity}</span>
                    <span>{inj.injury_type} ({inj.body_location})</span>
                    {inj.bleeding && <span className="bleeding-indicator">BLEEDING</span>}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="inspector-section">
            <h4>Combat</h4>
            <div className="combat-stats">
              <div className="stat-row"><span>APM</span><span className="mono">{combatant.combat.apm}</span></div>
              <div className="stat-row"><span>Initiative</span><span className="mono">+{combatant.combat.initiative_bonus}</span></div>
              <div className="stat-row"><span>Strike</span><span className="mono">+{combatant.combat.strike_bonus}</span></div>
              <div className="stat-row"><span>Parry</span><span className="mono">+{combatant.combat.parry_bonus}</span></div>
              <div className="stat-row"><span>Dodge</span><span className="mono">+{combatant.combat.dodge_bonus}</span></div>
              <div className="stat-row"><span>Roll w/ Impact</span><span className="mono">+{combatant.combat.roll_with_impact_bonus}</span></div>
            </div>
          </section>

          <section className="inspector-section">
            <h4>Attributes</h4>
            <div className="attributes-grid">
              {Object.entries(combatant.attributes).map(([key, val]) => (
                <div key={key} className="attr-cell">
                  <span className="attr-name text-xs">{key.toUpperCase()}</span>
                  <span className="attr-val mono">{val}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="inspector-section">
            <h4>Inventory</h4>
            <div className="inventory-list">
              {combatant.inventory.map(item => (
                <div key={item.id} className="inventory-item text-sm">
                  <span>{item.name} {item.quantity > 1 ? `(x${item.quantity})` : ''}</span>
                  {item.equipped && <span className="equipped-badge">E</span>}
                  <span className="text-dim">{item.weight}lb</span>
                </div>
              ))}
            </div>
          </section>

          <section className="inspector-section">
            <h4>Psionic Powers</h4>
            <div className="powers-list">
              {combatant.psionic_powers.map(powerId => (
                <div key={powerId} className="power-item text-sm">{powerId.replace(/_/g, ' ')}</div>
              ))}
            </div>
          </section>

          <section className="inspector-section">
            <h4>Progression</h4>
            <div className="xp-bar-area">
              <div className="stat-bar">
                <div className="stat-fill" style={{ width: `${Math.min(100, xpPercent)}%`, background: 'var(--accent-amber)' }} />
              </div>
              <span className="text-xs mono">{combatant.xp} / {combatant.xp_next_level} XP</span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
