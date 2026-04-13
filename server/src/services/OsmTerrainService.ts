import { gameState } from './GameStateService.js';
import type { TacticalTile } from '@gate-life/shared';

// Grid ↔ lat/lng constants (must match client MapPanel / scenario builder)
export const DEFAULT_GRID_ORIGIN_LAT = 39.2508;
export const DEFAULT_GRID_ORIGIN_LNG = -106.2925;
const GRID_DEG_LAT = 3.048 / 111195;
const GRID_DEG_LNG = 3.048 / 86397;

function makeGridConverters(originLat: number, originLng: number) {
  function gridToLatLng(gx: number, gy: number): [number, number] {
    return [originLat + gy * GRID_DEG_LAT, originLng + gx * GRID_DEG_LNG];
  }
  function latLngToGrid(lat: number, lng: number): [number, number] {
    return [
      Math.round((lng - originLng) / GRID_DEG_LNG),
      Math.round((lat - originLat) / GRID_DEG_LAT),
    ];
  }
  return { gridToLatLng, latLngToGrid };
}

/** Shared OSM cache key — one cache bucket per scenario start point */
function sharedTerrainCacheId(originLat: number, originLng: number): string {
  return `__terrain_${originLat.toFixed(5)}_${originLng.toFixed(5)}`;
}

// ── Polygon rasterization (scanline fill) ────────────────────────────────────
// Returns all integer (x,y) cells inside a closed polygon defined by vertices.
function rasterizePolygon(vertices: Array<[number, number]>): Array<[number, number]> {
  if (vertices.length < 3) return [];

  let minY = Infinity, maxY = -Infinity;
  for (const [, y] of vertices) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  minY = Math.floor(minY);
  maxY = Math.ceil(maxY);

  const cells: Array<[number, number]> = [];
  const n = vertices.length;

  for (let scanY = minY; scanY <= maxY; scanY++) {
    const intersections: number[] = [];
    for (let i = 0; i < n; i++) {
      const [x0, y0] = vertices[i];
      const [x1, y1] = vertices[(i + 1) % n];
      if ((y0 <= scanY && y1 > scanY) || (y1 <= scanY && y0 > scanY)) {
        const xIntersect = x0 + (scanY - y0) / (y1 - y0) * (x1 - x0);
        intersections.push(xIntersect);
      }
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      const xStart = Math.ceil(intersections[i]);
      const xEnd = Math.floor(intersections[i + 1]);
      for (let x = xStart; x <= xEnd; x++) {
        cells.push([x, scanY]);
      }
    }
  }
  return cells;
}

// Bresenham-style line rasterization for road centre-lines
function rasterizeLine(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let cx = x0, cy = y0;

  for (;;) {
    cells.push([cx, cy]);
    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; cx += sx; }
    if (e2 < dx)  { err += dx; cy += sy; }
  }
  return cells;
}

// ── Overpass query ───────────────────────────────────────────────────────────
interface OverpassElement {
  type: string;
  id: number;
  nodes?: number[];
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
}

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function queryOverpass(south: number, west: number, north: number, east: number): Promise<OverpassElement[]> {
  const bbox = `${south},${west},${north},${east}`;
  const query = `[out:json][timeout:45];(way["building"](${bbox});way["highway"](${bbox}););out body;>;out skel qt;`;

  console.log(`[osm] Querying Overpass for bbox ${bbox}…`);

  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 50000);

      const response = await fetch(url, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        console.warn(`[osm] ${url} returned ${response.status} — trying next`);
        continue;
      }

      const data = await response.json() as { elements: OverpassElement[] };
      console.log(`[osm] Received ${data.elements.length} elements from ${url}`);
      return data.elements;
    } catch (err) {
      console.warn(`[osm] ${url} failed:`, (err as Error).message, '— trying next');
    }
  }

  console.error('[osm] All Overpass endpoints failed');
  return [];
}

// ── Public interface ─────────────────────────────────────────────────────────
export interface TerrainResult {
  tiles: TacticalTile[];
  buildings: Array<{ gridPoly: Array<[number, number]> }>;
  roads: Array<{ gridLine: Array<[number, number]>; highway: string }>;
}

export async function fetchTerrain(
  sessionId: string,
  centerX: number,
  centerY: number,
  radiusGridUnits = 60,
  originLat: number = DEFAULT_GRID_ORIGIN_LAT,
  originLng: number = DEFAULT_GRID_ORIGIN_LNG,
): Promise<TerrainResult> {
  const { gridToLatLng, latLngToGrid } = makeGridConverters(originLat, originLng);
  const sharedKey = sharedTerrainCacheId(originLat, originLng);

  console.log(`[osm] fetchTerrain session=${sessionId.slice(0, 8)} center=(${centerX},${centerY}) origin=(${originLat},${originLng})`);

  // Invalidate session tile cache if it was built with a different grid origin (or pre-origin-tracking DB rows)
  const sessionRow = gameState.getSession(sessionId);
  let existing = gameState.getTerrain(sessionId);
  const storedLat = sessionRow?.terrain_origin_lat ?? null;
  const storedLng = sessionRow?.terrain_origin_lng ?? null;
  const originMatches =
    storedLat != null && storedLng != null &&
    Math.abs(storedLat - originLat) < 1e-5 && Math.abs(storedLng - originLng) < 1e-5;
  if (existing.length > 0 && !originMatches) {
    console.log(`[osm] Clearing stale terrain for session (stored origin ${storedLat},${storedLng} vs ${originLat},${originLng})`);
    gameState.clearTerrain(sessionId);
    existing = [];
  }

  // 1. Session cache (after validation)
  if (existing.length > 0) {
    return { tiles: existing, buildings: [], roads: [] };
  }

  // 2. Shared cache for this grid origin — reuse across sessions at the same scenario start
  const shared = gameState.getTerrain(sharedKey);
  if (shared.length > 0) {
    console.log(`[osm] Reusing ${shared.length} shared terrain cells for origin (${originLat}, ${originLng})`);
    gameState.setTerrain(sessionId, shared);
    gameState.updateSessionTerrainOrigin(sessionId, originLat, originLng);
    return { tiles: shared, buildings: [], roads: [] };
  }

  // Compute bounding box in lat/lng with a buffer
  const buffer = 20;
  const [southLat, westLng] = gridToLatLng(centerX - radiusGridUnits - buffer, centerY - radiusGridUnits - buffer);
  const [northLat, eastLng] = gridToLatLng(centerX + radiusGridUnits + buffer, centerY + radiusGridUnits + buffer);

  let elements: OverpassElement[];
  try {
    elements = await queryOverpass(southLat, westLng, northLat, eastLng);
  } catch (err) {
    console.error('[osm] Overpass fetch failed:', err);
    return { tiles: [], buildings: [], roads: [] };
  }

  if (elements.length === 0) {
    return { tiles: [], buildings: [], roads: [] };
  }

  // Build node lookup (id → lat/lng)
  const nodeMap = new Map<number, [number, number]>();
  for (const el of elements) {
    if (el.type === 'node' && el.lat !== undefined && el.lon !== undefined) {
      nodeMap.set(el.id, [el.lat, el.lon]);
    }
  }

  const tiles: TacticalTile[] = [];
  const seenCells = new Set<string>();
  const buildings: TerrainResult['buildings'] = [];
  const roads: TerrainResult['roads'] = [];

  for (const el of elements) {
    if (el.type !== 'way' || !el.nodes || !el.tags) continue;

    // Resolve nodes to grid coords
    const gridCoords: Array<[number, number]> = [];
    for (const nid of el.nodes) {
      const ll = nodeMap.get(nid);
      if (!ll) continue;
      gridCoords.push(latLngToGrid(ll[0], ll[1]));
    }
    if (gridCoords.length < 2) continue;

    if (el.tags.building) {
      // Closed polygon → rasterize as impassable
      const cells = rasterizePolygon(gridCoords);
      buildings.push({ gridPoly: gridCoords });

      for (const [x, y] of cells) {
        const key = `${x},${y}`;
        if (seenCells.has(key)) continue;
        seenCells.add(key);
        tiles.push({
          x, y,
          terrain_type: 'impassable',
          cover: 'full',
          elevation: 0,
          revealed: true,
          metadata: { building: true, name: el.tags.name ?? undefined },
        });
      }
    } else if (el.tags.highway) {
      // Open polyline → rasterize as road-marked open terrain
      const highway = el.tags.highway;
      roads.push({ gridLine: gridCoords, highway });

      for (let i = 0; i + 1 < gridCoords.length; i++) {
        const [x0, y0] = gridCoords[i];
        const [x1, y1] = gridCoords[i + 1];
        const lineCells = rasterizeLine(x0, y0, x1, y1);
        for (const [x, y] of lineCells) {
          const key = `${x},${y}`;
          if (seenCells.has(key)) continue;
          seenCells.add(key);
          tiles.push({
            x, y,
            terrain_type: 'open',
            cover: null,
            elevation: 0,
            revealed: true,
            metadata: { road: true, highway },
          });
        }
      }
    }
  }

  console.log(`[osm] Rasterized ${buildings.length} buildings, ${roads.length} roads → ${tiles.length} terrain cells`);

  // Write to both this session and the origin-scoped shared cache
  if (tiles.length > 0) {
    gameState.setTerrain(sessionId, tiles);
    gameState.setTerrain(sharedKey, tiles);
    gameState.updateSessionTerrainOrigin(sessionId, originLat, originLng);
  }

  return { tiles, buildings, roads };
}
