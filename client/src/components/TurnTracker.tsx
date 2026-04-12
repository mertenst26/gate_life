import { useGame } from '../context/GameContext';

export function TurnTracker() {
  const { state } = useGame();
  const ts = state.session?.turn_state;
  if (!ts) return null;

  const currentActorId = ts.turn_order[ts.current_actor_index];
  const isMyTurn = currentActorId === state.myCharacterId;

  return (
    <div className={`turn-tracker ${isMyTurn ? 'my-turn' : ''}`}>
      <div className="turn-info">
        <span className="round-badge">Round {ts.round}</span>
        <span className="text-xs text-dim">Tick {ts.tick}</span>
      </div>
      <div className="turn-order">
        {ts.turn_order.map((actorId, i) => {
          const combatant = state.party.find(c => c.id === actorId);
          const isCurrent = i === ts.current_actor_index;
          const actionsLeft = ts.action_budget[actorId] ?? 0;
          return (
            <div
              key={actorId}
              className={`turn-slot ${isCurrent ? 'active' : ''} ${actionsLeft <= 0 ? 'exhausted' : ''}`}
            >
              <span className="turn-name">{combatant?.name || 'Enemy'}</span>
              {isCurrent && <span className="turn-arrow">▸</span>}
              <span className="actions-left">{actionsLeft} APM</span>
            </div>
          );
        })}
      </div>
      {isMyTurn && (
        <div className="your-turn-indicator">YOUR TURN</div>
      )}
    </div>
  );
}
