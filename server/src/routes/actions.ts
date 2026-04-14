import type { GameMode } from "@gate-life/shared";
import type { FastifyInstance } from "fastify";
import { agentGm } from "../services/AgentCharacterAdapter.js";
import { gameState } from "../services/GameStateService.js";
import { itemAbilityService } from "../services/ItemAbilityService.js";
import { modeController } from "../services/ModeController.js";
import { partyInteractions } from "../services/PartyInteractionService.js";
import { progressionService } from "../services/ProgressionService.js";
import { turnEngine } from "../services/TurnEngine.js";
import { broadcastToSession } from "../ws/handler.js";

export async function actionRoutes(app: FastifyInstance) {
	app.post<{
		Body: {
			session_id: string;
			combatant_id: string;
			action_type: string;
			target_id?: string;
			data?: any;
		};
	}>("/", async (req) => {
		const { session_id, combatant_id, action_type, target_id, data } = req.body;
		const result = turnEngine.processAction(
			session_id,
			combatant_id,
			action_type,
			target_id,
			data,
		);

		broadcastToSession(session_id, {
			type: "game_event",
			payload: result,
			timestamp: new Date().toISOString(),
		});

		return result;
	});

	app.post<{ Body: { session_id: string } }>("/end-turn", async (req) => {
		const result = turnEngine.endTurn(req.body.session_id);

		broadcastToSession(req.body.session_id, {
			type: "turn_update",
			payload: result,
			timestamp: new Date().toISOString(),
		});

		return result;
	});

	app.post<{ Body: { session_id: string; mode: string; data?: any } }>(
		"/mode",
		async (req) => {
			const result = modeController.transitionMode(
				req.body.session_id,
				req.body.mode as GameMode,
				req.body.data,
			);
			if (!result.success) {
				return app.httpErrors.badRequest(
					result.error || "Invalid mode transition",
				);
			}
			return result;
		},
	);

	app.post<{ Body: { session_id: string } }>("/travel-leg", async (req) => {
		const events = modeController.processTravelLeg(req.body.session_id);
		broadcastToSession(req.body.session_id, {
			type: "game_event",
			payload: { events },
			timestamp: new Date().toISOString(),
		});
		return { events };
	});

	app.post<{ Body: { session_id: string; meditating_ids?: string[] } }>(
		"/rest-shift",
		async (req) => {
			const events = modeController.processRestShift(
				req.body.session_id,
				req.body.meditating_ids,
			);
			broadcastToSession(req.body.session_id, {
				type: "game_event",
				payload: { events },
				timestamp: new Date().toISOString(),
			});
			return { events };
		},
	);

	app.post<{
		Body: {
			session_id: string;
			campaign_id: string;
			combatant_id: string;
			amount: number;
			reason: string;
		};
	}>("/award-xp", async (req) => {
		const { session_id, campaign_id, combatant_id, amount, reason } = req.body;
		const events = progressionService.awardXP(
			combatant_id,
			amount,
			reason,
			campaign_id,
			session_id,
		);

		broadcastToSession(session_id, {
			type: "game_event",
			payload: { events },
			timestamp: new Date().toISOString(),
		});

		return { events };
	});

	// Party interaction routes

	app.post<{
		Body: {
			campaign_id: string;
			session_id: string;
			from_id: string;
			to_id: string;
			item_id: string;
			quantity?: number;
		};
	}>("/trade", async (req) => {
		const { campaign_id, session_id, from_id, to_id, item_id, quantity } =
			req.body;
		const events = partyInteractions.tradeItem(
			campaign_id,
			session_id,
			from_id,
			to_id,
			item_id,
			quantity,
		);
		broadcastToSession(session_id, {
			type: "game_event",
			payload: { events },
			timestamp: new Date().toISOString(),
		});
		return { events };
	});

	app.post<{
		Body: {
			campaign_id: string;
			session_id: string;
			healer_id: string;
			patient_id: string;
		};
	}>("/heal", async (req) => {
		const { campaign_id, session_id, healer_id, patient_id } = req.body;
		const events = partyInteractions.healAlly(
			campaign_id,
			session_id,
			healer_id,
			patient_id,
		);
		broadcastToSession(session_id, {
			type: "game_event",
			payload: { events },
			timestamp: new Date().toISOString(),
		});
		return { events };
	});

	app.post<{
		Body: {
			campaign_id: string;
			session_id: string;
			formation: Array<{ combatant_id: string; position: string }>;
		};
	}>("/formation", async (req) => {
		const events = partyInteractions.setFormation(
			req.body.campaign_id,
			req.body.session_id,
			req.body.formation as any,
		);
		broadcastToSession(req.body.session_id, {
			type: "game_event",
			payload: { events },
			timestamp: new Date().toISOString(),
		});
		return { events };
	});

	app.post<{ Body: { campaign_id: string; session_id: string } }>(
		"/banter",
		async (req) => {
			const events = partyInteractions.generateBanterPrompt(
				req.body.campaign_id,
				req.body.session_id,
			);
			broadcastToSession(req.body.session_id, {
				type: "game_event",
				payload: { events },
				timestamp: new Date().toISOString(),
			});
			return { events };
		},
	);

	app.post<{ Body: { combatant_id: string } }>("/eat", async (req) => {
		const success = partyInteractions.consumeRations(req.body.combatant_id);
		return { success };
	});

	app.post<{ Body: { combatant_id: string } }>("/drink", async (req) => {
		const success = partyInteractions.drinkWater(req.body.combatant_id);
		return { success };
	});

	app.post<{
		Body: {
			campaign_id: string;
			session_id: string;
			combatant_id: string;
			item_id: string;
			ability_index: number;
			target_data?: Record<string, unknown>;
		};
	}>("/use-item", async (req) => {
		const {
			campaign_id,
			session_id,
			combatant_id,
			item_id,
			ability_index,
			target_data,
		} = req.body;
		const events = itemAbilityService.useItemAbility(
			campaign_id,
			session_id,
			combatant_id,
			item_id,
			ability_index,
			target_data,
		);

		// Broadcast each event
		for (const event of events) {
			broadcastToSession(session_id, {
				type: "game_event",
				payload: event,
				timestamp: new Date().toISOString(),
			});
		}

		// Also send item_used websocket event
		broadcastToSession(session_id, {
			type: "item_used",
			payload: {
				combatantId: combatant_id,
				itemId: item_id,
				abilityIndex: ability_index,
			},
			timestamp: new Date().toISOString(),
		});

		return { events };
	});

	// Agent NPC turn processing
	app.post<{
		Body: { session_id: string; campaign_id: string; combatant_id: string };
	}>("/agent-turn", async (req) => {
		const { session_id, campaign_id, combatant_id } = req.body;
		const combatant = gameState.getCombatant(combatant_id);
		if (!combatant || combatant.kind !== "agent") {
			return app.httpErrors.badRequest("Not an agent combatant");
		}
		const events = await agentGm.processAgentTurn(
			combatant,
			session_id,
			campaign_id,
		);
		broadcastToSession(session_id, {
			type: "game_event",
			payload: { events },
			timestamp: new Date().toISOString(),
		});
		return { events };
	});
}
