import { useEffect, useRef, useState, useCallback } from 'react';
import type { ScenarioEntity } from '@gate-life/shared';

export const DEFAULT_LAT = 39.2508;
export const DEFAULT_LNG = -106.2925;

export type PlacementMode = 'none' | 'start' | 'enemy' | 'npc' | 'friendly' | 'vehicle' | 'poi' | 'copy' | 'relocate';

export interface PendingPin {
  lat: number;
  lng: number;
  entityType: 'enemy' | 'npc' | 'friendly' | 'vehicle' | 'poi';
}

interface Props {
  startLat: number;
  startLng: number;
  entities: ScenarioEntity[];
  placementMode: PlacementMode;
  selectedEntityId?: string;
  pendingPin?: PendingPin;
  /** When this changes (e.g. scenario id), the map auto-fits to start + all entities once. */
  fitBoundsKey?: string | null;
  onMapClick: (lat: number, lng: number) => void;
  /** Called with the entity ID; the parent resolves the current entity from its own state. */
  onEntityClick?: (entityId: string) => void;
}

function entityColor(type: string): string {
  if (type === 'enemy')    return '#e53935';
  if (type === 'npc')      return '#9c27b0';
  if (type === 'friendly') return '#00c853';
  if (type === 'vehicle')  return '#757575';
  if (type === 'poi')      return '#ffd600';
  return '#2196f3';
}

function cursorForMode(mode: PlacementMode): string {
  if (mode === 'none') return 'grab';
  return 'crosshair';
}

function highlightColor(entity: ScenarioEntity, selectedId?: string): { color: string; weight: number; fillOpacity: number } {
  const base = entityColor(entity.entity_type);
  const selected = entity.id === selectedId;
  return { color: base, weight: selected ? 4 : 2, fillOpacity: selected ? 0.9 : 0.6 };
}

/** API / SQLite may return lat/lng as strings; Leaflet needs numbers. */
function entityLatLng(e: ScenarioEntity): { lat: number; lng: number } | null {
  const lat = Number(e.lat);
  const lng = Number(e.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function coordsEqual(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  eps = 1e-6,
): boolean {
  return Math.abs(a.lat - b.lat) < eps && Math.abs(a.lng - b.lng) < eps;
}

/** True if layer is a circle marker (avoid instanceof across duplicate Leaflet bundles). */
function isCircleMarkerLayer(m: import('leaflet').Layer, leaflet: typeof import('leaflet')): boolean {
  if (m instanceof leaflet.CircleMarker) return true;
  const name = (m as { constructor?: { name?: string } }).constructor?.name;
  return name === 'CircleMarker';
}

let L: typeof import('leaflet') | null = null;

export function ScenarioMapPanel({
  startLat,
  startLng,
  entities,
  placementMode,
  selectedEntityId,
  pendingPin,
  fitBoundsKey,
  onMapClick,
  onEntityClick,
}: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObj = useRef<import('leaflet').Map | null>(null);
  const markersRef = useRef<Map<string, import('leaflet').Layer>>(new Map());
  const startMarkerRef = useRef<import('leaflet').CircleMarker | null>(null);
  const pendingMarkerRef = useRef<import('leaflet').Marker | null>(null);
  const [loaded, setLoaded] = useState(false);
  /** Reset when fitBoundsKey changes so we fit once per opened scenario. */
  const autoFitDoneRef = useRef(false);

  const placementRef = useRef(placementMode);
  placementRef.current = placementMode;

  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;

  const onEntityClickRef = useRef(onEntityClick);
  onEntityClickRef.current = onEntityClick;

  const selectedEntityIdRef = useRef(selectedEntityId);
  selectedEntityIdRef.current = selectedEntityId;

  useEffect(() => {
    let cancelled = false;
    if (mapObj.current) return;

    import('leaflet').then(leaflet => {
      if (cancelled || mapObj.current || !mapRef.current) return;

      L = leaflet;
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({ iconRetinaUrl: '', iconUrl: '', shadowUrl: '' });

      const map = L.map(mapRef.current, {
        center: [startLat, startLng],
        zoom: 13,
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: true,
        doubleClickZoom: false,
      });

      L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        subdomains: 'abc',
        maxNativeZoom: 17,
        maxZoom: 19,
        attribution: '&copy; OpenTopoMap',
        className: 'terrain-topo-tiles',
      }).addTo(map);

      map.on('click', (e: any) => {
        if (placementRef.current !== 'none') {
          onMapClickRef.current(e.latlng.lat, e.latlng.lng);
        }
      });

      mapObj.current = map;
      setLoaded(true);
    });

    return () => {
      cancelled = true;
      if (mapObj.current) {
        mapObj.current.remove();
        mapObj.current = null;
        markersRef.current.clear();
        startMarkerRef.current = null;
        pendingMarkerRef.current = null;
        setLoaded(false);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update cursor style when placement mode changes
  useEffect(() => {
    if (!mapObj.current) return;
    const container = mapObj.current.getContainer();
    container.style.cursor = cursorForMode(placementMode);
  }, [placementMode]);

  // Update start marker
  useEffect(() => {
    if (!mapObj.current || !L || !loaded) return;
    const map = mapObj.current;

    if (startMarkerRef.current) {
      startMarkerRef.current.setLatLng([startLat, startLng]);
    } else {
      startMarkerRef.current = L.circleMarker([startLat, startLng], {
        radius: 8, color: '#2196f3', weight: 3,
        fillColor: '#2196f3', fillOpacity: 0.5,
      }).addTo(map).bindTooltip('Start Point', {
        className: 'map-tooltip', direction: 'top',
      });
    }
  }, [startLat, startLng, loaded]);

  useEffect(() => {
    autoFitDoneRef.current = false;
  }, [fitBoundsKey]);

  // Once per scenario load: zoom to include start point and every placed entity (handles distant POIs, etc.).
  useEffect(() => {
    if (!mapObj.current || !L || !loaded || autoFitDoneRef.current) return;
    if (entities.length === 0) return;
    const map = mapObj.current;
    const pts: [number, number][] = [[startLat, startLng]];
    for (const e of entities) {
      const p = entityLatLng(e);
      if (p) pts.push([p.lat, p.lng]);
    }
    const b = L.latLngBounds(pts);
    map.fitBounds(b, { padding: [44, 44], maxZoom: 15, animate: false });
    autoFitDoneRef.current = true;
  }, [entities, startLat, startLng, loaded, fitBoundsKey]);

  // Update entity markers
  useEffect(() => {
    console.log(`[ScenarioMap] entities effect — count: ${entities.length}, loaded: ${loaded}, mapReady: ${!!mapObj.current}`);
    if (!mapObj.current || !L || !loaded) return;
    const map = mapObj.current;
    const existing = markersRef.current;
    console.log(`[ScenarioMap] markers in DOM: ${existing.size}, entity ids:`, entities.map(e => e.id.slice(0, 8)));
    const currentIds = new Set(entities.map(e => e.id));

    // Remove markers for deleted entities
    for (const [id, m] of existing) {
      if (!currentIds.has(id)) { map.removeLayer(m); existing.delete(id); }
    }

    const addCircleMarker = (
      entity: ScenarioEntity,
      ll: { lat: number; lng: number },
      color: string,
      weight: number,
      fillOpacity: number,
    ) => {
      if (!L) return;
      console.log(`[ScenarioMap] Creating circle marker for "${entity.name}" (${entity.entity_type}) at (${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)})`);
      const marker = L.circleMarker([ll.lat, ll.lng], {
        radius: 10, color, weight,
        fillColor: color, fillOpacity,
      }).addTo(map)
        .bindTooltip(`<b>${entity.name}</b><br/><span style="text-transform:uppercase;font-size:10px">${entity.entity_type}</span>`, {
          className: 'map-tooltip', direction: 'top',
        });

      marker.on('click', (e: any) => {
        e.originalEvent?.stopPropagation();
        console.log(`[ScenarioMap] Marker clicked: "${entity.name}" (${entity.id})`);
        onEntityClickRef.current?.(entity.id);
      });

      existing.set(entity.id, marker);
    };

    const addVehicleMarker = (entity: ScenarioEntity, ll: { lat: number; lng: number }, selected: boolean) => {
      if (!L) return;
      console.log(`[ScenarioMap] Creating vehicle square marker for "${entity.name}" at (${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)})`);
      const edge = selected ? 20 : 18;
      const border = selected ? 3 : 2;
      const fill = '#8a8a8a';
      const stroke = selected ? '#2a2a2a' : '#5a5a5a';
      const icon = L.divIcon({
        className: 'scenario-map-vehicle-marker',
        html: `<div class="scenario-map-vehicle-icon" style="width:${edge}px;height:${edge}px;background:${fill};border:${border}px solid ${stroke};box-sizing:border-box;border-radius:1px"></div>`,
        iconSize: [edge, edge],
        iconAnchor: [edge / 2, edge / 2],
      });
      const marker = L.marker([ll.lat, ll.lng], { icon })
        .addTo(map)
        .bindTooltip(`<b>${entity.name}</b><br/><span style="text-transform:uppercase;font-size:10px">${entity.entity_type}</span>`, {
          className: 'map-tooltip', direction: 'top',
        });

      marker.on('click', (e: any) => {
        e.originalEvent?.stopPropagation();
        console.log(`[ScenarioMap] Marker clicked: "${entity.name}" (${entity.id})`);
        onEntityClickRef.current?.(entity.id);
      });

      existing.set(entity.id, marker);
    };

    for (const entity of entities) {
      const pos = entityLatLng(entity);
      if (!pos) {
        console.warn(`[ScenarioMap] Skip entity "${entity.name}" — invalid lat/lng:`, entity.lat, entity.lng);
        continue;
      }
      let m = existing.get(entity.id);
      if (m && entity.entity_type === 'vehicle' && !(m instanceof L.Marker)) {
        map.removeLayer(m);
        existing.delete(entity.id);
        m = undefined;
      } else if (m && entity.entity_type !== 'vehicle' && m instanceof L.Marker) {
        map.removeLayer(m);
        existing.delete(entity.id);
        m = undefined;
      }

      const { color, weight, fillOpacity } = highlightColor(entity, selectedEntityId);
      const selected = entity.id === selectedEntityId;

      if (entity.entity_type === 'vehicle') {
        if (m) {
          map.removeLayer(m);
          existing.delete(entity.id);
        }
        addVehicleMarker(entity, pos, selected);
        continue;
      }

      const isCircle = m != null && isCircleMarkerLayer(m, L);

      if (isCircle && m) {
        const circle = m as import('leaflet').CircleMarker;
        const llPrev = circle.getLatLng();
        const cur = { lat: llPrev.lat, lng: llPrev.lng };
        if (!coordsEqual(cur, pos)) {
          console.log(`[ScenarioMap] Relocating marker "${entity.name}" from (${cur.lat.toFixed(5)}, ${cur.lng.toFixed(5)}) to (${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)})`);
          map.removeLayer(m);
          existing.delete(entity.id);
          addCircleMarker(entity, pos, color, weight, fillOpacity);
        } else {
          circle.setStyle({ color, weight, fillOpacity });
        }
      } else if (!m) {
        addCircleMarker(entity, pos, color, weight, fillOpacity);
      } else {
        // Stale layer or instanceof mismatch (duplicate Leaflet bundles) — recreate
        map.removeLayer(m);
        existing.delete(entity.id);
        addCircleMarker(entity, pos, color, weight, fillOpacity);
      }
    }
  }, [entities, loaded, selectedEntityId]);

  // Pulsing pending-pin marker shown while EntityChatPanel is open
  useEffect(() => {
    if (!mapObj.current || !L || !loaded) return;
    const map = mapObj.current;

    // Remove previous pending marker
    if (pendingMarkerRef.current) {
      map.removeLayer(pendingMarkerRef.current);
      pendingMarkerRef.current = null;
    }

    if (!pendingPin) return;

    const color = pendingPin.entityType === 'enemy'
      ? '#e74c3c'
      : pendingPin.entityType === 'vehicle'
        ? '#757575'
        : '#3498db';
    const icon = L.divIcon({
      className: '',
      html: `
        <div class="pending-pin-root">
          <div class="pending-pin-ring" style="--pin-color:${color}"></div>
          <div class="pending-pin-ring pending-pin-ring-2" style="--pin-color:${color}"></div>
          <div class="pending-pin-dot" style="background:${color}"></div>
        </div>`,
      iconSize: [48, 48],
      iconAnchor: [24, 24],
    });

    pendingMarkerRef.current = L.marker([pendingPin.lat, pendingPin.lng], {
      icon,
      interactive: false,
      zIndexOffset: 500,
    }).addTo(map);
  }, [pendingPin, loaded]);

  // Re-center map when start position changes
  const handleRecenter = useCallback(() => {
    if (!mapObj.current || !L) return;
    const pts: [number, number][] = [[startLat, startLng]];
    for (const e of entities) {
      const p = entityLatLng(e);
      if (p) pts.push([p.lat, p.lng]);
    }
    if (pts.length === 1) {
      mapObj.current.setView([startLat, startLng], 13, { animate: true });
      return;
    }
    mapObj.current.fitBounds(L!.latLngBounds(pts), { padding: [44, 44], maxZoom: 15, animate: true });
  }, [startLat, startLng, entities]);

  return (
    <div className="scenario-map-panel">
      <div ref={mapRef} className="scenario-map-container" />
      <div className="scenario-map-legend">
        <span className="legend-dot" style={{ background: '#2196f3' }} /> Start&nbsp;
        <span className="legend-dot" style={{ background: '#e53935' }} /> Enemy&nbsp;
        <span className="legend-dot" style={{ background: '#9c27b0' }} /> NPC&nbsp;
        {placementMode !== 'none' && (
          <span className="placement-indicator">
            {placementMode === 'copy'
              ? <>Copying — <strong>click map</strong> to stamp</>
              : placementMode === 'relocate'
              ? <>Relocating — <strong>click map</strong> to move here</>
              : <>Placing <strong>{placementMode}</strong> — click map</>
            }
          </span>
        )}
      </div>
      <button className="btn btn-sm scenario-recenter" onClick={handleRecenter}>
        Re-center
      </button>
    </div>
  );
}
