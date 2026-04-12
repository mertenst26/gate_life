import { useGame } from '../context/GameContext';
import { useRef, useCallback, useState } from 'react';
import { TurnTracker } from './TurnTracker';
import { ChatPanel } from './ChatPanel';
import { PartyHUD } from './PartyHUD';
import { MapPanel } from './MapPanel';
import { ContextActionBar } from './ContextActionBar';
import { TacticalBoard } from './TacticalBoard';
import { MODE_COLORS } from '@gate-life/shared';

const MIN_SIDEBAR = 220;
const MAX_SIDEBAR = 600;
const DEFAULT_SIDEBAR = 300;

const MIN_TACTICAL_H = 160;
const MAX_TACTICAL_H = 720;
const DEFAULT_TACTICAL_H = 360;

export function GameLayout() {
  const { state, actions } = useGame();
  const mode = state.session?.current_mode || 'conversation';
  const modeColor = MODE_COLORS[mode] || MODE_COLORS.conversation;

  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR);
  const [tacticalHeight, setTacticalHeight] = useState(DEFAULT_TACTICAL_H);

  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(DEFAULT_SIDEBAR);

  // vertical drag state for tactical/chat split
  const vDragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(DEFAULT_TACTICAL_H);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = sidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startX.current - ev.clientX;
      const next = Math.max(MIN_SIDEBAR, Math.min(MAX_SIDEBAR, startW.current + delta));
      setSidebarWidth(next);
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [sidebarWidth]);

  const onVMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    vDragging.current = true;
    startY.current = e.clientY;
    startH.current = tacticalHeight;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!vDragging.current) return;
      const delta = ev.clientY - startY.current;
      const next = Math.max(MIN_TACTICAL_H, Math.min(MAX_TACTICAL_H, startH.current + delta));
      setTacticalHeight(next);
    };
    const onUp = () => {
      vDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [tacticalHeight]);

  return (
    <div className="game-layout" style={{ '--mode-color': modeColor } as React.CSSProperties}>
      <header className="game-header">
        <div className="header-left">
          <h1 className="app-title">GATE<span className="accent">LIFE</span></h1>
          {state.campaign && (
            <span className="campaign-name">{state.campaign.name}</span>
          )}
        </div>
        <div className="header-center">
          {state.session && (
            <span className="mode-badge" style={{ borderColor: modeColor, color: modeColor }}>
              {mode.toUpperCase()}
            </span>
          )}
          {state.campaign?.world_clock && (
            <span className="world-clock mono">
              Day {state.campaign.world_clock.day} &middot; {String(Math.floor(state.campaign.world_clock.hour)).padStart(2, '0')}:{String(Math.floor(state.campaign.world_clock.minute)).padStart(2, '0')}
            </span>
          )}
        </div>
        <div className="header-right">
          {state.session && state.role !== 'spectator' && (
            mode === 'tactical'
              ? (
                <button
                  className="btn mode-btn mode-btn-exit"
                  onClick={() => actions.changeMode('conversation')}
                  title="Exit tactical combat"
                >
                  ✕ EXIT TACTICAL MODE
                </button>
              )
              : (
                <button
                  className="btn mode-btn mode-btn-tactical"
                  onClick={() => actions.changeMode('tactical')}
                  title="Enter turn-based tactical mode"
                >
                  ⚔ TACTICAL MODE
                </button>
              )
          )}
          <span className={`connection-dot ${state.connected ? 'online' : 'offline'}`} />
          <span className="text-xs text-dim">{state.connected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </header>

      {mode === 'tactical' && state.session?.turn_state && (
        <TurnTracker />
      )}

      <div className="game-content">
        <div className={`main-panel ${mode === 'tactical' ? 'with-tactical' : ''}`}>
          {mode === 'tactical' && (
            <>
              <TacticalBoard height={tacticalHeight} />
              <div
                className="tactical-chat-resize-handle"
                onMouseDown={onVMouseDown}
                title="Drag to resize"
              />
            </>
          )}
          <ChatPanel />
        </div>

        <div className="sidebar-resize-handle" onMouseDown={onMouseDown} title="Drag to resize" />

        <div className="side-panel" style={{ width: sidebarWidth }}>
          <PartyHUD />
          <MapPanel />
        </div>
      </div>

      {/* ContextActionBar hidden — actions handled via chat and tactical grid */}
    </div>
  );
}
