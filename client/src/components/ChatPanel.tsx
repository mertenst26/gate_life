import type { ChatMessage, Combatant, FollowRequest } from "@gate-life/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useGame } from "../context/GameContext";

const ACTIONS_RE = /<!--ACTIONS:(.*?)-->/s;

function parseGmContent(content: string): { text: string; actions: string[] } {
	const match = content.match(ACTIONS_RE);
	if (!match) return { text: content.trim(), actions: [] };
	const text = content.replace(ACTIONS_RE, "").trim();
	try {
		const parsed = JSON.parse(match[1]);
		return { text, actions: Array.isArray(parsed) ? parsed : [] };
	} catch {
		return { text, actions: [] };
	}
}

function FollowRequestBubble({
	msg,
	onRespond,
}: {
	msg: ChatMessage;
	onRespond: (requestId: string, accepted: boolean) => void;
}) {
	const [responded, setResponded] = useState(false);
	let followReq: FollowRequest | null = null;
	try {
		followReq = JSON.parse(msg.content);
	} catch {
		return null;
	}

	if (!followReq) return null;

	const handleResponse = (accepted: boolean) => {
		setResponded(true);
		onRespond(followReq!.request_id, accepted);
	};

	const distanceMeters = Math.round(followReq.distance_ft * 0.3048);

	return (
		<div className="chat-message msg-npc fade-in follow-request">
			<div className="msg-header">
				<span className="msg-actor">{followReq.npc_name}</span>
				<span className="msg-time text-xs text-dim">
					{new Date(msg.created_at).toLocaleTimeString([], {
						hour: "2-digit",
						minute: "2-digit",
					})}
				</span>
			</div>
			<div className="msg-content">
				<strong>{followReq.npc_name}</strong> wants to lead you to a location (
				{distanceMeters}m away).
			</div>
			{!responded && (
				<div className="follow-consent-buttons">
					<button
						className="btn btn-primary"
						onClick={() => handleResponse(true)}
					>
						Follow
					</button>
					<button
						className="btn btn-secondary"
						onClick={() => handleResponse(false)}
					>
						Decline
					</button>
				</div>
			)}
		</div>
	);
}

function MessageBubble({
	msg,
	party,
	showActions,
	onAction,
}: {
	msg: ChatMessage;
	party: Combatant[];
	showActions?: boolean;
	onAction?: (action: string) => void;
}) {
	const actor = party.find((c) => c.id === msg.actor_id);
	const actorName =
		actor?.name || (msg.message_type === "gm_narration" ? "GM" : "System");

	const getMessageClass = () => {
		switch (msg.message_type) {
			case "gm_narration":
				return "msg-narration";
			case "player_speech":
				return "msg-player";
			case "npc_dialog":
				return "msg-npc";
			case "dice_result":
				return "msg-dice";
			case "system_alert":
				return "msg-system";
			case "gm_private":
				return "msg-gm-private";
			case "follow_request":
				return "msg-npc";
			default:
				return "";
		}
	};

	const { text, actions } =
		msg.message_type === "gm_narration"
			? parseGmContent(msg.content)
			: { text: msg.content, actions: [] };

	return (
		<div className={`chat-message ${getMessageClass()} fade-in`}>
			{msg.message_type !== "system_alert" && (
				<div className="msg-header">
					<span className="msg-actor">
						{actorName}
						{actor?.kind === "agent" && <span className="agent-badge">AI</span>}
					</span>
					<span className="msg-time text-xs text-dim">
						{new Date(msg.created_at).toLocaleTimeString([], {
							hour: "2-digit",
							minute: "2-digit",
						})}
					</span>
				</div>
			)}
			<div className="msg-content">{text}</div>
			{showActions && actions.length > 0 && (
				<div className="gm-action-chips">
					{actions.map((a, i) => (
						<button
							key={i}
							className="gm-action-chip"
							onClick={() => onAction?.(a)}
							title="Click to fill the input with this action"
						>
							{a}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

function ThinkingBubble({
	name,
	isAgent,
}: {
	name: string;
	isAgent?: boolean;
}) {
	return (
		<div
			className={`chat-message ${isAgent ? "msg-npc" : "msg-narration"} gm-thinking-bubble fade-in`}
		>
			<div className="msg-header">
				<span className="msg-actor">
					{name}
					{isAgent && <span className="agent-badge">AI</span>}
				</span>
			</div>
			<div className="msg-content gm-thinking-dots">
				<span />
				<span />
				<span />
			</div>
		</div>
	);
}

export function ChatPanel() {
	const { state, actions } = useGame();
	const [input, setInput] = useState("");
	const scrollRef = useRef<HTMLDivElement>(null);
	const mode = state.session?.current_mode || "conversation";

	const isMyTurn =
		mode !== "tactical" ||
		state.session?.turn_state?.turn_order[
			state.session.turn_state.current_actor_index
		] === state.myCharacterId;
	const canChat =
		state.role !== "spectator" && (mode !== "tactical" || isMyTurn);

	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [state.messages, state.gmThinking, state.agentThinkingId]);

	const handleSend = () => {
		if (!input.trim() || !canChat) return;
		actions.sendChat(input.trim());
		setInput("");
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	};

	const handleFollowResponse = useCallback(
		(requestId: string, accepted: boolean) => {
			if (!state.ws) return;
			state.ws.send(
				JSON.stringify({
					type: "follow_response",
					payload: { request_id: requestId, accepted },
					timestamp: new Date().toISOString(),
				}),
			);
		},
		[state.ws],
	);

	// Index of the last gm_narration message (to show action chips only there)
	const lastGmIdx = state.messages.reduce(
		(last, msg, i) => (msg.message_type === "gm_narration" ? i : last),
		-1,
	);

	return (
		<div className="chat-panel panel" style={{ position: "relative" }}>
			<div className="chat-messages" ref={scrollRef}>
				{state.messages.map((msg, i) =>
					msg.message_type === "follow_request" ? (
						<FollowRequestBubble
							key={msg.id}
							msg={msg}
							onRespond={handleFollowResponse}
						/>
					) : (
						<MessageBubble
							key={msg.id}
							msg={msg}
							party={state.party}
							showActions={canChat && i === lastGmIdx}
							onAction={(a) => setInput(a)}
						/>
					),
				)}
				{state.messages.length === 0 &&
					!state.gmThinking &&
					!state.agentThinkingId && (
						<div className="chat-empty text-dim text-sm">
							The adventure begins...
						</div>
					)}
				{state.gmThinking && <ThinkingBubble name="GM" />}
				{state.agentThinkingId &&
					(() => {
						const agent = state.party.find(
							(c) => c.id === state.agentThinkingId,
						);
						return agent ? <ThinkingBubble name={agent.name} isAgent /> : null;
					})()}
			</div>
			<div className="chat-input-area">
				{!canChat && mode === "tactical" && (
					<div className="chat-locked text-xs text-dim">
						Waiting for{" "}
						{state.party.find(
							(c) =>
								c.id ===
								state.session?.turn_state?.turn_order[
									state.session?.turn_state?.current_actor_index ?? 0
								],
						)?.name || "current actor"}
						...
					</div>
				)}
				{canChat && (
					<div className="chat-input-row">
						<textarea
							className="chat-input"
							value={input}
							onChange={(e) => setInput(e.target.value)}
							onKeyDown={handleKeyDown}
							placeholder={
								mode === "tactical"
									? "Your turn — speak or act..."
									: "Say something..."
							}
							rows={1}
						/>
						<button className="btn btn-primary chat-send" onClick={handleSend}>
							Send
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
