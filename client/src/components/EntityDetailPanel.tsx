import { useState, useRef, useEffect } from 'react';
import type { ScenarioEntity } from '@gate-life/shared';
import type { PlacementMode } from './ScenarioMapPanel';
import { useResizablePanelWidth } from '../hooks/useResizablePanelWidth';

interface Props {
  entity: ScenarioEntity;
  placementMode: PlacementMode;
  onEdit: () => void;
  onToggleCopy: () => void;
  onToggleRelocate: () => void;
  onClose: () => void;
  /** Called when the user edits priorities inline so ScenarioBuilder can persist. */
  onUpdateDefinition?: (definition: Record<string, unknown>) => void;
  /** POI names placed on this scenario — link a priority to reveal that POI when the quest is accepted in play. */
  scenarioPoiNames?: string[];
}

/** Fields we render with dedicated labels + formatting; everything else is shown generically. */
const KNOWN_FIELDS: Record<string, string> = {
  enemy_type:        'Enemy Type',
  class_id:          'Class',
  personality:       'Personality',
  hp_max:            'Hit Points',
  sdc_max:           'SDC',
  mdc_max:           'MDC',
  armor_mdc_max:     'Armor MDC',
  apm:               'Actions / Melee',
  initiative_bonus:  'Initiative',
  strike_bonus:      'Strike',
  parry_bonus:       'Parry',
  dodge_bonus:       'Dodge',
  damage:            'Damage',
  damage_type:       'Damage Type',
  isp_max:           'ISP',
  ppe_max:           'PPE',
};

const ARRAY_FIELDS: Record<string, string> = {
  abilities:       'Abilities',
  psionic_powers:  'Psionic Powers',
  skills:          'Skills',
  loot_table:      'Loot',
  inventory:       'Inventory',
};

/** Keys we never show in the generic overflow section. */
const SKIP_FIELDS = new Set([
  'name', 'priorities', 'priority_mission_pois', ...Object.keys(KNOWN_FIELDS), ...Object.keys(ARRAY_FIELDS),
]);

function toLabel(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function renderValue(val: unknown): string {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

const DETAIL_PANEL_WIDTH_KEY = 'gate-life.panel.entityDetail';

export function EntityDetailPanel({
  entity,
  placementMode,
  onEdit,
  onToggleCopy,
  onToggleRelocate,
  onClose,
  onUpdateDefinition,
  scenarioPoiNames = [],
}: Props) {
  const { width: panelWidth, resizeHandleProps } = useResizablePanelWidth(DETAIL_PANEL_WIDTH_KEY, 320);
  const def = (entity.definition ?? {}) as Record<string, unknown>;
  const isCopying = placementMode === 'copy';
  const isRelocating = placementMode === 'relocate';

  // ── Priorities inline editor ─────────────────────────────────────────────
  const isNpc = entity.entity_type === 'npc';
  const [priorities, setPriorities] = useState<string[]>(
    Array.isArray(def.priorities) ? (def.priorities as string[]) : [],
  );
  const [missionPois, setMissionPois] = useState<(string | null)[]>(() => {
    const pri = Array.isArray(def.priorities) ? (def.priorities as string[]) : [];
    const raw = Array.isArray(def.priority_mission_pois) ? (def.priority_mission_pois as (string | null)[]) : [];
    return pri.map((_, i) => (i < raw.length ? raw[i] ?? null : null));
  });
  const [newPriority, setNewPriority] = useState('');
  const priorityInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const d = (entity.definition ?? {}) as Record<string, unknown>;
    const pri = Array.isArray(d.priorities) ? (d.priorities as string[]) : [];
    const raw = Array.isArray(d.priority_mission_pois) ? (d.priority_mission_pois as (string | null)[]) : [];
    setPriorities(pri);
    setMissionPois(pri.map((_, i) => (i < raw.length ? raw[i] ?? null : null)));
  }, [entity.id, entity.definition]);

  const persistPriorities = (nextPri: string[], nextMp: (string | null)[]) => {
    setPriorities(nextPri);
    setMissionPois(nextMp);
    if (onUpdateDefinition) {
      onUpdateDefinition({
        ...def,
        priorities: nextPri,
        priority_mission_pois: nextPri.map((_, i) => nextMp[i] ?? null),
      });
    }
  };

  const addPriority = () => {
    const trimmed = newPriority.trim();
    if (!trimmed) return;
    persistPriorities([...priorities, trimmed], [...missionPois, null]);
    setNewPriority('');
    priorityInputRef.current?.focus();
  };

  const removePriority = (idx: number) => {
    persistPriorities(
      priorities.filter((_, i) => i !== idx),
      missionPois.filter((_, i) => i !== idx),
    );
  };

  const setMissionPoiAt = (idx: number, poiName: string | null) => {
    const next = missionPois.map((p, i) => (i === idx ? poiName : p));
    while (next.length < priorities.length) next.push(null);
    persistPriorities(priorities, next.slice(0, priorities.length));
  };

  // Collect stat rows (known fields, skip nulls)
  const statRows = Object.entries(KNOWN_FIELDS).filter(([k]) => {
    const v = def[k];
    return v !== undefined && v !== null;
  });

  // Array/list fields
  const listRows = Object.entries(ARRAY_FIELDS).filter(([k]) => {
    const v = def[k];
    return Array.isArray(v) && (v as unknown[]).length > 0;
  });

  // Any extra fields not covered above
  const extraRows = Object.entries(def).filter(([k, v]) =>
    !SKIP_FIELDS.has(k) && v !== undefined && v !== null,
  );

  return (
    <div className="entity-detail-panel panel fade-in" style={{ width: panelWidth }}>
      <div
        className="entity-panel-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize side panel"
        tabIndex={0}
        {...resizeHandleProps}
      />
      {/* Header */}
      <div className="entity-detail-header">
        <div className="entity-detail-title">
          <span className={`entity-type-badge ${entity.entity_type}`}>
            {entity.entity_type.toUpperCase()}
          </span>
          <h3>{entity.name}</h3>
        </div>
        <button className="btn btn-sm" onClick={onClose} title="Close">✕</button>
      </div>

      <div className="entity-detail-body">
        {/* ── Priorities / Missions — NPC only ── */}
        {isNpc && (
          <section className="entity-detail-section entity-priorities-section">
            <h4 className="entity-detail-section-title entity-priorities-title">
              Priorities &amp; Missions
            </h4>
            <p className="entity-priorities-desc text-xs text-dim">
              What this NPC is trying to accomplish. Quest-giver NPCs pursue these goals by assigning them to the players as missions.
              Order is important: the first priority is offered in play before the second, then the third, and so on.
              Completing a mission requires convincing this NPC in play (proof helps); they decide when it counts.
              Optionally link a priority to a POI on this scenario so accepting that mission marks it in yellow on the in-game map.
            </p>
            {priorities.length === 0 && (
              <p className="text-xs text-dim entity-priorities-empty">No priorities set — add at least one to guide scenario flow.</p>
            )}
            <ul className="entity-priorities-list">
              {priorities.map((p, i) => (
                <li key={i} className="entity-priority-item entity-priority-item-with-poi">
                  <span className="entity-priority-bullet">▶</span>
                  <div className="entity-priority-stack">
                    <span className="entity-priority-text">{p}</span>
                    {scenarioPoiNames.length > 0 && (
                      <label className="entity-priority-poi-row text-xs text-dim">
                        <span className="entity-priority-poi-label">Mission map marker</span>
                        <select
                          className="entity-priority-poi-select"
                          value={missionPois[i] ?? ''}
                          onChange={e => setMissionPoiAt(i, e.target.value || null)}
                        >
                          <option value="">— None —</option>
                          {scenarioPoiNames.map(name => (
                            <option key={name} value={name}>{name}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  <button
                    className="entity-priority-remove"
                    title="Remove priority"
                    onClick={() => removePriority(i)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            {priorities.length > 0 && scenarioPoiNames.length === 0 && (
              <p className="text-xs text-dim entity-priorities-empty">Add a + POI on the map to link missions to locations.</p>
            )}
            <div className="entity-priority-add-row">
              <input
                ref={priorityInputRef}
                className="entity-priority-input"
                value={newPriority}
                onChange={e => setNewPriority(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addPriority()}
                placeholder="e.g. Find someone to recover the stolen cargo"
              />
              <button
                className="btn btn-sm"
                onClick={addPriority}
                disabled={!newPriority.trim()}
              >
                Add
              </button>
            </div>
          </section>
        )}

        {/* Core stats */}
        {statRows.length > 0 && (
          <section className="entity-detail-section">
            <h4 className="entity-detail-section-title">Stats</h4>
            <div className="entity-stat-grid">
              {statRows.map(([k, label]) => (
                <div key={k} className="entity-stat-row">
                  <span className="entity-stat-label">{label}</span>
                  <span className="entity-stat-value">{renderValue(def[k])}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* List fields */}
        {listRows.map(([k, label]) => {
          const items = def[k] as unknown[];
          return (
            <section key={k} className="entity-detail-section">
              <h4 className="entity-detail-section-title">{label}</h4>
              <ul className="entity-detail-list">
                {items.map((item, i) => (
                  <li key={i} className="entity-detail-list-item">
                    {typeof item === 'object' ? JSON.stringify(item) : String(item)}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        {/* Extra / custom fields */}
        {extraRows.length > 0 && (
          <section className="entity-detail-section">
            <h4 className="entity-detail-section-title">Additional Info</h4>
            <div className="entity-stat-grid">
              {extraRows.map(([k, v]) => (
                <div key={k} className="entity-stat-row">
                  <span className="entity-stat-label">{toLabel(k)}</span>
                  <span className="entity-stat-value">{renderValue(v)}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Actions */}
      <div className="entity-detail-actions">
        <button className="btn btn-sm" onClick={onEdit}>Edit</button>
        <button
          className={`btn btn-sm ${isRelocating ? 'btn-active' : ''}`}
          onClick={onToggleRelocate}
          title={isRelocating ? 'Cancel relocation' : 'Click the map to move this unit'}
        >
          {isRelocating ? 'Moving… (cancel)' : 'Relocate'}
        </button>
        <button
          className={`btn btn-sm ${isCopying ? 'btn-active' : 'btn-primary'}`}
          onClick={onToggleCopy}
          title={isCopying ? 'Cancel copy mode' : 'Click the map to stamp copies'}
        >
          {isCopying ? 'Copying… (cancel)' : 'Copy to Map'}
        </button>
      </div>
    </div>
  );
}
