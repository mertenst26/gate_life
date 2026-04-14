import { useGame } from '../context/GameContext';
import { useState, useMemo } from 'react';
import { CharacterInspector } from './CharacterInspector';
import type { Combatant } from '@gate-life/shared';
import { PARTY_MAX_SIZE } from '@gate-life/shared';

function PartyMemberCard({ combatant, onClick }: { combatant: Combatant; onClick: () => void }) {
  const hpPercent = (combatant.vitals.hp_current / combatant.vitals.hp_max) * 100;
  const hpColor = hpPercent > 60 ? 'var(--accent-green)' : hpPercent > 30 ? 'var(--accent-amber)' : 'var(--accent-red)';

  return (
    <div className={`party-card panel ${combatant.status === 'dead' ? 'dead' : ''}`} onClick={onClick}>
      <div className="party-card-header">
        <span className="party-name">{combatant.name}</span>
        <span className={`kind-badge ${combatant.kind}`}>
          {combatant.kind === 'agent' ? 'AI' : 'P'}
        </span>
      </div>
      <div className="party-class text-xs text-dim">Dog Boy Lv.{combatant.level}</div>
      <div className="party-hp-bar">
        <div className="hp-fill" style={{ width: `${Math.max(0, hpPercent)}%`, background: hpColor }} />
      </div>
      <div className="party-stats text-xs">
        <span>HP {combatant.vitals.hp_current}/{combatant.vitals.hp_max}</span>
        <span>ISP {combatant.vitals.isp_current}/{combatant.vitals.isp_max}</span>
      </div>
      {combatant.status === 'unconscious' && <div className="status-badge unconscious">UNCONSCIOUS</div>}
      {combatant.status === 'dead' && <div className="status-badge dead-badge">DEAD</div>}
    </div>
  );
}

export function PartyHUD() {
  const { state, actions } = useGame();
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [showSpawn, setShowSpawn] = useState(false);
  const [spawnName, setSpawnName] = useState('');

  /**
   * Campaigns launched from the scenario builder store grid_origin on the campaign row.
   * For those runs, the PARTY column is only for human players — AI Dog Boys belong on the map as scenario actors, not the squad list.
   */
  const gla = state.campaign?.grid_origin_lat;
  const glo = state.campaign?.grid_origin_lng;
  const scenarioAnchored =
    gla != null &&
    glo != null &&
    Number.isFinite(Number(gla)) &&
    Number.isFinite(Number(glo));

  const partyRoster = useMemo(() => {
    if (!scenarioAnchored) return state.party;
    return state.party.filter(c => c.kind === 'human');
  }, [state.party, scenarioAnchored]);

  const allowSpawnAgentCompanion = !scenarioAnchored;

  const emptySlots = PARTY_MAX_SIZE - partyRoster.length;
  const inspectedCombatant = inspecting ? partyRoster.find(c => c.id === inspecting) : null;

  const handleSpawn = () => {
    if (!spawnName.trim()) return;
    actions.spawnAgent(spawnName.trim());
    setSpawnName('');
    setShowSpawn(false);
  };

  return (
    <div className="party-hud">
      <div className="party-header">
        <span className="party-title">PARTY</span>
        <span className="party-count">{partyRoster.length}/{PARTY_MAX_SIZE}</span>
      </div>

      <div className="party-members">
        {partyRoster.map(c => (
          <PartyMemberCard key={c.id} combatant={c} onClick={() => setInspecting(c.id)} />
        ))}
        {Array.from({ length: emptySlots }).map((_, i) => (
          <div
            key={`empty-${i}`}
            className={`party-card empty-slot ${!allowSpawnAgentCompanion ? 'empty-slot-disabled' : ''}`}
            onClick={() => allowSpawnAgentCompanion && setShowSpawn(true)}
            title={!allowSpawnAgentCompanion ? 'Scenario campaigns: only human players appear here; AI units are on the map.' : undefined}
          >
            <span className="empty-label text-dim">+ Empty Slot</span>
          </div>
        ))}
      </div>

      {showSpawn && state.role !== 'spectator' && allowSpawnAgentCompanion && (
        <div className="spawn-dialog panel">
          <div className="spawn-title">Spawn Agent Companion</div>
          <input
            value={spawnName}
            onChange={(e) => setSpawnName(e.target.value)}
            placeholder="Dog Boy name..."
            onKeyDown={(e) => e.key === 'Enter' && handleSpawn()}
          />
          <div className="spawn-actions">
            <button className="btn btn-primary" onClick={handleSpawn}>Spawn</button>
            <button className="btn" onClick={() => setShowSpawn(false)}>Cancel</button>
          </div>
        </div>
      )}

      {inspectedCombatant && (
        <CharacterInspector
          combatant={inspectedCombatant}
          onClose={() => setInspecting(null)}
        />
      )}
    </div>
  );
}
