import type {
	DungeonDefinition,
	ScenarioEntity,
	WanderingMonsterConfig,
} from "@gate-life/shared";
import type { Dispatch, SetStateAction } from "react";
import { api } from "../../hooks/useApi";
import { DungeonDesignerPanel } from "../DungeonDesignerPanel";
import { EntityChatPanel } from "../EntityChatPanel";
import { EntityDetailPanel } from "../EntityDetailPanel";
import {
	type PendingPin,
	type PlacementMode,
	ScenarioMapPanel,
} from "../ScenarioMapPanel";
import type { ChatContext, DungeonContext } from ".";

export interface MapStepProps {
	scenarioId: string;
	name: string;
	setName: (v: string) => void;
	description: string;
	setDescription: (v: string) => void;
	startLat: number;
	startLng: number;
	entities: ScenarioEntity[];
	scenarioPoiNames: string[];
	scenarioNpcNames: string[];
	scenarioVehicleNames: string[];
	placementMode: PlacementMode;
	selectedTemplate: ScenarioEntity | null;
	chatContext: ChatContext | null;
	dungeonContext: DungeonContext | null;
	wanderingMonsterConfig: WanderingMonsterConfig | null;
	setWanderingMonsterConfig: Dispatch<
		SetStateAction<WanderingMonsterConfig | null>
	>;
	onToggleMode: (mode: PlacementMode) => void;
	onMapClick: (lat: number, lng: number) => void;
	onEntityClick: (entityId: string) => void;
	onEditEntity: () => void;
	onEntityConfirm: (
		entityName: string,
		definition: Record<string, unknown>,
		count: number,
	) => Promise<void>;
	onEntityConfirmBatch: (
		entities: Array<{ name: string; definition: Record<string, unknown> }>,
	) => Promise<void>;
	onUpdateEntityDefinition: (
		entityId: string,
		definition: Record<string, unknown>,
	) => Promise<void>;
	onDeleteEntity: (entityId: string) => Promise<void>;
	onDungeonPolygonComplete: (vertices: [number, number][]) => void;
	onDungeonConfirm: (definition: DungeonDefinition) => Promise<void>;
	onClearSelectedTemplate: () => void;
	onClearChatContext: () => void;
	onClearDungeonContext: () => void;
	onClearPlacementMode: () => void;
	onGoToReview: () => void;
}

export function MapStep({
	scenarioId,
	name,
	setName,
	description,
	setDescription,
	startLat,
	startLng,
	entities,
	scenarioPoiNames,
	scenarioNpcNames,
	scenarioVehicleNames,
	placementMode,
	selectedTemplate,
	chatContext,
	dungeonContext,
	wanderingMonsterConfig,
	setWanderingMonsterConfig,
	onToggleMode,
	onMapClick,
	onEntityClick,
	onEditEntity,
	onEntityConfirm,
	onEntityConfirmBatch,
	onUpdateEntityDefinition,
	onDeleteEntity,
	onDungeonPolygonComplete,
	onDungeonConfirm,
	onClearSelectedTemplate,
	onClearChatContext,
	onClearDungeonContext,
	onClearPlacementMode,
	onGoToReview,
}: MapStepProps) {
	return (
		<div className="scenario-map-step fade-in">
			<div className="scenario-info-edit">
				<div className="scenario-info-field">
					<label className="text-xs text-dim">Scenario Name</label>
					<input
						className="scenario-name-input"
						value={name}
						onChange={(e) => setName(e.target.value)}
						onBlur={() => {
							if (scenarioId && name.trim()) {
								api
									.updateScenario(scenarioId, { name })
									.catch((err) =>
										console.error("Failed to update scenario name:", err),
									);
							}
						}}
						placeholder="Enter scenario name..."
					/>
					{/* Wandering monster chance — inline quick-edit */}
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "0.4rem",
							marginTop: "0.4rem",
						}}
					>
						<label
							className="text-xs text-dim"
							style={{ whiteSpace: "nowrap" }}
						>
							Wandering Monster
						</label>
						<input
							type="checkbox"
							checked={wanderingMonsterConfig?.enabled ?? false}
							onChange={(e) => {
								const updated = {
									...(wanderingMonsterConfig ?? {
										enabled: false,
										encounter_chance: 0.4,
										monster_name: "",
										monster_definition: {},
									}),
									enabled: e.target.checked,
								} as WanderingMonsterConfig;
								setWanderingMonsterConfig(updated);
								if (scenarioId) {
									api
										.saveWanderingMonsterConfig(scenarioId, updated)
										.catch(console.error);
								}
							}}
							title="Enable wandering monster encounters"
						/>
						{wanderingMonsterConfig?.enabled && (
							<>
								<input
									type="number"
									min={0.1}
									max={100}
									step={0.1}
									value={wanderingMonsterConfig?.encounter_chance ?? 0.4}
									onChange={(e) => {
										const v = Math.min(
											100,
											Math.max(0.1, Number(e.target.value)),
										);
										setWanderingMonsterConfig((prev) =>
											prev
												? {
														...prev,
														encounter_chance: Math.round(v * 10) / 10,
													}
												: prev,
										);
									}}
									onBlur={() => {
										if (scenarioId && wanderingMonsterConfig) {
											api
												.saveWanderingMonsterConfig(
													scenarioId,
													wanderingMonsterConfig,
												)
												.catch(console.error);
										}
									}}
									style={{ width: "4rem", textAlign: "right" }}
									className="scenario-name-input"
								/>
								<span className="text-xs text-dim">% / turn</span>
								{wanderingMonsterConfig.monster_name && (
									<span
										className="text-xs text-dim"
										style={{ opacity: 0.7 }}
									>
										· {wanderingMonsterConfig.monster_name}
									</span>
								)}
							</>
						)}
					</div>
				</div>
				<div className="scenario-info-field">
					<label className="text-xs text-dim">Description (for GM)</label>
					<textarea
						className="scenario-description-input"
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						onBlur={() => {
							if (scenarioId) {
								api
									.updateScenario(scenarioId, { description })
									.catch((err) =>
										console.error(
											"Failed to update scenario description:",
											err,
										),
									);
							}
						}}
						placeholder="Describe the scenario setting, situation, and key details the GM should know..."
						rows={3}
					/>
				</div>
			</div>
			<div className="scenario-toolbar">
				<div className="toolbar-group">
					<button
						className={`btn btn-sm ${placementMode === "start" ? "btn-active" : ""}`}
						onClick={() => onToggleMode("start")}
						title="Click map to reposition the scenario start point"
					>
						Set Start
					</button>
					<button
						className={`btn btn-sm ${placementMode === "enemy" ? "btn-active" : ""}`}
						onClick={() => onToggleMode("enemy")}
						title="Click map to place an enemy and define it via AI"
					>
						+ Enemy
					</button>
					<button
						className={`btn btn-sm ${placementMode === "npc" ? "btn-active" : ""}`}
						onClick={() => onToggleMode("npc")}
						title="Click map to place an NPC and define it via AI"
					>
						+ NPC
					</button>
					<button
						className={`btn btn-sm ${placementMode === "friendly" ? "btn-active" : ""}`}
						onClick={() => onToggleMode("friendly" as any)}
						title="Click map to place a friendly allied unit"
					>
						+ Friendly
					</button>
					<button
						className={`btn btn-sm ${placementMode === "vehicle" ? "btn-active" : ""}`}
						onClick={() => onToggleMode("vehicle" as any)}
						title="Click map to place a vehicle"
					>
						+ Vehicle
					</button>
					<button
						className={`btn btn-sm ${placementMode === "poi" ? "btn-active" : ""}`}
						onClick={() => onToggleMode("poi" as any)}
						title="Click map to place a point of interest"
					>
						+ POI
					</button>
					<button
						className={`btn btn-sm ${placementMode === "dungeon" ? "btn-active" : ""}`}
						onClick={() => onToggleMode("dungeon")}
						title="Draw a polygon on the map to define a dungeon, then describe it to the AI"
						style={
							placementMode === "dungeon"
								? { borderColor: "#ff6d00", color: "#ff6d00" }
								: {}
						}
					>
						+ Dungeon
					</button>
				</div>

				<div className="toolbar-group">
					<span className="text-xs text-dim">
						{entities.length}{" "}
						{entities.length === 1 ? "entity" : "entities"} placed
					</span>
					<button
						className="btn btn-sm btn-primary"
						onClick={onGoToReview}
					>
						Review & Save
					</button>
				</div>
			</div>

			{/* Hint bar when no mode is active */}
			{placementMode === "none" &&
				!selectedTemplate &&
				!chatContext &&
				!dungeonContext && (
					<div className="scenario-hint-bar">
						Select <strong>+ Enemy</strong>, <strong>+ NPC</strong>,{" "}
						<strong>+ Friendly</strong>, <strong>+ Vehicle</strong>,{" "}
						<strong>+ POI</strong>, or <strong>+ Dungeon</strong> then click
						the map. Click an existing marker to copy it.
					</div>
				)}

			<div className="scenario-map-area">
				<ScenarioMapPanel
					startLat={startLat}
					startLng={startLng}
					entities={entities}
					placementMode={placementMode}
					selectedEntityId={selectedTemplate?.id}
					pendingPin={
						chatContext && !chatContext.existingEntity
							? ({
									lat: chatContext.lat,
									lng: chatContext.lng,
									entityType: chatContext.entityType,
								} as PendingPin)
							: undefined
					}
					fitBoundsKey={scenarioId}
					onMapClick={onMapClick}
					onEntityClick={onEntityClick}
					onDungeonPolygonComplete={onDungeonPolygonComplete}
				/>

				{/* Entity detail panel — shown when an entity is selected and no chat is open */}
				{selectedTemplate &&
					!chatContext &&
					(() => {
						console.log(
							"[ScenarioBuilder] Rendering EntityDetailPanel for:",
							selectedTemplate.name,
						);
						return null;
					})()}
				{selectedTemplate && !chatContext && (
					<EntityDetailPanel
						entity={selectedTemplate}
						placementMode={placementMode}
						onEdit={onEditEntity}
						onToggleCopy={() => onToggleMode("copy")}
						onToggleRelocate={() => onToggleMode("relocate")}
						onClose={() => {
							onClearSelectedTemplate();
							onClearPlacementMode();
						}}
						onUpdateDefinition={(definition) =>
							onUpdateEntityDefinition(selectedTemplate.id, definition)
						}
						scenarioPoiNames={scenarioPoiNames}
						scenarioNpcNames={scenarioNpcNames}
						scenarioVehicleNames={scenarioVehicleNames}
						onDelete={() => onDeleteEntity(selectedTemplate.id)}
					/>
				)}

				{chatContext && (
					<EntityChatPanel
						scenarioId={scenarioId}
						entityType={chatContext.entityType}
						lat={chatContext.lat}
						lng={chatContext.lng}
						existingEntity={chatContext.existingEntity}
						onConfirm={onEntityConfirm}
						onConfirmBatch={onEntityConfirmBatch}
						onCancel={onClearChatContext}
					/>
				)}

				{dungeonContext && (
					<DungeonDesignerPanel
						scenarioId={scenarioId}
						polygonVertices={dungeonContext.vertices}
						lat={dungeonContext.lat}
						lng={dungeonContext.lng}
						onConfirmDungeon={onDungeonConfirm}
						onCancel={onClearDungeonContext}
					/>
				)}
			</div>
		</div>
	);
}
