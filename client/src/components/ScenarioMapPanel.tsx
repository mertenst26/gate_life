import { useEffect, useRef, useState, useCallback } from 'react';
import type { DungeonDefinition, ScenarioEntity } from '@gate-life/shared';

export const DEFAULT_LAT = 39.2508;
export const DEFAULT_LNG = -106.2925;

export type PlacementMode = 'none' | 'start' | 'enemy' | 'npc' | 'friendly' | 'vehicle' | 'poi' | 'dungeon' | 'copy' | 'relocate';

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
  /** Called when the user finishes drawing a dungeon polygon (≥3 vertices). */
  onDungeonPolygonComplete?: (vertices: [number, number][]) => void;
}

function entityColor(type: string): string {
  if (type === 'enemy')    return '#e53935';
  if (type === 'npc')      return '#9c27b0';
  if (type === 'friendly') return '#00c853';
  if (type === 'vehicle')  return '#757575';
  if (type === 'poi')      return '#ffd600';
  if (type === 'dungeon')  return '#ff6d00';
  return '#2196f3';
}

function cursorForMode(mode: PlacementMode): string {
  if (mode === 'none') return 'grab';
  return 'crosshair';
}

const DUNGEON_TILE_COLORS: Record<number, string> = {
  0: 'rgba(20,14,8,0.72)',       // wall — very dark
  1: 'rgba(195,172,130,0.55)',   // floor — parchment
  2: 'rgba(150,132,100,0.55)',   // corridor — dim tan
  3: 'rgba(210,145,30,0.80)',    // door — golden
  4: 'rgba(70,155,210,0.80)',    // stairs/entry — blue
  5: 'rgba(190,60,210,0.80)',    // special — purple
};

const DUNGEON_TILE_NAMES: Record<number, string> = {
  0: 'Wall',
  1: 'Floor',
  2: 'Corridor',
  3: 'Door',
  4: 'Entry / Stairs',
  5: 'Special',
};

function buildDungeonSvg(def: DungeonDefinition): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg') as SVGSVGElement;
  svg.setAttribute('xmlns', ns);
  svg.setAttribute('viewBox', `0 0 ${def.width} ${def.height}`);
  svg.setAttribute('width', String(def.width));
  svg.setAttribute('height', String(def.height));
  // Make the SVG itself non-capturing so individual rects handle events
  svg.style.pointerEvents = 'none';

  // Build room lookup: "row,col" → room name
  const roomAt = new Map<string, string>();
  for (const room of def.rooms ?? []) {
    for (let r = room.row; r < room.row + room.height; r++) {
      for (let c = room.col; c < room.col + room.width; c++) {
        roomAt.set(`${r},${c}`, room.name);
      }
    }
  }

  // Build door lookup: "row,col" → door label
  const doorAt = new Map<string, string>();
  for (const door of def.doors ?? []) {
    doorAt.set(`${door.row},${door.col}`, door.label ?? 'Door');
  }

  for (let r = 0; r < def.height; r++) {
    const row = def.tiles[r];
    if (!row) continue;
    for (let c = 0; c < def.width; c++) {
      const tileVal = row[c] ?? 0;
      const fill = DUNGEON_TILE_COLORS[tileVal] ?? DUNGEON_TILE_COLORS[0];
      const rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('x', String(c));
      rect.setAttribute('y', String(r));
      rect.setAttribute('width', '1');
      rect.setAttribute('height', '1');
      rect.setAttribute('fill', fill);
      rect.setAttribute('stroke', 'rgba(0,0,0,0.15)');
      rect.setAttribute('stroke-width', '0.04');
      rect.style.pointerEvents = 'all';

      // Build the hover label
      const key = `${r},${c}`;
      const tileName = DUNGEON_TILE_NAMES[tileVal] ?? 'Unknown';
      const roomName = roomAt.get(key);
      const doorLabel = doorAt.get(key);
      const isEntry = r === def.entry_row && c === def.entry_col;

      let label = tileName;
      if (tileVal === 3 && doorLabel) label = `Door — ${doorLabel}`;
      else if (roomName) label = `${roomName} — ${tileName}`;
      if (isEntry) label += ' ★ Entry';

      rect.dataset.label = label;
      svg.appendChild(rect);
    }
  }

  // Entry cell highlight ring (non-interactive, on top)
  const entry = document.createElementNS(ns, 'rect');
  entry.setAttribute('x', String(def.entry_col));
  entry.setAttribute('y', String(def.entry_row));
  entry.setAttribute('width', '1');
  entry.setAttribute('height', '1');
  entry.setAttribute('fill', 'none');
  entry.setAttribute('stroke', '#00e5ff');
  entry.setAttribute('stroke-width', '0.12');
  entry.style.pointerEvents = 'none';
  svg.appendChild(entry);
  return svg;
}

function highlightColor(entity: ScenarioEntity, selectedId?: string): { strokeColor: string; fillColor: string; weight: number; fillOpacity: number } {
  const base = entityColor(entity.entity_type);
  const selected = entity.id === selectedId;
  return {
    strokeColor: selected ? '#ffffff' : 'rgba(255,255,255,0.80)',
    fillColor: base,
    weight: selected ? 3 : 2,
    fillOpacity: selected ? 1.0 : 0.88,
  };
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
  onDungeonPolygonComplete,
}: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObj = useRef<import('leaflet').Map | null>(null);
  const markersRef = useRef<Map<string, import('leaflet').Layer>>(new Map());
  const startMarkerRef = useRef<import('leaflet').CircleMarker | null>(null);
  const pendingMarkerRef = useRef<import('leaflet').Marker | null>(null);
  const [loaded, setLoaded] = useState(false);
  /** Reset when fitBoundsKey changes so we fit once per opened scenario. */
  const autoFitDoneRef = useRef(false);

  // Dungeon polygon drawing state
  const [polyVertices, setPolyVertices] = useState<[number, number][]>([]);
  const polyVerticesRef = useRef<[number, number][]>([]);
  const polyPreviewLayersRef = useRef<import('leaflet').Layer[]>([]);
  // Dungeon overlay layers + per-entity cleanup (event listeners, tooltip)
  const dungeonLayersRef = useRef<Map<string, { layers: import('leaflet').Layer[]; cleanup: () => void }>>(new Map());
  // Single shared tooltip div for all dungeon cell hovers
  const dungeonTooltipRef = useRef<HTMLDivElement | null>(null);
  const onDungeonPolygonCompleteRef = useRef(onDungeonPolygonComplete);
  onDungeonPolygonCompleteRef.current = onDungeonPolygonComplete;

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

      L.control.scale({ imperial: true, metric: true, position: 'bottomleft' }).addTo(map);

      map.on('click', (e: any) => {
        if (placementRef.current === 'dungeon') {
          // Add a vertex to the in-progress polygon
          const v: [number, number] = [e.latlng.lat, e.latlng.lng];
          const next = [...polyVerticesRef.current, v];
          polyVerticesRef.current = next;
          setPolyVertices([...next]);
        } else if (placementRef.current !== 'none') {
          onMapClickRef.current(e.latlng.lat, e.latlng.lng);
        }
      });

      // Custom pane for dungeon overlays — below the overlay pane (400) so entity
      // circle markers (also overlayPane, z 400) always render on top.
      map.createPane('dungeonPane');
      const dungeonPaneEl = map.getPane('dungeonPane')!;
      dungeonPaneEl.style.zIndex = '350';
      // Keep pointer events on so SVG rect hover tooltips work; Leaflet map clicks
      // still propagate normally because the dungeon rects use pointer-events:all only.

      // Shared dungeon cell hover tooltip
      const tip = document.createElement('div');
      tip.className = 'dungeon-cell-tooltip';
      tip.style.display = 'none';
      mapRef.current!.appendChild(tip);
      dungeonTooltipRef.current = tip;

      mapObj.current = map;
      setLoaded(true);
    });

    return () => {
      cancelled = true;
      if (mapObj.current) {
        dungeonTooltipRef.current?.remove();
        dungeonTooltipRef.current = null;
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

  // Update cursor style when placement mode changes; clear polygon vertices when leaving dungeon mode
  useEffect(() => {
    if (!mapObj.current) return;
    const container = mapObj.current.getContainer();
    container.style.cursor = cursorForMode(placementMode);
    if (placementMode !== 'dungeon') {
      polyVerticesRef.current = [];
      setPolyVertices([]);
    }
  }, [placementMode]);

  // Re-draw polygon preview whenever vertices change
  useEffect(() => {
    if (!mapObj.current || !L || !loaded) return;
    const map = mapObj.current;
    // Clear previous preview layers
    for (const layer of polyPreviewLayersRef.current) map.removeLayer(layer);
    polyPreviewLayersRef.current = [];
    if (polyVertices.length === 0) return;

    const verts = polyVertices as [number, number][];
    // Vertex dots
    for (const [lat, lng] of verts) {
      const dot = L.circleMarker([lat, lng], {
        radius: 5, color: '#ff6d00', weight: 2, fillColor: '#ff6d00', fillOpacity: 0.9, interactive: false,
      }).addTo(map);
      polyPreviewLayersRef.current.push(dot);
    }
    // Polyline connecting vertices
    if (verts.length >= 2) {
      const line = L.polyline(verts, { color: '#ff6d00', weight: 2, dashArray: '6 4', interactive: false }).addTo(map);
      polyPreviewLayersRef.current.push(line);
    }
    // Closing line when ≥ 3 vertices
    if (verts.length >= 3) {
      const closing = L.polyline([verts[verts.length - 1], verts[0]], {
        color: '#ff6d00', weight: 1.5, dashArray: '3 4', opacity: 0.55, interactive: false,
      }).addTo(map);
      polyPreviewLayersRef.current.push(closing);
    }
  }, [polyVertices, loaded]);

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
      strokeColor: string,
      fillColor: string,
      weight: number,
      fillOpacity: number,
    ) => {
      if (!L) return;
      console.log(`[ScenarioMap] Creating circle marker for "${entity.name}" (${entity.entity_type}) at (${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)})`);
      const marker = L.circleMarker([ll.lat, ll.lng], {
        radius: 10, color: strokeColor, weight,
        fillColor, fillOpacity,
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
      const stroke = selected ? '#ffffff' : 'rgba(255,255,255,0.75)';
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

      const { strokeColor, fillColor, weight, fillOpacity } = highlightColor(entity, selectedEntityId);
      const selected = entity.id === selectedEntityId;

      if (entity.entity_type === 'vehicle') {
        if (m) {
          map.removeLayer(m);
          existing.delete(entity.id);
        }
        addVehicleMarker(entity, pos, selected);
        continue;
      }

      if (entity.entity_type === 'dungeon') continue; // dungeons render as SVG overlays, not markers

      const isCircle = m != null && isCircleMarkerLayer(m, L);

      if (isCircle && m) {
        const circle = m as import('leaflet').CircleMarker;
        const llPrev = circle.getLatLng();
        const cur = { lat: llPrev.lat, lng: llPrev.lng };
        if (!coordsEqual(cur, pos)) {
          console.log(`[ScenarioMap] Relocating marker "${entity.name}" from (${cur.lat.toFixed(5)}, ${cur.lng.toFixed(5)}) to (${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)})`);
          map.removeLayer(m);
          existing.delete(entity.id);
          addCircleMarker(entity, pos, strokeColor, fillColor, weight, fillOpacity);
        } else {
          circle.setStyle({ color: strokeColor, fillColor, weight, fillOpacity });
        }
      } else if (!m) {
        addCircleMarker(entity, pos, strokeColor, fillColor, weight, fillOpacity);
      } else {
        // Stale layer or instanceof mismatch (duplicate Leaflet bundles) — recreate
        map.removeLayer(m);
        existing.delete(entity.id);
        addCircleMarker(entity, pos, strokeColor, fillColor, weight, fillOpacity);
      }
    }
  }, [entities, loaded, selectedEntityId]);

  // Dungeon polygon + grid overlays
  useEffect(() => {
    if (!mapObj.current || !L || !loaded) return;
    const map = mapObj.current;
    const dungeonEntities = entities.filter(e => e.entity_type === 'dungeon');
    const currentIds = new Set(dungeonEntities.map(e => e.id));
    const tip = dungeonTooltipRef.current;

    // Remove overlays for deleted dungeons
    for (const [id, entry] of dungeonLayersRef.current) {
      if (!currentIds.has(id)) {
        for (const l of entry.layers) map.removeLayer(l);
        entry.cleanup();
        dungeonLayersRef.current.delete(id);
      }
    }

    for (const entity of dungeonEntities) {
      const def = entity.definition as Partial<DungeonDefinition>;
      const poly = def.polygon_latlngs;
      if (!poly || poly.length < 3) continue;

      // Remove stale overlay before re-creating
      const existing = dungeonLayersRef.current.get(entity.id);
      if (existing) {
        for (const l of existing.layers) map.removeLayer(l);
        existing.cleanup();
      }

      const layers: import('leaflet').Layer[] = [];
      let svgCleanup = () => {};

      // Polygon border (in dungeonPane so it stays under entity markers)
      const polygonLayer = L.polygon(poly as [number, number][], {
        color: '#ff6d00',
        weight: 2,
        fillColor: '#ff6d00',
        fillOpacity: 0.07,
        dashArray: '6 4',
        interactive: false,
        pane: 'dungeonPane',
      }).addTo(map);
      layers.push(polygonLayer);

      // Grid SVG overlay (also in dungeonPane)
      const tiles = def.tiles;
      if (tiles && Array.isArray(tiles) && tiles.length > 0 && def.width && def.height) {
        const lats = poly.map(p => p[0]);
        const lngs = poly.map(p => p[1]);
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs);
        const maxLng = Math.max(...lngs);
        const bounds = L.latLngBounds([[minLat, minLng], [maxLat, maxLng]]);
        const svgEl = buildDungeonSvg(def as DungeonDefinition);

        // Wire hover tooltip via SVG event delegation
        if (tip) {
          const mapContainer = map.getContainer();

          const onMove = (e: MouseEvent) => {
            const target = e.target as SVGElement | null;
            const label = target?.dataset?.label;
            if (label) {
              const cr = mapContainer.getBoundingClientRect();
              tip.textContent = label;
              tip.style.display = 'block';
              // Keep tooltip inside the container horizontally
              const x = e.clientX - cr.left + 14;
              const y = e.clientY - cr.top - 32;
              tip.style.left = `${Math.min(x, cr.width - 180)}px`;
              tip.style.top = `${Math.max(y, 4)}px`;
            } else {
              tip.style.display = 'none';
            }
          };
          const onLeave = () => { tip.style.display = 'none'; };

          svgEl.addEventListener('mousemove', onMove);
          svgEl.addEventListener('mouseleave', onLeave);
          svgCleanup = () => {
            svgEl.removeEventListener('mousemove', onMove);
            svgEl.removeEventListener('mouseleave', onLeave);
            tip.style.display = 'none';
          };
        }

        const overlay = L.svgOverlay(svgEl, bounds, { interactive: true, opacity: 1, pane: 'dungeonPane' }).addTo(map);
        layers.push(overlay);
      }

      dungeonLayersRef.current.set(entity.id, { layers, cleanup: svgCleanup });
    }
  }, [entities, loaded]);

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

  const handleCloseDungeonPolygon = useCallback(() => {
    const verts = polyVerticesRef.current;
    if (verts.length < 3) return;
    const completed = [...verts] as [number, number][];
    // Clear preview
    if (mapObj.current && L) {
      for (const l of polyPreviewLayersRef.current) mapObj.current.removeLayer(l);
      polyPreviewLayersRef.current = [];
    }
    polyVerticesRef.current = [];
    setPolyVertices([]);
    onDungeonPolygonCompleteRef.current?.(completed);
  }, []);

  const handleCancelDungeonPolygon = useCallback(() => {
    if (mapObj.current && L) {
      for (const l of polyPreviewLayersRef.current) mapObj.current.removeLayer(l);
      polyPreviewLayersRef.current = [];
    }
    polyVerticesRef.current = [];
    setPolyVertices([]);
    // Signal cancellation with empty array (caller should reset mode)
    onDungeonPolygonCompleteRef.current?.([]);
  }, []);

  return (
    <div className="scenario-map-panel">
      <div ref={mapRef} className="scenario-map-container" />
      <div className="scenario-map-legend">
        <span className="legend-dot" style={{ background: '#2196f3' }} /> Start&nbsp;
        <span className="legend-dot" style={{ background: '#e53935' }} /> Enemy&nbsp;
        <span className="legend-dot" style={{ background: '#9c27b0' }} /> NPC&nbsp;
        <span className="legend-dot" style={{ background: '#ff6d00' }} /> Dungeon&nbsp;
        {placementMode !== 'none' && placementMode !== 'dungeon' && (
          <span className="placement-indicator">
            {placementMode === 'copy'
              ? <>Copying — <strong>click map</strong> to stamp</>
              : placementMode === 'relocate'
              ? <>Relocating — <strong>click map</strong> to move here</>
              : <>Placing <strong>{placementMode}</strong> — click map</>
            }
          </span>
        )}
        {placementMode === 'dungeon' && (
          <span className="placement-indicator" style={{ color: '#ff6d00' }}>
            Drawing dungeon — <strong>click</strong> to add vertices ({polyVertices.length})
          </span>
        )}
      </div>
      {placementMode === 'dungeon' && (
        <div className="dungeon-draw-controls">
          <button
            className="btn btn-sm"
            style={{ background: '#ff6d00', color: '#fff' }}
            disabled={polyVertices.length < 3}
            onClick={handleCloseDungeonPolygon}
          >
            Close Polygon ({polyVertices.length} pts)
          </button>
          <button className="btn btn-sm btn-ghost" onClick={handleCancelDungeonPolygon}>
            Cancel
          </button>
        </div>
      )}
      <button className="btn btn-sm scenario-recenter" onClick={handleRecenter}>
        Re-center
      </button>
    </div>
  );
}
