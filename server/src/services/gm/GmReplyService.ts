import type { ChatMessage } from "@gate-life/shared";
import { broadcastToSession } from "../../ws/handler.js";
import { auditPlayerCapabilityClaims } from "../CharacterCapabilityService.js";
import { revealOnFire } from "../ContactDetectionService.js";
import { gameState } from "../GameStateService.js";
import { llmChat } from "../LlmService.js";
import { PROXIMITY_RANGES, proximityService } from "../ProximityService.js";
import { processQuestCompleteMarkers } from "../QuestCompletionService.js";
import {
	extractRevealPoiMarkers,
	revealQuestPoiByName,
} from "../QuestPoiRevealService.js";
import { narrationService } from "./NarrationService.js";
import {
	buildSystemPrompt,
	COMBAT_RE,
	chatHistoryToLlmMessages,
	consolidateAdjacentRoles,
	enterTacticalMode,
	extractFireMarkers,
	extractMovePlayerMarkers,
	processDamageMarkers,
	processGiveItemMarkers,
	processGmRolls,
	stripMetaMarkersKeepActions,
} from "./shared.js";

export class GmReplyService {
	async respondToPlayerMessage(
		campaignId: string,
		sessionId: string,
		playerMessage: ChatMessage,
	): Promise<void> {
		const campaign = gameState.getCampaign(campaignId);
		if (!campaign || campaign.gm_kind !== "agent") return;

		broadcastToSession(sessionId, {
			type: "gm_thinking",
			payload: { thinking: true },
			timestamp: new Date().toISOString(),
		});

		const party = gameState.getPartyCombatants(campaignId);
		const recentMessages = gameState.getMessages(campaignId, {
			sessionId,
			limit: 30,
		});

		const speakingActor = party.find((c) => c.id === playerMessage.actor_id);
		const audit = auditPlayerCapabilityClaims(
			playerMessage.content,
			speakingActor,
		);

		// Check for recent combat events (last 10 seconds)
		const combatResults = this.formatRecentCombatEvents(
			campaignId,
			sessionId,
			party,
		);

		const systemPrompt = buildSystemPrompt(campaign, party, {
			capabilityAudit: audit.gmInjection || undefined,
			sessionId,
			combatResults: combatResults || undefined,
		});
		let llmMessages = chatHistoryToLlmMessages(recentMessages, party);
		llmMessages = consolidateAdjacentRoles(llmMessages);

		if (
			llmMessages.length === 0 ||
			llmMessages[llmMessages.length - 1].role !== "user"
		) {
			const actor = party.find((c) => c.id === playerMessage.actor_id);
			const name = actor?.name || "Player";
			llmMessages.push({
				role: "user",
				content: `[${name}]: ${playerMessage.content}`,
			});
		}

		if (llmMessages[0]?.role === "assistant") {
			llmMessages.unshift({
				role: "user",
				content: "[The adventure begins...]",
			});
		}

		// Append ACTIONS reminder to the last user message for extra reinforcement
		const lastMsg = llmMessages[llmMessages.length - 1];
		if (lastMsg && lastMsg.role === "user") {
			lastMsg.content +=
				'\n\nREMINDER: You MUST end your response with <!--ACTIONS:["action1","action2","action3","action4"]--> as specified in the system prompt.';
		}

		const response = await llmChat(systemPrompt, llmMessages, {
			maxTokens: 600,
			temperature: 0.8,
		});

		broadcastToSession(sessionId, {
			type: "gm_thinking",
			payload: { thinking: false },
			timestamp: new Date().toISOString(),
		});

		if (!response.trim()) return;

		// Debug: Log raw LLM response to check for ACTIONS markers
		const hasActions = /<!--ACTIONS:/.test(response);
		console.log(
			`[GmReply] Response length: ${response.length}, Has ACTIONS: ${hasActions}`,
		);
		if (!hasActions) {
			console.log(`[GmReply] ⚠️  MISSING ACTIONS MARKERS!`);
			console.log(`[GmReply] Raw response preview:`, response.slice(-200));
		}

		const combatStarting = COMBAT_RE.test(response);
		const fireNames = extractFireMarkers(response);

		const msg = gameState.createMessage({
			campaign_id: campaignId,
			session_id: sessionId,
			message_type: "gm_narration",
			content: stripMetaMarkersKeepActions(response),
			visibility: "party",
		});

		broadcastToSession(sessionId, {
			type: "chat_message",
			payload: msg,
			timestamp: new Date().toISOString(),
		});

		if (combatStarting) await enterTacticalMode(sessionId, campaignId);

		for (const name of fireNames) {
			revealOnFire(sessionId, campaignId, name).catch((err) =>
				console.error(`[AiGm] revealOnFire error for "${name}":`, err),
			);
		}

		for (const poiName of extractRevealPoiMarkers(response)) {
			revealQuestPoiByName(sessionId, campaignId, poiName);
		}

		processQuestCompleteMarkers(sessionId, campaignId, response);
		processGmRolls(response, sessionId, campaignId);

		const killedEnemies = processDamageMarkers(response, sessionId, campaignId);
		if (killedEnemies.length > 0) {
			await narrationService.narrateEnemyDeaths(
				sessionId,
				campaignId,
				killedEnemies,
			);
		}

		processGiveItemMarkers(response, sessionId, campaignId);

		const movePlayerTargets = extractMovePlayerMarkers(response);
		for (const npcName of movePlayerTargets) {
			this.movePlayerToNpc(
				sessionId,
				campaignId,
				playerMessage.actor_id,
				npcName,
			);
		}
	}

	private findAdjacentPosition(
		sessionId: string,
		campaignId: string,
		targetX: number,
		targetY: number,
	): { x: number; y: number } {
		const adjacent = [
			{ x: targetX, y: targetY + 1 },
			{ x: targetX + 1, y: targetY + 1 },
			{ x: targetX + 1, y: targetY },
			{ x: targetX + 1, y: targetY - 1 },
			{ x: targetX, y: targetY - 1 },
			{ x: targetX - 1, y: targetY - 1 },
			{ x: targetX - 1, y: targetY },
			{ x: targetX - 1, y: targetY + 1 },
		];

		const party = gameState.getPartyCombatants(campaignId);
		const enemies = gameState.getSessionEnemies(sessionId);
		const occupied = new Set<string>();

		for (const c of party) {
			if (c.tactical_x != null && c.tactical_y != null)
				occupied.add(`${c.tactical_x},${c.tactical_y}`);
		}
		for (const e of enemies) {
			if (e.tactical_x != null && e.tactical_y != null)
				occupied.add(`${e.tactical_x},${e.tactical_y}`);
		}

		for (const pos of adjacent) {
			if (!occupied.has(`${pos.x},${pos.y}`)) return pos;
		}

		return { x: targetX, y: targetY };
	}

	private formatRecentCombatEvents(
		campaignId: string,
		sessionId: string,
		party: Combatant[],
	): string | null {
		// Get recent game events (last 10 events should cover recent combat actions)
		const events = gameState.getEvents(campaignId, {
			sessionId,
			limit: 10,
		});

		// Filter for combat-related events from the last few seconds
		const now = Date.now();
		const RECENCY_THRESHOLD_MS = 10000; // 10 seconds

		const combatEventTypes = [
			"strike_hit",
			"strike_miss",
			"strike_fumble",
			"critical_hit",
			"dodge_success",
			"parry_success",
			"death",
			"unconscious",
			"armor_destroyed",
		];

		const recentCombatEvents = events.filter((e) => {
			if (!combatEventTypes.includes(e.event_type)) return false;
			const eventTime = new Date(e.timestamp).getTime();
			return now - eventTime < RECENCY_THRESHOLD_MS;
		});

		if (recentCombatEvents.length === 0) return null;

		// Format events into readable descriptions
		const lines: string[] = [];
		for (const event of recentCombatEvents) {
			const actorName =
				party.find((c) => c.id === event.actor_id)?.name || "Unknown";
			const targetName = event.target_id
				? party.find((c) => c.id === event.target_id)?.name ||
					gameState.getEnemy(event.target_id)?.name ||
					"Unknown"
				: null;

			switch (event.event_type) {
				case "strike_hit":
				case "critical_hit": {
					const data = event.data as any;
					const isCrit = event.event_type === "critical_hit";
					const strikeRoll = data.strike_roll;
					const damageRoll = data.damage_roll;
					const totalDamage = data.total_damage;
					const damageType = data.damage_type?.toUpperCase() || "SDC";
					lines.push(
						`${actorName} ${isCrit ? "CRITICALLY " : ""}hit ${targetName}! Strike roll: d20 (${strikeRoll?.natural}) + ${strikeRoll?.modifier} = ${strikeRoll?.total}. Damage: ${damageRoll?.natural}${isCrit ? " ×2" : ""} = ${totalDamage} ${damageType}.`,
					);
					break;
				}
				case "strike_miss": {
					const data = event.data as any;
					const strikeRoll = data.strike_roll;
					lines.push(
						`${actorName} attacked ${targetName} but MISSED. Strike roll: d20 (${strikeRoll?.natural}) + ${strikeRoll?.modifier} = ${strikeRoll?.total}.`,
					);
					break;
				}
				case "strike_fumble": {
					const data = event.data as any;
					const strikeRoll = data.strike_roll;
					lines.push(
						`${actorName} FUMBLED their attack on ${targetName}! Critical miss on d20 (${strikeRoll?.natural}).`,
					);
					break;
				}
				case "dodge_success": {
					const data = event.data as any;
					const dodgeRoll = data.dodge_roll;
					lines.push(
						`${actorName} dodged the attack! Dodge roll: d20 (${dodgeRoll?.natural}) + ${dodgeRoll?.modifier} = ${dodgeRoll?.total}.`,
					);
					break;
				}
				case "parry_success": {
					const data = event.data as any;
					const parryRoll = data.parry_roll;
					lines.push(
						`${actorName} parried the attack! Parry roll: d20 (${parryRoll?.natural}) + ${parryRoll?.modifier} = ${parryRoll?.total}.`,
					);
					break;
				}
				case "death":
					lines.push(`${actorName} has been KILLED!`);
					break;
				case "unconscious":
					lines.push(`${actorName} fell unconscious!`);
					break;
				case "armor_destroyed":
					lines.push(`${actorName}'s armor was destroyed!`);
					break;
			}
		}

		return lines.join("\n");
	}

	private movePlayerToNpc(
		sessionId: string,
		campaignId: string,
		playerActorId: string | undefined,
		npcName: string,
	): void {
		if (!playerActorId) return;

		const player = gameState.getCombatant(playerActorId);
		if (!player) return;

		const party = gameState.getPartyCombatants(campaignId);
		const npcInParty = party.find(
			(c) => c.name.toLowerCase() === npcName.toLowerCase(),
		);

		if (
			npcInParty &&
			npcInParty.tactical_x != null &&
			npcInParty.tactical_y != null
		) {
			// Check proximity before auto-moving
			const proximityCheck = proximityService.checkProximity(
				campaignId,
				{ x: npcInParty.tactical_x, y: npcInParty.tactical_y },
				PROXIMITY_RANGES.DIALOG_REFERENCE,
			);

			if (!proximityCheck.inRange) {
				// Too far - notify player instead of auto-moving
				const errorMsg = proximityService.generateProximityError(
					npcInParty.name,
					proximityCheck.distanceMeters,
					PROXIMITY_RANGES.DIALOG_REFERENCE,
					"reach",
				);
				const msg = gameState.createMessage({
					campaign_id: campaignId,
					session_id: sessionId,
					message_type: "system_alert",
					content: errorMsg,
					visibility: "party",
				});
				broadcastToSession(sessionId, {
					type: "chat_message",
					payload: msg,
					timestamp: new Date().toISOString(),
				});
				return;
			}

			const pos = this.findAdjacentPosition(
				sessionId,
				campaignId,
				npcInParty.tactical_x,
				npcInParty.tactical_y,
			);
			const updated = gameState.updateCombatantPosition(
				playerActorId,
				pos.x,
				pos.y,
			);
			if (updated) {
				broadcastToSession(sessionId, {
					type: "combatant_update",
					payload: updated,
					timestamp: new Date().toISOString(),
				});
			}
			return;
		}

		const enemies = gameState.getSessionEnemies(sessionId);
		const npcEntity = enemies.find(
			(e) => e.name.toLowerCase() === npcName.toLowerCase() && e.detected,
		);

		if (
			npcEntity &&
			npcEntity.tactical_x != null &&
			npcEntity.tactical_y != null
		) {
			const isPOI =
				npcEntity.enemy_type === "poi" || npcEntity.entity_type === "poi";

			// For NPCs, check proximity before auto-moving (can't teleport to distant NPCs)
			// For POIs/buildings, allow movement from any distance (approaching = travel)
			if (!isPOI) {
				const proximityCheck = proximityService.checkProximity(
					campaignId,
					{ x: npcEntity.tactical_x, y: npcEntity.tactical_y },
					PROXIMITY_RANGES.DIALOG_REFERENCE,
				);

				if (!proximityCheck.inRange) {
					// Too far - notify player instead of auto-moving
					const errorMsg = proximityService.generateProximityError(
						npcEntity.name,
						proximityCheck.distanceMeters,
						PROXIMITY_RANGES.DIALOG_REFERENCE,
						"reach",
					);
					const msg = gameState.createMessage({
						campaign_id: campaignId,
						session_id: sessionId,
						message_type: "system_alert",
						content: errorMsg,
						visibility: "party",
					});
					broadcastToSession(sessionId, {
						type: "chat_message",
						payload: msg,
						timestamp: new Date().toISOString(),
					});
					return;
				}
			}

			const pos = this.findAdjacentPosition(
				sessionId,
				campaignId,
				npcEntity.tactical_x,
				npcEntity.tactical_y,
			);
			const updated = gameState.updateCombatantPosition(
				playerActorId,
				pos.x,
				pos.y,
			);
			if (updated) {
				broadcastToSession(sessionId, {
					type: "combatant_update",
					payload: updated,
					timestamp: new Date().toISOString(),
				});
			}
		}
	}
}

export const gmReplyService = new GmReplyService();
