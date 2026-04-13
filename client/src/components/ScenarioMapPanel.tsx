import { useEffect, useRef, useState, useCallback } from 'react';
import type { ScenarioEntity } from '@gate-life/shared';

export const DEFAULT_LAT = 39.2508;
export const DEFAULT_LNG = -106.2925;

export type PlacementMode = 'none' | 'start' | 'enemy' | 'npc' | 'copy' | 'relocate';

export interface PendingPin {
  lat: number;
  lng: number;
  entityType: 'enemy' | 'npc';
}

interface Props {
  startLat: number;
  startLng: number;
  entities: ScenarioEntity[];
  placementMode: PlacementMode;
  selectedEntityId?: string;
  pendingPin?: PendingPin;
  onMapClick: (lat: number, lng: number) => void;
  /** Called with the entity ID; the parent resolves the current entity from its own state. */
  onEntityClick?: (entityId: string) => void;
}

function entityColor(type: string): string {
  if (type === 'enemy') return '#e53935';
  if (type === 'npc') return '#00e676';
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

let L: typeof import('leaflet') | null = null;

export function ScenarioMapPanel({ startLat, startLng, entities, placementMode, selectedEntityId, pendingPin, onMapClick, onEntityClick }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObj = useRef<import('leaflet').Map | null>(null);
  const markersRef = useRef<Map<string, import('leaflet').CircleMarker>>(new Map());
  const startMarkerRef = useRef<import('leaflet').CircleMarker | null>(null);
  const pendingMarkerRef = useRef<import('leaflet').Marker | null>(null);
  const [loaded, setLoaded] = useState(false);

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

    const addMarker = (entity: ScenarioEntity, color: string, weight: number, fillOpacity: number) => {
      if (!L) return;
      console.log(`[ScenarioMap] Creating marker for "${entity.name}" (${entity.entity_type}) at (${entity.lat.toFixed(5)}, ${entity.lng.toFixed(5)})`);
      const marker = L.circleMarker([entity.lat, entity.lng], {
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

    for (const entity of entities) {
      const { color, weight, fillOpacity } = highlightColor(entity, selectedEntityId);
      const m = existing.get(entity.id);

      if (m) {
        const ll = m.getLatLng();
        if (ll.lat !== entity.lat || ll.lng !== entity.lng) {
          // Position changed — remove the stale marker and place a fresh one
          console.log(`[ScenarioMap] Relocating marker "${entity.name}" from (${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}) to (${entity.lat.toFixed(5)}, ${entity.lng.toFixed(5)})`);
          map.removeLayer(m);
          existing.delete(entity.id);
          addMarker(entity, color, weight, fillOpacity);
        } else {
          m.setStyle({ color, weight, fillOpacity });
        }
      } else {
        addMarker(entity, color, weight, fillOpacity);
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

    const color = pendingPin.entityType === 'enemy' ? '#e74c3c' : '#3498db';
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
    if (mapObj.current) {
      mapObj.current.setView([startLat, startLng], 13, { animate: true });
    }
  }, [startLat, startLng]);

  return (
    <div className="scenario-map-panel">
      <div ref={mapRef} className="scenario-map-container" />
      <div className="scenario-map-legend">
        <span className="legend-dot" style={{ background: '#2196f3' }} /> Start&nbsp;
        <span className="legend-dot" style={{ background: '#e53935' }} /> Enemy&nbsp;
        <span className="legend-dot" style={{ background: '#00e676' }} /> NPC&nbsp;
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
