import { BrowserRouter, Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { GameProvider } from './context/GameContext';
import { Lobby } from './components/Lobby';
import { GameLayout } from './components/GameLayout';
import { ScenarioBuilder } from './components/ScenarioBuilder';

function LobbyRoute() {
  const navigate = useNavigate();
  return (
    <Lobby
      onStartGame={() => navigate('/game')}
      onBuildScenario={() => navigate('/builder')}
      onEditScenario={(id) => navigate(`/builder/${id}`)}
    />
  );
}

function GameRoute() {
  return <GameLayout />;
}

function BuilderRoute() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const navigate = useNavigate();
  return (
    <ScenarioBuilder
      editScenarioId={scenarioId}
      onBack={() => navigate('/')}
    />
  );
}

export function App() {
  return (
    <BrowserRouter>
      <GameProvider>
        <div className="app">
          <Routes>
            <Route path="/" element={<LobbyRoute />} />
            <Route path="/game" element={<GameRoute />} />
            <Route path="/game/:campaignId" element={<GameRoute />} />
            <Route path="/builder" element={<BuilderRoute />} />
            <Route path="/builder/:scenarioId" element={<BuilderRoute />} />
          </Routes>
        </div>
      </GameProvider>
    </BrowserRouter>
  );
}
