import { broadcastToSession } from "../../ws/handler.js";
import { revealOnFire } from "../ContactDetectionService.js";
import { gameState } from "../GameStateService.js";
import { llmChat } from "../LlmService.js";
import {
	buildSystemPrompt,
	COMBAT_RE,
	enterTacticalMode,
	extractFireMarkers,
	stripMetaMarkersKeepActions,
} from "./shared.js";

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
			[
				{
					role: "user",
					content: `[SYSTEM]: A wandering monster (${monsterName}) has appeared. Narrate the encounter.`,
				},
			],
			{ maxTokens: 600, temperature: 0.85 },
		);

		broadcastToSession(sessionId, {
			type: "gm_thinking",
			payload: { thinking: false },
			timestamp: new Date().toISOString(),
		});

		if (!response.trim()) return;

		// Debug: Check for ACTIONS markers
		const hasActions = /<!--ACTIONS:/.test(response);
		console.log(
			`[NarrationService:wandering] Response length: ${response.length}, Has ACTIONS: ${hasActions}`,
		);
		if (!hasActions) {
			console.log(`[NarrationService:wandering] ⚠️  MISSING ACTIONS MARKERS!`);
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
			[
				{
					role: "user",
					content: `[SYSTEM]: The party has spotted a hostile enemy (${enemyName}) at ${distanceFt} feet away. Describe what they see in vivid detail — the creature's appearance, what it's doing, and the immediate threat it poses. Keep it concise (2-4 sentences). Do NOT use the <!--COMBAT--> marker (combat mode is already active).`,
				},
			],
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
			[
				{
					role: "user",
					content: `[SYSTEM]: The following enemy/enemies have just been killed: ${enemyList}. Narrate their death(s) vividly and dramatically (2-3 sentences). Describe how they fall, what happens to their body, any final sounds or movements. Keep it concise but impactful.`,
				},
			],
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
		const enemies = gameState.getSessionEnemies(sessionId);
		const detectedPOIs = enemies.filter(
			(e) => e.detected && (e.enemy_type === "poi" || e.entity_type === "poi"),
		);

		// Check if any POIs are at the party's spawn position (0,0)
		const poiAtSpawn = detectedPOIs.find(
			(poi) => poi.tactical_x === 0 && poi.tactical_y === 0,
		);

		const systemPrompt = buildSystemPrompt(campaign, party, { sessionId });

		let additionalContext = "";
		if (!poiAtSpawn && detectedPOIs.length > 0) {
			const nearbyPoiList = detectedPOIs
				.map(
					(poi) => `${poi.name} at grid (${poi.tactical_x}, ${poi.tactical_y})`,
				)
				.join(", ");
			additionalContext = `\n\nIMPORTANT: The party spawns at grid (0, 0). Nearby POIs include: ${nearbyPoiList}. Do NOT describe the party as being inside or at any of these locations - they must travel to them first. Describe what the party can see from their starting position, including these structures in the distance if visible.`;
		}

		const userPrompt = campaign.gm_agent_config?.setting
			? `Begin the adventure. Set the scene based on the campaign setting provided. The party starts at grid (0, 0). Introduce the environment, the atmosphere, and what the party sees and hears from this EXACT starting position. CRITICAL: Do NOT place the party inside any building, structure, shack, or POI unless that structure is physically located at grid (0, 0). If structures exist elsewhere on the map, describe them as being nearby or in the distance, but do not claim the party is inside them. Do NOT describe or suggest interacting with specific mechanical objects (buttons, levers, terminals, etc.) that are more than 10 meters away from grid (0, 0). End with a hook that invites the players to act. IMPORTANT: You MUST end your response with the <!--ACTIONS:["action1","action2","action3","action4"]--> block as specified in the system prompt.${additionalContext}`
			: `Begin the adventure. The party of Dog Boys spawns at grid (0, 0) in post-apocalyptic wilderness near a dimensional rift zone. Set the scene from this EXACT starting position — describe the environment, atmosphere, and immediate situation. Do NOT place them inside any structure unless it's at grid (0, 0). End with a hook that invites the players to act. IMPORTANT: You MUST end your response with the <!--ACTIONS:["action1","action2","action3","action4"]--> block as specified in the system prompt.${additionalContext}`;

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

		// Debug: Check for ACTIONS markers
		const hasActions = /<!--ACTIONS:/.test(response);
		console.log(
			`[NarrationService:opening] Response length: ${response.length}, Has ACTIONS: ${hasActions}`,
		);
		if (!hasActions) {
			console.log(`[NarrationService:opening] ⚠️  MISSING ACTIONS MARKERS!`);
			console.log(
				`[NarrationService:opening] Raw response preview:`,
				response.slice(-200),
			);
		}

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

	async narrateCombatInitiation(
		campaignId: string,
		sessionId: string,
		enemyNames: string[],
		distanceFeet: number,
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

		const enemyList = enemyNames.join(", ");
		const distance = Math.round(distanceFeet);

		const response = await llmChat(
			systemPrompt,
			[
				{
					role: "user",
					content: `[SYSTEM]: Combat is about to begin! The following hostile enemies have closed to within ${distance} feet and are engaging: ${enemyList}. Narrate the dramatic moment when combat erupts — describe what the party hears, sees, and feels as the enemies close in for attack. Make it vivid and atmospheric (2-4 sentences). Examples: "The heavy thump of rotors and jets echoes as the gunship crests the ridge..." or "You hear the metallic clanking of armor as Coalition soldiers burst from cover...". Do NOT use the <!--COMBAT--> marker (tactical mode will activate automatically).`,
				},
			],
			{ maxTokens: 400, temperature: 0.9 },
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
}

export const narrationService = new NarrationService();
