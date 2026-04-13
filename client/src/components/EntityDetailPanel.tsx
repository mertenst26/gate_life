import type { ScenarioEntity } from '@gate-life/shared';
import type { PlacementMode } from './ScenarioMapPanel';

interface Props {
  entity: ScenarioEntity;
  placementMode: PlacementMode;
  onEdit: () => void;
  onToggleCopy: () => void;
  onToggleRelocate: () => void;
  onClose: () => void;
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
  'name', ...Object.keys(KNOWN_FIELDS), ...Object.keys(ARRAY_FIELDS),
]);

function toLabel(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function renderValue(val: unknown): string {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

export function EntityDetailPanel({ entity, placementMode, onEdit, onToggleCopy, onToggleRelocate, onClose }: Props) {
  const def = (entity.definition ?? {}) as Record<string, unknown>;
  const isCopying = placementMode === 'copy';
  const isRelocating = placementMode === 'relocate';

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
    <div className="entity-detail-panel panel fade-in">
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
