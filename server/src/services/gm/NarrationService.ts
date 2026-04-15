import { broadcastToSession } from "../../ws/handler.js";
import { gameState } from "../GameStateService.js";
import { llmChat } from "../LlmService.js";
import {
	COMBAT_RE,
	buildSystemPrompt,
	enterTacticalMode,
	extractFireMarkers,
	stripMetaMarkersKeepActions,
} from "./shared.js";
import { revealOnFire } from "../ContactDetectionService.js";

export class NarrationService {
	async narrateWanderingMonsterEncounter(
		campaignId: string,
		sessionId: string,
		monsterName: string,
	): Promise<void> {
		const campaign = gameState.getCampaign(campaignId);
		if (!campaign || campaign.gm_kind !== "agent") return;

		broadcastToSession(sessionId, {
			type: "gm_thinking",
			payload: { thinking: true },
			timestamp: new Date().toISOString(),
		});

		const party = gameState.getPartyCombatants(campaignId);
		const systemPrompt = buildSystemPrompt(campaign, party, {
			wanderingMonsterTriggered: monsterName,
			sessionId,
		});

		const response = await llmChat(
			systemPrompt,
			[{ role: "user", content: `[SYSTEM]: A wandering monster (${monsterName}) has appeared. Narrate the encounter.` }],
			{ maxTokens: 600, temperature: 0.85 },
		);

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
	}

	async narrateEnemySighting(
		campaignId: string,
		sessionId: string,
		enemyName: string,
		distanceFt: number,
	): Promise<void> {
		const campaign = gameState.getCampaign(campaignId);
		if (!campaign || campaign.gm_kind !== "agent") return;

		broadcastToSession(sessionId, {
			type: "gm_thinking",
			payload: { thinking: true },
			timestamp: new Date().toISOString(),
		});

		const party = gameState.getPartyCombatants(campaignId);
		const systemPrompt = buildSystemPrompt(campaign, party, { sessionId });

		const response = await llmChat(
			systemPrompt,
			[{ role: "user", content: `[SYSTEM]: The party has spotted a hostile enemy (${enemyName}) at ${distanceFt} feet away. Describe what they see in vivid detail — the creature's appearance, what it's doing, and the immediate threat it poses. Keep it concise (2-4 sentences). Do NOT use the <!--COMBAT--> marker (combat mode is already active).` }],
			{ maxTokens: 400, temperature: 0.85 },
		);

		broadcastToSession(sessionId, {
			type: "gm_thinking",
			payload: { thinking: false },
			timestamp: new Date().toISOString(),
		});

		if (!response.trim()) return;

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
	}

	async narrateEnemyDeaths(
		sessionId: string,
		campaignId: string,
		enemyNames: string[],
	): Promise<void> {
		const campaign = gameState.getCampaign(campaignId);
		if (!campaign || campaign.gm_kind !== "agent") return;

		broadcastToSession(sessionId, {
			type: "gm_thinking",
			payload: { thinking: true },
			timestamp: new Date().toISOString(),
		});

		const party = gameState.getPartyCombatants(campaignId);
		const systemPrompt = buildSystemPrompt(campaign, party, { sessionId });

		const enemyList =
			enemyNames.length === 1
				? enemyNames[0]
				: enemyNames.slice(0, -1).join(", ") + " and " + enemyNames.slice(-1);

		const response = await llmChat(
			systemPrompt,
			[{ role: "user", content: `[SYSTEM]: The following enemy/enemies have just been killed: ${enemyList}. Narrate their death(s) vividly and dramatically (2-3 sentences). Describe how they fall, what happens to their body, any final sounds or movements. Keep it concise but impactful.` }],
			{ maxTokens: 300, temperature: 0.9 },
		);

		broadcastToSession(sessionId, {
			type: "gm_thinking",
			payload: { thinking: false },
			timestamp: new Date().toISOString(),
		});

		if (!response.trim()) return;

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
	}

	async generateOpeningNarration(
		campaignId: string,
		sessionId: string,
	): Promise<void> {
		const campaign = gameState.getCampaign(campaignId);
		if (!campaign || campaign.gm_kind !== "agent") return;

		broadcastToSession(sessionId, {
			type: "gm_thinking",
			payload: { thinking: true },
			timestamp: new Date().toISOString(),
		});

		const party = gameState.getPartyCombatants(campaignId);
		const systemPrompt = buildSystemPrompt(campaign, party, { sessionId });

		const userPrompt = campaign.gm_agent_config?.setting
			? `Begin the adventure. Set the scene based on the campaign setting provided. Introduce the environment, the atmosphere, and what the party sees and hears. End with a hook that invites the players to act.`
			: `Begin the adventure. The party of Dog Boys is on a mission in the post-apocalyptic wilderness near a dimensional rift zone. Set the scene — describe the environment, atmosphere, and immediate situation. End with a hook that invites the players to act.`;

		const response = await llmChat(
			systemPrompt,
			[{ role: "user", content: userPrompt }],
			{ maxTokens: 1500, temperature: 0.9 },
		);

		broadcastToSession(sessionId, {
			type: "gm_thinking",
			payload: { thinking: false },
			timestamp: new Date().toISOString(),
		});

		if (!response.trim()) return;

		const msg = gameState.createMessage({
			campaign_id: campaignId,
			session_id: sessionId,
			message_type: "gm_narration",
			content: response.trim(),
			visibility: "party",
		});

		broadcastToSession(sessionId, {
			type: "chat_message",
			payload: msg,
			timestamp: new Date().toISOString(),
		});
	}
}

export const narrationService = new NarrationService();
