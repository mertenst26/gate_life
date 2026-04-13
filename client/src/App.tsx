import { useState } from 'react';
import { GameProvider } from './context/GameContext';
import { Lobby } from './components/Lobby';
import { GameLayout } from './components/GameLayout';
import { ScenarioBuilder } from './components/ScenarioBuilder';

export function App() {
  const [view, setView] = useState<'lobby' | 'game' | 'scenario_builder'>('lobby');
  const [editScenarioId, setEditScenarioId] = useState<string | undefined>(undefined);

  const openBuilder = (scenarioId?: string) => {
    setEditScenarioId(scenarioId);
    setView('scenario_builder');
  };

  return (
    <GameProvider>
      <div className="app">
        {view === 'lobby' && (
          <Lobby
            onStartGame={() => setView('game')}
            onBuildScenario={() => openBuilder()}
            onEditScenario={(id) => openBuilder(id)}
          />
        )}
        {view === 'game' && <GameLayout />}
        {view === 'scenario_builder' && (
          <ScenarioBuilder
            editScenarioId={editScenarioId}
            onBack={() => setView('lobby')}
          />
        )}
      </div>
    </GameProvider>
  );
}
