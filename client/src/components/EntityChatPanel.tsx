import { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '../hooks/useApi';
import { useResizablePanelWidth } from '../hooks/useResizablePanelWidth';
import type { ScenarioEntityType, ScenarioEntity, SuggestionGroup } from '@gate-life/shared';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  scenarioId: string;
  entityType: ScenarioEntityType;
  lat: number;
  lng: number;
  /** When provided the panel opens in edit mode for this existing entity. */
  existingEntity?: ScenarioEntity;
  onConfirm: (name: string, definition: Record<string, unknown>, count: number) => void;
  onCancel: () => void;
}

/** One color per suggestion group — cycles if there are more groups than colors. */
const CHAT_PANEL_WIDTH_KEY = 'gate-life.panel.entityChat';

const GROUP_COLORS = [
  { border: '#d4a057', bg: 'rgba(212,160,87,0.10)', text: '#d4a057' },  // amber
  { border: '#4fc3f7', bg: 'rgba(79,195,247,0.10)', text: '#4fc3f7' },  // cyan
  { border: '#ce93d8', bg: 'rgba(206,147,216,0.10)', text: '#ce93d8' }, // violet
  { border: '#a5d6a7', bg: 'rgba(165,214,167,0.10)', text: '#a5d6a7' }, // green
  { border: '#ef9a9a', bg: 'rgba(239,154,154,0.10)', text: '#ef9a9a' }, // rose
];

/** POIs are a single location — no multi-icon placement. */
const ENTITY_LABEL: Record<ScenarioEntityType, string> = {
  enemy: 'Enemy',
  npc: 'NPC',
  friendly: 'Friendly unit',
  vehicle: 'Vehicle',
  poi: 'Point of interest',
};

export function EntityChatPanel({ scenarioId, entityType, lat, lng, existingEntity, onConfirm, onCancel }: Props) {
  const { width: panelWidth, resizeHandleProps } = useResizablePanelWidth(CHAT_PANEL_WIDTH_KEY, 380);
  const isEditMode = !!existingEntity;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionGroup[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [pendingDef, setPendingDef] = useState<{ name: string; definition: Record<string, unknown> } | null>(null);
  const [count, setCount] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasFiredOpener = useRef(false);
  const sendToAiRef = useRef<(msgs: ChatMessage[]) => Promise<void>>(async () => {});

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages, loading, suggestions]);

  const sendToAi = useCallback(async (chatMessages: ChatMessage[]) => {
    const round = chatMessages.filter(m => m.role === 'user').length;
    console.log(`[EntityChat] Sending round ${round} to AI (${isEditMode ? 'edit' : 'create'} mode, ${entityType})`);
    console.log('[EntityChat] Last user message:', chatMessages[chatMessages.length - 1]?.content?.slice(0, 120));
    setLoading(true);
    setSuggestions([]);
    setMessages(chatMessages);
    setPendingDef(null);
    try {
      const result = await api.chatScenarioEntity(scenarioId, {
        entity_type: entityType,
        lat,
        lng,
        messages: chatMessages,
      });

      console.log('[EntityChat] AI reply received:', result.reply?.slice(0, 120));
      if (result.suggestions?.length) {
        console.log('[EntityChat] Suggestions:', result.suggestions.map(g => `${g.question}: [${g.chips.join(', ')}]`).join(' | '));
      }
      if (result.definition) {
        console.log('[EntityChat] Stat block received for:', result.name, result.definition);
      }

      setMessages(prev => [...prev, { role: 'assistant', content: result.reply }]);
      setSuggestions(result.suggestions ?? []);

      if (result.definition && result.name) {
        setPendingDef({ name: result.name, definition: result.definition });
      }
    } catch (e) {
      console.error('[EntityChat] API call failed:', e);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Connection error — please check the server and try again.',
      }]);
    } finally {
      setLoading(false);
    }
  }, [scenarioId, entityType, lat, lng, isEditMode]);

  sendToAiRef.current = sendToAi;

  useEffect(() => {
    if (hasFiredOpener.current) return;
    hasFiredOpener.current = true;
    if (isEditMode && existingEntity) {
      console.log(`[EntityChat] Opening in EDIT mode for "${existingEntity.name}" (${existingEntity.id})`);
    } else {
      console.log(`[EntityChat] Opening in CREATE mode for ${entityType} at (${lat.toFixed(5)}, ${lng.toFixed(5)})`);
    }
    const opener: ChatMessage = isEditMode && existingEntity
      ? {
          role: 'user',
          content: `I want to modify an existing ${entityType} named "${existingEntity.name}". Here are its current stats:\n\`\`\`json\n${JSON.stringify(existingEntity.definition, null, 2)}\n\`\`\`\nWhat would you like to change or add?`,
        }
      : {
          role: 'user',
          content: `I want to place a new ${entityType} here. What kind of ${entityType} should I define?`,
        };
    sendToAiRef.current([opener]);
    inputRef.current?.focus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSend = useCallback((text?: string) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    console.log('[EntityChat] User sending:', content.slice(0, 100));
    const userMsg: ChatMessage = { role: 'user', content };
    const updated = [...messages, userMsg];
    setInput('');
    setSuggestions([]);
    sendToAiRef.current(updated);
  }, [input, loading, messages]);

  const allowPlacementCount = entityType !== 'poi';
  const placeCount = allowPlacementCount ? count : 1;

  const handleConfirm = useCallback(() => {
    if (pendingDef) {
      console.log(`[EntityChat] Confirming "${pendingDef.name}" × ${placeCount}`, pendingDef.definition);
      onConfirm(pendingDef.name, pendingDef.definition, placeCount);
    }
  }, [pendingDef, onConfirm, placeCount]);

  const label = ENTITY_LABEL[entityType];
  const panelTitle = isEditMode
    ? `Edit ${existingEntity?.name ?? label}`
    : `Define ${label}`;
  const visibleMessages = messages.slice(1);

  return (
    <div className="entity-chat-panel panel fade-in" style={{ width: panelWidth }}>
      <div
        className="entity-panel-resize-handle entity-panel-resize-handle--chat"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize side panel"
        tabIndex={0}
        {...resizeHandleProps}
      />
      <div className="entity-chat-header">
        <div>
          <h3>{panelTitle}</h3>
          <span className="text-xs text-dim">({lat.toFixed(4)}, {lng.toFixed(4)})</span>
        </div>
        <button className="btn btn-sm" onClick={onCancel} title="Discard and close">✕</button>
      </div>

      <div className="entity-chat-messages" ref={scrollRef}>
        {loading && visibleMessages.length === 0 && (
          <div className="entity-chat-msg msg-ai">
            <div className="entity-msg-label text-xs text-dim">AI Designer</div>
            <div className="entity-msg-content gm-thinking-dots">
              <span /><span /><span />
            </div>
          </div>
        )}

        {visibleMessages.map((m, i) => (
          <div key={i} className={`entity-chat-msg ${m.role === 'user' ? 'msg-user' : 'msg-ai'}`}>
            <div className="entity-msg-label text-xs text-dim">
              {m.role === 'user' ? 'You' : 'AI Designer'}
            </div>
            <div className="entity-msg-content">{m.content}</div>
          </div>
        ))}

        {loading && visibleMessages.length > 0 && (
          <div className="entity-chat-msg msg-ai">
            <div className="entity-msg-label text-xs text-dim">AI Designer</div>
            <div className="entity-msg-content gm-thinking-dots">
              <span /><span /><span />
            </div>
          </div>
        )}

        {/* Inline suggestion groups — one row per question the AI asked */}
        {!loading && suggestions.length > 0 && (
          <div className="suggestion-groups">
            {suggestions.map((group, gi) => {
              const color = GROUP_COLORS[gi % GROUP_COLORS.length];
              return (
                <div key={gi} className="suggestion-group">
                  <span
                    className="suggestion-group-label"
                    style={{ color: color.text }}
                  >
                    {group.question}
                  </span>
                  <div className="suggestion-chips">
                    {group.chips.map((chip, ci) => (
                      <button
                        key={ci}
                        className="suggestion-chip"
                        style={{
                          borderColor: color.border,
                          background: color.bg,
                          color: color.text,
                        }}
                        onClick={() => {
                          setInput(prev => prev.trim() ? `${prev.trim()}, ${chip}` : chip);
                          inputRef.current?.focus();
                        }}
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {pendingDef && (
        <div className="entity-confirm-bar">
          <span className="text-sm entity-confirm-name">
            <strong>{pendingDef.name}</strong>
          </span>
          {!isEditMode && allowPlacementCount && (
            <div className="entity-count-stepper">
              <button
                className="btn btn-sm entity-count-btn"
                onClick={() => setCount(c => Math.max(1, c - 1))}
                disabled={count <= 1}
              >−</button>
              <span className="entity-count-display">{count}</span>
              <button
                className="btn btn-sm entity-count-btn"
                onClick={() => setCount(c => Math.min(20, c + 1))}
                disabled={count >= 20}
              >+</button>
            </div>
          )}
          <button className="btn btn-primary btn-sm" onClick={handleConfirm}>
            {isEditMode
              ? 'Save Changes'
              : allowPlacementCount && count > 1
                ? `Place ${count}×`
                : 'Place'}
          </button>
        </div>
      )}

      <div className="entity-chat-input">
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder={loading ? 'AI is thinking...' : `Describe the ${entityType === 'poi' ? 'point of interest' : label.toLowerCase()}...`}
          disabled={loading}
        />
        <button className="btn btn-sm" onClick={() => handleSend()} disabled={loading || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
