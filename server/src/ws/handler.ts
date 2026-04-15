import type { FastifyInstance } from "fastify";
import {
	type ConnectedClient,
	broadcastToAll,
	broadcastToSession,
	clients,
	getSessionClients,
	nextClientId,
} from "./clients.js";
import { pendingAgentOrders } from "./handlers/agentHelpers.js";
import { handleChatMessage } from "./handlers/chat.js";
import {
	handleJoinSession,
	handleRegisterCombatant,
} from "./handlers/joinSession.js";
import {
	handleEndTurn,
	handleFollowResponse,
	handlePing,
	handleTacticalMove,
	sendFollowRequest,
} from "./handlers/tactical.js";

// Re-export shared infrastructure so existing imports throughout the codebase continue to work
export {
	broadcastToAll,
	broadcastToSession,
	getSessionClients,
	pendingAgentOrders,
	sendFollowRequest,
};

export async function wsHandler(app: FastifyInstance) {
	app.get("/ws", { websocket: true }, (socket, _req) => {
		const clientId = nextClientId();
		const client: ConnectedClient = { socket, role: "player" };
		clients.set(clientId, client);

		console.log(`[ws] Client ${clientId} connected`);

		socket.on("message", (rawMsg: Buffer) => {
			try {
				const msg = JSON.parse(rawMsg.toString());
				handleClientMessage(clientId, client, msg);
			} catch {
				socket.send(
					JSON.stringify({
						type: "error",
						payload: { message: "Invalid message format" },
						timestamp: new Date().toISOString(),
					}),
				);
			}
		});

		socket.on("close", () => {
			clients.delete(clientId);
			console.log(`[ws] Client ${clientId} disconnected`);
		});
	});
}

async function handleClientMessage(
	clientId: string,
	client: ConnectedClient,
	msg: any,
): Promise<void> {
	switch (msg.type) {
		case "join_session":
			return handleJoinSession(clientId, client, msg.payload);
		case "chat_message":
			return handleChatMessage(clientId, client, msg.payload);
		case "tactical_move":
			return handleTacticalMove(clientId, client, msg.payload);
		case "end_turn":
			return handleEndTurn(clientId, client, msg.payload);
		case "register_combatant":
			return handleRegisterCombatant(clientId, client, msg.payload);
		case "follow_response":
			return handleFollowResponse(clientId, client, msg.payload);
		case "ping":
			return handlePing(client);
	}
}
