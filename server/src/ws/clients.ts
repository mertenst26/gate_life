import type { WSMessage } from "@gate-life/shared";
import { WebSocket } from "ws";

export interface ConnectedClient {
	socket: WebSocket;
	sessionId?: string;
	userId?: string;
	combatantId?: string;
	role: "gm" | "player" | "spectator";
}

export const clients: Map<string, ConnectedClient> = new Map();
export let clientIdCounter = 0;
export function nextClientId(): string {
	return String(++clientIdCounter);
}

export function broadcastToSession(
	sessionId: string,
	message: WSMessage,
): void {
	const payload = JSON.stringify(message);
	for (const client of clients.values()) {
		if (
			client.sessionId === sessionId &&
			client.socket.readyState === WebSocket.OPEN
		) {
			client.socket.send(payload);
		}
	}
}

export function broadcastToAll(message: WSMessage): void {
	const payload = JSON.stringify(message);
	for (const client of clients.values()) {
		if (client.socket.readyState === WebSocket.OPEN) {
			client.socket.send(payload);
		}
	}
}

export function getSessionClients(sessionId: string): ConnectedClient[] {
	return Array.from(clients.values()).filter((c) => c.sessionId === sessionId);
}
