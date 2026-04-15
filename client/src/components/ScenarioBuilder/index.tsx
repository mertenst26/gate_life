import type {
	DungeonDefinition,
	GmKind,
	ScenarioEntity,
	WanderingMonsterConfig,
} from "@gate-life/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../hooks/useApi";
import {
	DEFAULT_LAT,
	DEFAULT_LNG,
	type PlacementMode,
} from "../ScenarioMapPanel";
import { InfoStep } from "./InfoStep";
import { MapStep } from "./MapStep";
import { ReviewStep } from "./ReviewStep";

// ── Shared types ─────────────────────────────────────────────────────────────

type Step = "info" | "map" | "review";

export interface ChatContext {
	entityType: "enemy" | "npc" | "friendly" | "vehicle" | "poi";
	lat: number;
	lng: number;
	existingEntity?: ScenarioEntity;
}

export interface DungeonContext {
	vertices: [number, number][];
	lat: number;
	lng: number;
}

// ── Helper functions ─────────────────────────────────────────────────────────

interface Props {
	onBack: () => void;
	/** When provided, load this existing scenario and jump straight to the map step. */
	editScenarioId?: string;
}

const GRID_DEG_LAT = 3.048 / 111195; // degrees-lat per 10ft grid unit
const GRID_DEG_LNG = 3.048 / 86397; // degrees-lng per 10ft grid unit

function latLngToGrid(
	lat: number,
	lng: number,
	startLat: number,
	startLng: number,
): [number, number] {
	return [
		Math.round((lng - startLng) / GRID_DEG_LNG),
		Math.round((lat - startLat) / GRID_DEG_LAT),
	];
}

/** Coerce API/SQLite fields so lat/lng are always numbers (fixes map markers until reload). */
function normalizeScenarioEntity(raw: unknown): ScenarioEntity {
	const r = raw as Record<string, unknown>;
	const def = r.definition;
	return {
		...r,
		lat: Number(r.lat),
		lng: Number(r.lng),
		grid_x: Number(r.grid_x ?? 0),
		grid_y: Number(r.grid_y ?? 0),
		definition:
			typeof def === "string"
				? (JSON.parse(def) as Record<string, unknown>)
				: ((def as Record<string, unknown>) ?? {}),
	} as ScenarioEntity;
}

/**
 * Returns N lat/lng positions spread in a tight cluster around the centre pin.
 * count=1 → exactly at the pin.
 * count>1 → evenly spaced on a circle; radius grows slightly with count so
 *            markers don't overlap (approx. 4-8 grid units ≈ 40-80 ft).
 */
function clusterPositions(
	centerLat: number,
	centerLng: number,
	count: number,
): Array<[number, number]> {
	if (count === 1) return [[centerLat, centerLng]];

	const radiusUnits = 4 + Math.floor((count - 1) / 4);
	const rLat = GRID_DEG_LAT * radiusUnits;
	const rLng = GRID_DEG_LNG * radiusUnits;

	return Array.from({ length: count }, (_, i) => {
		const angle = (i / count) * 2 * Math.PI;
		return [
			centerLat + Math.cos(angle) * rLat,
			centerLng + Math.sin(angle) * rLng,
		] as [number, number];
	});
}

// ── ScenarioBuilder ──────────────────────────────────────────────────────────

export function ScenarioBuilder({ onBack, editScenarioId }: Props) {
	const [step, setStep] = useState<Step>("info");
	const [loadingEdit, setLoadingEdit] = useState(!!editScenarioId);

	// Step 1: basic info
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [gmKind, setGmKind] = useState<GmKind>("agent");
	const [startLat, setStartLat] = useState(DEFAULT_LAT);
	const [startLng, setStartLng] = useState(DEFAULT_LNG);
	const [wanderingMonsterConfig, setWanderingMonsterConfig] =
		useState<WanderingMonsterConfig | null>(null);
	const [infoError, setInfoError] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);

	// Step 2: map + entities
	const [scenarioId, setScenarioId] = useState<string | null>(
		editScenarioId ?? null,
	);
	const [entities, setEntities] = useState<ScenarioEntity[]>([]);
	const scenarioPoiNames = useMemo(
		() => entities.filter((e) => e.entity_type === "poi").map((e) => e.name),
		[entities],
	);
	const scenarioNpcNames = useMemo(
		() => entities.filter((e) => e.entity_type === "npc").map((e) => e.name),
		[entities],
	);
	const scenarioVehicleNames = useMemo(
		() =>
			entities
				.filter(
					(e) => e.entity_type === "vehicle" || e.entity_type === "friendly",
				)
				.map((e) => e.name),
		[entities],
	);

	// Load existing scenario when editing
	useEffect(() => {
		if (!editScenarioId) return;
		console.log(
			"[ScenarioBuilder] Loading existing scenario for edit:",
			editScenarioId,
		);
		setLoadingEdit(true);
		api
			.getScenario(editScenarioId)
			.then((raw: any) => {
				console.log(
					`[ScenarioBuilder] Scenario loaded: "${raw.name}" with ${(raw.entities ?? []).length} entities`,
				);
				setName(raw.name ?? "");
				setDescription(raw.description ?? "");
				setGmKind(raw.gm_kind ?? "agent");
				setStartLat(raw.start_lat ?? DEFAULT_LAT);
				setStartLng(raw.start_lng ?? DEFAULT_LNG);
				if (raw.wandering_monster_config) {
					setWanderingMonsterConfig(raw.wandering_monster_config);
				}
				const entities = (raw.entities ?? []).map((e: unknown) =>
					normalizeScenarioEntity(e),
				);
				console.log(
					"[ScenarioBuilder] Entities:",
					entities.map((e: any) => `${e.name} (${e.entity_type})`),
				);
				setEntities(entities);
				setStep("map");
			})
			.catch((err: unknown) => {
				console.error("[ScenarioBuilder] Failed to load scenario:", err);
				setInfoError("Failed to load scenario. Please try again.");
			})
			.finally(() => {
				setLoadingEdit(false);
			});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [editScenarioId]);
	const [placementMode, setPlacementMode] = useState<PlacementMode>("none");

	// Chat context: new entity being defined (or existing one being edited) via AI
	const [chatContext, setChatContext] = useState<ChatContext | null>(null);

	// Dungeon designer context: active when a polygon has been drawn and AI chat is open
	const [dungeonContext, setDungeonContext] = useState<DungeonContext | null>(
		null,
	);

	// Copy context: entity selected as template for stamping
	const [selectedTemplate, setSelectedTemplate] =
		useState<ScenarioEntity | null>(null);

	// Debug log whenever selectedTemplate changes
	useEffect(() => {
		if (selectedTemplate) {
			console.log(
				"[ScenarioBuilder] selectedTemplate set →",
				selectedTemplate.name,
				selectedTemplate.id,
			);
		} else {
			console.log("[ScenarioBuilder] selectedTemplate cleared");
		}
	}, [selectedTemplate]);

	const [saving, setSaving] = useState(false);

	// ── Step 1 ──

	const handleCreateScenario = useCallback(async () => {
		if (!name.trim()) return;
		setCreating(true);
		setInfoError(null);
		console.log("[ScenarioBuilder] Creating scenario:", {
			name: name.trim(),
			gmKind,
			startLat,
			startLng,
		});
		try {
			const result = (await api.createScenario({
				name: name.trim(),
				description: description.trim() || undefined,
				gm_kind: gmKind,
				start_lat: startLat,
				start_lng: startLng,
				wandering_monster_config: wanderingMonsterConfig
					? (wanderingMonsterConfig as unknown as Record<string, unknown>)
					: undefined,
			})) as any;
			if (result?.id) {
				console.log("[ScenarioBuilder] Scenario created:", result.id);
				setScenarioId(result.id);
				setStep("map");
			} else {
				console.warn(
					"[ScenarioBuilder] Unexpected response from createScenario:",
					result,
				);
				setInfoError(
					"Server returned an unexpected response. Please try again.",
				);
			}
		} catch (e: unknown) {
			console.error("[ScenarioBuilder] createScenario failed:", e);
			setInfoError(
				e instanceof Error
					? e.message
					: "Failed to create scenario. Is the server running?",
			);
		} finally {
			setCreating(false);
		}
	}, [name, description, gmKind, startLat, startLng]);

	// ── Step 2: map interactions ──

	const toggleMode = useCallback((mode: PlacementMode) => {
		setPlacementMode((prev) => {
			const next = prev === mode ? "none" : mode;
			console.log(`[ScenarioBuilder] Placement mode: ${prev} → ${next}`);
			return next;
		});
		if (mode !== "copy" && mode !== "relocate") setSelectedTemplate(null);
		setChatContext(null);
	}, []);

	/** Called by ScenarioMapPanel when the user closes (or cancels) a dungeon polygon. */
	const handleDungeonPolygonComplete = useCallback(
		(vertices: [number, number][]) => {
			setPlacementMode("none");
			if (vertices.length < 3) return; // cancelled
			// Centroid
			const lat = vertices.reduce((s, v) => s + v[0], 0) / vertices.length;
			const lng = vertices.reduce((s, v) => s + v[1], 0) / vertices.length;
			setDungeonContext({ vertices, lat, lng });
		},
		[],
	);

	/** Called by DungeonDesignerPanel when the user confirms the AI-generated definition. */
	const handleDungeonConfirm = useCallback(
		async (definition: DungeonDefinition) => {
			if (!scenarioId || !dungeonContext) return;
			const { lat, lng } = dungeonContext;
			const [gridX, gridY] = latLngToGrid(lat, lng, startLat, startLng);
			try {
				const result = await api.saveScenarioEntity(scenarioId, {
					entity_type: "dungeon",
					lat,
					lng,
					grid_x: gridX,
					grid_y: gridY,
					name: definition.name,
					definition: definition as unknown as Record<string, unknown>,
				});
				const saved = result as ScenarioEntity;
				setEntities((prev) => {
					const idx = prev.findIndex((e) => e.id === saved.id);
					return idx >= 0
						? prev.map((e) => (e.id === saved.id ? saved : e))
						: [...prev, saved];
				});
			} catch (err) {
				console.error("[ScenarioBuilder] Failed to save dungeon:", err);
			}
			setDungeonContext(null);
		},
		[scenarioId, dungeonContext, startLat, startLng],
	);

	const handleMapClick = useCallback(
		(lat: number, lng: number) => {
			console.log(
				`[ScenarioBuilder] Map clicked at (${lat.toFixed(5)}, ${lng.toFixed(5)}) — mode: ${placementMode}`,
			);
			if (placementMode === "start") {
				console.log("[ScenarioBuilder] Updating start point");
				setStartLat(lat);
				setStartLng(lng);
				if (scenarioId) {
					api
						.updateScenario(scenarioId, { start_lat: lat, start_lng: lng })
						.then(() => console.log("[ScenarioBuilder] Start point saved"))
						.catch((e) =>
							console.error("[ScenarioBuilder] Failed to save start point:", e),
						);
				}
				setPlacementMode("none");
			} else if (
				placementMode === "enemy" ||
				placementMode === "npc" ||
				placementMode === "friendly" ||
				placementMode === "vehicle" ||
				placementMode === "poi"
			) {
				console.log(
					`[ScenarioBuilder] Opening ${placementMode} chat at (${lat.toFixed(5)}, ${lng.toFixed(5)})`,
				);
				setChatContext({ entityType: placementMode as any, lat, lng });
				setPlacementMode("none");
			} else if (placementMode === "copy" && selectedTemplate && scenarioId) {
				const [gridX, gridY] = latLngToGrid(lat, lng, startLat, startLng);
				console.log(
					`[ScenarioBuilder] Stamping copy of "${selectedTemplate.name}" at (${lat.toFixed(5)}, ${lng.toFixed(5)}) grid=(${gridX},${gridY})`,
				);
				api
					.saveScenarioEntity(scenarioId, {
						entity_type: selectedTemplate.entity_type,
						lat,
						lng,
						grid_x: gridX,
						grid_y: gridY,
						name: selectedTemplate.name,
						definition: selectedTemplate.definition,
					})
					.then((result) => {
						console.log(
							"[ScenarioBuilder] Copy API result:",
							JSON.stringify(result),
						);
						if ((result as any)?.id) {
							console.log("[ScenarioBuilder] Copy saved:", (result as any).id);
							setEntities((prev) => {
								const next = [...prev, normalizeScenarioEntity(result)];
								console.log(
									"[ScenarioBuilder] setEntities after copy — total entities:",
									next.length,
									next.map((e) => (e as any).id?.slice(0, 8)),
								);
								return next;
							});
						} else {
							console.warn("[ScenarioBuilder] Copy result missing id:", result);
						}
					})
					.catch((e) =>
						console.error("[ScenarioBuilder] Copy save failed:", e),
					);
			} else if (
				placementMode === "relocate" &&
				selectedTemplate &&
				scenarioId
			) {
				const [gridX, gridY] = latLngToGrid(lat, lng, startLat, startLng);
				console.log(
					`[ScenarioBuilder] Relocating "${selectedTemplate.name}" to (${lat.toFixed(5)}, ${lng.toFixed(5)}) grid=(${gridX},${gridY})`,
				);
				api
					.updateScenarioEntity(scenarioId, selectedTemplate.id, {
						lat,
						lng,
						grid_x: gridX,
						grid_y: gridY,
					})
					.then((result) => {
						if ((result as any)?.id) {
							const updated = normalizeScenarioEntity(result);
							console.log(
								`[ScenarioBuilder] Relocate saved for: ${updated.id} new pos: (${updated.lat}, ${updated.lng})`,
							);
							setEntities((prev) =>
								prev.map((e) => (e.id === updated.id ? updated : e)),
							);
							setSelectedTemplate(updated);
						}
					})
					.catch((e) => console.error("[ScenarioBuilder] Relocate failed:", e));
				setPlacementMode("none");
			} else {
				console.log(
					"[ScenarioBuilder] Map click ignored (no active placement mode)",
				);
			}
		},
		[placementMode, scenarioId, selectedTemplate, startLat, startLng],
	);

	const handleEntityClick = useCallback(
		(entityId: string) => {
			console.log("[ScenarioBuilder] Entity marker clicked:", entityId);
			const entity = entities.find((e) => e.id === entityId);
			if (!entity) {
				console.warn(
					"[ScenarioBuilder] Entity not found in state for id:",
					entityId,
					"— known ids:",
					entities.map((e) => e.id),
				);
				return;
			}
			console.log(
				`[ScenarioBuilder] Selected entity: "${entity.name}" (${entity.entity_type})`,
			);
			setSelectedTemplate(entity);
			setPlacementMode("none");
			setChatContext(null);
		},
		[entities],
	);

	const handleEditEntity = useCallback(() => {
		if (!selectedTemplate) return;
		if (selectedTemplate.entity_type === "dungeon") return;
		console.log(
			`[ScenarioBuilder] Opening edit chat for "${selectedTemplate.name}" (${selectedTemplate.id})`,
		);
		setChatContext({
			entityType: selectedTemplate.entity_type as
				| "enemy"
				| "npc"
				| "friendly"
				| "vehicle"
				| "poi",
			lat: selectedTemplate.lat,
			lng: selectedTemplate.lng,
			existingEntity: selectedTemplate,
		});
		setPlacementMode("none");
	}, [selectedTemplate]);

	const handleEntityConfirm = useCallback(
		async (
			entityName: string,
			definition: Record<string, unknown>,
			count: number,
		) => {
			if (!scenarioId || !chatContext) return;

			// Edit mode: update the existing entity in place
			if (chatContext.existingEntity) {
				console.log(
					`[ScenarioBuilder] Saving edits to "${entityName}" (${chatContext.existingEntity.id})`,
				);
				try {
					await api.updateScenarioEntity(
						scenarioId,
						chatContext.existingEntity.id,
						{ name: entityName, definition },
					);
					console.log("[ScenarioBuilder] Entity updated successfully");
				} catch (e) {
					console.error("[ScenarioBuilder] updateScenarioEntity failed:", e);
				}
				setEntities((prev) =>
					prev.map((e) =>
						e.id === chatContext.existingEntity!.id
							? { ...e, name: entityName, definition }
							: e,
					),
				);
				setSelectedTemplate((prev) =>
					prev?.id === chatContext.existingEntity!.id
						? { ...prev, name: entityName, definition }
						: prev,
				);
				setChatContext(null);
				return;
			}

			// Create mode: place one or more new entities
			const positions = clusterPositions(
				chatContext.lat,
				chatContext.lng,
				count,
			);
			console.log(
				`[ScenarioBuilder] Placing ${count}× "${entityName}" (${chatContext.entityType}) — ${positions.length} position(s)`,
			);

			try {
				const saved = await Promise.all(
					positions.map(([lat, lng]) => {
						const [gridX, gridY] = latLngToGrid(lat, lng, startLat, startLng);
						console.log(
							`[ScenarioBuilder]  → saveScenarioEntity at (${lat.toFixed(5)}, ${lng.toFixed(5)}) grid=(${gridX},${gridY})`,
						);
						return api.saveScenarioEntity(scenarioId, {
							entity_type: chatContext.entityType,
							lat,
							lng,
							grid_x: gridX,
							grid_y: gridY,
							name: entityName,
							definition,
						}) as Promise<ScenarioEntity>;
					}),
				);
				const succeeded = saved.filter((r) => (r as any)?.id);
				console.log(
					`[ScenarioBuilder] ${succeeded.length}/${positions.length} entities saved successfully`,
					succeeded.map((e: any) => e.id),
				);
				setEntities((prev) => [
					...prev,
					...succeeded.map((e) => normalizeScenarioEntity(e)),
				]);
			} catch (e) {
				console.error("[ScenarioBuilder] saveScenarioEntity failed:", e);
			}
			setChatContext(null);
		},
		[scenarioId, chatContext, startLat, startLng],
	);

	const handleEntityConfirmBatch = useCallback(
		async (
			entities: Array<{ name: string; definition: Record<string, unknown> }>,
		) => {
			if (!scenarioId || !chatContext) return;

			const positions = clusterPositions(
				chatContext.lat,
				chatContext.lng,
				entities.length,
			);

			const saved: ScenarioEntity[] = [];
			for (let i = 0; i < entities.length; i++) {
				const { name, definition } = entities[i];
				const [lat, lng] = positions[i];
				const [gridX, gridY] = latLngToGrid(lat, lng, startLat, startLng);
				console.log(
					`[ScenarioBuilder] Batch placing "${name}" at (${lat.toFixed(5)}, ${lng.toFixed(5)}) grid=(${gridX},${gridY})`,
				);
				try {
					const result = (await api.saveScenarioEntity(scenarioId, {
						entity_type: chatContext.entityType,
						lat,
						lng,
						grid_x: gridX,
						grid_y: gridY,
						name,
						definition,
					})) as ScenarioEntity;
					if ((result as any)?.id) {
						saved.push(normalizeScenarioEntity(result));
					}
				} catch (e) {
					console.error(
						`[ScenarioBuilder] Batch save failed for "${name}":`,
						e,
					);
				}
			}
			console.log(
				`[ScenarioBuilder] Batch placed ${saved.length}/${entities.length} entities`,
			);
			setEntities((prev) => [...prev, ...saved]);
			setChatContext(null);
		},
		[scenarioId, chatContext, startLat, startLng],
	);

	const handleUpdateEntityDefinition = useCallback(
		async (entityId: string, definition: Record<string, unknown>) => {
			if (!scenarioId) return;
			try {
				await api.updateScenarioEntity(scenarioId, entityId, { definition });
			} catch (e) {
				console.error(
					"[ScenarioBuilder] updateScenarioEntity (definition) failed:",
					e,
				);
			}
			setEntities((prev) =>
				prev.map((e) => (e.id === entityId ? { ...e, definition } : e)),
			);
			setSelectedTemplate((prev) =>
				prev?.id === entityId ? { ...prev, definition } : prev,
			);
		},
		[scenarioId],
	);

	const handleDeleteEntity = useCallback(
		async (entityId: string) => {
			if (!scenarioId) return;
			console.log("[ScenarioBuilder] Deleting entity:", entityId);
			try {
				await api.deleteScenarioEntity(scenarioId, entityId);
				console.log("[ScenarioBuilder] Entity deleted");
			} catch (e) {
				console.error("[ScenarioBuilder] deleteScenarioEntity failed:", e);
			}
			setEntities((prev) => prev.filter((e) => e.id !== entityId));
			if (selectedTemplate?.id === entityId) {
				setSelectedTemplate(null);
				setPlacementMode("none");
			}
		},
		[scenarioId, selectedTemplate],
	);

	// ── Step 3 ──

	const handleSave = useCallback(async () => {
		if (!scenarioId) return;
		console.log(
			`[ScenarioBuilder] Saving scenario "${name}" (${scenarioId}) with ${entities.length} entities`,
		);
		setSaving(true);
		try {
			await api.updateScenario(scenarioId, {
				name: name.trim(),
				description: description.trim() || undefined,
				gm_kind: gmKind,
				start_lat: startLat,
				start_lng: startLng,
				wandering_monster_config: wanderingMonsterConfig ?? undefined,
			});
			console.log("[ScenarioBuilder] Scenario saved successfully");
			onBack();
		} catch (e) {
			console.error("[ScenarioBuilder] Save failed:", e);
		} finally {
			setSaving(false);
		}
	}, [
		scenarioId,
		name,
		description,
		gmKind,
		startLat,
		startLng,
		wanderingMonsterConfig,
		entities,
		onBack,
	]);

	if (loadingEdit) {
		return (
			<div
				className="scenario-builder fade-in"
				style={{ alignItems: "center", justifyContent: "center" }}
			>
				<div className="gm-thinking-dots" style={{ margin: "4rem auto" }}>
					<span />
					<span />
					<span />
				</div>
				<p className="text-dim text-sm" style={{ textAlign: "center" }}>
					Loading scenario…
				</p>
			</div>
		);
	}

	return (
		<div className="scenario-builder fade-in">
			{/* Header */}
			<div className="scenario-builder-header">
				<button className="btn" onClick={onBack}>
					&larr; Back
				</button>
				<h2 className="scenario-builder-title">
					{editScenarioId ? (
						<>
							SCENARIO<span className="accent"> EDITOR</span>
						</>
					) : (
						<>
							SCENARIO<span className="accent"> BUILDER</span>
						</>
					)}
				</h2>
				<div className="scenario-steps">
					<span
						className={`scenario-step ${step === "info" ? "active" : step === "map" || step === "review" ? "done" : ""}`}
					>
						1. Info
					</span>
					<span className="scenario-step-arrow">&rarr;</span>
					<span
						className={`scenario-step ${step === "map" ? "active" : step === "review" ? "done" : ""}`}
					>
						2. Map
					</span>
					<span className="scenario-step-arrow">&rarr;</span>
					<span
						className={`scenario-step ${step === "review" ? "active" : ""}`}
					>
						3. Review
					</span>
				</div>
			</div>

			{/* ── Step 1: Basic Info ── */}
			{step === "info" && (
				<InfoStep
					name={name}
					setName={setName}
					gmKind={gmKind}
					setGmKind={setGmKind}
					startLat={startLat}
					setStartLat={setStartLat}
					startLng={startLng}
					setStartLng={setStartLng}
					scenarioId={scenarioId}
					wanderingMonsterConfig={wanderingMonsterConfig}
					onWanderingMonsterChange={(config) =>
						setWanderingMonsterConfig(config)
					}
					infoError={infoError}
					creating={creating}
					onCreateScenario={handleCreateScenario}
					onApplyDescription={(text) => setDescription(text)}
				/>
			)}

			{/* ── Step 2: Map Editor ── */}
			{step === "map" && scenarioId && (
				<MapStep
					scenarioId={scenarioId}
					name={name}
					setName={setName}
					description={description}
					setDescription={setDescription}
					startLat={startLat}
					startLng={startLng}
					entities={entities}
					scenarioPoiNames={scenarioPoiNames}
					scenarioNpcNames={scenarioNpcNames}
					scenarioVehicleNames={scenarioVehicleNames}
					placementMode={placementMode}
					selectedTemplate={selectedTemplate}
					chatContext={chatContext}
					dungeonContext={dungeonContext}
					wanderingMonsterConfig={wanderingMonsterConfig}
					setWanderingMonsterConfig={setWanderingMonsterConfig}
					onToggleMode={toggleMode}
					onMapClick={handleMapClick}
					onEntityClick={handleEntityClick}
					onEditEntity={handleEditEntity}
					onEntityConfirm={handleEntityConfirm}
					onEntityConfirmBatch={handleEntityConfirmBatch}
					onUpdateEntityDefinition={handleUpdateEntityDefinition}
					onDeleteEntity={handleDeleteEntity}
					onDungeonPolygonComplete={handleDungeonPolygonComplete}
					onDungeonConfirm={handleDungeonConfirm}
					onClearSelectedTemplate={() => setSelectedTemplate(null)}
					onClearChatContext={() => setChatContext(null)}
					onClearDungeonContext={() => setDungeonContext(null)}
					onClearPlacementMode={() => setPlacementMode("none")}
					onGoToReview={() => setStep("review")}
				/>
			)}

			{/* ── Step 3: Review ── */}
			{step === "review" && (
				<ReviewStep
					name={name}
					description={description}
					gmKind={gmKind}
					startLat={startLat}
					startLng={startLng}
					wanderingMonsterConfig={wanderingMonsterConfig}
					entities={entities}
					saving={saving}
					onSave={handleSave}
					onBackToMap={() => setStep("map")}
					onDeleteEntity={handleDeleteEntity}
				/>
			)}
		</div>
	);
}
