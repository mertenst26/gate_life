import type { FollowRequest, TurnState } from "@gate-life/shared";
import { randomUUID } from "crypto";
import { aiGm } from "../../services/AiGmService.js";
import { gameState } from "../../services/GameStateService.js";
import { checkWanderingMonster } from "../../services/WanderingMonsterService.js";
import type { ConnectedClient } from "../clients.js";
import { broadcastToSession } from "../clients.js";
import { triggerAgentTurnIfNeeded } from "./agentHelpers.js";

const pendingFollowRequests = new Map<string, FollowRequest>();

/**
 * Create and broadcast a follow request from an NPC to the player.
 */
export function sendFollowRequest(
	sessionId: string,
	campaignId: string,
	npcId: string,
	npcName: string,
	targetX: number,
	targetY: number,
): void {
	const npc = gameState.getCombatant(npcId);
	if (!npc) {
		console.error(`[follow_request] NPC ${npcId} not found`);
		return;
	}

	const npcX = npc.tactical_x ?? 0;
	const npcY = npc.tactical_y ?? 0;
	const distanceGrid = Math.sqrt((targetX - npcX) ** 2 + (targetY - npcY) ** 2);
	const distanceFt = Math.round(distanceGrid * 10);

	const requestId = randomUUID();
	const expiresAt = new Date(Date.now() + 30000).toISOString();

	const followReq: FollowRequest = {
		request_id: requestId,
		npc_id: npcId,
		npc_name: npcName,
		target_x: targetX,
		target_y: targetY,
		distance_ft: distanceFt,
		expires_at: expiresAt,
	};

	pendingFollowRequests.set(requestId, followReq);

	setTimeout(() => {
		if (pendingFollowRequests.has(requestId)) {
			pendingFollowRequests.delete(requestId);
			console.log(`[follow_request] ${requestId} expired`);
		}
	}, 30000);

	const followMsg = gameState.createMessage({
		campaign_id: campaignId,
		session_id: sessionId,
		actor_id: npcId,
		message_type: "follow_request",
		content: JSON.stringify(followReq),
		visibility: "party",
	});

	broadcastToSession(sessionId, {
		type: "chat_message",
		payload: followMsg,
		timestamp: new Date().toISOString(),
	});

	console.log(
		`[follow_request] ${npcName} requests player to follow to (${targetX}, ${targetY}) — ${distanceFt} ft`,
	);
}

export async function handleTacticalMove(
	_clientId: string,
	client: ConnectedClient,
	payload: any,
): Promise<void> {
	const {
		target_x,
		target_y,
		combatant_id: payloadCombatantId,
	} = payload as {
		target_x: number;
		target_y: number;
		combatant_id?: string;
	};

	if (!client.combatantId && payloadCombatantId) {
		client.combatantId = payloadCombatantId;
		console.log(
			`[tactical_move] auto-registered combatantId=${client.combatantId?.slice(-4)} from payload`,
		);
	}

	if (!client.sessionId || !client.combatantId) {
		client.socket.send(
			JSON.stringify({
				type: "error",
				payload: { message: "Not registered" },
				timestamp: new Date().toISOString(),
			}),
		);
		return;
	}
	const session = gameState.getSession(client.sessionId);
	if (!session || session.current_mode !== "tactical") {
		client.socket.send(
			JSON.stringify({
				type: "error",
				payload: { message: "Not in tactical mode" },
				timestamp: new Date().toISOString(),
			}),
		);
		return;
	}

	const ts = session.turn_state;
	const activeId = ts?.turn_order[ts.current_actor_index ?? 0];
	if (activeId !== client.combatantId) {
		client.socket.send(
			JSON.stringify({
				type: "error",
				payload: { message: "It is not your turn" },
				timestamp: new Date().toISOString(),
			}),
		);
		return;
	}

	const combatant = gameState.getCombatant(client.combatantId);
	if (!combatant || combatant.status === "dead") return;

	const maxGridUnits = Math.round(
		(combatant.attributes.spd_bipedal * 5) / 10,
	);
	const curX = combatant.tactical_x ?? 0;
	const curY = combatant.tactical_y ?? 0;
	const dist = Math.sqrt((target_x - curX) ** 2 + (target_y - curY) ** 2);

	if (dist > maxGridUnits + 0.5) {
		client.socket.send(
			JSON.stringify({
				type: "error",
				payload: {
					message: `Movement too far: max ${maxGridUnits} grid units (${maxGridUnits * 10} ft), attempted ${Math.round(dist * 10)} ft`,
				},
				timestamp: new Date().toISOString(),
			}),
		);
		return;
	}

	const dx = target_x - curX;
	const dy = target_y - curY;
	let facing = combatant.facing ?? "north";
	if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
		const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
		if (angle > -22.5 && angle <= 22.5) facing = "east";
		else if (angle > 22.5 && angle <= 67.5) facing = "northeast";
		else if (angle > 67.5 && angle <= 112.5) facing = "north";
		else if (angle > 112.5 && angle <= 157.5) facing = "northwest";
		else if (angle > 157.5 || angle <= -157.5) facing = "west";
		else if (angle > -157.5 && angle <= -112.5) facing = "southwest";
		else if (angle > -112.5 && angle <= -67.5) facing = "south";
		else facing = "southeast";
	}

	const updated = gameState.updateCombatantPosition(
		client.combatantId,
		target_x,
		target_y,
		facing,
	);
	if (updated) {
		broadcastToSession(client.sessionId, {
			type: "combatant_update",
			payload: updated,
			timestamp: new Date().toISOString(),
		});
	}
}

export async function handleEndTurn(
	_clientId: string,
	client: ConnectedClient,
	_payload: any,
): Promise<void> {
	if (!client.sessionId || !client.combatantId) {
		client.socket.send(
			JSON.stringify({
				type: "error",
				payload: { message: "Not registered — refresh and rejoin" },
				timestamp: new Date().toISOString(),
			}),
		);
		return;
	}
	const session = gameState.getSession(client.sessionId);
	if (!session || session.current_mode !== "tactical") {
		client.socket.send(
			JSON.stringify({
				type: "error",
				payload: {
					message: `Not in tactical mode (mode=${session?.current_mode})`,
				},
				timestamp: new Date().toISOString(),
			}),
		);
		return;
	}

	const party = gameState.getPartyCombatants(session.campaign_id);
	const ts = session.turn_state;

	const partyIds = new Set(party.map((c) => c.id));
	const orderIds = new Set(ts?.turn_order ?? []);
	const hasStaleIds =
		ts?.turn_order.some((id) => !partyIds.has(id)) ?? false;
	const hasMissingIds = party.some((c) => !orderIds.has(c.id));
	const orderIsStale =
		!ts || hasStaleIds || hasMissingIds || ts.turn_order.length === 0;

	if (orderIsStale) {
		console.log(
			`[end_turn] stale turn_order detected — re-rolling initiative`,
		);
		const rolled = party.map((c) => {
			const natural = Math.floor(Math.random() * 20) + 1;
			const bonus = c.combat.initiative_bonus ?? 0;
			broadcastToSession(client.sessionId!, {
				type: "dice_roll",
				payload: {
					dice: "d20",
					results: [natural],
					modifier: bonus,
					total: natural + bonus,
					natural,
					label: `${c.name} initiative`,
				},
				timestamp: new Date().toISOString(),
			});
			return { id: c.id, roll: natural + bonus };
		});
		rolled.sort((a, b) => b.roll - a.roll);
		const turn_order = rolled.map((r) => r.id);
		const freshTs: TurnState = {
			turn_order,
			current_actor_index: 0,
			round: (ts?.round ?? 0) + 1,
			tick: (ts?.tick ?? 0) + 1,
			action_budget: Object.fromEntries(
				party.map((c) => [c.id, c.combat.apm]),
			),
			pending_input:
				turn_order.length > 0
					? { actor_id: turn_order[0], input_type: "free_text" }
					: undefined,
		};
		gameState.updateTurnState(client.sessionId, freshTs);
		broadcastToSession(client.sessionId, {
			type: "turn_update",
			payload: freshTs,
			timestamp: new Date().toISOString(),
		});
		return;
	}

	const safeTs = ts!;
	const activeId = safeTs.turn_order[safeTs.current_actor_index];
	if (activeId !== client.combatantId) {
		client.socket.send(
			JSON.stringify({
				type: "error",
				payload: {
					message: `Not your turn — active is ${party.find((c) => c.id === activeId)?.name ?? activeId}`,
				},
				timestamp: new Date().toISOString(),
			}),
		);
		return;
	}

	const nextIndex =
		(safeTs.current_actor_index + 1) % safeTs.turn_order.length;
	const roundIncremented = nextIndex === 0;
	const newRound = roundIncremented ? safeTs.round + 1 : safeTs.round;
	const newTs: TurnState = {
		...safeTs,
		current_actor_index: nextIndex,
		round: newRound,
		tick: safeTs.tick + 1,
		pending_input: {
			actor_id: safeTs.turn_order[nextIndex],
			input_type: "free_text",
		},
	};
	gameState.updateTurnState(client.sessionId, newTs);
	broadcastToSession(client.sessionId, {
		type: "turn_update",
		payload: newTs,
		timestamp: new Date().toISOString(),
	});

	if (roundIncremented) {
		const campaign = gameState.getCampaign(session.campaign_id);
		checkWanderingMonster({
			sessionId: client.sessionId!,
			campaignId: session.campaign_id,
			campaign,
			turns: 1,
			broadcast: (msg) => broadcastToSession(client.sessionId!, msg),
			onEncounter: (monsterName) => {
				aiGm
					.narrateWanderingMonsterEncounter(
						session.campaign_id,
						client.sessionId!,
						monsterName,
					)
					.catch((err) =>
						console.error("[wandering-monster] AI narration error:", err),
					);
			},
		}).catch((err) =>
			console.error("[wandering-monster] check error:", err),
		);
	}

	triggerAgentTurnIfNeeded(client.sessionId!, session.campaign_id).catch(
		(err) => console.error("[agent-turn] error:", err),
	);
}

export async function handleFollowResponse(
	_clientId: string,
	client: ConnectedClient,
	payload: any,
): Promise<void> {
	const { request_id, accepted } = payload as {
		request_id: string;
		accepted: boolean;
	};

	if (!client.sessionId || !client.combatantId) return;
	const session = gameState.getSession(client.sessionId);
	if (!session) return;

	const followReq = pendingFollowRequests.get(request_id);
	if (!followReq) {
		console.log(
			`[follow_response] request ${request_id} not found or expired`,
		);
		return;
	}

	pendingFollowRequests.delete(request_id);

	if (!accepted) {
		const declineMsg = gameState.createMessage({
			campaign_id: session.campaign_id,
			session_id: client.sessionId,
			message_type: "system_alert",
			content: `You declined to follow ${followReq.npc_name}.`,
			visibility: "party",
		});
		broadcastToSession(client.sessionId, {
			type: "chat_message",
			payload: declineMsg,
			timestamp: new Date().toISOString(),
		});
		return;
	}

	const MAX_FOLLOW_DISTANCE_FT = 1312;
	if (followReq.distance_ft > MAX_FOLLOW_DISTANCE_FT) {
		const tooFarMsg = gameState.createMessage({
			campaign_id: session.campaign_id,
			session_id: client.sessionId,
			message_type: "system_alert",
			content: `⚠ Follow blocked: ${followReq.npc_name} is too far away (${Math.round(followReq.distance_ft)} ft, max ${MAX_FOLLOW_DISTANCE_FT} ft).`,
			visibility: "party",
		});
		broadcastToSession(client.sessionId, {
			type: "chat_message",
			payload: tooFarMsg,
			timestamp: new Date().toISOString(),
		});
		return;
	}

	const updated = gameState.updateCombatantPosition(
		client.combatantId,
		followReq.target_x,
		followReq.target_y,
	);
	if (updated) {
		broadcastToSession(client.sessionId, {
			type: "combatant_update",
			payload: updated,
			timestamp: new Date().toISOString(),
		});

		const confirmMsg = gameState.createMessage({
			campaign_id: session.campaign_id,
			session_id: client.sessionId,
			message_type: "system_alert",
			content: `📍 You followed ${followReq.npc_name} to grid (${followReq.target_x}, ${followReq.target_y}).`,
			visibility: "party",
		});
		broadcastToSession(client.sessionId, {
			type: "chat_message",
			payload: confirmMsg,
			timestamp: new Date().toISOString(),
		});

		console.log(
			`[follow_response] ${updated.name} followed ${followReq.npc_name} → (${followReq.target_x}, ${followReq.target_y})`,
		);
	}
}

export function handlePing(client: ConnectedClient): void {
	client.socket.send(
		JSON.stringify({
			type: "pong",
			payload: {},
			timestamp: new Date().toISOString(),
		}),
	);
}
