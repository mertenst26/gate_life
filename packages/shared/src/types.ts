export type GameMode =
	| "charCreate"
	| "conversation"
	| "tactical"
	| "travel"
	| "rest";
export type CombatantKind = "human" | "agent";
export type CombatantStatus = "alive" | "unconscious" | "dead";
export type GmKind = "human" | "agent";
export type MessageType =
	| "gm_narration"
	| "player_speech"
	| "npc_dialog"
	| "dice_result"
	| "system_alert"
	| "gm_private"
	| "follow_request";
export type Visibility = "party" | "gm" | "gm_only_agent_reasoning";
export type DamageType = "sdc" | "md";
export type TerrainType =
	| "open"
	| "rough"
	| "hazardous"
	| "impassable"
	| "elevated";
export type CoverType = "partial" | "full" | null;
export type InjurySeverity = "minor" | "moderate" | "severe" | "critical";
export type ItemType =
	| "weapon_melee"
	| "weapon_ranged"
	| "armor"
	| "consumable"
	| "ammo"
	| "container"
	| "misc"
	| "special";
export type Rarity = "common" | "uncommon" | "rare" | "legendary" | "artifact";

/** Special item ability types that can be triggered by using the item */
export type ItemAbilityType =
	| "spawn_support" // Summon allied units (gunships, reinforcements, etc.)
	| "teleport" // Teleport to location
	| "heal" // Heal target
	| "buff" // Apply status effect
	| "damage" // Deal damage to area
	| "reveal" // Reveal map area or entities
	| "custom"; // Custom scripted effect

/** Configuration for special item abilities */
export interface ItemAbility {
	ability_type: ItemAbilityType;
	name: string;
	description: string;
	/** Specific configuration based on ability_type */
	config?: Record<string, unknown>;
	/** Number of times this ability can be used (null = unlimited) */
	uses?: number | null;
	/** Cooldown in game rounds between uses */
	cooldown_rounds?: number;
	/** Last round this ability was used (for cooldown tracking) */
	last_used_round?: number;
	/** For spawn_support: reference to scenario entity names that will be summoned */
	linked_entity_names?: string[];
}

export interface Attributes {
	iq: number;
	me: number;
	ma: number;
	ps: number;
	pp: number;
	pe: number;
	pb: number;
	spd_bipedal: number;
	spd_quadruped: number;
}

export interface CombatBonuses {
	initiative_bonus: number;
	strike_bonus: number;
	parry_bonus: number;
	dodge_bonus: number;
	roll_with_impact_bonus: number;
	damage_bonus: number;
	apm: number;
}

export interface Vitals {
	hp_current: number;
	hp_max: number;
	sdc_current: number;
	sdc_max: number;
	isp_current: number;
	isp_max: number;
	ppe_current: number;
	ppe_max: number;
	armor_mdc_current: number;
	armor_mdc_max: number;
}

export interface Needs {
	hunger: number;
	thirst: number;
	fatigue: number;
}

export interface Injury {
	id: string;
	body_location: string;
	severity: InjurySeverity;
	injury_type: string;
	bleeding: boolean;
	pain_level: number;
	healing_progress: number;
}

export interface InventoryItem {
	id: string;
	template_id: string;
	name: string;
	type: ItemType;
	damage?: string;
	damage_type?: DamageType;
	mdc?: number;
	weight: number;
	quantity: number;
	equipped: boolean;
	uses?: number;
	max_uses?: number;
	charges?: number;
	max_charges?: number;
	properties?: Record<string, unknown>;
	/** Special abilities this item can trigger when used */
	abilities?: ItemAbility[];
	/** Flavor text description shown in inventory */
	description?: string;
}

export interface PsionicPower {
	id: string;
	name: string;
	isp_cost: number;
	description: string;
	duration?: string;
	range_ft?: number;
	automatic?: boolean;
	save?: string;
}

export interface Combatant {
	id: string;
	campaign_id: string;
	session_id?: string;
	kind: CombatantKind;
	controller?: string;
	class_id: string;
	name: string;
	status: CombatantStatus;
	personality?: PersonalityProfile;
	attributes: Attributes;
	vitals: Vitals;
	combat: CombatBonuses;
	needs: Needs;
	internal_temp: number;
	pulse_bpm: number;
	tactical_x?: number;
	tactical_y?: number;
	facing?: string;
	elevation?: number;
	level: number;
	xp: number;
	xp_next_level: number;
	psionic_powers: string[];
	skills: string[];
	inventory: InventoryItem[];
	equipped: Record<string, string>;
	status_effects: StatusEffect[];
	injuries: Injury[];
	pack_howl_remaining: number;
	/** If false, this combatant is a scenario/world NPC (shown on map/tactical) but not in the party HUD */
	party_member?: boolean;
}

export interface DogBoyMutationEntry {
	name: string;
	description: string;
}

export interface PersonalityProfile {
	preset_id?: string;
	temperament: string;
	combat_preference: string;
	speech_style: string;
	quirks: string[];
	/** Randomized Dog Boy breed stock (Psi-Hound creation tables). */
	dog_boy_breed?: string;
	/** d100 genetic variance / mutation results from creation. */
	dog_boy_mutations?: DogBoyMutationEntry[];
	/** NPC scenario builder: mission hooks */
	priorities?: string[];
	/** Parallel to priorities: POI entity name revealed when that mission is accepted */
	priority_mission_pois?: (string | null)[];
}

export interface StatusEffect {
	id: string;
	name: string;
	duration_rounds?: number;
	bonuses?: Partial<CombatBonuses>;
	penalties?: Record<string, number>;
}

export interface Campaign {
	id: string;
	name: string;
	creator_user_id: string;
	gm_kind: GmKind;
	gm_user_id?: string;
	gm_agent_config?: AgentGmConfig;
	/** Present when the campaign was created from a scenario launch — authoritative world/tactical grid (0,0). */
	grid_origin_lat?: number | null;
	grid_origin_lng?: number | null;
	world_clock: WorldClock;
	created_at: string;
	updated_at: string;
}

export interface WanderingMonsterConfig {
	enabled: boolean;
	/** 1–100: percentage chance per turn of movement */
	encounter_chance: number;
	monster_name: string;
	monster_definition: Record<string, unknown>;
	/** AI rationale / designer notes, shown only to the GM */
	notes?: string;
}

/** POI names placed on the scenario map (for GM prompts and quest reveal). */
export interface ScenarioContextPoi {
	name: string;
}

/** NPC with optional per-priority links to scenario POI names. */
export interface ScenarioContextQuestGiver {
	name: string;
	/** Ordered: index 0 is the mission the GM should lead with; advance only after prior entries are addressed in play. */
	priorities: string[];
	/** Same length as priorities: which POI to mark when that mission is accepted */
	priority_mission_pois?: (string | null)[];
}

/** Injected into agent GM config at scenario launch — exact names for <!--REVEAL_POI:...-->. */
export interface ScenarioContext {
	pois: ScenarioContextPoi[];
	quest_givers: ScenarioContextQuestGiver[];
}

/** Runtime progress per quest-giver NPC name (matches scenario entity name). */
export interface QuestGiverProgressEntry {
	/** 0-based index of the next priority not yet convincingly completed */
	next_priority_index: number;
}

export interface AgentGmConfig {
	tone?: string;
	difficulty?: string;
	narrative_style?: string;
	setting?: string;
	/** Tactical grid (0,0) aligns to this real-world point — set when launching a scenario */
	grid_origin_lat?: number;
	grid_origin_lng?: number;
	/**
	 * npc/friendly names from the launched scenario. AI agents whose name matches (case-insensitive)
	 * are hidden from the party HUD — they belong on the map as scenario actors, not the player squad.
	 */
	scenario_party_excluded_agent_names?: string[];
	wandering_monster?: WanderingMonsterConfig;
	scenario_context?: ScenarioContext;
	/** Filled at scenario launch; updated when <!--QUEST_COMPLETE:...--> is processed */
	quest_giver_progress?: Record<string, QuestGiverProgressEntry>;
}

export interface WorldClock {
	day: number;
	hour: number;
	minute: number;
}

export interface Session {
	id: string;
	campaign_id: string;
	current_mode: GameMode;
	current_scene_id?: string;
	turn_state?: TurnState;
	spectator_user_ids: string[];
	active: boolean;
	/** Grid origin used when tactical_terrain was last built — invalidates cache if campaign origin differs */
	terrain_origin_lat?: number | null;
	terrain_origin_lng?: number | null;
}

export interface TurnState {
	turn_order: string[];
	current_actor_index: number;
	round: number;
	tick: number;
	action_budget: Record<string, number>;
	pending_input?: PendingInput;
}

export interface PendingInput {
	actor_id: string;
	input_type:
		| "free_text"
		| "action_selection"
		| "gm_adjudication"
		| "agent_computation";
	available_actions?: string[];
	timer_started_at?: string;
	timer_duration_ms?: number;
}

export interface ChatMessage {
	id: string;
	campaign_id: string;
	session_id?: string;
	actor_id?: string;
	message_type: MessageType;
	content: string;
	visibility: Visibility;
	created_at: string;
}

export interface FollowRequest {
	request_id: string;
	npc_id: string;
	npc_name: string;
	target_x: number;
	target_y: number;
	distance_ft: number;
	expires_at: string;
}

export interface GameEvent {
	id: string;
	campaign_id: string;
	session_id?: string;
	event_type: string;
	actor_id?: string;
	target_id?: string;
	data?: Record<string, unknown>;
	narrative?: string;
	visibility: Visibility;
	created_at: string;
}

export interface DiceRoll {
	dice: string;
	results: number[];
	modifier: number;
	total: number;
	natural: number;
	critical?: boolean;
	fumble?: boolean;
}

export interface Enemy {
	id: string;
	session_id: string;
	name: string;
	/** Mechanical role (hostile, friendly, poi, neutral, vehicle, …). Not the map icon. */
	enemy_type: string;
	/** Optional map/tactical token style — e.g. \`npc\` for quest-giver markers. Overrides enemy_type for rendering only. */
	icon_type?: string | null;
	hp_current: number;
	hp_max: number;
	sdc_current: number;
	sdc_max: number;
	mdc_current?: number;
	mdc_max?: number;
	apm: number;
	initiative_bonus: number;
	strike_bonus: number;
	parry_bonus: number;
	dodge_bonus: number;
	damage: string;
	damage_type: DamageType;
	tactical_x?: number;
	tactical_y?: number;
	facing?: string;
	status: CombatantStatus;
	abilities: string[];
	loot_table: LootEntry[];
	detected?: boolean;
	/** True when this POI was marked as an active quest destination (yellow on map) */
	quest_poi?: boolean;
	/** Support unit metadata (for gunships, reinforcements, etc.) */
	support_config?: SupportUnitConfig;
}

/** Configuration for support units like gunships */
export interface SupportUnitConfig {
	/** Type of support unit */
	unit_type: "gunship" | "transport" | "drone" | "reinforcement";
	/** Fuel remaining (for vehicles) */
	fuel?: number;
	max_fuel?: number;
	/** Who called in this support unit (combatant ID) */
	summoned_by?: string;
	/** Item that summoned this unit */
	summoned_by_item?: string;
	/** Maximum range for support actions (grid units) */
	action_range?: number;
	/** Gun run damage formula */
	strike_damage?: string;
	/** Whether this unit can land and extract */
	can_extract?: boolean;
	/** Movement speed in grid units per round (10 ft per unit). Default 15. */
	speed?: number;
	/** Whether this unit has been called in and is currently moving toward the party */
	inbound?: boolean;
	/**
	 * Rounds remaining before the vehicle can move (engine warm-up / takeoff delay).
	 * Decremented each round; movement begins when it reaches 0.
	 */
	takeoff_rounds_remaining?: number;
	/** Grid position of the destination the unit is heading toward */
	destination_x?: number;
	destination_y?: number;
}

/** Map/tactical token style: `icon_type` overrides `enemy_type` for rendering only. */
export function enemyMapTokenKind(
	e: Pick<Enemy, "enemy_type" | "icon_type">,
): string {
	const i = e.icon_type?.trim();
	if (i) return i;
	return e.enemy_type;
}

export interface LootEntry {
	item_id: string;
	chance: number;
	quantity_min: number;
	quantity_max: number;
}

export interface TacticalTile {
	x: number;
	y: number;
	terrain_type: TerrainType;
	cover?: CoverType;
	elevation: number;
	revealed: boolean;
	metadata?: Record<string, unknown>;
}

export interface VitalSample {
	combatant_id: string;
	pulse_bpm: number;
	internal_temp: number;
	sampled_at: string;
}

// WebSocket message types
export type WSMessageType =
	| "session_state"
	| "mode_change"
	| "turn_update"
	| "chat_message"
	| "game_event"
	| "combatant_update"
	| "vital_sample"
	| "dice_roll"
	| "party_update"
	| "enemy_update"
	| "tactical_update"
	| "tactical_move"
	| "end_turn"
	| "gm_thinking"
	| "agent_thinking"
	| "wandering_monster_encounter"
	| "register_combatant"
	| "follow_response"
	| "item_received"
	| "item_used"
	| "support_units_spawned"
	| "gunship_available"
	| "ping"
	| "pong"
	| "error";

export interface WSMessage {
	type: WSMessageType;
	payload: unknown;
	timestamp: string;
}

// API request types
export interface CreateCampaignRequest {
	name: string;
	gm_kind: GmKind;
	gm_user_id?: string;
	gm_agent_config?: AgentGmConfig;
	/** Persisted on the campaign row when launching from a scenario builder scenario */
	grid_origin_lat?: number;
	grid_origin_lng?: number;
}

export interface CreateCombatantRequest {
	campaign_id: string;
	kind: CombatantKind;
	name: string;
	controller?: string;
	personality_preset?: string;
	/** false = world/scenario NPC (not listed in party HUD) */
	party_member?: boolean;
}

export interface PlayerActionRequest {
	session_id: string;
	combatant_id: string;
	action_type: string;
	target_id?: string;
	data?: Record<string, unknown>;
}

export interface SendMessageRequest {
	campaign_id: string;
	session_id?: string;
	actor_id?: string;
	message_type: MessageType;
	content: string;
	visibility?: Visibility;
}

// ── Scenario Builder ──

export type ScenarioEntityType =
	| "enemy"
	| "npc"
	| "friendly"
	| "vehicle"
	| "poi"
	| "dungeon";

// ── Dungeon types ──────────────────────────────────────────────────────────

/** 0=wall  1=floor  2=corridor  3=door  4=stairs/entry  5=special */
export type DungeonTileType = 0 | 1 | 2 | 3 | 4 | 5;

export interface DungeonRoom {
	name: string;
	description: string;
	/** Top-left cell row (0-based) */
	row: number;
	/** Top-left cell col (0-based) */
	col: number;
	width: number;
	height: number;
	features?: string[];
}

export interface DungeonDoor {
	row: number;
	col: number;
	/** "ns" = north–south passage, "ew" = east–west passage */
	orientation?: "ns" | "ew";
	label?: string;
	locked?: boolean;
}

export interface DungeonDefinition {
	name: string;
	/** False = surface building/ruin, true = underground cave/mine/vault */
	above_ground: boolean;
	/** Grid width in cells */
	width: number;
	/** Grid height in cells */
	height: number;
	/** Size of each cell in feet (typically 10) */
	cell_size_ft: number;
	/** 2D array [row][col] of DungeonTileType */
	tiles: DungeonTileType[][];
	rooms: DungeonRoom[];
	doors: DungeonDoor[];
	/** Entry point cell coordinates */
	entry_row: number;
	entry_col: number;
	/** Polygon boundary on the world map [[lat, lng], …] */
	polygon_latlngs: Array<[number, number]>;
	notes?: string;
}

export interface Scenario {
	id: string;
	name: string;
	description?: string;
	creator_user_id: string;
	gm_kind: GmKind;
	start_lat: number;
	start_lng: number;
	created_at: string;
	wandering_monster_config?: WanderingMonsterConfig;
}

/** Crew member definition for vehicles */
export interface VehicleCrewMember {
	role: string; // e.g., "Pilot", "Gunner", "Co-Pilot"
	name?: string; // Optional custom name, otherwise auto-generated
	/** Stats will be auto-generated if not provided */
	hp_max?: number;
	sdc_max?: number;
	mdc_max?: number;
	skills?: string[];
}

/** Vehicle-specific configuration */
export interface VehicleConfig {
	/** Whether this vehicle should spawn with crew NPCs */
	include_crew: boolean;
	/** Crew member definitions */
	crew?: VehicleCrewMember[];
	/** Vehicle speed in grid units per round (10ft per unit) */
	speed?: number;
	/** Fuel capacity and current fuel */
	fuel?: number;
	max_fuel?: number;
	/** Cargo/passenger capacity */
	capacity?: number;
}

/** Item that can be given to players by an NPC */
export interface NpcGiveableItem {
	name: string;
	type: ItemType;
	description?: string;
	uses?: number;
	abilities?: Omit<ItemAbility, "last_used_round">[];
}

export interface ScenarioEntity {
	id: string;
	scenario_id: string;
	entity_type: ScenarioEntityType;
	grid_x: number;
	grid_y: number;
	lat: number;
	lng: number;
	name: string;
	definition: Record<string, unknown>;
}

export interface CreateScenarioRequest {
	name: string;
	description?: string;
	gm_kind: GmKind;
	start_lat: number;
	start_lng: number;
	wandering_monster_config?: WanderingMonsterConfig;
}

export interface EntityChatRequest {
	entity_type: ScenarioEntityType;
	lat: number;
	lng: number;
	messages: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface SuggestionGroup {
	/** Short label matching the question topic, e.g. "Setting" or "Difficulty" */
	question: string;
	chips: string[];
}

export interface EntityChatResponse {
	reply: string;
	/** Single entity (legacy / simple cases) */
	definition?: Record<string, unknown>;
	name?: string;
	/** Multiple entities returned at once (e.g. a gang, a squad, a group) */
	definitions?: Array<{ name: string; definition: Record<string, unknown> }>;
	suggestions?: SuggestionGroup[];
}
