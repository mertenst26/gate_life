import { useState } from 'react';
import { GameProvider } from './context/GameContext';
import { Lobby } from './components/Lobby';
import { GameLayout } from './components/GameLayout';

export function App() {
  const [view, setView] = useState<'lobby' | 'game'>('lobby');

  return (
    <GameProvider>
      <div className="app">
        {view === 'lobby' ? (
          <Lobby onStartGame={() => setView('game')} />
        ) : (
          <GameLayout />
        )}
      </div>
    </GameProvider>
  );
}
