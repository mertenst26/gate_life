import type { ChatMessage } from "@gate-life/shared";
import { broadcastToSession } from "../../ws/handler.js";
import {
	auditPlayerCapabilityClaims,
} from "../CharacterCapabilityService.js";
import { revealOnFire } from "../ContactDetectionService.js";
import { gameState } from "../GameStateService.js";
import { llmChat } from "../LlmService.js";
import { processQuestCompleteMarkers } from "../QuestCompletionService.js";
import {
	extractRevealPoiMarkers,
	revealQuestPoiByName,
} from "../QuestPoiRevealService.js";
import { narrationService } from "./NarrationService.js";
import {
	COMBAT_RE,
	buildSystemPrompt,
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

		const systemPrompt = buildSystemPrompt(campaign, party, {
			capabilityAudit: audit.gmInjection || undefined,
			sessionId,
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

		const response = await llmChat(systemPrompt, llmMessages, {
			maxTokens: 1024,
			temperature: 0.8,
		});

		broadcastToSession(sessionId, {
			type: "gm_thinking",
			payload: { thinking: false },
			timestamp: new Date().toISOString(),
		});

		if (!response.trim()) return;

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
			await narrationService.narrateEnemyDeaths(sessionId, campaignId, killedEnemies);
		}

		processGiveItemMarkers(response, sessionId, campaignId);

		const movePlayerTargets = extractMovePlayerMarkers(response);
		for (const npcName of movePlayerTargets) {
			this.movePlayerToNpc(sessionId, campaignId, playerMessage.actor_id, npcName);
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

		if (npcInParty && npcInParty.tactical_x != null && npcInParty.tactical_y != null) {
			const pos = this.findAdjacentPosition(sessionId, campaignId, npcInParty.tactical_x, npcInParty.tactical_y);
			const updated = gameState.updateCombatantPosition(playerActorId, pos.x, pos.y);
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

		if (npcEntity && npcEntity.tactical_x != null && npcEntity.tactical_y != null) {
			const pos = this.findAdjacentPosition(sessionId, campaignId, npcEntity.tactical_x, npcEntity.tactical_y);
			const updated = gameState.updateCombatantPosition(playerActorId, pos.x, pos.y);
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
