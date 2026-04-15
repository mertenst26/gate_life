import type { GmKind, WanderingMonsterConfig } from "@gate-life/shared";
import { useCallback, useRef, useState } from "react";
import { api } from "../../hooks/useApi";

// ── Setting Designer ────────────────────────────────────────────────────────

interface SettingMessage {
	role: "user" | "assistant";
	content: string;
}

function SettingDesigner({
	lat,
	lng,
	onApply,
}: {
	lat: number;
	lng: number;
	onApply: (text: string) => void;
}) {
	const [messages, setMessages] = useState<SettingMessage[]>([]);
	const [input, setInput] = useState("");
	const [loading, setLoading] = useState(false);
	const [suggestions, setSuggestions] = useState<string[]>([]);
	const [appliedText, setAppliedText] = useState("");
	const scrollRef = useRef<HTMLDivElement>(null);

	const scrollToBottom = () => {
		setTimeout(() => {
			scrollRef.current?.scrollTo({
				top: scrollRef.current.scrollHeight,
				behavior: "smooth",
			});
		}, 50);
	};

	const send = useCallback(
		async (userText: string) => {
			if (!userText.trim() || loading) return;
			const newMsg: SettingMessage = { role: "user", content: userText.trim() };
			const history = [...messages, newMsg];
			setMessages(history);
			setInput("");
			setSuggestions([]);
			setLoading(true);
			scrollToBottom();
			try {
				const res = await api.chatScenarioSetting({
					lat,
					lng,
					messages: history,
				});
				const assistantMsg: SettingMessage = {
					role: "assistant",
					content: res.reply,
				};
				setMessages((prev) => [...prev, assistantMsg]);
				setSuggestions(res.suggestions ?? []);
			} catch (e) {
				console.error("[SettingDesigner] chat error:", e);
			} finally {
				setLoading(false);
				scrollToBottom();
			}
		},
		[messages, lat, lng, loading],
	);

	const generate = () =>
		send("Generate a setting description for this location.");

	const handleApply = (text: string) => {
		setAppliedText(text);
		onApply(text);
	};

	return (
		<div className="setting-designer">
			<div className="setting-designer-header">
				<span className="text-sm" style={{ fontWeight: 600 }}>
					Setting Designer
				</span>
				<span className="text-xs text-dim" style={{ marginLeft: "0.5rem" }}>
					AI-generated, grounded in map location
				</span>
			</div>

			<div className="setting-chat-history" ref={scrollRef}>
				{messages.length === 0 && !loading && (
					<div className="setting-empty-hint text-xs text-dim">
						Click <strong>Generate from Location</strong> to draft a setting, or
						type a description and let the AI expand it.
					</div>
				)}
				{messages.map((m, i) => (
					<div key={i} className={`setting-msg setting-msg-${m.role}`}>
						{m.role === "assistant" && (
							<div className="setting-msg-actions">
								<button
									className={`btn btn-xs ${appliedText === m.content ? "btn-active" : ""}`}
									onClick={() => handleApply(m.content)}
									title="Use this as the scenario setting"
								>
									{appliedText === m.content ? "✓ Applied" : "Use this setting"}
								</button>
							</div>
						)}
						<div className="setting-msg-content">{m.content}</div>
					</div>
				))}
				{loading && (
					<div className="setting-msg setting-msg-assistant">
						<div className="setting-typing-dots">
							<span />
							<span />
							<span />
						</div>
					</div>
				)}
			</div>

			{suggestions.length > 0 && (
				<div className="setting-suggestions">
					{suggestions.map((s, i) => (
						<button key={i} className="setting-chip" onClick={() => send(s)}>
							{s}
						</button>
					))}
				</div>
			)}

			<div className="setting-input-row">
				<input
					className="setting-input"
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send(input)}
					placeholder="Describe the setting or ask to adjust…"
					disabled={loading}
				/>
				<button
					className="btn btn-sm"
					onClick={() => send(input)}
					disabled={loading || !input.trim()}
				>
					Send
				</button>
				<button
					className="btn btn-sm"
					onClick={generate}
					disabled={loading}
					title="Auto-generate from map coordinates"
				>
					Generate
				</button>
			</div>

			{appliedText && (
				<div className="setting-applied-preview text-xs text-dim">
					Setting applied — will be used by the GM.
				</div>
			)}
		</div>
	);
}

// ── Wandering Monster Designer ────────────────────────────────────────────────

interface WanderingMonsterDesignerProps {
	scenarioId: string | null;
	lat: number;
	lng: number;
	initialConfig?: WanderingMonsterConfig;
	onChange: (config: WanderingMonsterConfig | null) => void;
}

interface WanderingMessage {
	role: "user" | "assistant";
	content: string;
}

function WanderingMonsterDesigner({
	scenarioId,
	lat,
	lng,
	initialConfig,
	onChange,
}: WanderingMonsterDesignerProps) {
	const [enabled, setEnabled] = useState(initialConfig?.enabled ?? false);
	const [encounterChance, setEncounterChance] = useState(
		initialConfig?.encounter_chance ?? 15,
	);
	const [monsterName, setMonsterName] = useState(
		initialConfig?.monster_name ?? "",
	);
	const [monsterDef, setMonsterDef] = useState<Record<string, unknown>>(
		initialConfig?.monster_definition ?? {},
	);
	const [notes, setNotes] = useState(initialConfig?.notes ?? "");
	const [messages, setMessages] = useState<WanderingMessage[]>([]);
	const [input, setInput] = useState("");
	const [loading, setLoading] = useState(false);
	const [suggestions, setSuggestions] = useState<
		Array<{ question: string; chips: string[] }>
	>([]);
	const [appliedConfig, setAppliedConfig] =
		useState<WanderingMonsterConfig | null>(initialConfig ?? null);
	const [pendingConfig, setPendingConfig] =
		useState<WanderingMonsterConfig | null>(null);
	const scrollRef = useRef<HTMLDivElement>(null);

	const emitChange = useCallback(
		(updates: Partial<WanderingMonsterConfig>) => {
			const config: WanderingMonsterConfig = {
				enabled,
				encounter_chance: encounterChance,
				monster_name: monsterName,
				monster_definition: monsterDef,
				notes,
				...updates,
			};
			onChange(config.enabled ? config : null);
		},
		[enabled, encounterChance, monsterName, monsterDef, notes, onChange],
	);

	const handleToggle = (val: boolean) => {
		setEnabled(val);
		if (!val) {
			onChange(null);
			return;
		}
		if (monsterName) emitChange({ enabled: val });
	};

	const handleChanceChange = (val: number) => {
		setEncounterChance(val);
		emitChange({ encounter_chance: val });
	};

	const handleApplyConfig = useCallback(
		(config: WanderingMonsterConfig) => {
			setEnabled(true);
			setEncounterChance(config.encounter_chance);
			setMonsterName(config.monster_name);
			setMonsterDef(config.monster_definition);
			setNotes(config.notes ?? "");
			setAppliedConfig(config);
			onChange({ ...config, enabled: true });
		},
		[onChange],
	);

	const send = useCallback(
		async (userText: string) => {
			if (!userText.trim() || loading || !scenarioId) return;
			const newMsg: WanderingMessage = {
				role: "user",
				content: userText.trim(),
			};
			const history = [...messages, newMsg];
			setMessages(history);
			setInput("");
			setSuggestions([]);
			setLoading(true);
			setTimeout(
				() =>
					scrollRef.current?.scrollTo({
						top: scrollRef.current.scrollHeight,
						behavior: "smooth",
					}),
				50,
			);
			try {
				const res = await api.chatWanderingMonster(scenarioId, history);
				const assistantMsg: WanderingMessage = {
					role: "assistant",
					content: res.reply,
				};
				setMessages((prev) => [...prev, assistantMsg]);
				setSuggestions(res.suggestions ?? []);
				if (res.config) {
					setPendingConfig(res.config);
				}
				setTimeout(
					() =>
						scrollRef.current?.scrollTo({
							top: scrollRef.current.scrollHeight,
							behavior: "smooth",
						}),
					50,
				);
			} catch (e) {
				console.error("[WanderingMonsterDesigner] chat error:", e);
			} finally {
				setLoading(false);
			}
		},
		[messages, scenarioId, loading],
	);

	return (
		<div className="wandering-monster-designer">
			<div className="wm-header">
				<span className="text-sm" style={{ fontWeight: 600 }}>
					Wandering Monster
				</span>
				<label className="wm-toggle-label">
					<input
						type="checkbox"
						checked={enabled}
						onChange={(e) => handleToggle(e.target.checked)}
					/>
					<span className="wm-toggle-text">
						{enabled ? "Enabled" : "Disabled"}
					</span>
				</label>
			</div>

			{enabled && (
				<>
					<div className="wm-chance-row">
						<label className="text-xs">Encounter chance per turn</label>
						<div className="wm-chance-controls">
							<input
								type="range"
								min={0.1}
								max={100}
								step={0.1}
								value={encounterChance}
								onChange={(e) => handleChanceChange(Number(e.target.value))}
								className="wm-slider"
							/>
							<input
								type="number"
								min={0.1}
								max={100}
								step={0.1}
								value={encounterChance}
								onChange={(e) => {
									const v = Math.min(100, Math.max(0.1, Number(e.target.value)));
									handleChanceChange(Math.round(v * 10) / 10);
								}}
								className="wm-chance-input"
								style={{ width: "4.5rem", textAlign: "right" }}
							/>
							<span className="wm-chance-label">%</span>
						</div>
						<p className="text-xs text-dim wm-chance-hint">
							{encounterChance < 1 &&
								`Extremely rare — ~${encounterChance}% per turn (remote wilderness / civilian zone)`}
							{encounterChance >= 1 &&
								encounterChance <= 5 &&
								"Very safe — rare encounters (civilian area)"}
							{encounterChance > 5 &&
								encounterChance <= 15 &&
								"Low threat — occasional patrols (wilderness)"}
							{encounterChance > 15 &&
								encounterChance <= 35 &&
								"Moderate threat — active hostiles (contested zone)"}
							{encounterChance > 35 &&
								encounterChance <= 60 &&
								"High threat — frequent patrols (enemy territory)"}
							{encounterChance > 60 &&
								"Extreme — constant danger (enemy base / hot zone)"}
						</p>
					</div>

					{appliedConfig && (
						<div className="wm-applied-card">
							<div className="wm-applied-header">
								<span className="wm-monster-type-badge">WANDERING MONSTER</span>
								<strong>{appliedConfig.monster_name}</strong>
							</div>
							{appliedConfig.notes && (
								<p className="text-xs text-dim wm-notes">
									{appliedConfig.notes}
								</p>
							)}
							<div className="text-xs text-dim">
								Encounter chance:{" "}
								<strong>{appliedConfig.encounter_chance}%</strong> per turn of
								movement
							</div>
						</div>
					)}

					{!scenarioId && (
						<p className="text-xs text-dim" style={{ marginTop: "0.5rem" }}>
							Save the scenario first to use the AI Designer.
						</p>
					)}

					{scenarioId && (
						<div className="wm-chat">
							<div className="wm-chat-header text-xs text-dim">
								AI Designer — suggests monsters based on location, threat level
								& scenario context
							</div>
							<div className="wm-chat-history" ref={scrollRef}>
								{messages.length === 0 && !loading && (
									<div className="wm-empty-hint text-xs text-dim">
										Ask the AI Designer to suggest a suitable wandering monster
										for this scenario.
									</div>
								)}
								{messages.map((m, i) => {
									return (
										<div key={i} className={`wm-msg wm-msg-${m.role}`}>
											{m.content}
										</div>
									);
								})}
								{loading && (
									<div className="wm-msg wm-msg-assistant">
										<div className="setting-typing-dots">
											<span />
											<span />
											<span />
										</div>
									</div>
								)}
							</div>

							{suggestions.length > 0 && (
								<div className="wm-suggestions">
									{suggestions.map((group, gi) => (
										<div key={gi} className="wm-suggestion-group">
											<span className="text-xs text-dim">
												{group.question}:
											</span>
											<div className="wm-chip-row">
												{group.chips.map((chip, ci) => (
													<button
														key={ci}
														className="setting-chip"
														onClick={() => send(chip)}
													>
														{chip}
													</button>
												))}
											</div>
										</div>
									))}
								</div>
							)}

							{pendingConfig && (
								<div className="wm-apply-bar">
									<div className="text-xs text-dim">
										AI suggests: <strong>{pendingConfig.monster_name}</strong>{" "}
										at <strong>{pendingConfig.encounter_chance}%</strong>
									</div>
									<button
										className="btn btn-sm btn-primary"
										onClick={() => {
											handleApplyConfig(pendingConfig);
											setPendingConfig(null);
										}}
									>
										Apply
									</button>
								</div>
							)}

							<div className="wm-input-row">
								<input
									className="setting-input"
									value={input}
									onChange={(e) => setInput(e.target.value)}
									onKeyDown={(e) =>
										e.key === "Enter" && !e.shiftKey && send(input)
									}
									placeholder="Describe the environment or threat level…"
									disabled={loading}
								/>
								<button
									className="btn btn-sm"
									onClick={() => send(input)}
									disabled={loading || !input.trim()}
								>
									Send
								</button>
								<button
									className="btn btn-sm"
									onClick={() =>
										send(
											"Suggest a wandering monster for this scenario location and setting.",
										)
									}
									disabled={loading}
									title="Ask the AI to generate a wandering monster suggestion"
								>
									Suggest
								</button>
							</div>
						</div>
					)}
				</>
			)}
		</div>
	);
}

// ── Info Step ─────────────────────────────────────────────────────────────────

export interface InfoStepProps {
	name: string;
	setName: (v: string) => void;
	gmKind: GmKind;
	setGmKind: (v: GmKind) => void;
	startLat: number;
	setStartLat: (v: number) => void;
	startLng: number;
	setStartLng: (v: number) => void;
	scenarioId: string | null;
	wanderingMonsterConfig: WanderingMonsterConfig | null;
	onWanderingMonsterChange: (config: WanderingMonsterConfig | null) => void;
	infoError: string | null;
	creating: boolean;
	onCreateScenario: () => void;
	onApplyDescription: (text: string) => void;
}

export function InfoStep({
	name,
	setName,
	gmKind,
	setGmKind,
	startLat,
	setStartLat,
	startLng,
	setStartLng,
	scenarioId,
	wanderingMonsterConfig,
	onWanderingMonsterChange,
	infoError,
	creating,
	onCreateScenario,
	onApplyDescription,
}: InfoStepProps) {
	return (
		<div className="scenario-info-step fade-in">
			<div className="scenario-form panel">
				<h3>Scenario Details</h3>

				{infoError && <div className="scenario-error">{infoError}</div>}

				<div className="form-group">
					<label className="text-sm">Name</label>
					<input
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="e.g. Ambush at Leadville Pass..."
						onKeyDown={(e) => e.key === "Enter" && onCreateScenario()}
						autoFocus
					/>
				</div>
				<div className="form-group">
					<label className="text-sm">Game Master</label>
					<select
						value={gmKind}
						onChange={(e) => setGmKind(e.target.value as GmKind)}
					>
						<option value="agent">AI Agent</option>
						<option value="human">Human</option>
					</select>
				</div>
				<div className="form-row">
					<div className="form-group">
						<label className="text-sm">Start Latitude</label>
						<input
							type="number"
							step="0.0001"
							value={startLat}
							onChange={(e) => setStartLat(Number(e.target.value))}
						/>
					</div>
					<div className="form-group">
						<label className="text-sm">Start Longitude</label>
						<input
							type="number"
							step="0.0001"
							value={startLng}
							onChange={(e) => setStartLng(Number(e.target.value))}
						/>
					</div>
				</div>
				<p className="text-xs text-dim">
					You can also click "Set Start" on the map to adjust the starting
					position interactively.
				</p>

				<SettingDesigner
					lat={startLat}
					lng={startLng}
					onApply={onApplyDescription}
				/>

				<WanderingMonsterDesigner
					scenarioId={scenarioId}
					lat={startLat}
					lng={startLng}
					initialConfig={wanderingMonsterConfig ?? undefined}
					onChange={onWanderingMonsterChange}
				/>

				<div className="dialog-actions">
					<button
						className="btn btn-primary"
						onClick={onCreateScenario}
						disabled={!name.trim() || creating}
					>
						{creating ? "Creating..." : "Continue to Map"}
					</button>
				</div>
			</div>
		</div>
	);
}
