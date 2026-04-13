import { useEffect, useRef, useState } from 'react';
import { useGame } from '../context/GameContext';
import type { Combatant } from '@gate-life/shared';

const LEADVILLE_LAT = 39.2508;
const LEADVILLE_LNG = -106.2925;
const GRID_DEG_LAT = 3.048 / 111195;
const GRID_DEG_LNG = 3.048 / 86397;

function gridToLatLng(x: number, y: number): [number, number] {
  return [LEADVILLE_LAT + y * GRID_DEG_LAT, LEADVILLE_LNG + x * GRID_DEG_LNG];
}

function zoomForMode(mode: string): number {
  if (mode === 'tactical') return 18;
  if (mode === 'travel') return 12;
  return 14;
}

function partyColor(c: Combatant): string {
  if (c.status === 'dead') return '#555';
  return c.kind === 'agent' ? '#6c3483' : '#2980b9';
}

function initials(name: string): string {
  return name.split(/\s+/).map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase() || '?';
}

let L: typeof import('leaflet') | null = null;

export function MapPanel() {
  const { state } = useGame();
  const mode = state.session?.current_mode ?? 'conversation';

  const mapRef     = useRef<HTMLDivElement>(null);
  const mapObj     = useRef<import('leaflet').Map | null>(null);
  const markers    = useRef<Map<string, import('leaflet').Marker>>(new Map());
  const [collapsed, setCollapsed] = useState(false);
  const [loaded,    setLoaded]    = useState(false);
  const prevMode   = useRef(mode);
  const prevPos    = useRef<Map<string, [number, number]>>(new Map());

  // Init map once — guarded against React StrictMode double-invoke via cancelled flag
  useEffect(() => {
    if (collapsed) return;

    let cancelled = false;

    // If already initialized (e.g. from a previous non-cancelled run), skip
    if (mapObj.current) return;

    import('leaflet').then(leaflet => {
      if (cancelled || mapObj.current || !mapRef.current) return;

      L = leaflet;
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({ iconRetinaUrl: '', iconUrl: '', shadowUrl: '' });

      const map = L.map(mapRef.current, {
        center: [LEADVILLE_LAT, LEADVILLE_LNG],
        zoom: zoomForMode(mode),
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

      L.circleMarker([LEADVILLE_LAT, LEADVILLE_LNG], {
        radius: 5, color: '#d4a057', weight: 2,
        fillColor: '#d4a057', fillOpacity: 0.4,
      }).addTo(map).bindTooltip('Leadville, CO — Start (0,0)', {
        className: 'map-tooltip', direction: 'top',
      });

      mapObj.current = map;
      setLoaded(true);
    });

    return () => {
      cancelled = true;
      if (mapObj.current) {
        mapObj.current.remove();
        mapObj.current = null;
        markers.current.clear();
        setLoaded(false);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed]);

  // Re-center when mode changes (entering/leaving tactical)
  useEffect(() => {
    if (!mapObj.current || !L || !loaded || prevMode.current === mode) return;
    prevMode.current = mode;
    const map = mapObj.current;
    const alive = state.party.filter(c => c.status !== 'dead');
    // Only zoom-to-fit when entering tactical — respect user zoom in other modes
    if (mode === 'tactical') {
      if (alive.length === 1) {
        map.setView(gridToLatLng(alive[0].tactical_x ?? 0, alive[0].tactical_y ?? 0), zoomForMode(mode), { animate: true });
      } else if (alive.length > 1) {
        const pts = alive.map(c => L!.latLng(...gridToLatLng(c.tactical_x ?? 0, c.tactical_y ?? 0)));
        map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: zoomForMode(mode), animate: true });
      }
    }
    prevPos.current.clear();
  }, [mode, loaded, state.party]);

  // Update markers + auto-pan on movement
  useEffect(() => {
    if (!mapObj.current || !L || !loaded) return;
    const map = mapObj.current;
    const existing = markers.current;
    const ids = new Set(state.party.map(c => c.id));

    for (const [id, m] of existing) {
      if (!ids.has(id)) { map.removeLayer(m); existing.delete(id); }
    }

    // Count how many combatants share each grid cell so we can offset markers
    const cellCount = new Map<string, number>();
    const cellIdx   = new Map<string, number>();
    for (const c of state.party) {
      const k = `${c.tactical_x ?? 0},${c.tactical_y ?? 0}`;
      cellIdx.set(c.id, cellCount.get(k) ?? 0);
      cellCount.set(k, (cellCount.get(k) ?? 0) + 1);
    }

    let moved: [number, number] | null = null;
    for (const c of state.party) {
      const stackSize = cellCount.get(`${c.tactical_x ?? 0},${c.tactical_y ?? 0}`) ?? 1;
      const idx       = cellIdx.get(c.id) ?? 0;
      // Spread stacked markers by ~15m (~0.00015 deg) in a circle
      const angle  = stackSize > 1 ? (idx / stackSize) * Math.PI * 2 : 0;
      const spread = stackSize > 1 ? 0.00015 : 0;
      const [baseLat, baseLng] = gridToLatLng(c.tactical_x ?? 0, c.tactical_y ?? 0);
      const lat = baseLat + Math.sin(angle) * spread;
      const lng = baseLng + Math.cos(angle) * spread;
      const color = partyColor(c);
      const label = initials(c.name);
      const v = c.vitals;
      const tip = `<b>${c.name}</b><br/>HP ${v?.hp_current ?? '?'}/${v?.hp_max ?? '?'} · SDC ${v?.sdc_current ?? '?'}/${v?.sdc_max ?? '?'}<br/><span style="color:#888;font-size:10px">(${c.tactical_x ?? 0}, ${c.tactical_y ?? 0})</span>`;

      const icon = L.divIcon({
        className: '',
        html: `<div style="width:26px;height:26px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,0.7);display:flex;align-items:center;justify-content:center;font:bold 10px sans-serif;color:#fff;box-shadow:0 0 8px ${color}88">${label}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });

      if (existing.has(c.id)) {
        const m = existing.get(c.id)!;
        m.setLatLng([lat, lng]);
        m.setIcon(icon);
        m.setTooltipContent(tip);
      } else {
        const m = L.marker([lat, lng], { icon, interactive: false })
          .addTo(map)
          .bindTooltip(tip, { className: 'map-tooltip', direction: 'top', offset: [0, -16] });
        existing.set(c.id, m);
      }

      const cur: [number, number] = [c.tactical_x ?? 0, c.tactical_y ?? 0];
      const prev = prevPos.current.get(c.id);
      if (!prev || prev[0] !== cur[0] || prev[1] !== cur[1]) {
        prevPos.current.set(c.id, cur);
        moved = [lat, lng];
      }
    }

    if (moved) {
      if (mode === 'tactical') {
        // In tactical mode: keep all party members in view, zoom to fit
        const alive = state.party.filter(c => c.status !== 'dead');
        if (alive.length > 1) {
          const pts = alive.map(c => L!.latLng(...gridToLatLng(c.tactical_x ?? 0, c.tactical_y ?? 0)));
          map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: zoomForMode(mode), animate: true });
        } else {
          map.panTo(moved, { animate: true, duration: 0.4 });
        }
      }
      // Outside tactical: leave zoom alone — user controls it manually
    }
  }, [state.party, loaded, mode]);

  return (
    <div className={`map-panel panel ${collapsed ? 'map-panel-collapsed' : ''}`}>
      <div className="map-header" onClick={() => setCollapsed(c => !c)}>
        <span className="map-title">
          <span className="map-icon">◈</span> WORLD MAP
          <span className="map-subtitle text-dim"> — read only</span>
        </span>
        <button className="map-toggle btn" aria-label="toggle map">{collapsed ? '▲' : '▼'}</button>
      </div>

      {!collapsed && (
        <div className="map-container">
          <div ref={mapRef} className="leaflet-container-inner" />
          <div className="map-legend">
            <span className="legend-dot" style={{ background: '#2980b9' }} /> Human&nbsp;
            <span className="legend-dot" style={{ background: '#6c3483' }} /> AI&nbsp;
            <span className="legend-dot" style={{ background: '#d4a057' }} /> Start
          </div>
        </div>
      )}
    </div>
  );
}
