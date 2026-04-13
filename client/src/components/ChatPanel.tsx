import { useGame } from '../context/GameContext';
import { useCallback, useRef, useEffect, useState } from 'react';
import type { ChatMessage, Combatant } from '@gate-life/shared';
import { DiceRollWidget } from './DiceRollWidget';

const ACTIONS_RE = /<!--ACTIONS:(.*?)-->/s;

function parseGmContent(content: string): { text: string; actions: string[] } {
  const match = content.match(ACTIONS_RE);
  if (!match) return { text: content.trim(), actions: [] };
  const text = content.replace(ACTIONS_RE, '').trim();
  try {
    const parsed = JSON.parse(match[1]);
    return { text, actions: Array.isArray(parsed) ? parsed : [] };
  } catch {
    return { text, actions: [] };
  }
}

function MessageBubble({
  msg, party, showActions, onAction,
}: {
  msg: ChatMessage;
  party: Combatant[];
  showActions?: boolean;
  onAction?: (action: string) => void;
}) {
  const actor = party.find(c => c.id === msg.actor_id);
  const actorName = actor?.name || (msg.message_type === 'gm_narration' ? 'GM' : 'System');

  const getMessageClass = () => {
    switch (msg.message_type) {
      case 'gm_narration': return 'msg-narration';
      case 'player_speech': return 'msg-player';
      case 'npc_dialog': return 'msg-npc';
      case 'dice_result': return 'msg-dice';
      case 'system_alert': return 'msg-system';
      case 'gm_private': return 'msg-gm-private';
      default: return '';
    }
  };

  const { text, actions } = msg.message_type === 'gm_narration'
    ? parseGmContent(msg.content)
    : { text: msg.content, actions: [] };

  return (
    <div className={`chat-message ${getMessageClass()} fade-in`}>
      {msg.message_type !== 'system_alert' && (
        <div className="msg-header">
          <span className="msg-actor">
            {actorName}
            {actor?.kind === 'agent' && <span className="agent-badge">AI</span>}
          </span>
          <span className="msg-time text-xs text-dim">
            {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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

function ThinkingBubble({ name, isAgent }: { name: string; isAgent?: boolean }) {
  return (
    <div className={`chat-message ${isAgent ? 'msg-npc' : 'msg-narration'} gm-thinking-bubble fade-in`}>
      <div className="msg-header">
        <span className="msg-actor">
          {name}
          {isAgent && <span className="agent-badge">AI</span>}
        </span>
      </div>
      <div className="msg-content gm-thinking-dots">
        <span /><span /><span />
      </div>
    </div>
  );
}

export function ChatPanel() {
  const { state, actions, dispatch } = useGame();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const mode = state.session?.current_mode || 'conversation';

  const currentRoll = state.diceRollQueue[0] ?? null;
  const dismissRoll = useCallback(() => dispatch({ type: 'DEQUEUE_DICE_ROLL' }), [dispatch]);

  const isMyTurn = mode !== 'tactical' ||
    (state.session?.turn_state?.turn_order[state.session.turn_state.current_actor_index] === state.myCharacterId);
  const canChat = state.role !== 'spectator' && (mode !== 'tactical' || isMyTurn);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [state.messages, state.gmThinking, state.agentThinkingId]);

  const handleSend = () => {
    if (!input.trim() || !canChat) return;
    actions.sendChat(input.trim());
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Index of the last gm_narration message (to show action chips only there)
  const lastGmIdx = state.messages.reduce(
    (last, msg, i) => (msg.message_type === 'gm_narration' ? i : last),
    -1,
  );

  return (
    <div className="chat-panel panel" style={{ position: 'relative' }}>
      {currentRoll && (
        <DiceRollWidget
          key={`${currentRoll.label}-${currentRoll.total}-${Date.now()}`}
          roll={currentRoll}
          onDismiss={dismissRoll}
        />
      )}
      <div className="chat-messages" ref={scrollRef}>
        {state.messages.map((msg, i) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            party={state.party}
            showActions={canChat && i === lastGmIdx}
            onAction={(a) => setInput(a)}
          />
        ))}
        {state.messages.length === 0 && !state.gmThinking && !state.agentThinkingId && (
          <div className="chat-empty text-dim text-sm">
            The adventure begins...
          </div>
        )}
        {state.gmThinking && <ThinkingBubble name="GM" />}
        {state.agentThinkingId && (() => {
          const agent = state.party.find(c => c.id === state.agentThinkingId);
          return agent ? <ThinkingBubble name={agent.name} isAgent /> : null;
        })()}
      </div>
      <div className="chat-input-area">
        {!canChat && mode === 'tactical' && (
          <div className="chat-locked text-xs text-dim">
            Waiting for {state.party.find(c => c.id === state.session?.turn_state?.turn_order[state.session?.turn_state?.current_actor_index ?? 0])?.name || 'current actor'}...
          </div>
        )}
        {canChat && (
          <div className="chat-input-row">
            <textarea
              className="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={mode === 'tactical' ? 'Your turn — speak or act...' : 'Say something...'}
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
