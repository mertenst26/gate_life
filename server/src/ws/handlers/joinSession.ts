import { gameState } from "../../services/GameStateService.js";
import type { ConnectedClient } from "../clients.js";
import { broadcastToSession } from "../clients.js";
import { triggerAgentTurnIfNeeded } from "./agentHelpers.js";

export async function handleJoinSession(
	clientId: string,
	client: ConnectedClient,
	payload: any,
): Promise<void> {
	client.sessionId = payload.session_id;
	client.userId = payload.user_id;
	client.combatantId = payload.combatant_id || undefined;
	client.role = payload.role || "player";
	if (!client.combatantId) {
		console.warn(
			`[join_session] WARNING: no combatant_id from clientId=${clientId} — will rely on register_combatant`,
		);
	}
	console.log(
		`[join_session] clientId=${clientId} sessionId=${client.sessionId} combatantId=${client.combatantId} role=${client.role}`,
	);

	const session = gameState.getSession(payload.session_id);
	if (session) {
		const campaign = gameState.getCampaign(session.campaign_id);
		const party = gameState.getPartyCombatants(session.campaign_id);
		const world_npcs = gameState.getWorldNpcCombatants(session.campaign_id);
		const detectedEntities = gameState
			.getSessionEnemies(session.id)
			.filter((e) => e.detected);
		client.socket.send(
			JSON.stringify({
				type: "session_state",
				payload: { session, campaign, party, world_npcs, detectedEntities },
				timestamp: new Date().toISOString(),
			}),
		);

		if (session.current_mode === "tactical") {
			setTimeout(() => {
				triggerAgentTurnIfNeeded(session.id, session.campaign_id).catch(
					(err) => console.error("[agent-turn] join trigger error:", err),
				);
			}, 1500);
		}
	}
}

export function handleRegisterCombatant(
	clientId: string,
	client: ConnectedClient,
	payload: any,
): void {
	const { combatant_id } = payload as { combatant_id: string };
	client.combatantId = combatant_id;
	console.log(
		`[register_combatant] clientId=${clientId} combatantId=${client.combatantId}`,
	);
	client.socket.send(
		JSON.stringify({
			type: "pong",
			payload: { registered: combatant_id },
			timestamp: new Date().toISOString(),
		}),
	);
}
