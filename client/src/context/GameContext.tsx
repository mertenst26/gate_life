import type {
	Campaign,
	ChatMessage,
	Combatant,
	Enemy,
	GameMode,
	Session,
	TurnState,
	WorldClock,
} from "@gate-life/shared";
import {
	createContext,
	type Dispatch,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useReducer,
} from "react";
import type { DiceRollEvent } from "../components/DiceRollWidget";
import { api } from "../hooks/useApi";
import { useWebSocket } from "../hooks/useWebSocket";

interface GameState {
	userId: string;
	role: "gm" | "player" | "spectator";
	campaign: Campaign | null;
	session: Session | null;
	party: Combatant[];
	/** Detected scenario entities (enemies, friendlies, vehicles, POIs). */
	detectedEntities: Enemy[];
	/** Scenario-placed NPCs (not in party HUD) — same tactical grid as party */
	worldNpcs: Combatant[];
	messages: ChatMessage[];
	myCharacterId: string | null;
	connected: boolean;
	gmThinking: boolean;
	agentThinkingId: string | null;
	/** Queue of dice rolls to animate — each item shows then is removed. */
	diceRollQueue: DiceRollEvent[];
}

type GameAction =
	| { type: "SET_CAMPAIGN"; payload: Campaign }
	| { type: "SET_SESSION"; payload: Session }
	| { type: "SET_PARTY"; payload: Combatant[] }
	| { type: "SET_WORLD_NPCS"; payload: Combatant[] }
	| { type: "UPDATE_COMBATANT"; payload: Combatant }
	| { type: "ADD_COMBATANT"; payload: Combatant }
	| { type: "SET_DETECTED_ENTITIES"; payload: Enemy[] }
	| { type: "UPSERT_DETECTED_ENTITY"; payload: Enemy }
	| { type: "SET_MESSAGES"; payload: ChatMessage[] }
	| { type: "ADD_MESSAGE"; payload: ChatMessage }
	| { type: "SET_MODE"; payload: GameMode }
	| { type: "SET_TURN_STATE"; payload: TurnState | null }
	| { type: "SET_WORLD_CLOCK"; payload: WorldClock }
	| { type: "SET_MY_CHARACTER"; payload: string }
	| { type: "SET_CONNECTED"; payload: boolean }
	| { type: "SET_GM_THINKING"; payload: boolean }
	| { type: "SET_AGENT_THINKING"; payload: string | null }
	| {
			type: "SET_USER";
			payload: { userId: string; role: "gm" | "player" | "spectator" };
	  }
	| { type: "ENQUEUE_DICE_ROLL"; payload: DiceRollEvent }
	| { type: "DEQUEUE_DICE_ROLL" };

function gameReducer(state: GameState, action: GameAction): GameState {
	switch (action.type) {
		case "SET_CAMPAIGN":
			return { ...state, campaign: action.payload };
		case "SET_SESSION":
			return { ...state, session: action.payload };
		case "SET_PARTY":
			return { ...state, party: action.payload };
		case "SET_WORLD_NPCS":
			return { ...state, worldNpcs: action.payload };
		case "UPDATE_COMBATANT": {
			const id = action.payload.id;
			if (state.party.some((c) => c.id === id)) {
				return {
					...state,
					party: state.party.map((c) => (c.id === id ? action.payload : c)),
				};
			}
			if (state.worldNpcs.some((c) => c.id === id)) {
				return {
					...state,
					worldNpcs: state.worldNpcs.map((c) =>
						c.id === id ? action.payload : c,
					),
				};
			}
			return state;
		}
		case "ADD_COMBATANT":
			return { ...state, party: [...state.party, action.payload] };
		case "SET_DETECTED_ENTITIES":
			return { ...state, detectedEntities: action.payload };
		case "UPSERT_DETECTED_ENTITY": {
			const exists = state.detectedEntities.some(
				(e) => e.id === action.payload.id,
			);
			console.log("[gameReducer] UPSERT_DETECTED_ENTITY:", {
				name: action.payload.name,
				exists,
				currentCount: state.detectedEntities.length,
				newCount: exists
					? state.detectedEntities.length
					: state.detectedEntities.length + 1,
			});
			return {
				...state,
				detectedEntities: exists
					? state.detectedEntities.map((e) =>
							e.id === action.payload.id ? action.payload : e,
						)
					: [...state.detectedEntities, action.payload],
			};
		}
		case "SET_MESSAGES": {
			// Merge with any WebSocket messages already in state, deduplicating by id
			const incomingIds = new Set(action.payload.map((m: ChatMessage) => m.id));
			const wsOnly = state.messages.filter((m) => !incomingIds.has(m.id));
			return { ...state, messages: [...action.payload, ...wsOnly] };
		}
		case "ADD_MESSAGE":
			if (state.messages.some((m) => m.id === action.payload.id)) return state;
			return { ...state, messages: [...state.messages, action.payload] };
		case "SET_MODE":
			return {
				...state,
				session: state.session
					? { ...state.session, current_mode: action.payload }
					: null,
			};
		case "SET_TURN_STATE":
			return {
				...state,
				session: state.session
					? { ...state.session, turn_state: action.payload ?? undefined }
					: null,
			};
		case "SET_WORLD_CLOCK":
			return {
				...state,
				campaign: state.campaign
					? { ...state.campaign, world_clock: action.payload }
					: null,
			};
		case "SET_MY_CHARACTER":
			return { ...state, myCharacterId: action.payload };
		case "SET_CONNECTED":
			return { ...state, connected: action.payload };
		case "SET_GM_THINKING":
			return { ...state, gmThinking: action.payload };
		case "SET_AGENT_THINKING":
			return { ...state, agentThinkingId: action.payload };
		case "SET_USER":
			return {
				...state,
				userId: action.payload.userId,
				role: action.payload.role,
			};
		case "ENQUEUE_DICE_ROLL":
			return {
				...state,
				diceRollQueue: [...state.diceRollQueue, action.payload],
			};
		case "DEQUEUE_DICE_ROLL":
			return { ...state, diceRollQueue: state.diceRollQueue.slice(1) };
		default:
			return state;
	}
}

const STORAGE_KEY_CHAR = "gate_life_my_character_id";

const initialState: GameState = {
	userId: "player-1",
	role: "player",
	campaign: null,
	session: null,
	party: [],
	worldNpcs: [],
	detectedEntities: [],
	messages: [],
	myCharacterId: sessionStorage.getItem(STORAGE_KEY_CHAR) ?? null,
	connected: false,
	gmThinking: false,
	agentThinkingId: null,
	diceRollQueue: [],
};

interface GameContextType {
	state: GameState;
	dispatch: Dispatch<GameAction>;
	ws: ReturnType<typeof useWebSocket>;
	actions: {
		loadCampaign: (campaignId: string) => Promise<void>;
		sendChat: (content: string, messageType?: string) => void;
		performAction: (
			actionType: string,
			targetId?: string,
			data?: unknown,
		) => Promise<void>;
		endTurn: () => void;
		changeMode: (mode: string) => Promise<void>;
		spawnAgent: (name: string, preset?: string) => Promise<void>;
		sendTacticalMove: (targetX: number, targetY: number) => void;
	};
}

const GameContext = createContext<GameContextType | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
	const [state, dispatch] = useReducer(gameReducer, initialState);
	const ws = useWebSocket(
		state.session?.id ?? null,
		state.userId,
		state.myCharacterId,
	);

	useEffect(() => {
		dispatch({ type: "SET_CONNECTED", payload: ws.connected });
	}, [ws.connected]);

	// Persist character ID so it survives Vite HMR and server restarts
	useEffect(() => {
		if (state.myCharacterId) {
			sessionStorage.setItem(STORAGE_KEY_CHAR, state.myCharacterId);
		}
	}, [state.myCharacterId]);

	// When character ID is set (or reconnected), tell the server our combatant ID
	// without triggering a full session_state response that would clobber turn_state
	useEffect(() => {
		if (ws.connected && state.myCharacterId) {
			console.log(
				"[GameContext] registering combatantId on server:",
				state.myCharacterId,
			);
			ws.send({
				type: "register_combatant",
				payload: { combatant_id: state.myCharacterId },
			});
		}
	}, [state.myCharacterId, ws.connected]);

	// WebSocket message handlers
	useEffect(() => {
		const unsubs: Array<() => void> = [];

		unsubs.push(
			ws.subscribe("session_state", (msg) => {
				const { session, campaign, party, world_npcs, detectedEntities } =
					msg.payload as {
						session?: Session;
						campaign?: Campaign;
						party?: Combatant[];
						world_npcs?: Combatant[];
						detectedEntities?: Enemy[];
					};
				if (campaign) dispatch({ type: "SET_CAMPAIGN", payload: campaign });
				if (session) dispatch({ type: "SET_SESSION", payload: session });
				if (party) dispatch({ type: "SET_PARTY", payload: party });
				if (world_npcs)
					dispatch({ type: "SET_WORLD_NPCS", payload: world_npcs });
				if (detectedEntities)
					dispatch({
						type: "SET_DETECTED_ENTITIES",
						payload: detectedEntities,
					});
			}),
		);

		unsubs.push(
			ws.subscribe("chat_message", (msg) => {
				dispatch({ type: "ADD_MESSAGE", payload: msg.payload as ChatMessage });
			}),
		);

		unsubs.push(
			ws.subscribe("mode_change", (msg) => {
				const { mode, turn_state } = msg.payload as {
					mode?: GameMode;
					turn_state?: TurnState | null;
				};
				if (mode) dispatch({ type: "SET_MODE", payload: mode });
				if (turn_state !== undefined)
					dispatch({ type: "SET_TURN_STATE", payload: turn_state });
			}),
		);

		unsubs.push(
			ws.subscribe("turn_update", (msg) => {
				dispatch({ type: "SET_TURN_STATE", payload: msg.payload as TurnState });
			}),
		);

		unsubs.push(
			ws.subscribe("combatant_update", (msg) => {
				const c = msg.payload as Combatant;
				console.log(
					`[GameContext] combatant_update: ${c.id?.slice(-4)} → (${c.tactical_x},${c.tactical_y})`,
				);
				dispatch({ type: "UPDATE_COMBATANT", payload: c });
			}),
		);

		unsubs.push(
			ws.subscribe("error", (msg) => {
				console.warn(
					"[GameContext] server error:",
					(msg.payload as any)?.message,
				);
			}),
		);

		unsubs.push(
			ws.subscribe("party_update", (msg) => {
				const party = msg.payload as Combatant[];
				dispatch({ type: "SET_PARTY", payload: party });
			}),
		);

		unsubs.push(
			ws.subscribe("enemy_update", (msg) => {
				const entity = msg.payload as Enemy;
				console.log("[GameContext] Received enemy_update:", {
					name: entity.name,
					id: entity.id,
					detected: entity.detected,
					tactical_x: entity.tactical_x,
					tactical_y: entity.tactical_y,
					status: entity.status,
					enemy_type: entity.enemy_type,
				});
				if (entity.detected) {
					console.log(
						"[GameContext] Dispatching UPSERT_DETECTED_ENTITY for",
						entity.name,
					);
					dispatch({ type: "UPSERT_DETECTED_ENTITY", payload: entity });
				} else {
					console.log("[GameContext] Skipping entity update - not detected");
				}
			}),
		);

		unsubs.push(
			ws.subscribe("wandering_monster_encounter", (msg) => {
				const { enemy } = msg.payload as { enemy: Enemy };
				if (enemy) {
					dispatch({
						type: "UPSERT_DETECTED_ENTITY",
						payload: { ...enemy, detected: true },
					});
				}
			}),
		);

		unsubs.push(
			ws.subscribe("gm_thinking", (msg) => {
				const { thinking } = msg.payload as { thinking: boolean };
				dispatch({ type: "SET_GM_THINKING", payload: thinking });
			}),
		);

		unsubs.push(
			ws.subscribe("agent_thinking", (msg) => {
				const { actor_id, thinking } = msg.payload as {
					actor_id: string;
					thinking: boolean;
				};
				dispatch({
					type: "SET_AGENT_THINKING",
					payload: thinking ? actor_id : null,
				});
			}),
		);

		// Track recently seen dice rolls to prevent duplicates from multiple WS connections
		const seenRolls = new Set<string>();
		unsubs.push(
			ws.subscribe("dice_roll", (msg) => {
				const roll = msg.payload as DiceRollEvent;
				// Create a unique key for this roll based on label and result
				const rollKey = `${roll.label}:${roll.total}:${roll.results.join(",")}:${msg.timestamp}`;

				if (seenRolls.has(rollKey)) {
					console.log("[GameContext] Skipping duplicate dice_roll:", rollKey);
					return;
				}

				seenRolls.add(rollKey);
				// Clean up old entries after 5 seconds to prevent memory leak
				setTimeout(() => seenRolls.delete(rollKey), 5000);

				// gm_only rolls are only shown to the GM role — for now show to all since
				// we don't have GM role detection at this layer; the widget itself is subtle.
				dispatch({ type: "ENQUEUE_DICE_ROLL", payload: roll });
			}),
		);

		return () => unsubs.forEach((fn) => fn());
	}, [ws.subscribe]);

	const loadCampaign = useCallback(async (campaignId: string) => {
		const data = (await api.getGameState(campaignId)) as {
			campaign?: Campaign;
			session?: Session;
			party?: Combatant[];
			world_npcs?: Combatant[];
		};
		if (data.campaign)
			dispatch({ type: "SET_CAMPAIGN", payload: data.campaign });
		if (data.session) dispatch({ type: "SET_SESSION", payload: data.session });
		if (data.party) dispatch({ type: "SET_PARTY", payload: data.party });
		if (data.world_npcs)
			dispatch({ type: "SET_WORLD_NPCS", payload: data.world_npcs });

		if (data.session?.id) {
			const messages = (await api.getMessages(
				campaignId,
				data.session.id,
			)) as ChatMessage[];
			dispatch({ type: "SET_MESSAGES", payload: messages });
		}
	}, []);

	const sendChat = useCallback(
		(content: string, messageType = "player_speech") => {
			if (!state.campaign || !state.session) return;
			ws.send({
				type: "chat_message",
				payload: {
					actor_id: state.myCharacterId,
					message_type: messageType,
					content,
					visibility: "party",
				},
			});
		},
		[state.campaign, state.session, state.myCharacterId, ws.send],
	);

	const performAction = useCallback(
		async (actionType: string, targetId?: string, data?: unknown) => {
			if (!state.session || !state.myCharacterId) return;
			await api.performAction({
				session_id: state.session.id,
				combatant_id: state.myCharacterId,
				action_type: actionType,
				target_id: targetId,
				data,
			});
		},
		[state.session, state.myCharacterId],
	);

	const endTurn = useCallback(() => {
		console.log(
			"[endTurn] called. session=",
			state.session?.id,
			"myCharacterId=",
			state.myCharacterId,
			"wsConnected=",
			ws.connected,
		);
		if (!state.session) {
			console.log("[endTurn] blocked: no session");
			return;
		}
		if (!state.myCharacterId) {
			console.log("[endTurn] blocked: no myCharacterId");
			return;
		}
		ws.send({ type: "end_turn", payload: {} });
		console.log("[endTurn] sent end_turn WS message");
	}, [state.session, state.myCharacterId, ws.connected, ws.send]);

	const sendTacticalMove = useCallback(
		(targetX: number, targetY: number) => {
			console.log(
				`[sendTacticalMove] (${targetX},${targetY}) wsConnected=${ws.connected}`,
			);
			ws.send({
				type: "tactical_move",
				payload: {
					target_x: targetX,
					target_y: targetY,
					combatant_id: state.myCharacterId,
				},
			});
		},
		[ws.send, ws.connected, state.myCharacterId],
	);

	const changeMode = useCallback(
		async (mode: string) => {
			if (!state.session) return;
			const result = await api.changeGameMode(state.session.id, mode);
			// Apply directly from REST response — don't rely solely on WS broadcast
			if (result?.mode)
				dispatch({ type: "SET_MODE", payload: result.mode as any });
			if (result?.turn_state !== undefined)
				dispatch({ type: "SET_TURN_STATE", payload: result.turn_state as any });
		},
		[state.session],
	);

	const spawnAgent = useCallback(
		async (name: string, preset?: string) => {
			if (!state.campaign) return;
			const combatant = (await api.createCombatant({
				campaign_id: state.campaign.id,
				name,
				kind: "agent",
				personality_preset: preset,
			})) as Combatant | null;
			if (combatant) {
				dispatch({ type: "ADD_COMBATANT", payload: combatant });
			}
		},
		[state.campaign],
	);

	const contextValue: GameContextType = {
		state,
		dispatch,
		ws,
		actions: {
			loadCampaign,
			sendChat,
			performAction,
			endTurn,
			changeMode,
			spawnAgent,
			sendTacticalMove,
		},
	};

	return (
		<GameContext.Provider value={contextValue}>{children}</GameContext.Provider>
	);
}

export function useGame() {
	const ctx = useContext(GameContext);
	if (!ctx) throw new Error("useGame must be used within GameProvider");
	return ctx;
}
