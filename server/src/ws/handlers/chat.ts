import type { TurnState } from "@gate-life/shared";
import { aiGm } from "../../services/AiGmService.js";
import { checkContactAndEnterTactical } from "../../services/ContactDetectionService.js";
import { gameState } from "../../services/GameStateService.js";
import { checkMovementForContact } from "../../services/MovementDetectionService.js";
import { parseMovement } from "../../services/MovementParser.js";
import { checkWanderingMonster } from "../../services/WanderingMonsterService.js";
import type { ConnectedClient } from "../clients.js";
import { broadcastToSession } from "../clients.js";
import {
	directionToFacing,
	handleDirectedAgentMessage,
	parseDirectedAgentCommand,
} from "./agentHelpers.js";

export async function handleChatMessage(
	_clientId: string,
	client: ConnectedClient,
	payload: any,
): Promise<void> {
	if (!client.sessionId) return;
	const session = gameState.getSession(client.sessionId);
	if (!session) return;

	const actorId = payload.actor_id || client.combatantId;
	const content: string = payload.content;
	let suppressGmResponse = false;

	const chatMsg = gameState.createMessage({
		campaign_id: session.campaign_id,
		session_id: client.sessionId,
		actor_id: actorId,
		message_type: payload.message_type || "player_speech",
		content,
		visibility: payload.visibility || "party",
	});

	broadcastToSession(client.sessionId, {
		type: "chat_message",
		payload: chatMsg,
		timestamp: new Date().toISOString(),
	});

	if (chatMsg.message_type === "player_speech") {
		const party = gameState.getPartyCombatants(session.campaign_id);
		const directed = parseDirectedAgentCommand(content, party);
		if (directed) {
			handleDirectedAgentMessage(
				directed.agent,
				directed.command,
				{
					actor_id: actorId ?? undefined,
					content,
					message_type: chatMsg.message_type,
				},
				client.sessionId,
				session.campaign_id,
			);
			return;
		}
	}

	if (actorId && chatMsg.message_type === "player_speech") {
		const combatant = gameState.getCombatant(actorId);
		if (combatant && combatant.status !== "dead") {
			const isTactical = session.current_mode === "tactical";
			const movement = parseMovement(
				content,
				combatant.attributes.spd_bipedal,
				combatant.attributes.spd_quadruped,
				isTactical,
			);
			if (movement) {
				if (isTactical) {
					const ts = session.turn_state;
					const activeId = ts?.turn_order[ts.current_actor_index ?? 0];
					if (activeId !== actorId) {
						const blockedMsg = gameState.createMessage({
							campaign_id: session.campaign_id,
							session_id: client.sessionId,
							message_type: "system_alert",
							content: `⚠ Movement blocked: it is not ${combatant.name}'s turn.`,
							visibility: "party",
						});
						broadcastToSession(client.sessionId, {
							type: "chat_message",
							payload: blockedMsg,
							timestamp: new Date().toISOString(),
						});
						return;
					}

					const maxGridUnits = Math.round(
						(combatant.attributes.spd_bipedal * 5) / 10,
					);
					if (movement.distance_grid > maxGridUnits) {
						const blockedMsg = gameState.createMessage({
							campaign_id: session.campaign_id,
							session_id: client.sessionId,
							message_type: "system_alert",
							content: `⚠ Movement blocked: ${movement.distance_grid} units exceeds max range of ${maxGridUnits} units (${maxGridUnits * 10} ft) this turn.`,
							visibility: "party",
						});
						broadcastToSession(client.sessionId, {
							type: "chat_message",
							payload: blockedMsg,
							timestamp: new Date().toISOString(),
						});
						return;
					}
				}

				const curX = combatant.tactical_x ?? 0;
				const curY = combatant.tactical_y ?? 0;
				const facing = directionToFacing(movement.direction_label);

				if (isTactical) {
					const newX = curX + movement.dx;
					const newY = curY + movement.dy;
					const updated = gameState.updateCombatantPosition(
						actorId,
						newX,
						newY,
						facing,
					);
					if (updated) {
						broadcastToSession(client.sessionId, {
							type: "combatant_update",
							payload: updated,
							timestamp: new Date().toISOString(),
						});
						console.log(
							`[move] ${combatant.name} → ${movement.direction_label} ${movement.distance_ft}ft (${movement.pace}) → grid (${newX}, ${newY})`,
						);

						const confirmMsg = gameState.createMessage({
							campaign_id: session.campaign_id,
							session_id: client.sessionId,
							message_type: "system_alert",
							content: `📍 ${combatant.name} moved ${movement.distance_ft} ft ${movement.direction_label} → grid (${newX}, ${newY}).`,
							visibility: "party",
						});
						broadcastToSession(client.sessionId, {
							type: "chat_message",
							payload: confirmMsg,
							timestamp: new Date().toISOString(),
						});
					}
				} else {
					const movementResult = await checkMovementForContact(
						curX,
						curY,
						movement.dx,
						movement.dy,
						client.sessionId!,
						session.campaign_id,
					);

					const party = gameState.getPartyCombatants(session.campaign_id);
					for (const member of party) {
						const updated = gameState.updateCombatantPosition(
							member.id,
							movementResult.finalX,
							movementResult.finalY,
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

					console.log(
						`[move] ${combatant.name} → ${movement.direction_label} ${movement.distance_ft}ft (${movement.pace}) → grid (${movementResult.finalX}, ${movementResult.finalY})`,
					);

					if (movementResult.contactMade && movementResult.detectedEnemy) {
						const enemy = movementResult.detectedEnemy;
						const now = new Date().toISOString();
						const isHostile =
							enemy.enemy_type !== "friendly" &&
							enemy.enemy_type !== "poi" &&
							enemy.enemy_type !== "neutral";

						if (!enemy.detected) {
							gameState.markEnemyDetected(enemy.id);
							const detectedEntity = { ...enemy, detected: true };
							broadcastToSession(client.sessionId, {
								type: "enemy_update",
								payload: detectedEntity,
								timestamp: now,
							});
						}

						const spotterName =
							movementResult.spotter?.name ?? combatant.name;
						const alertMsg = gameState.createMessage({
							campaign_id: session.campaign_id,
							session_id: client.sessionId,
							message_type: "system_alert",
							content: `⚠ ${spotterName} spotted ${enemy.name} at ${movementResult.distanceToEnemy} ft — movement stopped!`,
							visibility: "party",
						});
						broadcastToSession(client.sessionId, {
							type: "chat_message",
							payload: alertMsg,
							timestamp: now,
						});

						if (isHostile && session.current_mode !== "tactical") {
							const partyAlive = gameState
								.getPartyCombatants(session.campaign_id)
								.filter((c) => c.status !== "dead");

							const rolled = partyAlive.map((c) => {
								const natural = Math.floor(Math.random() * 20) + 1;
								const bonus = c.combat?.initiative_bonus ?? 0;
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
									timestamp: now,
								});
								return { id: c.id, roll: natural + bonus };
							});
							rolled.sort((a, b) => b.roll - a.roll);
							const turn_order = rolled.map((r) => r.id);

							const turn_state: TurnState = {
								turn_order,
								current_actor_index: 0,
								round: 1,
								tick: 0,
								action_budget: Object.fromEntries(
									partyAlive.map((c) => [c.id, c.combat?.apm ?? 4]),
								),
								pending_input:
									turn_order.length > 0
										? { actor_id: turn_order[0], input_type: "free_text" }
										: undefined,
							};

							gameState.updateSessionMode(client.sessionId!, "tactical");
							gameState.updateTurnState(client.sessionId!, turn_state);

							broadcastToSession(client.sessionId!, {
								type: "mode_change",
								payload: { mode: "tactical", turn_state },
								timestamp: now,
							});

							const firstActorName =
								partyAlive.find((c) => c.id === turn_order[0])?.name ??
								"Unknown";
							const combatMsg = gameState.createMessage({
								campaign_id: session.campaign_id,
								session_id: client.sessionId!,
								message_type: "system_alert",
								content: `⚔ CONTACT! ${spotterName} has hostile **${enemy.name}** in sight (${movementResult.distanceToEnemy} ft) — COMBAT BEGINS. ${firstActorName} acts first.`,
								visibility: "party",
							});
							broadcastToSession(client.sessionId!, {
								type: "chat_message",
								payload: combatMsg,
								timestamp: now,
							});

							const campaign = gameState.getCampaign(session.campaign_id);
							if (campaign?.gm_kind === "agent") {
								aiGm
									.narrateEnemySighting(
										session.campaign_id,
										client.sessionId!,
										enemy.name,
										movementResult.distanceToEnemy ?? 0,
									)
									.catch((err) =>
										console.error(
											"[move] Failed to narrate enemy sighting:",
											err,
										),
									);
							}

							suppressGmResponse = true;
						}
					} else {
						const spd = combatant.attributes.spd_bipedal;
						const metersPerTurn = spd * 1.524;
						const turns = Math.max(
							1,
							Math.ceil((movement.distance_ft * 0.3048) / metersPerTurn),
						);
						const campaign = gameState.getCampaign(session.campaign_id);
						checkWanderingMonster({
							sessionId: client.sessionId!,
							campaignId: session.campaign_id,
							campaign,
							turns,
							broadcast: (msg) =>
								broadcastToSession(client.sessionId!, msg),
							onEncounter: (monsterName) => {
								checkContactAndEnterTactical(
									client.sessionId!,
									session.campaign_id,
								).catch((err) =>
									console.error(
										"[contact-detection] post-WM check error:",
										err,
									),
								);
								aiGm
									.narrateWanderingMonsterEncounter(
										session.campaign_id,
										client.sessionId!,
										monsterName,
									)
									.catch((err) =>
										console.error(
											"[wandering-monster] AI narration error:",
											err,
										),
									);
							},
						}).catch((err) =>
							console.error("[wandering-monster] chat check error:", err),
						);
					}
				}
			}
		}
	}

	const campaign = gameState.getCampaign(session.campaign_id);
	if (
		!suppressGmResponse &&
		campaign?.gm_kind === "agent" &&
		chatMsg.message_type === "player_speech"
	) {
		aiGm
			.respondToPlayerMessage(
				session.campaign_id,
				client.sessionId,
				chatMsg,
			)
			.catch((err) => console.error("[aiGm] Failed to respond:", err));
	}
}
