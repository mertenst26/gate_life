import { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '../hooks/useApi';
import { useResizablePanelWidth } from '../hooks/useResizablePanelWidth';
import type { DungeonDefinition, SuggestionGroup } from '@gate-life/shared';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  scenarioId: string;
  /** Polygon vertices drawn on the map — will be embedded in the definition. */
  polygonVertices: [number, number][];
  /** Centroid of the polygon (used as the entity lat/lng for the marker). */
  lat: number;
  lng: number;
  onConfirmDungeon: (definition: DungeonDefinition) => void;
  onCancel: () => void;
}

const CHAT_PANEL_WIDTH_KEY = 'gate-life.panel.dungeonDesigner';

const GROUP_COLORS = [
  { border: '#ff6d00', bg: 'rgba(255,109,0,0.10)', text: '#ff6d00' },
  { border: '#4fc3f7', bg: 'rgba(79,195,247,0.10)', text: '#4fc3f7' },
  { border: '#ce93d8', bg: 'rgba(206,147,216,0.10)', text: '#ce93d8' },
  { border: '#a5d6a7', bg: 'rgba(165,214,167,0.10)', text: '#a5d6a7' },
  { border: '#ef9a9a', bg: 'rgba(239,154,154,0.10)', text: '#ef9a9a' },
];

const TILE_CHAR: Record<number, string> = {
  0: '█', 1: '·', 2: ' ', 3: '+', 4: '▼', 5: '★',
};

function renderAsciiPreview(def: DungeonDefinition, maxW = 40, maxH = 16): string {
  const scaleX = Math.max(1, Math.ceil(def.width / maxW));
  const scaleY = Math.max(1, Math.ceil(def.height / maxH));
  const lines: string[] = [];
  for (let r = 0; r < def.height; r += scaleY) {
    let line = '';
    for (let c = 0; c < def.width; c += scaleX) {
      const tile = def.tiles[r]?.[c] ?? 0;
      line += TILE_CHAR[tile] ?? '█';
    }
    lines.push(line);
  }
  return lines.join('\n');
}

/** Compute centroid of a polygon given as [[lat, lng], ...] */
function polygonCentroid(verts: [number, number][]): [number, number] {
  if (verts.length === 0) return [0, 0];
  const sumLat = verts.reduce((s, v) => s + v[0], 0);
  const sumLng = verts.reduce((s, v) => s + v[1], 0);
  return [sumLat / verts.length, sumLng / verts.length];
}

/** Rough bounding box area in metres² and dimensions. */
function polygonInfo(verts: [number, number][]): { widthM: number; heightM: number } {
  if (verts.length < 2) return { widthM: 0, heightM: 0 };
  const lats = verts.map(v => v[0]);
  const lngs = verts.map(v => v[1]);
  const latDeg = Math.max(...lats) - Math.min(...lats);
  const lngDeg = Math.max(...lngs) - Math.min(...lngs);
  const midLat = (Math.max(...lats) + Math.min(...lats)) / 2;
  const heightM = latDeg * 111320;
  const widthM = lngDeg * 111320 * Math.cos((midLat * Math.PI) / 180);
  return { widthM: Math.round(widthM), heightM: Math.round(heightM) };
}

export function DungeonDesignerPanel({
  scenarioId,
  polygonVertices,
  lat,
  lng,
  onConfirmDungeon,
  onCancel,
}: Props) {
  const { width: panelWidth, resizeHandleProps } = useResizablePanelWidth(CHAT_PANEL_WIDTH_KEY, 420);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionGroup[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [pendingDef, setPendingDef] = useState<DungeonDefinition | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasFiredOpener = useRef(false);
  const sendToAiRef = useRef<(msgs: ChatMessage[]) => Promise<void>>(async () => {});

  const { widthM, heightM } = polygonInfo(polygonVertices);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages, loading, suggestions]);

  const sendToAi = useCallback(async (chatMessages: ChatMessage[]) => {
    setLoading(true);
    setSuggestions([]);
    setMessages(chatMessages);
    setPendingDef(null);
    try {
      const result = await api.chatScenarioEntity(scenarioId, {
        entity_type: 'dungeon',
        lat,
        lng,
        messages: chatMessages,
      });

      setMessages(prev => [...prev, { role: 'assistant', content: result.reply }]);
      setSuggestions(result.suggestions ?? []);

      // Dungeon returns a single definition object
      if (result.definition && result.name) {
        const def = result.definition as Partial<DungeonDefinition>;
        // Inject the polygon vertices from the map drawing
        const full: DungeonDefinition = {
          name: result.name,
          above_ground: def.above_ground ?? false,
          width: def.width ?? 20,
          height: def.height ?? 15,
          cell_size_ft: def.cell_size_ft ?? 10,
          tiles: def.tiles ?? [],
          rooms: def.rooms ?? [],
          doors: def.doors ?? [],
          entry_row: def.entry_row ?? 0,
          entry_col: def.entry_col ?? 0,
          polygon_latlngs: polygonVertices,
          notes: def.notes,
        };
        setPendingDef(full);
      }
    } catch (e) {
      console.error('[DungeonDesigner] API call failed:', e);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Connection error — please check the server and try again.',
      }]);
    } finally {
      setLoading(false);
    }
  }, [scenarioId, lat, lng, polygonVertices]);

  sendToAiRef.current = sendToAi;

  useEffect(() => {
    if (hasFiredOpener.current) return;
    hasFiredOpener.current = true;
    const [cLat, cLng] = polygonCentroid(polygonVertices);
    const opener: ChatMessage = {
      role: 'user',
      content: `I want to design a dungeon at (${cLat.toFixed(4)}, ${cLng.toFixed(4)}). The polygon I drew covers roughly ${widthM}m × ${heightM}m on the map. What kind of dungeon should I build here?`,
    };
    sendToAiRef.current([opener]);
    inputRef.current?.focus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSend = useCallback((text?: string) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    const userMsg: ChatMessage = { role: 'user', content };
    const updated = [...messages, userMsg];
    setInput('');
    setSuggestions([]);
    sendToAiRef.current(updated);
  }, [input, loading, messages]);

  const visibleMessages = messages.slice(1);
  const asciiPreview = pendingDef && pendingDef.tiles.length > 0 ? renderAsciiPreview(pendingDef) : null;

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
          <h3>Dungeon Designer</h3>
          <span className="text-xs text-dim">
            {polygonVertices.length}-vertex polygon · ~{widthM}m × {heightM}m
          </span>
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

        {!loading && suggestions.length > 0 && (
          <div className="suggestion-groups">
            {suggestions.map((group, gi) => {
              const color = GROUP_COLORS[gi % GROUP_COLORS.length];
              return (
                <div key={gi} className="suggestion-group">
                  <span className="suggestion-group-label" style={{ color: color.text }}>
                    {group.question}
                  </span>
                  <div className="suggestion-chips">
                    {group.chips.map((chip, ci) => (
                      <button
                        key={ci}
                        className="suggestion-chip"
                        style={{ borderColor: color.border, background: color.bg, color: color.text }}
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
        <div className="entity-confirm-bar" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong style={{ color: '#ff6d00' }}>{pendingDef.name}</strong>
              <span className="text-xs text-dim" style={{ marginLeft: '0.5rem' }}>
                {pendingDef.above_ground ? 'Above ground' : 'Underground'} ·{' '}
                {pendingDef.width}×{pendingDef.height} grid · {pendingDef.cell_size_ft}ft cells
              </span>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => onConfirmDungeon(pendingDef)}>
              Place Dungeon
            </button>
          </div>

          {/* Room list */}
          {pendingDef.rooms.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
              {pendingDef.rooms.map((room, i) => (
                <span
                  key={i}
                  className="text-xs"
                  title={room.description}
                  style={{
                    background: 'rgba(255,109,0,0.10)',
                    border: '1px solid rgba(255,109,0,0.30)',
                    borderRadius: '4px',
                    padding: '0.1rem 0.4rem',
                    color: '#ff8c3a',
                  }}
                >
                  {room.name}
                </span>
              ))}
            </div>
          )}

          {/* ASCII grid preview */}
          {asciiPreview && (
            <pre
              style={{
                fontFamily: 'monospace',
                fontSize: '9px',
                lineHeight: '11px',
                background: 'rgba(0,0,0,0.4)',
                border: '1px solid rgba(255,109,0,0.2)',
                borderRadius: '4px',
                padding: '0.4rem 0.5rem',
                margin: 0,
                overflowX: 'auto',
                color: '#c8b99a',
                letterSpacing: '0.5px',
              }}
            >
              {asciiPreview}
            </pre>
          )}
        </div>
      )}

      <div className="entity-chat-input">
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder={loading ? 'AI is thinking...' : 'Describe rooms, contents, atmosphere...'}
          disabled={loading}
        />
        <button className="btn btn-sm" onClick={() => handleSend()} disabled={loading || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
