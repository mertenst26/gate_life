import type { ScenarioEntity } from "@gate-life/shared";
import { useEffect, useRef, useState } from "react";
import { useResizablePanelWidth } from "../hooks/useResizablePanelWidth";
import type { PlacementMode } from "./ScenarioMapPanel";

interface Props {
	entity: ScenarioEntity;
	placementMode: PlacementMode;
	onEdit: () => void;
	onToggleCopy: () => void;
	onToggleRelocate: () => void;
	onClose: () => void;
	/** Called when the user edits priorities inline so ScenarioBuilder can persist. */
	onUpdateDefinition?: (definition: Record<string, unknown>) => void;
	/** Called when the user confirms deleting this entity. */
	onDelete?: () => void;
	/** POI names placed on this scenario — link a priority to reveal that POI when the quest is accepted in play. */
	scenarioPoiNames?: string[];
	/** NPC names placed on this scenario — link a priority to reveal or interact with that NPC. */
	scenarioNpcNames?: string[];
	/** Vehicle/friendly names placed on this scenario — link to spawn_support item abilities so activating the beacon calls those exact units. */
	scenarioVehicleNames?: string[];
}

/** Fields we render with dedicated labels + formatting; everything else is shown generically. */
const KNOWN_FIELDS: Record<string, string> = {
	enemy_type: "Enemy Type",
	class_id: "Class",
	personality: "Personality",
	hp_max: "Hit Points",
	sdc_max: "SDC",
	mdc_max: "MDC",
	armor_mdc_max: "Armor MDC",
	apm: "Actions / Melee",
	initiative_bonus: "Initiative",
	strike_bonus: "Strike",
	parry_bonus: "Parry",
	dodge_bonus: "Dodge",
	damage: "Damage",
	damage_type: "Damage Type",
	isp_max: "ISP",
	ppe_max: "PPE",
};

const ARRAY_FIELDS: Record<string, string> = {
	abilities: "Abilities",
	psionic_powers: "Psionic Powers",
	skills: "Skills",
	loot_table: "Loot",
	inventory: "Inventory",
	giveable_items: "Items to Give",
	crew: "Crew Members",
};

/** Keys we never show in the generic overflow section. */
const SKIP_FIELDS = new Set([
	"name",
	"priorities",
	"priority_mission_pois",
	"vehicle_config",
	"linked_entities",
	...Object.keys(KNOWN_FIELDS),
	...Object.keys(ARRAY_FIELDS),
]);

function toLabel(key: string): string {
	return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderValue(val: unknown): string {
	if (val === null || val === undefined) return "—";
	if (typeof val === "object") return JSON.stringify(val);
	return String(val);
}

const DETAIL_PANEL_WIDTH_KEY = "gate-life.panel.entityDetail";

export function EntityDetailPanel({
	entity,
	placementMode,
	onEdit,
	onToggleCopy,
	onToggleRelocate,
	onClose,
	onUpdateDefinition,
	onDelete,
	scenarioPoiNames = [],
	scenarioNpcNames = [],
	scenarioVehicleNames = [],
}: Props) {
	const { width: panelWidth, resizeHandleProps } = useResizablePanelWidth(
		DETAIL_PANEL_WIDTH_KEY,
		320,
	);
	const def = (entity.definition ?? {}) as Record<string, unknown>;
	const isCopying = placementMode === "copy";
	const isRelocating = placementMode === "relocate";

	// ── Priorities inline editor ─────────────────────────────────────────────
	const isNpc = entity.entity_type === "npc";
	const [priorities, setPriorities] = useState<string[]>(
		Array.isArray(def.priorities) ? (def.priorities as string[]) : [],
	);
	const [missionPois, setMissionPois] = useState<(string | null)[]>(() => {
		const pri = Array.isArray(def.priorities)
			? (def.priorities as string[])
			: [];
		const raw = Array.isArray(def.priority_mission_pois)
			? (def.priority_mission_pois as (string | null)[])
			: [];
		return pri.map((_, i) => (i < raw.length ? (raw[i] ?? null) : null));
	});
	const [newPriority, setNewPriority] = useState("");
	const priorityInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		const d = (entity.definition ?? {}) as Record<string, unknown>;
		const pri = Array.isArray(d.priorities) ? (d.priorities as string[]) : [];
		const raw = Array.isArray(d.priority_mission_pois)
			? (d.priority_mission_pois as (string | null)[])
			: [];
		setPriorities(pri);
		setMissionPois(
			pri.map((_, i) => (i < raw.length ? (raw[i] ?? null) : null)),
		);
	}, [entity.id, entity.definition]);

	const persistPriorities = (nextPri: string[], nextMp: (string | null)[]) => {
		setPriorities(nextPri);
		setMissionPois(nextMp);
		if (onUpdateDefinition) {
			onUpdateDefinition({
				...def,
				priorities: nextPri,
				priority_mission_pois: nextPri.map((_, i) => nextMp[i] ?? null),
			});
		}
	};

	const addPriority = () => {
		const trimmed = newPriority.trim();
		if (!trimmed) return;
		persistPriorities([...priorities, trimmed], [...missionPois, null]);
		setNewPriority("");
		priorityInputRef.current?.focus();
	};

	const removePriority = (idx: number) => {
		persistPriorities(
			priorities.filter((_, i) => i !== idx),
			missionPois.filter((_, i) => i !== idx),
		);
	};

	const setMissionPoiAt = (idx: number, poiName: string | null) => {
		const next = missionPois.map((p, i) => (i === idx ? poiName : p));
		while (next.length < priorities.length) next.push(null);
		persistPriorities(priorities, next.slice(0, priorities.length));
	};

	// ── Giveable items editor ────────────────────────────────────────────────
	const ITEM_TYPES = [
		"misc",
		"special",
		"weapon_melee",
		"weapon_ranged",
		"armor",
		"consumable",
		"ammo",
		"container",
	] as const;

	const [giveableItems, setGiveableItems] = useState<
		Array<Record<string, unknown>>
	>(
		Array.isArray(def.giveable_items)
			? (def.giveable_items as Array<Record<string, unknown>>)
			: [],
	);

	const blankNewItem = () => ({
		name: "",
		type: "misc",
		description: "",
		uses: "" as string | number,
		addAbility: false,
		abilityName: "Activate",
		abilityDesc: "",
	});
	const [addingItem, setAddingItem] = useState(false);
	const [newItem, setNewItem] = useState(blankNewItem);

	useEffect(() => {
		const d = (entity.definition ?? {}) as Record<string, unknown>;
		setGiveableItems(
			Array.isArray(d.giveable_items)
				? (d.giveable_items as Array<Record<string, unknown>>)
				: [],
		);
	}, [entity.id, entity.definition]);

	const persistItems = (updated: Array<Record<string, unknown>>) => {
		setGiveableItems(updated);
		if (onUpdateDefinition) {
			onUpdateDefinition({ ...def, giveable_items: updated });
		}
	};

	const commitNewItem = () => {
		if (!newItem.name.trim()) return;
		const item: Record<string, unknown> = {
			name: newItem.name.trim(),
			type: newItem.type,
			description: newItem.description.trim() || undefined,
			uses: newItem.uses === "" ? undefined : Number(newItem.uses),
		};
		if (newItem.addAbility) {
			item.abilities = [
				{
					ability_type: "spawn_support",
					name: newItem.abilityName.trim() || "Activate",
					description: newItem.abilityDesc.trim(),
					linked_entity_names: [],
				},
			];
		}
		persistItems([...giveableItems, item]);
		setAddingItem(false);
		setNewItem(blankNewItem());
	};

	const removeItem = (idx: number) => {
		persistItems(giveableItems.filter((_, i) => i !== idx));
	};

	const toggleLinkedEntity = (
		itemIdx: number,
		abilityIdx: number,
		vehicleName: string,
	) => {
		const updated = giveableItems.map((item, ii) => {
			if (ii !== itemIdx) return item;
			const abilities = Array.isArray(item.abilities)
				? (item.abilities as Array<Record<string, unknown>>)
				: [];
			const updatedAbilities = abilities.map((ab, ai) => {
				if (ai !== abilityIdx) return ab;
				const current = Array.isArray(ab.linked_entity_names)
					? (ab.linked_entity_names as string[])
					: [];
				const next = current.includes(vehicleName)
					? current.filter((n) => n !== vehicleName)
					: [...current, vehicleName];
				return { ...ab, linked_entity_names: next };
			});
			return { ...item, abilities: updatedAbilities };
		});
		persistItems(updated);
	};

	// Collect stat rows (known fields, skip nulls)
	const statRows = Object.entries(KNOWN_FIELDS).filter(([k]) => {
		const v = def[k];
		return v !== undefined && v !== null;
	});

	// Array/list fields
	const listRows = Object.entries(ARRAY_FIELDS).filter(([k]) => {
		const v = def[k];
		return Array.isArray(v) && (v as unknown[]).length > 0;
	});

	// Any extra fields not covered above
	const extraRows = Object.entries(def).filter(
		([k, v]) => !SKIP_FIELDS.has(k) && v !== undefined && v !== null,
	);

	return (
		<div
			className="entity-detail-panel panel fade-in"
			style={{ width: panelWidth }}
		>
			<div
				className="entity-panel-resize-handle"
				role="separator"
				aria-orientation="vertical"
				aria-label="Resize side panel"
				tabIndex={0}
				{...resizeHandleProps}
			/>
			{/* Header */}
			<div className="entity-detail-header">
				<div className="entity-detail-title">
					<span className={`entity-type-badge ${entity.entity_type}`}>
						{entity.entity_type.toUpperCase()}
					</span>
					<h3>{entity.name}</h3>
				</div>
				<button className="btn btn-sm" onClick={onClose} title="Close">
					✕
				</button>
			</div>

			<div className="entity-detail-body">
				{/* ── Priorities / Missions — NPC only ── */}
				{isNpc && (
					<section className="entity-detail-section entity-priorities-section">
						<h4 className="entity-detail-section-title entity-priorities-title">
							Priorities &amp; Missions
						</h4>
						<p className="entity-priorities-desc text-xs text-dim">
							What this NPC is trying to accomplish. Quest-giver NPCs pursue
							these goals by assigning them to the players as missions. Order is
							important: the first priority is offered in play before the
							second, then the third, and so on. Completing a mission requires
							convincing this NPC in play (proof helps); they decide when it
							counts. Optionally link a priority to a POI on this scenario so
							accepting that mission marks it in yellow on the in-game map.
						</p>
						{priorities.length === 0 && (
							<p className="text-xs text-dim entity-priorities-empty">
								No priorities set — add at least one to guide scenario flow.
							</p>
						)}
						<ul className="entity-priorities-list">
							{priorities.map((p, i) => (
								<li
									key={i}
									className="entity-priority-item entity-priority-item-with-poi"
								>
									<span className="entity-priority-bullet">▶</span>
									<div className="entity-priority-stack">
										<span className="entity-priority-text">{p}</span>
										{(scenarioPoiNames.length > 0 ||
											scenarioNpcNames.length > 0) && (
											<label className="entity-priority-poi-row text-xs text-dim">
												<span className="entity-priority-poi-label">
													Mission map marker
												</span>
												<select
													className="entity-priority-poi-select"
													value={missionPois[i] ?? ""}
													onChange={(e) =>
														setMissionPoiAt(i, e.target.value || null)
													}
												>
													<option value="">— None —</option>
													{scenarioPoiNames.length > 0 && (
														<optgroup label="POIs">
															{scenarioPoiNames.map((name) => (
																<option key={name} value={name}>
																	{name}
																</option>
															))}
														</optgroup>
													)}
													{scenarioNpcNames.length > 0 && (
														<optgroup label="NPCs">
															{scenarioNpcNames.map((name) => (
																<option key={name} value={name}>
																	{name}
																</option>
															))}
														</optgroup>
													)}
												</select>
											</label>
										)}
									</div>
									<button
										className="entity-priority-remove"
										title="Remove priority"
										onClick={() => removePriority(i)}
									>
										✕
									</button>
								</li>
							))}
						</ul>
						{priorities.length > 0 &&
							scenarioPoiNames.length === 0 &&
							scenarioNpcNames.length === 0 && (
								<p className="text-xs text-dim entity-priorities-empty">
									Add a + POI or + NPC on the map to link missions to map
									markers.
								</p>
							)}
						<div className="entity-priority-add-row">
							<input
								ref={priorityInputRef}
								className="entity-priority-input"
								value={newPriority}
								onChange={(e) => setNewPriority(e.target.value)}
								onKeyDown={(e) => e.key === "Enter" && addPriority()}
								placeholder="e.g. Find someone to recover the stolen cargo"
							/>
							<button
								className="btn btn-sm"
								onClick={addPriority}
								disabled={!newPriority.trim()}
							>
								Add
							</button>
						</div>
					</section>
				)}

				{/* Vehicle Configuration */}
				{entity.entity_type === "vehicle" && def.vehicle_config && (
					<section className="entity-detail-section">
						<h4 className="entity-detail-section-title">
							Vehicle Configuration
						</h4>
						<div className="entity-stat-grid">
							<div className="entity-stat-row">
								<span className="entity-stat-label">Include Crew</span>
								<span className="entity-stat-value">
									{(def.vehicle_config as any).include_crew ? "Yes" : "No"}
								</span>
							</div>
							{(def.vehicle_config as any).speed && (
								<div className="entity-stat-row">
									<span className="entity-stat-label">Speed</span>
									<span className="entity-stat-value">
										{(def.vehicle_config as any).speed} units/round (
										{(def.vehicle_config as any).speed * 10} ft/round)
									</span>
								</div>
							)}
							{(def.vehicle_config as any).max_fuel && (
								<div className="entity-stat-row">
									<span className="entity-stat-label">Fuel</span>
									<span className="entity-stat-value">
										{(def.vehicle_config as any).fuel || 0} /{" "}
										{(def.vehicle_config as any).max_fuel}
									</span>
								</div>
							)}
							{(def.vehicle_config as any).capacity !== undefined && (
								<div className="entity-stat-row">
									<span className="entity-stat-label">Capacity</span>
									<span className="entity-stat-value">
										{(def.vehicle_config as any).capacity} troops
									</span>
								</div>
							)}
						</div>
						{(def.vehicle_config as any).crew &&
							Array.isArray((def.vehicle_config as any).crew) &&
							(def.vehicle_config as any).crew.length > 0 && (
								<>
									<h5
										className="entity-detail-section-title"
										style={{ marginTop: "0.75rem", fontSize: "0.85rem" }}
									>
										Crew Members
									</h5>
									<ul className="entity-detail-list">
										{(
											(def.vehicle_config as any).crew as Array<
												Record<string, unknown>
											>
										).map((crew: Record<string, unknown>, i: number) => (
											<li key={i} className="entity-detail-list-item">
												<strong>{crew.role as string}</strong>
												{crew.name && <span> — {crew.name as string}</span>}
												{crew.hp_max && (
													<span className="text-dim text-xs">
														{" "}
														(HP {crew.hp_max}, SDC {crew.sdc_max}, MDC{" "}
														{crew.mdc_max})
													</span>
												)}
												{crew.skills &&
													Array.isArray(crew.skills) &&
													crew.skills.length > 0 && (
														<div className="text-xs text-dim">
															Skills: {(crew.skills as string[]).join(", ")}
														</div>
													)}
											</li>
										))}
									</ul>
								</>
							)}
					</section>
				)}

			{/* Giveable Items (for NPCs / friendlies) */}
			{(entity.entity_type === "npc" ||
				entity.entity_type === "friendly") && (
				<section className="entity-detail-section entity-priorities-section">
					<h4 className="entity-detail-section-title entity-priorities-title">
						Items This NPC Can Give
					</h4>
					<p
						className="entity-priorities-desc text-xs text-dim"
					>
						Items the GM can hand to players through dialogue or narration.
						Use a <em>spawn_support</em> ability to link the item to specific
						vehicles or units already placed on this scenario — activating it
						in-play will call those exact units to the party's position.
					</p>

					{giveableItems.length > 0 && (
						<ul className="entity-priorities-list" style={{ marginBottom: "0.5rem" }}>
							{giveableItems.map((item, i) => {
								const abilities = Array.isArray(item.abilities)
									? (item.abilities as Array<Record<string, unknown>>)
									: [];
								return (
									<li
										key={i}
										className="entity-priority-item entity-priority-item-with-poi"
										style={{ flexDirection: "column", alignItems: "flex-start", gap: "0.35rem" }}
									>
										<div style={{ display: "flex", width: "100%", alignItems: "center", gap: "0.4rem" }}>
											<span className="entity-priority-bullet">●</span>
											<div style={{ flex: 1 }}>
												<strong>{item.name as string}</strong>
												<span className="text-dim"> · {item.type as string}</span>
												{item.uses != null && (
													<span className="text-dim"> · {item.uses as number} use{Number(item.uses) !== 1 ? "s" : ""}</span>
												)}
											</div>
											<button
												className="entity-priority-remove"
												title="Remove item"
												onClick={() => removeItem(i)}
											>
												✕
											</button>
										</div>
										{item.description && (
											<div className="text-xs text-dim" style={{ paddingLeft: "1.4rem" }}>
												{item.description as string}
											</div>
										)}
										{abilities.map((ab, ai) => (
											<div
												key={ai}
												style={{
													paddingLeft: "1.4rem",
													width: "100%",
												}}
											>
												<div className="text-xs" style={{ marginBottom: "0.2rem" }}>
													<span style={{ color: "var(--color-accent, #f0c040)" }}>
														⚡ {ab.name as string}
													</span>
													<span className="text-dim"> ({ab.ability_type as string})</span>
												</div>
												{ab.description && (
													<div className="text-xs text-dim" style={{ marginBottom: "0.25rem" }}>
														{ab.description as string}
													</div>
												)}
												{ab.ability_type === "spawn_support" && (
													<div className="text-xs text-dim">
														<div style={{ marginBottom: "0.2rem", fontWeight: 600 }}>
															Units called when activated:
														</div>
														{scenarioVehicleNames.length === 0 && (
															<span style={{ fontStyle: "italic", opacity: 0.6 }}>
																No vehicles/friendlies on map yet — place some first.
															</span>
														)}
														{scenarioVehicleNames.map((vName) => {
															const linked = Array.isArray(ab.linked_entity_names)
																? (ab.linked_entity_names as string[])
																: [];
															return (
																<label
																	key={vName}
																	style={{
																		display: "flex",
																		alignItems: "center",
																		gap: "0.4rem",
																		cursor: "pointer",
																		padding: "0.1rem 0",
																	}}
																>
																	<input
																		type="checkbox"
																		checked={linked.includes(vName)}
																		onChange={() => toggleLinkedEntity(i, ai, vName)}
																	/>
																	{vName}
																</label>
															);
														})}
														{(Array.isArray(ab.linked_entity_names)
															? (ab.linked_entity_names as string[])
															: []
														).length === 0 &&
															scenarioVehicleNames.length > 0 && (
																<span style={{ fontStyle: "italic", opacity: 0.6 }}>
																	None checked — generic units will spawn instead.
																</span>
															)}
													</div>
												)}
											</div>
										))}
									</li>
								);
							})}
						</ul>
					)}

					{giveableItems.length === 0 && !addingItem && (
						<p className="text-xs text-dim entity-priorities-empty">
							No items yet — add one below.
						</p>
					)}

					{/* Add item form */}
					{addingItem ? (
						<div
							style={{
								background: "var(--color-bg-secondary, rgba(0,0,0,0.3))",
								border: "1px solid var(--color-border, rgba(255,255,255,0.1))",
								borderRadius: "6px",
								padding: "0.75rem",
								display: "flex",
								flexDirection: "column",
								gap: "0.5rem",
							}}
						>
							<div style={{ display: "flex", gap: "0.5rem" }}>
								<input
									className="entity-priority-input"
									style={{ flex: 2 }}
									placeholder="Item name (e.g. Homing Beacon)"
									value={newItem.name}
									onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
									onKeyDown={(e) => e.key === "Enter" && commitNewItem()}
									autoFocus
								/>
								<select
									className="entity-priority-poi-select"
									style={{ flex: 1 }}
									value={newItem.type}
									onChange={(e) => setNewItem({ ...newItem, type: e.target.value })}
								>
									{ITEM_TYPES.map((t) => (
										<option key={t} value={t}>{t}</option>
									))}
								</select>
							</div>
							<textarea
								className="entity-priority-input"
								style={{ resize: "vertical", minHeight: "3rem", fontFamily: "inherit", fontSize: "0.8rem" }}
								placeholder="Description (optional)"
								value={newItem.description}
								onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
							/>
							<div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
								<input
									className="entity-priority-input"
									style={{ width: "5rem" }}
									type="number"
									min={1}
									placeholder="Uses"
									value={newItem.uses}
									onChange={(e) => setNewItem({ ...newItem, uses: e.target.value })}
								/>
								<span className="text-xs text-dim">uses (leave blank = unlimited)</span>
							</div>

							{/* spawn_support ability toggle */}
							<label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }} className="text-xs">
								<input
									type="checkbox"
									checked={newItem.addAbility}
									onChange={(e) => setNewItem({ ...newItem, addAbility: e.target.checked })}
								/>
								<span>Add a <strong>spawn_support</strong> ability (beacon / summon / extraction call)</span>
							</label>

							{newItem.addAbility && (
								<div
									style={{
										paddingLeft: "1.2rem",
										display: "flex",
										flexDirection: "column",
										gap: "0.4rem",
										borderLeft: "2px solid var(--color-accent, #f0c040)",
									}}
								>
									<input
										className="entity-priority-input"
										placeholder="Ability name (e.g. Activate Beacon)"
										value={newItem.abilityName}
										onChange={(e) => setNewItem({ ...newItem, abilityName: e.target.value })}
									/>
									<textarea
										className="entity-priority-input"
										style={{ resize: "vertical", minHeight: "2.5rem", fontFamily: "inherit", fontSize: "0.8rem" }}
										placeholder="What happens when it's used (e.g. Transmits extraction coordinates to sky lifters)"
										value={newItem.abilityDesc}
										onChange={(e) => setNewItem({ ...newItem, abilityDesc: e.target.value })}
									/>
									<p className="text-xs text-dim" style={{ margin: 0 }}>
										After saving, use the checkboxes that appear to link specific vehicles/units from this scenario.
									</p>
								</div>
							)}

							<div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
								<button
									className="btn btn-sm"
									onClick={() => { setAddingItem(false); setNewItem(blankNewItem()); }}
								>
									Cancel
								</button>
								<button
									className="btn btn-sm btn-primary"
									onClick={commitNewItem}
									disabled={!newItem.name.trim()}
								>
									Add Item
								</button>
							</div>
						</div>
					) : (
						<div className="entity-priority-add-row">
							<button
								className="btn btn-sm"
								onClick={() => setAddingItem(true)}
							>
								+ Add Item
							</button>
						</div>
					)}
				</section>
			)}

				{/* Core stats */}
				{statRows.length > 0 && (
					<section className="entity-detail-section">
						<h4 className="entity-detail-section-title">Stats</h4>
						<div className="entity-stat-grid">
							{statRows.map(([k, label]) => (
								<div key={k} className="entity-stat-row">
									<span className="entity-stat-label">{label}</span>
									<span className="entity-stat-value">
										{renderValue(def[k])}
									</span>
								</div>
							))}
						</div>
					</section>
				)}

				{/* List fields */}
				{listRows.map(([k, label]) => {
					const items = def[k] as unknown[];
					return (
						<section key={k} className="entity-detail-section">
							<h4 className="entity-detail-section-title">{label}</h4>
							<ul className="entity-detail-list">
								{items.map((item, i) => (
									<li key={i} className="entity-detail-list-item">
										{typeof item === "object"
											? JSON.stringify(item)
											: String(item)}
									</li>
								))}
							</ul>
						</section>
					);
				})}

				{/* Extra / custom fields */}
				{extraRows.length > 0 && (
					<section className="entity-detail-section">
						<h4 className="entity-detail-section-title">Additional Info</h4>
						<div className="entity-stat-grid">
							{extraRows.map(([k, v]) => (
								<div key={k} className="entity-stat-row">
									<span className="entity-stat-label">{toLabel(k)}</span>
									<span className="entity-stat-value">{renderValue(v)}</span>
								</div>
							))}
						</div>
					</section>
				)}
			</div>

		{/* Actions */}
		<div className="entity-detail-actions">
			<button className="btn btn-sm" onClick={onEdit}>
				Edit
			</button>
			<button
				className={`btn btn-sm ${isRelocating ? "btn-active" : ""}`}
				onClick={onToggleRelocate}
				title={
					isRelocating
						? "Cancel relocation"
						: "Click the map to move this unit"
				}
			>
				{isRelocating ? "Moving… (cancel)" : "Relocate"}
			</button>
			<button
				className={`btn btn-sm ${isCopying ? "btn-active" : "btn-primary"}`}
				onClick={onToggleCopy}
				title={
					isCopying ? "Cancel copy mode" : "Click the map to stamp copies"
				}
			>
				{isCopying ? "Copying… (cancel)" : "Copy to Map"}
			</button>
			{onDelete && (
				<button
					className="btn btn-sm btn-danger"
					onClick={() => {
						if (window.confirm(`Delete "${entity.name}"? This cannot be undone.`)) {
							onDelete();
						}
					}}
					title="Remove this entity from the scenario"
				>
					Delete
				</button>
			)}
		</div>
		</div>
	);
}
