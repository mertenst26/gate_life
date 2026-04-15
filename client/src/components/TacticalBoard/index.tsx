import { useEffect, useRef, useState } from "react";
import { useGame } from "../../context/GameContext";
import { api } from "../../hooks/useApi";
import { EnemyInspector } from "../EnemyInspector";
import {
	W,
	H,
	cellKey,
	type TerrainCell,
	type TerrainMap,
} from "./useTacticalCanvas";
import { useTacticalCanvas } from "./useTacticalCanvas";
import { useTacticalInput } from "./useTacticalInput";

export function TacticalBoard({ height }: { height?: number }) {
	const { state, actions } = useGame();
	const turnState = state.session?.turn_state ?? null;
	const myId = state.myCharacterId;
	const activeId = turnState?.turn_order[turnState.current_actor_index] ?? null;
	const canMove = activeId !== null && activeId === myId;

	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const originRef = useRef({ ox: -10, oy: -8 });
	const terrainRef = useRef<TerrainMap>(new Map());
	const redrawRef = useRef(() => {});

	const [terrainLoaded, setTerrainLoaded] = useState(false);
	const [inspectingEntity, setInspectingEntity] = useState<string | null>(null);

	console.log(
		"[TacticalBoard] Render - detectedEntities count:",
		state.detectedEntities.length,
	);
	if (state.detectedEntities.length > 0) {
		console.log(
			"[TacticalBoard] Detected entities:",
			state.detectedEntities.map((e) => ({
				name: e.name,
				id: e.id,
				tactical_x: e.tactical_x,
				tactical_y: e.tactical_y,
				detected: e.detected,
				status: e.status,
			})),
		);
	}

	const {
		selectedId,
		setSelectedId,
		moveError,
		hovered,
		onClick,
		onMouseMove,
		onMouseDown,
		onMouseMoveForPan,
		onMouseUp,
	} = useTacticalInput({
		canvasRef,
		originRef,
		terrainRef,
		redrawRef,
		party: state.party,
		detectedEntities: state.detectedEntities,
		activeId,
		myId,
		sendTacticalMove: actions.sendTacticalMove,
		onEntityClick: setInspectingEntity,
	});

	const { redraw } = useTacticalCanvas({
		canvasRef,
		originRef,
		terrainRef,
		party: state.party,
		worldNpcs: state.worldNpcs,
		detectedEntities: state.detectedEntities,
		activeId,
		myId,
		selectedId,
		terrainLoaded,
		currentMode: state.session?.current_mode,
	});

	redrawRef.current = redraw;

	// ── Fetch terrain when session is available ──────────────────────────────
	useEffect(() => {
		const sessionId = state.session?.id;
		if (!sessionId) {
			console.log("[tactical] No session ID, skipping terrain fetch");
			return;
		}

		const me = state.party.find((c) => c.id === myId);
		const cx = me?.tactical_x ?? 0;
		const cy = me?.tactical_y ?? 0;

		console.log(
			`[tactical] Fetching terrain for session ${sessionId.slice(0, 8)} at (${cx},${cy}) myId=${myId?.slice(0, 8)}`,
		);

		let cancelled = false;
		setTerrainLoaded(false);

		api
			.getTerrain(sessionId, cx, cy, 60)
			.then((result) => {
				if (cancelled) return;
				console.log(
					`[tactical] API returned ${result.tiles.length} tiles, ${result.buildings.length} buildings, ${result.roads.length} roads`,
				);
				const map = new Map<string, TerrainCell>();
				for (const tile of result.tiles) {
					map.set(cellKey(tile.x, tile.y), tile);
				}
				terrainRef.current = map;
				setTerrainLoaded(true);
				const sampleTiles = result.tiles.slice(0, 5);
				const tilesWithRoads = result.tiles.filter((t) => t.metadata?.road);
				console.log(
					`[tactical] Loaded ${result.tiles.length} terrain cells (${result.buildings.length} buildings, ${result.roads.length} roads)`,
				);
				console.log(
					`[tactical] Tiles with road metadata: ${tilesWithRoads.length}`,
				);
				console.log("[tactical] Sample tiles:", sampleTiles);
				if (tilesWithRoads.length > 0) {
					console.log(
						"[tactical] Sample road tiles:",
						tilesWithRoads.slice(0, 3),
					);
				}
			})
			.catch((err) => {
				if (cancelled) return;
				console.error("[tactical] Failed to load terrain:", err);
				setTerrainLoaded(true);
			});

		return () => {
			cancelled = true;
		};
	}, [state.session?.id, myId, state.party]);

	// ── Hover info ──────────────────────────────────────────────────────────
	const hoveredCombatant = hovered
		? state.party.find(
				(c) =>
					(c.tactical_x ?? 0) === hovered.gx &&
					(c.tactical_y ?? 0) === hovered.gy,
			)
		: null;

	const hoveredTerrain = hovered
		? terrainRef.current.get(cellKey(hovered.gx, hovered.gy))
		: null;

	return (
		<div
			className="tactical-board panel"
			style={{
				...(height !== undefined ? { height } : {}),
				position: "relative",
			}}
		>
			<div className="tactical-board-header">
				<span className="tb-title">⚔ TACTICAL GRID</span>
				<span className="tb-subtitle text-dim">
					1 cell = 10 ft · North = up
				</span>
				{hoveredCombatant && (
					<span className="tb-hover-info">
						{hoveredCombatant.name} — HP {hoveredCombatant.vitals?.hp_current}/
						{hoveredCombatant.vitals?.hp_max}
					</span>
				)}
				{hovered &&
					!hoveredCombatant &&
					hoveredTerrain?.terrain_type === "impassable" && (
						<span className="tb-hover-info" style={{ color: "#c0392b" }}>
							Building
							{hoveredTerrain.metadata?.name
								? ` — ${String(hoveredTerrain.metadata.name)}`
								: ""}{" "}
							({hovered.gx}, {hovered.gy})
						</span>
					)}
				{hovered && !hoveredCombatant && !!hoveredTerrain?.metadata?.road && (
					<span className="tb-hover-info" style={{ color: "#d4a057" }}>
						Road ({hovered.gx}, {hovered.gy})
					</span>
				)}
				{hovered && !hoveredCombatant && !hoveredTerrain && (
					<span className="tb-coords text-dim">
						({hovered.gx}, {hovered.gy})
					</span>
				)}
				{canMove && (
					<div className="tb-actions">
						{!selectedId ? (
							<span className="tb-hint">Click your token to select</span>
						) : (
							<span className="tb-hint selected">
								Click a cell to move · or click token again to deselect
							</span>
						)}
						<button
							className="btn end-turn-btn"
							onClick={() => {
								actions.endTurn();
								setSelectedId(null);
							}}
						>
							END TURN →
						</button>
					</div>
				)}
				{!canMove && activeId && (
					<span className="tb-hint waiting">
						Waiting for{" "}
						{state.party.find((c) => c.id === activeId)?.name ?? "unknown"}…
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
					style={{ cursor: selectedId ? "crosshair" : "default" }}
					onClick={onClick}
					onMouseMove={(e) => {
						onMouseMove(e);
						onMouseMoveForPan(e);
					}}
					onMouseDown={onMouseDown}
					onMouseUp={onMouseUp}
					onContextMenu={(e) => e.preventDefault()}
				/>
			</div>

			<div className="tactical-debug">
				me:{myId?.slice(-6) ?? "none"} · active:{activeId?.slice(-6) ?? "none"}{" "}
				· {canMove ? "✓ my turn" : "✗ not my turn"} · terrain:
				{terrainRef.current.size}
			</div>

			{inspectingEntity && (
				<EnemyInspector
					enemy={state.detectedEntities.find((e) => e.id === inspectingEntity)!}
					onClose={() => setInspectingEntity(null)}
				/>
			)}
		</div>
	);
}
