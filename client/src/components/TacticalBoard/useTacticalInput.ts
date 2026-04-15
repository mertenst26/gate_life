import type { Combatant, Enemy } from "@gate-life/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	CELL,
	canvasToGrid,
	cellKey,
	gridToCanvas,
	maxMove,
	type TerrainMap,
} from "./useTacticalCanvas";

interface UseTacticalInputParams {
	canvasRef: { current: HTMLCanvasElement | null };
	originRef: { current: { ox: number; oy: number } };
	terrainRef: { current: TerrainMap };
	redrawRef: { current: () => void };
	party: Combatant[];
	detectedEntities: Enemy[];
	activeId: string | null;
	myId: string | null | undefined;
	sendTacticalMove: (x: number, y: number) => void;
	onEntityClick: (entityId: string) => void;
}

export function useTacticalInput({
	canvasRef,
	originRef,
	terrainRef,
	redrawRef,
	party,
	detectedEntities,
	activeId,
	myId,
	sendTacticalMove,
	onEntityClick,
}: UseTacticalInputParams) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [moveError, setMoveError] = useState<string | null>(null);
	const [hovered, setHovered] = useState<{ gx: number; gy: number } | null>(
		null,
	);

	const activeIdRef = useRef(activeId);
	const myIdRef = useRef(myId);
	const selectedIdRef = useRef<string | null>(null);
	const partyRef = useRef(party);
	const detectedEntitiesRef = useRef(detectedEntities);
	const sendMoveRef = useRef(sendTacticalMove);
	const onEntityClickRef = useRef(onEntityClick);

	activeIdRef.current = activeId;
	myIdRef.current = myId;
	partyRef.current = party;
	detectedEntitiesRef.current = detectedEntities;
	sendMoveRef.current = sendTacticalMove;
	onEntityClickRef.current = onEntityClick;

	useEffect(() => {
		selectedIdRef.current = selectedId;
	}, [selectedId]);

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
		const curMyId = myIdRef.current;
		const curSel = selectedIdRef.current;
		const curParty = partyRef.current;

		console.log(
			`[click] px=${Math.round(px)},py=${Math.round(py)} → grid(${gx},${gy}) | activeId=${curActiveId?.slice(-4)} myId=${curMyId?.slice(-4)} sel=${curSel?.slice(-4) ?? "none"}`,
		);

		// Replicate stacking offsets so hit-test matches drawn positions
		const cellCounts2 = new Map<string, number>();
		const cellIndex2 = new Map<string, number>();
		for (const c of curParty) {
			if (c.status === "dead") continue;
			const k = `${c.tactical_x ?? 0},${c.tactical_y ?? 0}`;
			cellIndex2.set(c.id, cellCounts2.get(k) ?? 0);
			cellCounts2.set(k, (cellCounts2.get(k) ?? 0) + 1);
		}

		// Hit-test tokens using the same offset math as draw()
		for (const c of curParty) {
			if (c.status === "dead") continue;
			const cgx = c.tactical_x ?? 0;
			const cgy = c.tactical_y ?? 0;
			const base = gridToCanvas(cgx, cgy, ox, oy);
			const stackSize = cellCounts2.get(`${cgx},${cgy}`) ?? 1;
			const stackIdx = cellIndex2.get(c.id) ?? 0;
			const angle = stackSize > 1 ? (stackIdx / stackSize) * Math.PI * 2 : 0;
			const spread = stackSize > 1 ? CELL * 0.22 : 0;
			const tcx = base.x + Math.cos(angle) * spread;
			const tcy = base.y + Math.sin(angle) * spread;
			const hitRadius = CELL * 0.38 + 4;

			if (Math.hypot(px - tcx, py - tcy) <= hitRadius) {
				console.log(
					`[click] hit token: ${c.name} (${c.id.slice(-4)}) | isActive=${c.id === curActiveId} isMine=${c.id === curMyId}`,
				);
				if (c.id === curActiveId && c.id === curMyId) {
					setSelectedId((prev) => {
						const next = prev === c.id ? null : c.id;
						console.log(`[click] selecting: ${next?.slice(-4) ?? "none"}`);
						return next;
					});
					setMoveError(null);
				} else {
					const reason =
						c.id !== curActiveId
							? `It's ${curParty.find((p) => p.id === curActiveId)?.name ?? "someone else"}'s turn (active:${curActiveId?.slice(-4)}, me:${curMyId?.slice(-4)})`
							: "Not your character";
					console.log(`[click] blocked: ${reason}`);
					setMoveError(reason);
					setTimeout(() => setMoveError(null), 3000);
				}
				return;
			}
		}

		// Hit-test detected entities (enemies, friendlies, NPCs, etc.)
		const entities = detectedEntitiesRef.current;
		for (const entity of entities) {
			const egx = entity.tactical_x ?? null;
			const egy = entity.tactical_y ?? null;
			if (egx == null || egy == null) continue;

			const base = gridToCanvas(egx, egy, ox, oy);
			const hitRadius = CELL * 0.36 + 4;

			if (Math.hypot(px - base.x, py - base.y) <= hitRadius) {
				console.log(
					`[click] hit entity: ${entity.name} (${entity.id.slice(-4)})`,
				);
				onEntityClickRef.current(entity.id);
				return;
			}
		}

		// Clicked empty cell — attempt move if a token is selected
		console.log(
			`[click] cell click → sel=${curSel?.slice(-4) ?? "none"} canMove=${curActiveId === curMyId}`,
		);
		if (!curSel || curActiveId !== curMyId) {
			if (!curSel)
				console.log("[click] no token selected — click your token first");
			else
				console.log(
					`[click] not your turn (active:${curActiveId?.slice(-4)} me:${curMyId?.slice(-4)})`,
				);
			return;
		}

		const sel = curParty.find((c) => c.id === curSel);
		if (!sel) {
			console.log("[click] selected combatant not found in party");
			return;
		}

		// Check impassable terrain
		const targetCell = terrainRef.current.get(cellKey(gx, gy));
		if (targetCell?.terrain_type === "impassable") {
			console.log(`[click] blocked by terrain at (${gx},${gy})`);
			setMoveError("Blocked: building");
			setTimeout(() => setMoveError(null), 3000);
			return;
		}

		const range = maxMove(sel.attributes.spd_bipedal);
		const moveDist = Math.sqrt(
			(gx - (sel.tactical_x ?? 0)) ** 2 + (gy - (sel.tactical_y ?? 0)) ** 2,
		);
		console.log(
			`[click] move attempt: (${sel.tactical_x},${sel.tactical_y}) → (${gx},${gy}) dist=${moveDist.toFixed(1)} range=${range} spd=${sel.attributes.spd_bipedal}`,
		);

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
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// ── Hover ────────────────────────────────────────────────────────────────
	const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const rect = canvas.getBoundingClientRect();
		const { ox, oy } = originRef.current;
		const { gx, gy } = canvasToGrid(
			e.clientX - rect.left,
			e.clientY - rect.top,
			ox,
			oy,
		);
		setHovered({ gx, gy });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// ── Pan ──────────────────────────────────────────────────────────────────
	const panStart = useRef<{
		mx: number;
		my: number;
		ox: number;
		oy: number;
	} | null>(null);

	const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
		if (e.button !== 1 && e.button !== 2) return;
		e.preventDefault();
		panStart.current = { mx: e.clientX, my: e.clientY, ...originRef.current };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const onMouseMoveForPan = useCallback(
		(e: React.MouseEvent<HTMLCanvasElement>) => {
			if (!panStart.current) return;
			const dx = Math.round((e.clientX - panStart.current.mx) / CELL);
			const dy = Math.round((e.clientY - panStart.current.my) / CELL);
			originRef.current = {
				ox: panStart.current.ox - dx,
				oy: panStart.current.oy + dy,
			};
			redrawRef.current();
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[],
	);

	const onMouseUp = useCallback(() => {
		panStart.current = null;
	}, []);

	return {
		selectedId,
		setSelectedId,
		moveError,
		hovered,
		onClick,
		onMouseMove,
		onMouseDown,
		onMouseMoveForPan,
		onMouseUp,
	};
}
