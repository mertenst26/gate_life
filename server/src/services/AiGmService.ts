import type { ChatMessage } from "@gate-life/shared";
import { gmReplyService } from "./gm/GmReplyService.js";
import { narrationService } from "./gm/NarrationService.js";

/**
 * Thin facade that delegates to NarrationService and GmReplyService.
 * Keeps the existing `aiGm` singleton interface stable for all callers.
 */
class AiGmService {
	async narrateWanderingMonsterEncounter(
		campaignId: string,
		sessionId: string,
		monsterName: string,
	): Promise<void> {
		return narrationService.narrateWanderingMonsterEncounter(campaignId, sessionId, monsterName);
	}

	async narrateEnemySighting(
		campaignId: string,
		sessionId: string,
		enemyName: string,
		distanceFt: number,
	): Promise<void> {
		return narrationService.narrateEnemySighting(campaignId, sessionId, enemyName, distanceFt);
	}

	async narrateEnemyDeaths(
		sessionId: string,
		campaignId: string,
		enemyNames: string[],
	): Promise<void> {
		return narrationService.narrateEnemyDeaths(sessionId, campaignId, enemyNames);
	}

	async generateOpeningNarration(
		campaignId: string,
		sessionId: string,
	): Promise<void> {
		return narrationService.generateOpeningNarration(campaignId, sessionId);
	}

	async respondToPlayerMessage(
		campaignId: string,
		sessionId: string,
		playerMessage: ChatMessage,
	): Promise<void> {
		return gmReplyService.respondToPlayerMessage(campaignId, sessionId, playerMessage);
	}
}

export const aiGm = new AiGmService();
