import { useGame } from '../context/GameContext';
import { useRef, useEffect, useState } from 'react';
import type { ChatMessage, Combatant } from '@gate-life/shared';

function MessageBubble({ msg, party }: { msg: ChatMessage; party: Combatant[] }) {
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
      <div className="msg-content">{msg.content}</div>
    </div>
  );
}

function GmThinkingBubble() {
  return (
    <div className="chat-message msg-narration gm-thinking-bubble fade-in">
      <div className="msg-header">
        <span className="msg-actor">GM</span>
      </div>
      <div className="msg-content gm-thinking-dots">
        <span /><span /><span />
      </div>
    </div>
  );
}

export function ChatPanel() {
  const { state, actions } = useGame();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const mode = state.session?.current_mode || 'conversation';

  const isMyTurn = mode !== 'tactical' ||
    (state.session?.turn_state?.turn_order[state.session.turn_state.current_actor_index] === state.myCharacterId);
  const canChat = state.role !== 'spectator' && (mode !== 'tactical' || isMyTurn);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [state.messages, state.gmThinking]);

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

  return (
    <div className="chat-panel panel">
      <div className="chat-messages" ref={scrollRef}>
        {state.messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} party={state.party} />
        ))}
        {state.messages.length === 0 && !state.gmThinking && (
          <div className="chat-empty text-dim text-sm">
            The adventure begins...
          </div>
        )}
        {state.gmThinking && <GmThinkingBubble />}
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
