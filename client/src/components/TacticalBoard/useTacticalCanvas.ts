import {
	type Combatant,
	type Enemy,
	enemyMapTokenKind,
} from "@gate-life/shared";
import { useCallback, useEffect, useRef } from "react";

// ── Shared constants (exported for useTacticalInput) ─────────────────────────
export const CELL = 28;
export const COLS = 41;
export const ROWS = 33;
export const W = COLS * CELL;
export const H = ROWS * CELL;

export function maxMove(spd: number) {
	return Math.round((spd * 5) / 10);
}

function tokenColor(c: Combatant) {
	if (c.status === "dead") return "#444";
	if (c.party_member === false) return "#27ae60";
	return c.kind === "agent" ? "#6c3483" : "#2980b9";
}

function initials(name: string) {
	return (
		name
			.split(/\s+/)
			.map((w) => w[0] ?? "")
			.join("")
			.slice(0, 2)
			.toUpperCase() || "?"
	);
}

const FACING_ANGLES: Record<string, number> = {
	N: -Math.PI / 2,
	NE: -Math.PI / 4,
	E: 0,
	SE: Math.PI / 4,
	S: Math.PI / 2,
	SW: (3 * Math.PI) / 4,
	W: Math.PI,
	NW: (-3 * Math.PI) / 4,
};

function facingAngle(facing: string | undefined): number | null {
	if (!facing) return null;
	return FACING_ANGLES[facing.toUpperCase()] ?? null;
}

export function gridToCanvas(gx: number, gy: number, ox: number, oy: number) {
	const col = gx - ox;
	const row = ROWS - 1 - (gy - oy);
	return { x: col * CELL + CELL / 2, y: row * CELL + CELL / 2 };
}

export function canvasToGrid(cx: number, cy: number, ox: number, oy: number) {
	const col = Math.floor(cx / CELL);
	const row = Math.floor(cy / CELL);
	return { gx: ox + col, gy: oy + (ROWS - 1 - row) };
}

// ── Terrain types ────────────────────────────────────────────────────────────
export interface TerrainCell {
	x: number;
	y: number;
	terrain_type: string;
	metadata?: Record<string, unknown>;
}

export type TerrainMap = Map<string, TerrainCell>;

export function cellKey(x: number, y: number) {
	return `${x},${y}`;
}

// ── Entity type appearance ───────────────────────────────────────────────────
function entityColor(
	entity: Pick<Enemy, "enemy_type" | "icon_type" | "quest_poi">,
): string {
	if (entity.enemy_type === "poi" && entity.quest_poi) return "#f1c40f";
	const k = enemyMapTokenKind(entity);
	switch (k) {
		case "friendly":
			return "#27ae60";
		case "npc":
			return "#9c27b0";
		case "vehicle":
			return "#e67e22";
		case "poi":
			return "#f39c12";
		default:
			return "#c0392b";
	}
}

function entitySymbol(entity: Pick<Enemy, "enemy_type" | "icon_type">): string {
	const k = enemyMapTokenKind(entity);
	switch (k) {
		case "friendly":
			return "▲";
		case "npc":
			return "◉";
		case "vehicle":
			return "◆";
		case "poi":
			return "★";
		default:
			return "✕";
	}
}

// ── Draw function ────────────────────────────────────────────────────────────
function draw(
	canvas: HTMLCanvasElement,
	party: Combatant[],
	worldNpcs: Combatant[],
	detectedEntities: Enemy[],
	activeId: string | null,
	selectedId: string | null,
	ox: number,
	oy: number,
	terrain: TerrainMap,
) {
	const mapChars = [...party, ...worldNpcs];
	const ctx = canvas.getContext("2d");
	if (!ctx) return;

	ctx.clearRect(0, 0, W, H);

	// Debug: Sample terrain cells
	let roadCount = 0;
	let buildingCount = 0;
	for (const [, cell] of terrain.entries()) {
		if (cell.metadata?.road) roadCount++;
		if (cell.terrain_type === "impassable") buildingCount++;
	}
	if (terrain.size > 0) {
		console.log(
			`[tactical draw] terrain.size=${terrain.size} roads=${roadCount} buildings=${buildingCount} ox=${ox} oy=${oy}`,
		);
		const samples = [
			terrain.get(cellKey(ox, oy)),
			terrain.get(cellKey(ox + 5, oy + 5)),
			terrain.get(cellKey(ox - 5, oy - 5)),
		];
		console.log("[tactical draw] Sample cells:", samples);
	}

	// ── Cell backgrounds + grid lines + terrain ─────────────────────────────
	for (let row = 0; row < ROWS; row++) {
		for (let col = 0; col < COLS; col++) {
			const gx = ox + col;
			const gy = oy + (ROWS - 1 - row);
			const px = col * CELL;
			const py = row * CELL;

			const cell = terrain.get(cellKey(gx, gy));

			if (cell?.terrain_type === "impassable") {
				ctx.fillStyle = "#2c1f1f";
				ctx.fillRect(px, py, CELL, CELL);
				ctx.save();
				ctx.beginPath();
				ctx.rect(px, py, CELL, CELL);
				ctx.clip();
				ctx.strokeStyle = "rgba(180,100,80,0.55)";
				ctx.lineWidth = 1;
				for (let d = -CELL; d < CELL * 2; d += 7) {
					ctx.beginPath();
					ctx.moveTo(px + d, py);
					ctx.lineTo(px + d + CELL, py + CELL);
					ctx.stroke();
				}
				ctx.restore();
				ctx.strokeStyle = "#7a3a2a";
				ctx.lineWidth = 1.5;
				ctx.strokeRect(px + 1, py + 1, CELL - 2, CELL - 2);
			} else if (cell?.metadata?.road) {
				ctx.fillStyle = "#1e1c14";
				ctx.fillRect(px, py, CELL, CELL);
				ctx.fillStyle = "rgba(200,150,60,0.22)";
				ctx.fillRect(
					px + CELL * 0.15,
					py + CELL * 0.15,
					CELL * 0.7,
					CELL * 0.7,
				);
			} else {
				const even = (gx + gy) % 2 === 0;
				ctx.fillStyle = even ? "#111822" : "#0d1520";
				ctx.fillRect(px, py, CELL, CELL);
			}

			ctx.strokeStyle = "rgba(80,120,160,0.18)";
			ctx.lineWidth = 0.5;
			ctx.strokeRect(px, py, CELL, CELL);

			if (gx === 0 || gy === 0) {
				ctx.strokeStyle = "rgba(100,160,220,0.25)";
				ctx.lineWidth = 1;
				ctx.strokeRect(px, py, CELL, CELL);
			}
		}
	}

	// ── Coordinate ruler ──────────────────────────────────────────────────────
	ctx.fillStyle = "rgba(100,160,220,0.35)";
	ctx.font = "8px monospace";
	ctx.textAlign = "center";
	for (let col = 0; col < COLS; col += 2) {
		ctx.fillText(String(ox + col), col * CELL + CELL / 2, CELL - 2);
	}
	ctx.textAlign = "right";
	for (let row = 0; row < ROWS; row += 2) {
		const gy = oy + (ROWS - 1 - row);
		ctx.fillText(String(gy), CELL - 3, row * CELL + CELL / 2 + 4);
	}

	// ── Movement range highlight ────────────────────────────────────────────
	if (selectedId) {
		const sel = party.find((c) => c.id === selectedId);
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
						const blocked = cell?.terrain_type === "impassable";
						if (blocked) {
							ctx.fillStyle = "rgba(192,57,43,0.15)";
						} else {
							ctx.fillStyle = "rgba(241,196,15,0.10)";
						}
						ctx.fillRect(col * CELL + 1, row * CELL + 1, CELL - 2, CELL - 2);
					}
				}
			}
		}
	}

	// ── Character tokens ──────────────────────────────────────────────────────
	const cellCounts = new Map<string, number>();
	const cellIndex = new Map<string, number>();
	for (const c of mapChars) {
		if (c.status === "dead") continue;
		const key = `${c.tactical_x ?? 0},${c.tactical_y ?? 0}`;
		cellIndex.set(c.id, cellCounts.get(key) ?? 0);
		cellCounts.set(key, (cellCounts.get(key) ?? 0) + 1);
	}

	// ── Dead tokens (drawn first, below live ones) ───────────────────────────
	for (const c of mapChars) {
		if (c.status !== "dead") continue;
		const gx = c.tactical_x ?? 0;
		const gy = c.tactical_y ?? 0;
		const col = gx - ox;
		const row = ROWS - 1 - (gy - oy);
		if (col < 0 || col >= COLS || row < 0 || row >= ROWS) continue;

		const { x: cx, y: cy } = gridToCanvas(gx, gy, ox, oy);
		const r = CELL * 0.36;

		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		ctx.fillStyle = "#252525";
		ctx.fill();
		ctx.strokeStyle = "rgba(140,140,140,0.5)";
		ctx.lineWidth = 1.5;
		ctx.stroke();

		ctx.strokeStyle = "#c0392b";
		ctx.lineWidth = 2.5;
		ctx.lineCap = "round";
		const xr = r * 0.65;
		ctx.beginPath();
		ctx.moveTo(cx - xr, cy - xr);
		ctx.lineTo(cx + xr, cy + xr);
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(cx + xr, cy - xr);
		ctx.lineTo(cx - xr, cy + xr);
		ctx.stroke();

		ctx.fillStyle = "rgba(140,140,140,0.55)";
		ctx.font = "8px monospace";
		ctx.textAlign = "center";
		ctx.textBaseline = "top";
		ctx.fillText(c.name.slice(0, 8), cx, cy + r + 3);
	}

	// ── Live tokens (draw scenario NPCs first, party on top for hit-testing) ─
	const liveWorld = worldNpcs.filter((c) => c.status !== "dead");
	const liveParty = party.filter((c) => c.status !== "dead");
	for (const c of [...liveWorld, ...liveParty]) {
		const gx = c.tactical_x ?? 0;
		const gy = c.tactical_y ?? 0;
		const col = gx - ox;
		const row = ROWS - 1 - (gy - oy);
		if (col < 0 || col >= COLS || row < 0 || row >= ROWS) continue;

		const cellKey2 = `${gx},${gy}`;
		const stackSize = cellCounts.get(cellKey2) ?? 1;
		const stackIdx = cellIndex.get(c.id) ?? 0;

		const base = gridToCanvas(gx, gy, ox, oy);
		const stackAngle = stackSize > 1 ? (stackIdx / stackSize) * Math.PI * 2 : 0;
		const spread = stackSize > 1 ? CELL * 0.22 : 0;
		const cx = base.x + Math.cos(stackAngle) * spread;
		const cy = base.y + Math.sin(stackAngle) * spread;
		const r = CELL * 0.38;
		const isActive = c.id === activeId;
		const isSel = c.id === selectedId;
		const color = tokenColor(c);
		const isUnconscious = c.status === "unconscious";

		if (isActive || isSel) {
			const grad = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r + 10);
			grad.addColorStop(
				0,
				isSel ? "rgba(241,196,15,0.5)" : "rgba(230,126,34,0.5)",
			);
			grad.addColorStop(1, "transparent");
			ctx.beginPath();
			ctx.arc(cx, cy, r + 10, 0, Math.PI * 2);
			ctx.fillStyle = grad;
			ctx.fill();
		}

		// ── Facing indicator (drawn before circle so circle sits on top) ───────
		const fAngle = facingAngle(c.facing);
		if (fAngle !== null) {
			const stickEnd = r + 10;
			const ex = cx + Math.cos(fAngle) * stickEnd;
			const ey = cy + Math.sin(fAngle) * stickEnd;
			ctx.beginPath();
			ctx.moveTo(cx, cy);
			ctx.lineTo(ex, ey);
			ctx.strokeStyle = isUnconscious
				? "rgba(200,150,50,0.7)"
				: "rgba(255,255,255,0.85)";
			ctx.lineWidth = 2.5;
			ctx.lineCap = "round";
			ctx.stroke();
			ctx.beginPath();
			ctx.arc(ex, ey, 3, 0, Math.PI * 2);
			ctx.fillStyle = isUnconscious
				? "rgba(200,150,50,0.8)"
				: "rgba(255,255,255,0.9)";
			ctx.fill();
		}

		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		ctx.fillStyle = isUnconscious ? "#3d2b0a" : color;
		ctx.fill();

		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		ctx.strokeStyle = isSel
			? "#f1c40f"
			: isActive
				? "#e67e22"
				: isUnconscious
					? "#d4a057"
					: "rgba(255,255,255,0.7)";
		ctx.lineWidth = isSel || isActive ? 2.5 : isUnconscious ? 2 : 1.5;
		ctx.stroke();

		ctx.fillStyle = isUnconscious ? "#d4a057" : "#fff";
		ctx.font = "bold 12px sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(initials(c.name), cx, cy);

		if (isUnconscious) {
			ctx.fillStyle = "#d4a057";
			ctx.font = "bold 8px monospace";
			ctx.textBaseline = "top";
			ctx.fillText("~KO~", cx, cy + r * 0.1);
		}

		ctx.font = isActive ? "bold 9px monospace" : "9px monospace";
		ctx.fillStyle = isActive
			? "#e67e22"
			: isUnconscious
				? "#d4a057"
				: "rgba(220,230,240,0.7)";
		ctx.textBaseline = "top";
		ctx.fillText(c.name.slice(0, 8), cx, cy + r + 3);

		if (isActive) {
			ctx.fillStyle = "#e67e22";
			ctx.font = "bold 7px monospace";
			ctx.textBaseline = "bottom";
			ctx.textAlign = "center";
			ctx.fillText("◀ ACTING", cx, cy - r - 2);
		}
	}

	// ── Detected scenario entities (enemies, friendlies, vehicles, POIs) ──────
	for (const entity of detectedEntities) {
		const gx = entity.tactical_x ?? null;
		const gy = entity.tactical_y ?? null;
		if (gx == null || gy == null) {
			console.log(
				`[tactical draw] Skipping ${entity.name} — no position (${gx}, ${gy})`,
			);
			continue;
		}

		const col = gx - ox;
		const row = ROWS - 1 - (gy - oy);
		const inBounds = col >= 0 && col < COLS && row >= 0 && row < ROWS;
		console.log(
			`[tactical draw] ${entity.name} at (${gx},${gy}) → viewport col=${col} row=${row} (ox=${ox} oy=${oy}) ${inBounds ? "✓ visible" : "✗ OUT OF BOUNDS"}`,
		);
		if (!inBounds) continue;

		const { x: cx, y: cy } = gridToCanvas(gx, gy, ox, oy);
		const r = CELL * 0.36;
		const isDead = entity.status === "dead";
		const color = isDead ? "#555" : entityColor(entity);
		const symbol = isDead ? "☠" : entitySymbol(entity);

		if (!isDead) {
			const grad = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, r + 8);
			grad.addColorStop(0, `${color}55`);
			grad.addColorStop(1, "transparent");
			ctx.beginPath();
			ctx.arc(cx, cy, r + 8, 0, Math.PI * 2);
			ctx.fillStyle = grad;
			ctx.fill();

			const entityFAngle = facingAngle(entity.facing);
			if (entityFAngle !== null) {
				const coneRadius = r + 14;
				const halfArc = Math.PI / 2;
				ctx.beginPath();
				ctx.moveTo(cx, cy);
				ctx.arc(
					cx,
					cy,
					coneRadius,
					entityFAngle - halfArc,
					entityFAngle + halfArc,
				);
				ctx.closePath();
				ctx.fillStyle = `${color}28`;
				ctx.fill();
				ctx.strokeStyle = `${color}66`;
				ctx.lineWidth = 1;
				ctx.stroke();

				const stickEnd = r + 11;
				const ex = cx + Math.cos(entityFAngle) * stickEnd;
				const ey = cy + Math.sin(entityFAngle) * stickEnd;
				ctx.beginPath();
				ctx.moveTo(cx, cy);
				ctx.lineTo(ex, ey);
				ctx.strokeStyle = `${color}cc`;
				ctx.lineWidth = 2;
				ctx.lineCap = "round";
				ctx.stroke();
				ctx.beginPath();
				ctx.arc(ex, ey, 2.5, 0, Math.PI * 2);
				ctx.fillStyle = color;
				ctx.fill();
			}
		}

		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		ctx.fillStyle = isDead ? "#252525" : `${color}cc`;
		ctx.fill();
		ctx.strokeStyle = isDead ? "rgba(140,140,140,0.5)" : color;
		ctx.lineWidth = isDead ? 1.5 : 2;
		ctx.stroke();

		ctx.fillStyle = isDead ? "#888" : "#fff";
		ctx.font = `bold ${Math.round(CELL * 0.32)}px sans-serif`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(symbol, cx, cy);

		ctx.fillStyle = isDead ? "rgba(140,140,140,0.7)" : color;
		ctx.font = "9px monospace";
		ctx.textBaseline = "top";
		ctx.fillText(entity.name.slice(0, 8), cx, cy + r + 3);

		if (isDead) {
			ctx.fillStyle = "rgba(192,57,43,0.8)";
			ctx.fillText("DEAD", cx, cy + r + 13);
		} else {
			ctx.fillStyle = color;
			const hpText = `${entity.hp_current}/${entity.hp_max} HP`;
			ctx.fillText(hpText, cx, cy + r + 13);
		}
	}
}

export function originForCenter(cx: number, cy: number) {
	return { ox: cx - Math.floor(COLS / 2), oy: cy - Math.floor(ROWS / 2) };
}

// ── Hook ─────────────────────────────────────────────────────────────────────
interface UseTacticalCanvasParams {
	canvasRef: { current: HTMLCanvasElement | null };
	originRef: { current: { ox: number; oy: number } };
	terrainRef: { current: TerrainMap };
	party: Combatant[];
	worldNpcs: Combatant[];
	detectedEntities: Enemy[];
	activeId: string | null;
	myId: string | null | undefined;
	selectedId: string | null;
	terrainLoaded: boolean;
	currentMode: string | undefined;
}

export function useTacticalCanvas({
	canvasRef,
	originRef,
	terrainRef,
	party,
	worldNpcs,
	detectedEntities,
	activeId,
	myId,
	selectedId,
	terrainLoaded,
	currentMode,
}: UseTacticalCanvasParams) {
	const partyRef = useRef(party);
	const worldNpcsRef = useRef(worldNpcs);
	const detectedEntitiesRef = useRef(detectedEntities);
	const activeIdRef = useRef(activeId);
	const selectedIdRef = useRef(selectedId);

	partyRef.current = party;
	worldNpcsRef.current = worldNpcs;
	detectedEntitiesRef.current = detectedEntities;
	activeIdRef.current = activeId;
	selectedIdRef.current = selectedId;

	// ── Redraw ────────────────────────────────────────────────────────────────
	const redraw = useCallback(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const { ox, oy } = originRef.current;
		const terrain = terrainRef.current;
		console.log(
			`[tactical] redraw - terrain.size=${terrain.size} ox=${ox} oy=${oy}`,
		);
		draw(
			canvas,
			partyRef.current,
			worldNpcsRef.current,
			detectedEntitiesRef.current,
			activeIdRef.current,
			selectedIdRef.current,
			ox,
			oy,
			terrain,
		);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		console.log(
			"[tactical] redraw — party positions:",
			party
				.map((c) => `${c.name.slice(0, 6)}:(${c.tactical_x},${c.tactical_y})`)
				.join(" | "),
		);
		redraw();
	}, [
		party,
		worldNpcs,
		detectedEntities,
		selectedId,
		activeId,
		terrainLoaded,
		redraw,
	]);

	// ── Center on MY character on mount ─────────────────────────────────────
	useEffect(() => {
		const me = party.find((c) => c.id === myId);
		const target = me ?? (party.length > 0 ? party[0] : null);
		if (target) {
			const { ox, oy } = originForCenter(
				target.tactical_x ?? 0,
				target.tactical_y ?? 0,
			);
			originRef.current = { ox, oy };
			redraw();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// ── Re-center when MY position changes ──────────────────────────────────
	const meX = party.find((c) => c.id === myId)?.tactical_x;
	const meY = party.find((c) => c.id === myId)?.tactical_y;
	useEffect(() => {
		const me = party.find((c) => c.id === myId);
		if (me) {
			const { ox, oy } = originForCenter(
				me.tactical_x ?? 0,
				me.tactical_y ?? 0,
			);
			originRef.current = { ox, oy };
			redraw();
		}
	}, [meX, meY, myId, redraw, party, originRef]);

	// ── Pan to show the whole party whenever any combatant moves ─────────────
	const partyPositionKey = [...party, ...worldNpcs]
		.map((c) => `${c.id}:${c.tactical_x ?? 0},${c.tactical_y ?? 0}`)
		.join("|");

	useEffect(() => {
		if (party.length === 0 && worldNpcs.length === 0) return;
		const alive = [...party, ...worldNpcs].filter(
			(c) => c.status !== "dead",
		);
		if (alive.length === 0) return;

		const sumX = alive.reduce((s, c) => s + (c.tactical_x ?? 0), 0);
		const sumY = alive.reduce((s, c) => s + (c.tactical_y ?? 0), 0);
		const centX = Math.round(sumX / alive.length);
		const centY = Math.round(sumY / alive.length);

		const { ox, oy } = originRef.current;
		const margin = 2;
		const anyOutside = alive.some((c) => {
			const col = (c.tactical_x ?? 0) - ox;
			const row = ROWS - 1 - ((c.tactical_y ?? 0) - oy);
			return (
				col < margin ||
				col > COLS - margin - 1 ||
				row < margin ||
				row > ROWS - margin - 1
			);
		});

		if (anyOutside) {
			const { ox: nox, oy: noy } = originForCenter(centX, centY);
			originRef.current = { ox: nox, oy: noy };
			redraw();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [partyPositionKey, redraw]);

	// ── Pan to show detected enemies when they appear in tactical mode ───────
	const detectedEntitiesKey = detectedEntities
		.map((e) => `${e.id}:${e.tactical_x ?? 0},${e.tactical_y ?? 0}`)
		.join("|");

	useEffect(() => {
		if (currentMode !== "tactical") return;
		const hostileEntities = detectedEntities.filter(
			(e) =>
				e.status !== "dead" &&
				e.tactical_x != null &&
				e.tactical_y != null &&
				e.enemy_type !== "friendly" &&
				e.enemy_type !== "poi" &&
				e.enemy_type !== "neutral",
		);
		if (hostileEntities.length === 0) return;

		const alive = [...party, ...worldNpcs].filter(
			(c) => c.status !== "dead",
		);
		if (alive.length === 0) return;

		const allPositions = [
			...alive.map((c) => ({ x: c.tactical_x ?? 0, y: c.tactical_y ?? 0 })),
			...hostileEntities.map((e) => ({ x: e.tactical_x!, y: e.tactical_y! })),
		];

		const minX = Math.min(...allPositions.map((p) => p.x));
		const maxX = Math.max(...allPositions.map((p) => p.x));
		const minY = Math.min(...allPositions.map((p) => p.y));
		const maxY = Math.max(...allPositions.map((p) => p.y));

		const centX = Math.round((minX + maxX) / 2);
		const centY = Math.round((minY + maxY) / 2);

		const { ox, oy } = originRef.current;
		const margin = 2;
		const anyOutside = allPositions.some((p) => {
			const col = p.x - ox;
			const row = ROWS - 1 - (p.y - oy);
			return (
				col < margin ||
				col > COLS - margin - 1 ||
				row < margin ||
				row > ROWS - margin - 1
			);
		});

		if (anyOutside) {
			console.log(
				`[tactical] Auto-panning to show party + enemies — centering on (${centX}, ${centY})`,
			);
			const { ox: nox, oy: noy } = originForCenter(centX, centY);
			originRef.current = { ox: nox, oy: noy };
			redraw();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [detectedEntitiesKey, currentMode, redraw]);

	return { redraw };
}
