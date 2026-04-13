import { useState, useCallback, useEffect } from 'react';
import { api } from '../hooks/useApi';
import { ScenarioMapPanel, DEFAULT_LAT, DEFAULT_LNG, type PlacementMode, type PendingPin } from './ScenarioMapPanel';
import { EntityChatPanel } from './EntityChatPanel';
import { EntityDetailPanel } from './EntityDetailPanel';
import type { ScenarioEntity, GmKind } from '@gate-life/shared';

type Step = 'info' | 'map' | 'review';

interface Props {
  onBack: () => void;
  /** When provided, load this existing scenario and jump straight to the map step. */
  editScenarioId?: string;
}

const GRID_DEG_LAT = 3.048 / 111195;  // degrees-lat per 10ft grid unit
const GRID_DEG_LNG = 3.048 / 86397;   // degrees-lng per 10ft grid unit

function latLngToGrid(lat: number, lng: number, startLat: number, startLng: number): [number, number] {
  return [
    Math.round((lng - startLng) / GRID_DEG_LNG),
    Math.round((lat - startLat) / GRID_DEG_LAT),
  ];
}

/**
 * Returns N lat/lng positions spread in a tight cluster around the centre pin.
 * count=1 → exactly at the pin.
 * count>1 → evenly spaced on a circle; radius grows slightly with count so
 *            markers don't overlap (approx. 4-8 grid units ≈ 40-80 ft).
 */
function clusterPositions(centerLat: number, centerLng: number, count: number): Array<[number, number]> {
  if (count === 1) return [[centerLat, centerLng]];

  // Scale radius with count so entities don't overlap: ~4 grid units base, +1 per 4 extras
  const radiusUnits = 4 + Math.floor((count - 1) / 4);
  const rLat = GRID_DEG_LAT * radiusUnits;
  const rLng = GRID_DEG_LNG * radiusUnits;

  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * 2 * Math.PI;
    return [
      centerLat + Math.cos(angle) * rLat,
      centerLng + Math.sin(angle) * rLng,
    ] as [number, number];
  });
}

export function ScenarioBuilder({ onBack, editScenarioId }: Props) {
  const [step, setStep] = useState<Step>('info');
  const [loadingEdit, setLoadingEdit] = useState(!!editScenarioId);

  // Step 1: basic info
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [gmKind, setGmKind] = useState<GmKind>('agent');
  const [startLat, setStartLat] = useState(DEFAULT_LAT);
  const [startLng, setStartLng] = useState(DEFAULT_LNG);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Step 2: map + entities
  const [scenarioId, setScenarioId] = useState<string | null>(editScenarioId ?? null);
  const [entities, setEntities] = useState<ScenarioEntity[]>([]);

  // Load existing scenario when editing
  useEffect(() => {
    if (!editScenarioId) return;
    console.log('[ScenarioBuilder] Loading existing scenario for edit:', editScenarioId);
    setLoadingEdit(true);
    api.getScenario(editScenarioId).then((raw: any) => {
      console.log(`[ScenarioBuilder] Scenario loaded: "${raw.name}" with ${(raw.entities ?? []).length} entities`);
      setName(raw.name ?? '');
      setDescription(raw.description ?? '');
      setGmKind(raw.gm_kind ?? 'agent');
      setStartLat(raw.start_lat ?? DEFAULT_LAT);
      setStartLng(raw.start_lng ?? DEFAULT_LNG);
      const entities = (raw.entities ?? []).map((e: any) => ({
        ...e,
        definition: typeof e.definition === 'string' ? JSON.parse(e.definition) : e.definition,
      }));
      console.log('[ScenarioBuilder] Entities:', entities.map((e: any) => `${e.name} (${e.entity_type})`));
      setEntities(entities);
      setStep('map');
    }).catch((err: unknown) => {
      console.error('[ScenarioBuilder] Failed to load scenario:', err);
      setInfoError('Failed to load scenario. Please try again.');
    }).finally(() => {
      setLoadingEdit(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editScenarioId]);
  const [placementMode, setPlacementMode] = useState<PlacementMode>('none');

  // Chat context: new entity being defined (or existing one being edited) via AI
  const [chatContext, setChatContext] = useState<{
    entityType: 'enemy' | 'npc';
    lat: number;
    lng: number;
    existingEntity?: ScenarioEntity; // present when editing an existing entity
  } | null>(null);

  // Copy context: entity selected as template for stamping
  const [selectedTemplate, setSelectedTemplate] = useState<ScenarioEntity | null>(null);

  // Debug log whenever selectedTemplate changes
  useEffect(() => {
    if (selectedTemplate) {
      console.log('[ScenarioBuilder] selectedTemplate set →', selectedTemplate.name, selectedTemplate.id);
    } else {
      console.log('[ScenarioBuilder] selectedTemplate cleared');
    }
  }, [selectedTemplate]);

  const [saving, setSaving] = useState(false);

  // ── Step 1 ──

  const handleCreateScenario = useCallback(async () => {
    if (!name.trim()) return;
    setCreating(true);
    setInfoError(null);
    console.log('[ScenarioBuilder] Creating scenario:', { name: name.trim(), gmKind, startLat, startLng });
    try {
      const result = await api.createScenario({
        name: name.trim(),
        description: description.trim() || undefined,
        gm_kind: gmKind,
        start_lat: startLat,
        start_lng: startLng,
      }) as any;
      if (result?.id) {
        console.log('[ScenarioBuilder] Scenario created:', result.id);
        setScenarioId(result.id);
        setStep('map');
      } else {
        console.warn('[ScenarioBuilder] Unexpected response from createScenario:', result);
        setInfoError('Server returned an unexpected response. Please try again.');
      }
    } catch (e: unknown) {
      console.error('[ScenarioBuilder] createScenario failed:', e);
      setInfoError(e instanceof Error ? e.message : 'Failed to create scenario. Is the server running?');
    } finally {
      setCreating(false);
    }
  }, [name, description, gmKind, startLat, startLng]);

  // ── Step 2: map interactions ──

  const toggleMode = useCallback((mode: PlacementMode) => {
    setPlacementMode(prev => {
      const next = prev === mode ? 'none' : mode;
      console.log(`[ScenarioBuilder] Placement mode: ${prev} → ${next}`);
      return next;
    });
    if (mode !== 'copy' && mode !== 'relocate') setSelectedTemplate(null);
    setChatContext(null);
  }, []);

  const handleMapClick = useCallback((lat: number, lng: number) => {
    console.log(`[ScenarioBuilder] Map clicked at (${lat.toFixed(5)}, ${lng.toFixed(5)}) — mode: ${placementMode}`);
    if (placementMode === 'start') {
      console.log('[ScenarioBuilder] Updating start point');
      setStartLat(lat);
      setStartLng(lng);
      if (scenarioId) {
        api.updateScenario(scenarioId, { start_lat: lat, start_lng: lng })
          .then(() => console.log('[ScenarioBuilder] Start point saved'))
          .catch(e => console.error('[ScenarioBuilder] Failed to save start point:', e));
      }
      setPlacementMode('none');
    } else if (placementMode === 'enemy' || placementMode === 'npc') {
      console.log(`[ScenarioBuilder] Opening ${placementMode} chat at (${lat.toFixed(5)}, ${lng.toFixed(5)})`);
      setChatContext({ entityType: placementMode, lat, lng });
      setPlacementMode('none');
    } else if (placementMode === 'copy' && selectedTemplate && scenarioId) {
      const [gridX, gridY] = latLngToGrid(lat, lng, startLat, startLng);
      console.log(`[ScenarioBuilder] Stamping copy of "${selectedTemplate.name}" at (${lat.toFixed(5)}, ${lng.toFixed(5)}) grid=(${gridX},${gridY})`);
      api.saveScenarioEntity(scenarioId, {
        entity_type: selectedTemplate.entity_type,
        lat,
        lng,
        grid_x: gridX,
        grid_y: gridY,
        name: selectedTemplate.name,
        definition: selectedTemplate.definition,
      }).then(result => {
        console.log('[ScenarioBuilder] Copy API result:', JSON.stringify(result));
        if ((result as any)?.id) {
          console.log('[ScenarioBuilder] Copy saved:', (result as any).id);
          setEntities(prev => {
            const next = [...prev, result as ScenarioEntity];
            console.log('[ScenarioBuilder] setEntities after copy — total entities:', next.length, next.map(e => (e as any).id?.slice(0, 8)));
            return next;
          });
        } else {
          console.warn('[ScenarioBuilder] Copy result missing id:', result);
        }
      }).catch(e => console.error('[ScenarioBuilder] Copy save failed:', e));
    } else if (placementMode === 'relocate' && selectedTemplate && scenarioId) {
      const [gridX, gridY] = latLngToGrid(lat, lng, startLat, startLng);
      console.log(`[ScenarioBuilder] Relocating "${selectedTemplate.name}" to (${lat.toFixed(5)}, ${lng.toFixed(5)}) grid=(${gridX},${gridY})`);
      api.updateScenarioEntity(scenarioId, selectedTemplate.id, { lat, lng, grid_x: gridX, grid_y: gridY })
        .then(result => {
        if ((result as any)?.id) {
          const updated = result as ScenarioEntity;
          console.log(`[ScenarioBuilder] Relocate saved for: ${updated.id} new pos: (${updated.lat}, ${updated.lng})`);
          setEntities(prev => prev.map(e => e.id === updated.id ? updated : e));
          setSelectedTemplate(updated);
        }
        })
        .catch(e => console.error('[ScenarioBuilder] Relocate failed:', e));
      setPlacementMode('none');
    } else {
      console.log('[ScenarioBuilder] Map click ignored (no active placement mode)');
    }
  }, [placementMode, scenarioId, selectedTemplate, startLat, startLng]);

  const handleEntityClick = useCallback((entityId: string) => {
    console.log('[ScenarioBuilder] Entity marker clicked:', entityId);
    const entity = entities.find(e => e.id === entityId);
    if (!entity) {
      console.warn('[ScenarioBuilder] Entity not found in state for id:', entityId, '— known ids:', entities.map(e => e.id));
      return;
    }
    console.log(`[ScenarioBuilder] Selected entity: "${entity.name}" (${entity.entity_type})`);
    setSelectedTemplate(entity);
    setPlacementMode('none');
    setChatContext(null);
  }, [entities]);

  const handleEditEntity = useCallback(() => {
    if (!selectedTemplate) return;
    console.log(`[ScenarioBuilder] Opening edit chat for "${selectedTemplate.name}" (${selectedTemplate.id})`);
    setChatContext({
      entityType: selectedTemplate.entity_type,
      lat: selectedTemplate.lat,
      lng: selectedTemplate.lng,
      existingEntity: selectedTemplate,
    });
    setPlacementMode('none');
  }, [selectedTemplate]);

  const handleEntityConfirm = useCallback(async (
    entityName: string,
    definition: Record<string, unknown>,
    count: number,
  ) => {
    if (!scenarioId || !chatContext) return;

    // Edit mode: update the existing entity in place
    if (chatContext.existingEntity) {
      console.log(`[ScenarioBuilder] Saving edits to "${entityName}" (${chatContext.existingEntity.id})`);
      try {
        await api.updateScenarioEntity(scenarioId, chatContext.existingEntity.id, { name: entityName, definition });
        console.log('[ScenarioBuilder] Entity updated successfully');
      } catch (e) {
        console.error('[ScenarioBuilder] updateScenarioEntity failed:', e);
      }
      setEntities(prev => prev.map(e =>
        e.id === chatContext.existingEntity!.id
          ? { ...e, name: entityName, definition }
          : e,
      ));
      setSelectedTemplate(prev =>
        prev?.id === chatContext.existingEntity!.id
          ? { ...prev, name: entityName, definition }
          : prev,
      );
      setChatContext(null);
      return;
    }

    // Create mode: place one or more new entities
    const positions = clusterPositions(chatContext.lat, chatContext.lng, count);
    console.log(`[ScenarioBuilder] Placing ${count}× "${entityName}" (${chatContext.entityType}) — ${positions.length} position(s)`);

    try {
      const saved = await Promise.all(
        positions.map(([lat, lng]) => {
          const [gridX, gridY] = latLngToGrid(lat, lng, startLat, startLng);
          console.log(`[ScenarioBuilder]  → saveScenarioEntity at (${lat.toFixed(5)}, ${lng.toFixed(5)}) grid=(${gridX},${gridY})`);
          return api.saveScenarioEntity(scenarioId, {
            entity_type: chatContext.entityType,
            lat,
            lng,
            grid_x: gridX,
            grid_y: gridY,
            name: entityName,
            definition,
          }) as Promise<ScenarioEntity>;
        }),
      );
      const succeeded = saved.filter(r => (r as any)?.id);
      console.log(`[ScenarioBuilder] ${succeeded.length}/${positions.length} entities saved successfully`, succeeded.map((e: any) => e.id));
      setEntities(prev => [...prev, ...succeeded]);
    } catch (e) {
      console.error('[ScenarioBuilder] saveScenarioEntity failed:', e);
    }
    setChatContext(null);
  }, [scenarioId, chatContext, startLat, startLng]);

  const handleDeleteEntity = useCallback(async (entityId: string) => {
    if (!scenarioId) return;
    console.log('[ScenarioBuilder] Deleting entity:', entityId);
    try {
      await api.deleteScenarioEntity(scenarioId, entityId);
      console.log('[ScenarioBuilder] Entity deleted');
    } catch (e) {
      console.error('[ScenarioBuilder] deleteScenarioEntity failed:', e);
    }
    setEntities(prev => prev.filter(e => e.id !== entityId));
    if (selectedTemplate?.id === entityId) {
      setSelectedTemplate(null);
      setPlacementMode('none');
    }
  }, [scenarioId, selectedTemplate]);

  // ── Step 3 ──

  const handleSave = useCallback(async () => {
    if (!scenarioId) return;
    console.log(`[ScenarioBuilder] Saving scenario "${name}" (${scenarioId}) with ${entities.length} entities`);
    setSaving(true);
    try {
      await api.updateScenario(scenarioId, {
        name: name.trim(),
        description: description.trim() || undefined,
        gm_kind: gmKind,
        start_lat: startLat,
        start_lng: startLng,
      });
      console.log('[ScenarioBuilder] Scenario saved successfully');
      onBack();
    } catch (e) {
      console.error('[ScenarioBuilder] Save failed:', e);
    } finally {
      setSaving(false);
    }
  }, [scenarioId, name, description, gmKind, startLat, startLng, entities, onBack]);

  if (loadingEdit) {
    return (
      <div className="scenario-builder fade-in" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="gm-thinking-dots" style={{ margin: '4rem auto' }}>
          <span /><span /><span />
        </div>
        <p className="text-dim text-sm" style={{ textAlign: 'center' }}>Loading scenario…</p>
      </div>
    );
  }

  return (
    <div className="scenario-builder fade-in">
      {/* Header */}
      <div className="scenario-builder-header">
        <button className="btn" onClick={onBack}>&larr; Back</button>
        <h2 className="scenario-builder-title">
          {editScenarioId
            ? <>SCENARIO<span className="accent"> EDITOR</span></>
            : <>SCENARIO<span className="accent"> BUILDER</span></>}
        </h2>
        <div className="scenario-steps">
          <span className={`scenario-step ${step === 'info' ? 'active' : step === 'map' || step === 'review' ? 'done' : ''}`}>1. Info</span>
          <span className="scenario-step-arrow">&rarr;</span>
          <span className={`scenario-step ${step === 'map' ? 'active' : step === 'review' ? 'done' : ''}`}>2. Map</span>
          <span className="scenario-step-arrow">&rarr;</span>
          <span className={`scenario-step ${step === 'review' ? 'active' : ''}`}>3. Review</span>
        </div>
      </div>

      {/* ── Step 1: Basic Info ── */}
      {step === 'info' && (
        <div className="scenario-info-step fade-in">
          <div className="scenario-form panel">
            <h3>Scenario Details</h3>

            {infoError && (
              <div className="scenario-error">{infoError}</div>
            )}

            <div className="form-group">
              <label className="text-sm">Name</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Ambush at Leadville Pass..."
                onKeyDown={e => e.key === 'Enter' && handleCreateScenario()}
                autoFocus
              />
            </div>
            <div className="form-group">
              <label className="text-sm">Description</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Brief scenario description..."
                rows={3}
              />
            </div>
            <div className="form-group">
              <label className="text-sm">Game Master</label>
              <select value={gmKind} onChange={e => setGmKind(e.target.value as GmKind)}>
                <option value="agent">AI Agent</option>
                <option value="human">Human</option>
              </select>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="text-sm">Start Latitude</label>
                <input
                  type="number"
                  step="0.0001"
                  value={startLat}
                  onChange={e => setStartLat(Number(e.target.value))}
                />
              </div>
              <div className="form-group">
                <label className="text-sm">Start Longitude</label>
                <input
                  type="number"
                  step="0.0001"
                  value={startLng}
                  onChange={e => setStartLng(Number(e.target.value))}
                />
              </div>
            </div>
            <p className="text-xs text-dim">
              You can also click "Set Start" on the map to adjust the starting position interactively.
            </p>
            <div className="dialog-actions">
              <button
                className="btn btn-primary"
                onClick={handleCreateScenario}
                disabled={!name.trim() || creating}
              >
                {creating ? 'Creating...' : 'Continue to Map'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 2: Map Editor ── */}
      {step === 'map' && scenarioId && (
        <div className="scenario-map-step fade-in">
          <div className="scenario-toolbar">
            <div className="toolbar-group">
              <button
                className={`btn btn-sm ${placementMode === 'start' ? 'btn-active' : ''}`}
                onClick={() => toggleMode('start')}
                title="Click map to reposition the scenario start point"
              >
                Set Start
              </button>
              <button
                className={`btn btn-sm ${placementMode === 'enemy' ? 'btn-active' : ''}`}
                onClick={() => toggleMode('enemy')}
                title="Click map to place an enemy and define it via AI"
              >
                + Enemy
              </button>
              <button
                className={`btn btn-sm ${placementMode === 'npc' ? 'btn-active' : ''}`}
                onClick={() => toggleMode('npc')}
                title="Click map to place an NPC and define it via AI"
              >
                + NPC
              </button>
            </div>


            <div className="toolbar-group">
              <span className="text-xs text-dim">
                {entities.length} {entities.length === 1 ? 'entity' : 'entities'} placed
              </span>
              <button className="btn btn-sm btn-primary" onClick={() => setStep('review')}>
                Review & Save
              </button>
            </div>
          </div>

          {/* Hint bar when no mode is active */}
          {placementMode === 'none' && !selectedTemplate && !chatContext && (
            <div className="scenario-hint-bar">
              Select <strong>+ Enemy</strong> or <strong>+ NPC</strong> then click the map to place entities.
              Click an existing marker to copy it.
            </div>
          )}

          <div className="scenario-map-area">
            <ScenarioMapPanel
              startLat={startLat}
              startLng={startLng}
              entities={entities}
              placementMode={placementMode}
              selectedEntityId={selectedTemplate?.id}
              pendingPin={chatContext && !chatContext.existingEntity ? { lat: chatContext.lat, lng: chatContext.lng, entityType: chatContext.entityType } as PendingPin : undefined}
              onMapClick={handleMapClick}
              onEntityClick={handleEntityClick}
            />

            {/* Entity detail panel — shown when an entity is selected and no chat is open */}
            {selectedTemplate && !chatContext && (
              (() => { console.log('[ScenarioBuilder] Rendering EntityDetailPanel for:', selectedTemplate.name); return null; })()
            )}
            {selectedTemplate && !chatContext && (
              <EntityDetailPanel
                entity={selectedTemplate}
                placementMode={placementMode}
                onEdit={handleEditEntity}
                onToggleCopy={() => toggleMode('copy')}
                onToggleRelocate={() => toggleMode('relocate')}
                onClose={() => { setSelectedTemplate(null); setPlacementMode('none'); }}
              />
            )}

            {chatContext && (
              <EntityChatPanel
                scenarioId={scenarioId}
                entityType={chatContext.entityType}
                lat={chatContext.lat}
                lng={chatContext.lng}
                existingEntity={chatContext.existingEntity}
                onConfirm={handleEntityConfirm}
                onCancel={() => setChatContext(null)}
              />
            )}
          </div>
        </div>
      )}

      {/* ── Step 3: Review ── */}
      {step === 'review' && (
        <div className="scenario-review-step fade-in">
          <div className="scenario-review panel">
            <h3>Review Scenario</h3>
            <div className="review-meta">
              <p><strong>Name:</strong> {name}</p>
              {description && <p><strong>Description:</strong> {description}</p>}
              <p><strong>GM:</strong> {gmKind === 'agent' ? 'AI Agent' : 'Human'}</p>
              <p><strong>Start:</strong> ({startLat.toFixed(4)}, {startLng.toFixed(4)})</p>
            </div>

            <h4>Entities ({entities.length})</h4>
            {entities.length === 0 ? (
              <p className="text-sm text-dim">No entities placed yet.</p>
            ) : (
              <div className="entity-list">
                {entities.map(e => (
                  <div key={e.id} className="entity-card panel">
                    <div className="entity-card-info">
                      <span className={`entity-type-badge ${e.entity_type}`}>
                        {e.entity_type.toUpperCase()}
                      </span>
                      <strong>{e.name}</strong>
                      <span className="text-xs text-dim">
                        ({e.lat.toFixed(4)}, {e.lng.toFixed(4)})
                      </span>
                    </div>
                    <button className="btn btn-sm btn-danger" onClick={() => handleDeleteEntity(e.id)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="dialog-actions">
              <button className="btn" onClick={() => setStep('map')}>
                &larr; Back to Map
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save Scenario'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
