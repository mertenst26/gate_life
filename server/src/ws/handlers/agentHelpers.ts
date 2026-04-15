import type { Combatant, TurnState, WSMessage } from "@gate-life/shared";
import { agentChat } from "../../services/AgentChatService.js";
import { executeAgentTurn } from "../../services/AgentTurnExecutor.js";
import { gameState } from "../../services/GameStateService.js";
import { parseMovement } from "../../services/MovementParser.js";
import { broadcastToSession } from "../clients.js";

export const pendingAgentOrders = new Map<string, string>();

const runningAgentTurns = new Set<string>();

/**
 * Detects messages addressed to a named agent in the party.
 *
 * Accepted patterns (all case-insensitive):
 *   "uu - move east"         name at start + separator
 *   "uu: how are you?"       name at start + colon
 *   "whats up uu?"           name at end
 *   "hey uu, what's wrong?"  hey/hi prefix
 *   "@uu move north"         @ mention
 *   "uu?"  "uu!"             bare name with punctuation
 *
 * Returns { agent, command } where command is the text stripped of the name/prefix.
 */
export function parseDirectedAgentCommand(
	content: string,
	party: Combatant[],
): { agent: Combatant; command: string } | null {
	const agents = party.filter(
		(c) => c.kind === "agent" && c.status === "alive",
	);
	const text = content.trim();

	for (const agent of agents) {
		const n = agent.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

		const sepMatch = text.match(new RegExp(`^@?${n}[\\s]*[-:,]\\s*(.+)$`, "i"));
		if (sepMatch) return { agent, command: sepMatch[1].trim() };

		const endMatch = text.match(new RegExp(`^(.+?)\\s+${n}[?!.,]*$`, "i"));
		if (endMatch) return { agent, command: endMatch[1].trim() };

		const heyMatch = text.match(
			new RegExp(`^(?:hey|hi|yo|ok)\\s+${n}[,\\s]+(.+)$`, "i"),
		);
		if (heyMatch) return { agent, command: heyMatch[1].trim() };

		const bareMatch = text.match(new RegExp(`^@?${n}[?!.]*$`, "i"));
		if (bareMatch) return { agent, command: "What's your status?" };
	}

	return null;
}

/**
 * If the current active actor in the turn order is an agent, execute their turn
 * and then advance the turn order. Safe to call from both end_turn and join_session.
 */
export async function triggerAgentTurnIfNeeded(
	sessionId: string,
	campaignId: string,
): Promise<void> {
	if (runningAgentTurns.has(sessionId)) return;

	const session = gameState.getSession(sessionId);
	const ts = session?.turn_state;
	if (!session || session.current_mode !== "tactical" || !ts) return;

	const activeId = ts.turn_order[ts.current_actor_index ?? 0];
	const party = gameState.getPartyCombatants(campaignId);
	const actor = party.find((c) => c.id === activeId);
	if (!actor || actor.kind !== "agent") return;

	runningAgentTurns.add(sessionId);
	console.log(
		`[agent-turn] triggering ${actor.name}'s turn (session=${sessionId.slice(-4)})`,
	);

	try {
		await executeAgentTurn(actor, sessionId, campaignId);
	} catch (err) {
		console.error(`[agent-turn] ${actor.name} error:`, err);
	} finally {
		runningAgentTurns.delete(sessionId);
		const latestSession = gameState.getSession(sessionId);
		const latestTs = latestSession?.turn_state;
		if (!latestTs) return;

		const afterIndex =
			(latestTs.current_actor_index + 1) % latestTs.turn_order.length;
		const afterTs: TurnState = {
			...latestTs,
			current_actor_index: afterIndex,
			round: afterIndex === 0 ? latestTs.round + 1 : latestTs.round,
			tick: latestTs.tick + 1,
			pending_input: {
				actor_id: latestTs.turn_order[afterIndex],
				input_type: "free_text",
			},
		};
		gameState.updateTurnState(sessionId, afterTs);
		broadcastToSession(sessionId, {
			type: "turn_update",
			payload: afterTs,
			timestamp: new Date().toISOString(),
		});
		console.log(
			`[agent-turn] ${actor.name} done — now actor ${afterIndex} (${afterTs.turn_order[afterIndex]})`,
		);
	}
}

export function buildAck(agent: Combatant, _rawCommand: string): string {
	const style = agent.personality?.speech_style ?? "terse";
	const name = agent.name;

	const lines: Record<string, string[]> = {
		terse: [
			`"Copy." ${name} nods.`,
			`"Understood." ${name} readies.`,
			`"Roger."`,
			`${name} gives a quick nod.`,
		],
		formal: [
			`"Order received. Will execute on my turn," ${name} reports.`,
			`"Understood. Standing by," ${name} says.`,
		],
		slang: [
			`"Got it!" ${name} barks.`,
			`"On it!" ${name} says.`,
			`"Yeah yeah, I hear ya."`,
		],
		poetic: [
			`${name} dips their head. "As you say."`,
			`"When the moment comes," ${name} murmurs.`,
		],
	};
	const pool = lines[style] ?? lines.terse;
	return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Handle a directed message to an agent.
 *
 * Tactical mode:
 *   - Movement/action command -> queue for their turn + canned ack
 *   - Conversation -> LLM in-character reply
 *
 * Outside tactical (conversation, travel, rest):
 *   - Always go to LLM for a conversational reply
 *   - If the command also contains movement, execute it immediately on the world map
 */
export function handleDirectedAgentMessage(
	agent: Combatant,
	command: string,
	playerMessage: { actor_id?: string; content: string; message_type: string },
	sessionId: string,
	campaignId: string,
): void {
	const session = gameState.getSession(sessionId);
	const isTactical = session?.current_mode === "tactical";
	const movement = parseMovement(
		command,
		agent.attributes.spd_bipedal,
		agent.attributes.spd_quadruped,
		false,
	);

	if (isTactical && movement) {
		pendingAgentOrders.set(agent.id, command);
		console.log(
			`[directed] queued tactical movement for ${agent.name}: "${command}"`,
		);

		const ack = gameState.createMessage({
			campaign_id: campaignId,
			session_id: sessionId,
			actor_id: agent.id,
			message_type: "npc_dialog",
			content: buildAck(agent, command),
			visibility: "party",
		});
		broadcastToSession(sessionId, {
			type: "chat_message",
			payload: ack,
			timestamp: new Date().toISOString(),
		});
		return;
	}

	console.log(
		`[directed] conversational message to ${agent.name}: "${command}"`,
	);

	if (!isTactical && movement) {
		const curX = agent.tactical_x ?? 0;
		const curY = agent.tactical_y ?? 0;
		const newX = curX + movement.dx;
		const newY = curY + movement.dy;
		const updated = gameState.updateCombatantPosition(
			agent.id,
			newX,
			newY,
			movement.direction_label,
		);
		if (updated) {
			broadcastToSession(sessionId, {
				type: "combatant_update",
				payload: updated,
				timestamp: new Date().toISOString(),
			});
			console.log(
				`[directed] ${agent.name} moved immediately → (${newX},${newY})`,
			);
		}
	}

	const fullMsg = {
		...playerMessage,
		id: "",
		campaign_id: campaignId,
		session_id: sessionId,
		timestamp: new Date().toISOString(),
		visibility: "party" as const,
	};
	agentChat
		.respondToDirectMessage(agent, fullMsg as any, sessionId, campaignId)
		.catch((err) => console.error(`[agentChat] ${agent.name} error:`, err));
}

export function directionToFacing(dir: string): string {
	const map: Record<string, string> = {
		north: "north",
		n: "north",
		south: "south",
		s: "south",
		east: "east",
		e: "east",
		west: "west",
		w: "west",
		northeast: "northeast",
		ne: "northeast",
		northwest: "northwest",
		nw: "northwest",
		southeast: "southeast",
		se: "southeast",
		southwest: "southwest",
		sw: "southwest",
		forward: "north",
		advance: "north",
		charge: "north",
		back: "south",
		backward: "south",
		retreat: "south",
	};
	return map[dir.toLowerCase()] || "north";
}
