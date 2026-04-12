import { useGame } from '../context/GameContext';
import { useRef, useEffect, useCallback, useState } from 'react';
import { api } from '../hooks/useApi';
import type { Combatant } from '@gate-life/shared';

const CELL = 44;
const COLS = 21;
const ROWS = 17;
const W = COLS * CELL;
const H = ROWS * CELL;

function maxMove(spd: number) { return Math.round(spd * 5 / 10); }

function tokenColor(c: Combatant) {
  if (c.status === 'dead') return '#444';
  return c.kind === 'agent' ? '#6c3483' : '#2980b9';
}

function initials(name: string) {
  return name.split(/\s+/).map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase() || '?';
}

function gridToCanvas(gx: number, gy: number, ox: number, oy: number) {
  const col = gx - ox;
  const row = (ROWS - 1) - (gy - oy);
  return { x: col * CELL + CELL / 2, y: row * CELL + CELL / 2 };
}

function canvasToGrid(cx: number, cy: number, ox: number, oy: number) {
  const col = Math.floor(cx / CELL);
  const row = Math.floor(cy / CELL);
  return { gx: ox + col, gy: oy + (ROWS - 1 - row) };
}

// ── Terrain types for drawing ──────────────────────────────────────────────
interface TerrainCell {
  x: number;
  y: number;
  terrain_type: string;
  metadata?: Record<string, unknown>;
}

type TerrainMap = Map<string, TerrainCell>;

function cellKey(x: number, y: number) { return `${x},${y}`; }

// ── Draw function ────────────────────────────────────────────────────────────
function draw(
  canvas: HTMLCanvasElement,
  party: Combatant[],
  activeId: string | null,
  selectedId: string | null,
  ox: number,
  oy: number,
  terrain: TerrainMap,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, W, H);

  // ── Cell backgrounds + grid lines + terrain ─────────────────────────────
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const gx = ox + col;
      const gy = oy + (ROWS - 1 - row);
      const px = col * CELL;
      const py = row * CELL;

      const cell = terrain.get(cellKey(gx, gy));

      if (cell?.terrain_type === 'impassable') {
        // Building — clearly visible dark grey-brown fill
        ctx.fillStyle = '#2c1f1f';
        ctx.fillRect(px, py, CELL, CELL);
        // Crosshatch (clipped to cell)
        ctx.save();
        ctx.beginPath();
        ctx.rect(px, py, CELL, CELL);
        ctx.clip();
        ctx.strokeStyle = 'rgba(180,100,80,0.55)';
        ctx.lineWidth = 1;
        for (let d = -CELL; d < CELL * 2; d += 7) {
          ctx.beginPath();
          ctx.moveTo(px + d, py);
          ctx.lineTo(px + d + CELL, py + CELL);
          ctx.stroke();
        }
        ctx.restore();
        // Visible border
        ctx.strokeStyle = '#7a3a2a';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(px + 1, py + 1, CELL - 2, CELL - 2);
      } else if (cell?.metadata?.road) {
        // Road — warm amber tint, clearly distinct from open ground
        ctx.fillStyle = '#1e1c14';
        ctx.fillRect(px, py, CELL, CELL);
        ctx.fillStyle = 'rgba(200,150,60,0.22)';
        ctx.fillRect(px + CELL * 0.15, py + CELL * 0.15, CELL * 0.7, CELL * 0.7);
      } else {
        // Normal open terrain — alternating chequer
        const even = (gx + gy) % 2 === 0;
        ctx.fillStyle = even ? '#111822' : '#0d1520';
        ctx.fillRect(px, py, CELL, CELL);
      }

      // Grid lines
      ctx.strokeStyle = 'rgba(80,120,160,0.18)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(px, py, CELL, CELL);

      // Axis emphasis
      if (gx === 0 || gy === 0) {
        ctx.strokeStyle = 'rgba(100,160,220,0.25)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px, py, CELL, CELL);
      }
    }
  }

  // ── Coordinate ruler ──────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(100,160,220,0.35)';
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  for (let col = 0; col < COLS; col += 2) {
    ctx.fillText(String(ox + col), col * CELL + CELL / 2, CELL - 2);
  }
  ctx.textAlign = 'right';
  for (let row = 0; row < ROWS; row += 2) {
    const gy = oy + (ROWS - 1 - row);
    ctx.fillText(String(gy), CELL - 3, row * CELL + CELL / 2 + 4);
  }

  // ── Movement range highlight ────────────────────────────────────────────
  if (selectedId) {
    const sel = party.find(c => c.id === selectedId);
    if (sel) {
      const range = maxMove(sel.attributes.spd_bipedal);
      const sx = sel.tactical_x ?? 0;
      const sy = sel.tactical_y ?? 0;

      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          const gx = ox + col;
          const gy = oy + (ROWS - 1 - row);
          const dist = Math.sqrt((gx - sx) ** 2 + (gy - sy) ** 2);
          if (dist > 0 && dist <= range) {
            const cell = terrain.get(cellKey(gx, gy));
            const blocked = cell?.terrain_type === 'impassable';
            if (blocked) {
              // Red tint for blocked cells within range
              ctx.fillStyle = 'rgba(192,57,43,0.15)';
            } else {
              ctx.fillStyle = 'rgba(241,196,15,0.10)';
            }
            ctx.fillRect(col * CELL + 1, row * CELL + 1, CELL - 2, CELL - 2);
          }
        }
      }
    }
  }

  // ── Character tokens ──────────────────────────────────────────────────────
  // Pre-compute stacking offsets for combatants sharing the same cell
  const cellCounts = new Map<string, number>();
  const cellIndex  = new Map<string, number>();
  for (const c of party) {
    if (c.status === 'dead') continue;
    const key = `${c.tactical_x ?? 0},${c.tactical_y ?? 0}`;
    cellIndex.set(c.id, cellCounts.get(key) ?? 0);
    cellCounts.set(key, (cellCounts.get(key) ?? 0) + 1);
  }

  for (const c of party) {
    if (c.status === 'dead') continue;
    const gx = c.tactical_x ?? 0;
    const gy = c.tactical_y ?? 0;
    const col = gx - ox;
    const row = (ROWS - 1) - (gy - oy);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) continue;

    const cellKey2 = `${gx},${gy}`;
    const stackSize = cellCounts.get(cellKey2) ?? 1;
    const stackIdx  = cellIndex.get(c.id) ?? 0;

    const base = gridToCanvas(gx, gy, ox, oy);
    // Spread stacked tokens in a small arc around the cell centre
    const angle  = stackSize > 1 ? (stackIdx / stackSize) * Math.PI * 2 : 0;
    const spread = stackSize > 1 ? CELL * 0.22 : 0;
    const cx = base.x + Math.cos(angle) * spread;
    const cy = base.y + Math.sin(angle) * spread;
    const r = CELL * 0.38;
    const isActive = c.id === activeId;
    const isSel    = c.id === selectedId;
    const color    = tokenColor(c);

    if (isActive || isSel) {
      const grad = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r + 10);
      grad.addColorStop(0, isSel ? 'rgba(241,196,15,0.5)' : 'rgba(230,126,34,0.5)');
      grad.addColorStop(1, 'transparent');
      ctx.beginPath();
      ctx.arc(cx, cy, r + 10, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = isSel ? '#f1c40f' : isActive ? '#e67e22' : 'rgba(255,255,255,0.7)';
    ctx.lineWidth   = isSel || isActive ? 2.5 : 1.5;
    ctx.stroke();

    ctx.fillStyle    = '#fff';
    ctx.font         = 'bold 12px sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials(c.name), cx, cy);

    ctx.fillStyle    = 'rgba(220,230,240,0.7)';
    ctx.font         = isActive ? 'bold 9px monospace' : '9px monospace';
    ctx.fillStyle    = isActive ? '#e67e22' : 'rgba(220,230,240,0.7)';
    ctx.textBaseline = 'top';
    ctx.fillText(c.name.slice(0, 8), cx, cy + r + 3);

    // "ACTING" badge above active token
    if (isActive) {
      ctx.fillStyle    = '#e67e22';
      ctx.font         = 'bold 7px monospace';
      ctx.textBaseline = 'bottom';
      ctx.textAlign    = 'center';
      ctx.fillText('◀ ACTING', cx, cy - r - 2);
    }
  }
}

function originForCenter(cx: number, cy: number) {
  return { ox: cx - Math.floor(COLS / 2), oy: cy - Math.floor(ROWS / 2) };
}

// ── Component ──────────────────────────────────────────────────────────────────
export function TacticalBoard({ height }: { height?: number }) {
  const { state, actions } = useGame();
  const turnState = state.session?.turn_state ?? null;
  const myId      = state.myCharacterId;
  const activeId  = turnState?.turn_order[turnState.current_actor_index] ?? null;
  const canMove   = activeId !== null && activeId === myId;

  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const originRef     = useRef({ ox: -10, oy: -8 });
  const partyRef      = useRef(state.party);
  const activeIdRef   = useRef(activeId);
  const myIdRef       = useRef(myId);
  const selectedIdRef = useRef<string | null>(null);
  const sendMoveRef   = useRef(actions.sendTacticalMove);
  const terrainRef    = useRef<TerrainMap>(new Map());

  partyRef.current    = state.party;
  activeIdRef.current = activeId;
  myIdRef.current     = myId;
  sendMoveRef.current = actions.sendTacticalMove;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [moveError,  setMoveError]  = useState<string | null>(null);
  const [hovered,    setHovered]    = useState<{ gx: number; gy: number } | null>(null);
  const [terrainLoaded, setTerrainLoaded] = useState(false);

  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  // ── Fetch terrain from server on mount ────────────────────────────────────
  useEffect(() => {
    const sessionId = state.session?.id;
    if (!sessionId) return;

    const me = state.party.find(c => c.id === myId);
    const cx = me?.tactical_x ?? 0;
    const cy = me?.tactical_y ?? 0;

    api.getTerrain(sessionId, cx, cy, 60).then(result => {
      const map = new Map<string, TerrainCell>();
      for (const tile of result.tiles) {
        map.set(cellKey(tile.x, tile.y), tile);
      }
      terrainRef.current = map;
      setTerrainLoaded(true);
      console.log(`[tactical] Loaded ${result.tiles.length} terrain cells (${result.buildings.length} buildings, ${result.roads.length} roads)`);
    }).catch(err => {
      console.error('[tactical] Failed to load terrain:', err);
      setTerrainLoaded(true); // proceed with empty terrain
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Redraw ────────────────────────────────────────────────────────────────
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { ox, oy } = originRef.current;
    draw(canvas, partyRef.current, activeIdRef.current, selectedIdRef.current, ox, oy, terrainRef.current);
  }, []);

  useEffect(() => { redraw(); }, [state.party, selectedId, activeId, terrainLoaded, redraw]);

  // ── Center on MY character on mount ─────────────────────────────────────
  useEffect(() => {
    const me = state.party.find(c => c.id === myId);
    const target = me ?? (state.party.length > 0 ? state.party[0] : null);
    if (target) {
      const { ox, oy } = originForCenter(target.tactical_x ?? 0, target.tactical_y ?? 0);
      originRef.current = { ox, oy };
      redraw();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Re-center when MY position changes ──────────────────────────────────
  const meX = state.party.find(c => c.id === myId)?.tactical_x;
  const meY = state.party.find(c => c.id === myId)?.tactical_y;
  useEffect(() => {
    const me = state.party.find(c => c.id === myId);
    if (me) {
      const { ox, oy } = originForCenter(me.tactical_x ?? 0, me.tactical_y ?? 0);
      originRef.current = { ox, oy };
      redraw();
    }
  }, [meX, meY, myId, redraw]);

  // ── Pan to show the whole party whenever any combatant moves ─────────────
  // This keeps all party members in view regardless of whose turn it is.
  const partyPositionKey = state.party
    .map(c => `${c.id}:${c.tactical_x ?? 0},${c.tactical_y ?? 0}`)
    .join('|');

  useEffect(() => {
    if (state.party.length === 0) return;
    const alive = state.party.filter(c => c.status !== 'dead');
    if (alive.length === 0) return;

    // Compute centroid of all alive party members
    const sumX = alive.reduce((s, c) => s + (c.tactical_x ?? 0), 0);
    const sumY = alive.reduce((s, c) => s + (c.tactical_y ?? 0), 0);
    const centX = Math.round(sumX / alive.length);
    const centY = Math.round(sumY / alive.length);

    // Check if any member is outside the current viewport
    const { ox, oy } = originRef.current;
    const margin = 2;
    const anyOutside = alive.some(c => {
      const col = (c.tactical_x ?? 0) - ox;
      const row = (ROWS - 1) - ((c.tactical_y ?? 0) - oy);
      return col < margin || col > COLS - margin - 1 || row < margin || row > ROWS - margin - 1;
    });

    if (anyOutside) {
      const { ox: nox, oy: noy } = originForCenter(centX, centY);
      originRef.current = { ox: nox, oy: noy };
      redraw();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyPositionKey, redraw]);

  // Deselect if not your turn
  useEffect(() => {
    if (activeId !== myId) setSelectedId(null);
  }, [activeId, myId]);

  // ── Click handler ────────────────────────────────────────────────────────
  const onClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const { ox, oy } = originRef.current;
    const { gx, gy } = canvasToGrid(px, py, ox, oy);

    const curActiveId = activeIdRef.current;
    const curMyId     = myIdRef.current;
    const curSel      = selectedIdRef.current;
    const party       = partyRef.current;

    console.log(`[click] px=${Math.round(px)},py=${Math.round(py)} → grid(${gx},${gy}) | activeId=${curActiveId?.slice(-4)} myId=${curMyId?.slice(-4)} sel=${curSel?.slice(-4) ?? 'none'}`);

    // Replicate stacking offsets so hit-test matches drawn positions
    const cellCounts2 = new Map<string, number>();
    const cellIndex2  = new Map<string, number>();
    for (const c of party) {
      if (c.status === 'dead') continue;
      const k = `${c.tactical_x ?? 0},${c.tactical_y ?? 0}`;
      cellIndex2.set(c.id, cellCounts2.get(k) ?? 0);
      cellCounts2.set(k, (cellCounts2.get(k) ?? 0) + 1);
    }

    // Hit-test tokens using the same offset math as draw()
    for (const c of party) {
      if (c.status === 'dead') continue;
      const cgx = c.tactical_x ?? 0;
      const cgy = c.tactical_y ?? 0;
      const base = gridToCanvas(cgx, cgy, ox, oy);
      const stackSize = cellCounts2.get(`${cgx},${cgy}`) ?? 1;
      const stackIdx  = cellIndex2.get(c.id) ?? 0;
      const angle  = stackSize > 1 ? (stackIdx / stackSize) * Math.PI * 2 : 0;
      const spread = stackSize > 1 ? CELL * 0.22 : 0;
      const tcx = base.x + Math.cos(angle) * spread;
      const tcy = base.y + Math.sin(angle) * spread;
      const hitRadius = CELL * 0.38 + 4;

      if (Math.hypot(px - tcx, py - tcy) <= hitRadius) {
        console.log(`[click] hit token: ${c.name} (${c.id.slice(-4)}) | isActive=${c.id === curActiveId} isMine=${c.id === curMyId}`);
        if (c.id === curActiveId && c.id === curMyId) {
          setSelectedId(prev => {
            const next = prev === c.id ? null : c.id;
            console.log(`[click] selecting: ${next?.slice(-4) ?? 'none'}`);
            return next;
          });
          setMoveError(null);
        } else {
          const reason = c.id !== curActiveId
            ? `It's ${party.find(p => p.id === curActiveId)?.name ?? 'someone else'}'s turn (active:${curActiveId?.slice(-4)}, me:${curMyId?.slice(-4)})`
            : 'Not your character';
          console.log(`[click] blocked: ${reason}`);
          setMoveError(reason);
          setTimeout(() => setMoveError(null), 3000);
        }
        return;
      }
    }

    // Clicked empty cell — attempt move if a token is selected
    console.log(`[click] cell click → sel=${curSel?.slice(-4) ?? 'none'} canMove=${curActiveId === curMyId}`);
    if (!curSel || curActiveId !== curMyId) {
      if (!curSel) console.log('[click] no token selected — click your token first');
      else console.log(`[click] not your turn (active:${curActiveId?.slice(-4)} me:${curMyId?.slice(-4)})`);
      return;
    }

    const sel = party.find(c => c.id === curSel);
    if (!sel) { console.log('[click] selected combatant not found in party'); return; }

    // Check impassable terrain
    const targetCell = terrainRef.current.get(cellKey(gx, gy));
    if (targetCell?.terrain_type === 'impassable') {
      console.log(`[click] blocked by terrain at (${gx},${gy})`);
      setMoveError('Blocked: building');
      setTimeout(() => setMoveError(null), 3000);
      return;
    }

    const range = maxMove(sel.attributes.spd_bipedal);
    const moveDist = Math.sqrt((gx - (sel.tactical_x ?? 0)) ** 2 + (gy - (sel.tactical_y ?? 0)) ** 2);
    console.log(`[click] move attempt: (${sel.tactical_x},${sel.tactical_y}) → (${gx},${gy}) dist=${moveDist.toFixed(1)} range=${range} spd=${sel.attributes.spd_bipedal}`);

    if (moveDist > range + 0.5) {
      console.log(`[click] too far: ${moveDist.toFixed(1)} > ${range}`);
      setMoveError(`Too far — max ${range} units (${range * 10} ft)`);
      setTimeout(() => setMoveError(null), 3000);
      return;
    }

    console.log(`[click] sending tactical_move to (${gx},${gy})`);
    sendMoveRef.current(gx, gy);
    setSelectedId(null);
    setMoveError(null);
  }, []);

  // ── Hover ────────────────────────────────────────────────────────────────
  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const { ox, oy } = originRef.current;
    const { gx, gy } = canvasToGrid(e.clientX - rect.left, e.clientY - rect.top, ox, oy);
    setHovered({ gx, gy });
  }, []);

  // ── Pan ──────────────────────────────────────────────────────────────────
  const panStart = useRef<{ mx: number; my: number; ox: number; oy: number } | null>(null);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 1 && e.button !== 2) return;
    e.preventDefault();
    panStart.current = { mx: e.clientX, my: e.clientY, ...originRef.current };
  }, []);

  const onMouseMoveForPan = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!panStart.current) return;
    const dx = Math.round((e.clientX - panStart.current.mx) / CELL);
    const dy = Math.round((e.clientY - panStart.current.my) / CELL);
    originRef.current = {
      ox: panStart.current.ox - dx,
      oy: panStart.current.oy + dy,
    };
    redraw();
  }, [redraw]);

  const onMouseUp = useCallback(() => { panStart.current = null; }, []);

  // ── Hover info ──────────────────────────────────────────────────────────
  const hoveredCombatant = hovered
    ? state.party.find(c => (c.tactical_x ?? 0) === hovered.gx && (c.tactical_y ?? 0) === hovered.gy)
    : null;

  const hoveredTerrain = hovered ? terrainRef.current.get(cellKey(hovered.gx, hovered.gy)) : null;

  return (
    <div className="tactical-board panel" style={height !== undefined ? { height } : undefined}>
      <div className="tactical-board-header">
        <span className="tb-title">⚔ TACTICAL GRID</span>
        <span className="tb-subtitle text-dim">1 cell = 10 ft · North = up</span>
        {hoveredCombatant && (
          <span className="tb-hover-info">
            {hoveredCombatant.name} — HP {hoveredCombatant.vitals?.hp_current}/{hoveredCombatant.vitals?.hp_max}
          </span>
        )}
        {hovered && !hoveredCombatant && hoveredTerrain?.terrain_type === 'impassable' && (
          <span className="tb-hover-info" style={{ color: '#c0392b' }}>
            Building{hoveredTerrain.metadata?.name ? ` — ${String(hoveredTerrain.metadata.name)}` : ''} ({hovered.gx}, {hovered.gy})
          </span>
        )}
        {hovered && !hoveredCombatant && !!hoveredTerrain?.metadata?.road && (
          <span className="tb-hover-info" style={{ color: '#d4a057' }}>
            Road ({hovered.gx}, {hovered.gy})
          </span>
        )}
        {hovered && !hoveredCombatant && !hoveredTerrain && (
          <span className="tb-coords text-dim">({hovered.gx}, {hovered.gy})</span>
        )}
        {canMove && (
          <div className="tb-actions">
            {!selectedId
              ? <span className="tb-hint">Click your token to select</span>
              : <span className="tb-hint selected">Click a cell to move · or click token again to deselect</span>
            }
            <button className="btn end-turn-btn" onClick={() => { actions.endTurn(); setSelectedId(null); }}>
              END TURN →
            </button>
          </div>
        )}
        {!canMove && activeId && (
          <span className="tb-hint waiting">
            Waiting for {state.party.find(c => c.id === activeId)?.name ?? 'unknown'}…
          </span>
        )}
      </div>

      {moveError && <div className="tactical-error">{moveError}</div>}

      <div className="tactical-board-canvas-wrap">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="tb-canvas"
          style={{ cursor: selectedId ? 'crosshair' : 'default' }}
          onClick={onClick}
          onMouseMove={(e) => { onMouseMove(e); onMouseMoveForPan(e); }}
          onMouseDown={onMouseDown}
          onMouseUp={onMouseUp}
          onContextMenu={e => e.preventDefault()}
        />
      </div>

      <div className="tactical-debug">
        me:{myId?.slice(-6) ?? 'none'} · active:{activeId?.slice(-6) ?? 'none'} · {canMove ? '✓ my turn' : '✗ not my turn'} · terrain:{terrainRef.current.size}
      </div>
    </div>
  );
}
