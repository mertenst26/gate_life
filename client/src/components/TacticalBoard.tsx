import { useGame } from '../context/GameContext';
import { useRef, useEffect, useCallback, useState } from 'react';
import type { Combatant } from '@gate-life/shared';

const CELL = 44;          // pixels per grid cell
const COLS = 21;          // visible columns
const ROWS = 17;          // visible rows
const W = COLS * CELL;
const H = ROWS * CELL;

// Rifts: SPD × 5 ft per melee round; 1 grid unit = 10 ft
function maxMove(spd: number) { return Math.round(spd * 5 / 10); }

function tokenColor(c: Combatant) {
  if (c.status === 'dead') return '#444';
  return c.kind === 'agent' ? '#6c3483' : '#2980b9';
}

function initials(name: string) {
  return name.split(/\s+/).map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase() || '?';
}

// Grid (gx, gy) → canvas pixel centre of that cell, given viewport origin
// Y is flipped: higher gy = further up on screen (north = up)
function gridToCanvas(gx: number, gy: number, ox: number, oy: number) {
  const col = gx - ox;
  const row = (ROWS - 1) - (gy - oy);
  return { x: col * CELL + CELL / 2, y: row * CELL + CELL / 2 };
}

// Canvas pixel → grid coordinate
function canvasToGrid(cx: number, cy: number, ox: number, oy: number) {
  const col = Math.floor(cx / CELL);
  const row = Math.floor(cy / CELL);
  return {
    gx: ox + col,
    gy: oy + (ROWS - 1 - row),
  };
}

function draw(
  canvas: HTMLCanvasElement,
  party: Combatant[],
  activeId: string | null,
  selectedId: string | null,
  ox: number,
  oy: number,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, W, H);

  // ── Cell backgrounds + grid lines ──────────────────────────────────────
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const gx = ox + col;
      const gy = oy + (ROWS - 1 - row);

      // Alternating subtle chequer
      const even = (gx + gy) % 2 === 0;
      ctx.fillStyle = even ? '#111822' : '#0d1520';
      ctx.fillRect(col * CELL, row * CELL, CELL, CELL);

      ctx.strokeStyle = 'rgba(80,120,160,0.18)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(col * CELL, row * CELL, CELL, CELL);

      // Axis labels on grid line 0
      if (gx === 0 || gy === 0) {
        ctx.strokeStyle = 'rgba(100,160,220,0.25)';
        ctx.lineWidth = 1;
        ctx.strokeRect(col * CELL, row * CELL, CELL, CELL);
      }
    }
  }

  // ── Coordinate ruler labels ─────────────────────────────────────────────
  ctx.fillStyle = 'rgba(100,160,220,0.35)';
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  for (let col = 0; col < COLS; col += 2) {
    const gx = ox + col;
    ctx.fillText(String(gx), col * CELL + CELL / 2, CELL - 2);
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
            ctx.fillStyle = 'rgba(241,196,15,0.10)';
            ctx.fillRect(col * CELL + 1, row * CELL + 1, CELL - 2, CELL - 2);
            if (dist === range) {
              ctx.strokeStyle = 'rgba(241,196,15,0.35)';
              ctx.lineWidth = 0.5;
              ctx.strokeRect(col * CELL + 1, row * CELL + 1, CELL - 2, CELL - 2);
            }
          }
        }
      }
    }
  }

  // ── Character tokens ────────────────────────────────────────────────────
  for (const c of party) {
    if (c.status === 'dead') continue;
    const gx = c.tactical_x ?? 0;
    const gy = c.tactical_y ?? 0;
    const col = gx - ox;
    const row = (ROWS - 1) - (gy - oy);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) continue;

    const { x: cx, y: cy } = gridToCanvas(gx, gy, ox, oy);
    const r = CELL * 0.38;
    const isActive = c.id === activeId;
    const isSel    = c.id === selectedId;
    const color    = tokenColor(c);

    // Glow
    if (isActive || isSel) {
      const grad = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r + 10);
      grad.addColorStop(0, isSel ? 'rgba(241,196,15,0.5)' : 'rgba(230,126,34,0.5)');
      grad.addColorStop(1, 'transparent');
      ctx.beginPath();
      ctx.arc(cx, cy, r + 10, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // Fill
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // Border
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = isSel ? '#f1c40f' : isActive ? '#e67e22' : 'rgba(255,255,255,0.7)';
    ctx.lineWidth   = isSel || isActive ? 2.5 : 1.5;
    ctx.stroke();

    // Initials
    ctx.fillStyle    = '#fff';
    ctx.font         = `bold 12px sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials(c.name), cx, cy);

    // Name label
    ctx.fillStyle    = 'rgba(220,230,240,0.7)';
    ctx.font         = '9px monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(c.name.slice(0, 8), cx, cy + r + 3);
  }
}

// Center viewport on the centroid of alive party members
function centroid(party: Combatant[]) {
  const alive = party.filter(c => c.status !== 'dead');
  if (!alive.length) return { x: 0, y: 0 };
  const sx = alive.reduce((s, c) => s + (c.tactical_x ?? 0), 0) / alive.length;
  const sy = alive.reduce((s, c) => s + (c.tactical_y ?? 0), 0) / alive.length;
  return { x: Math.round(sx), y: Math.round(sy) };
}

function originForCenter(cx: number, cy: number) {
  return { ox: cx - Math.floor(COLS / 2), oy: cy - Math.floor(ROWS / 2) };
}

export function TacticalBoard() {
  const { state, actions } = useGame();
  const turnState = state.session?.turn_state ?? null;
  const myId      = state.myCharacterId;
  const activeId  = turnState?.turn_order[turnState.current_actor_index] ?? null;
  const canMove   = activeId !== null && activeId === myId;

  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const originRef    = useRef({ ox: -10, oy: -8 });
  const partyRef     = useRef(state.party);
  const activeIdRef  = useRef(activeId);
  const myIdRef      = useRef(myId);
  const selectedIdRef = useRef<string | null>(null);
  const sendMoveRef  = useRef(actions.sendTacticalMove);

  partyRef.current   = state.party;
  activeIdRef.current = activeId;
  myIdRef.current    = myId;
  sendMoveRef.current = actions.sendTacticalMove;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [moveError, setMoveError]   = useState<string | null>(null);
  const [hovered, setHovered]       = useState<{ gx: number; gy: number } | null>(null);

  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  // ── Redraw ──────────────────────────────────────────────────────────────
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { ox, oy } = originRef.current;
    draw(canvas, partyRef.current, activeIdRef.current, selectedIdRef.current, ox, oy);
  }, []);

  useEffect(() => { redraw(); }, [state.party, selectedId, activeId, redraw]);

  // ── Center viewport on party when party changes significantly ─────────
  useEffect(() => {
    const c = centroid(state.party);
    const { ox, oy } = originForCenter(c.x, c.y);
    originRef.current = { ox, oy };
    redraw();
  }, [state.party.map(c => `${c.tactical_x},${c.tactical_y}`).join('|'), redraw]);

  // Deselect if it's no longer your turn
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

    // Hit-test tokens first (click inside token circle)
    for (const c of party) {
      if (c.status === 'dead') continue;
      const { x: cx, y: cy } = gridToCanvas(c.tactical_x ?? 0, c.tactical_y ?? 0, ox, oy);
      if (Math.hypot(px - cx, py - cy) <= CELL * 0.38 + 4) {
        // Clicked a token
        if (c.id === curActiveId && c.id === curMyId) {
          const next = curSel === c.id ? null : c.id;
          setSelectedId(next);
          setMoveError(null);
        } else {
          const reason = c.id !== curActiveId ? `It's ${party.find(p => p.id === curActiveId)?.name ?? 'someone else'}'s turn` : 'Not your character';
          setMoveError(reason);
          setTimeout(() => setMoveError(null), 3000);
        }
        return;
      }
    }

    // Clicked a cell — move if a character is selected
    if (!curSel || curActiveId !== curMyId) return;

    const sel = party.find(c => c.id === curSel);
    if (!sel) return;

    const range = maxMove(sel.attributes.spd_bipedal);
    const dist  = Math.sqrt((gx - (sel.tactical_x ?? 0)) ** 2 + (gy - (sel.tactical_y ?? 0)) ** 2);
    if (dist > range + 0.5) {
      setMoveError(`Too far — max ${range} units (${range * 10} ft)`);
      setTimeout(() => setMoveError(null), 3000);
      return;
    }

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

  // ── Drag-to-pan ──────────────────────────────────────────────────────────
  const panStart = useRef<{ mx: number; my: number; ox: number; oy: number } | null>(null);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 1 && e.button !== 2) return; // middle or right drag to pan
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

  const hoveredCombatant = hovered
    ? state.party.find(c => (c.tactical_x ?? 0) === hovered.gx && (c.tactical_y ?? 0) === hovered.gy)
    : null;

  return (
    <div className="tactical-board panel">
      <div className="tactical-board-header">
        <span className="tb-title">⚔ TACTICAL GRID</span>
        <span className="tb-subtitle text-dim">1 cell = 10 ft · North = up</span>
        {hoveredCombatant && (
          <span className="tb-hover-info">
            {hoveredCombatant.name} — HP {hoveredCombatant.vitals?.hp_current}/{hoveredCombatant.vitals?.hp_max}
          </span>
        )}
        {hovered && !hoveredCombatant && (
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
        me:{myId?.slice(-6) ?? 'none'} · active:{activeId?.slice(-6) ?? 'none'} · {canMove ? '✓ my turn' : '✗ not my turn'} · sel:{selectedId?.slice(-6) ?? 'none'}
      </div>
    </div>
  );
}
