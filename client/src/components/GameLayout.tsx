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

export function GameLayout() {
  const { state, actions } = useGame();
  const mode = state.session?.current_mode || 'conversation';
  const modeColor = MODE_COLORS[mode] || MODE_COLORS.conversation;

  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(DEFAULT_SIDEBAR);

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
          {mode === 'tactical' && <TacticalBoard />}
          <ChatPanel />
        </div>

        <div className="sidebar-resize-handle" onMouseDown={onMouseDown} title="Drag to resize" />

        <div className="side-panel" style={{ width: sidebarWidth }}>
          <PartyHUD />
          <MapPanel />
        </div>
      </div>

      {state.role !== 'spectator' && <ContextActionBar />}
    </div>
  );
}
