import { useGame } from '../context/GameContext';

const MODE_ACTIONS: Record<string, Array<{ id: string; label: string; icon: string }>> = {
  conversation: [
    { id: 'speak', label: 'Speak', icon: '\u{1F4AC}' },
    { id: 'skill_check', label: 'Skill Check', icon: '\u{1F3B2}' },
    { id: 'inspect', label: 'Inspect', icon: '\u{1F50D}' },
    { id: 'rest', label: 'Rest', icon: '\u{1F319}' },
  ],
  tactical: [
    { id: 'strike', label: 'Strike', icon: '\u2694' },
    { id: 'move', label: 'Move', icon: '\u{1F3C3}' },
    { id: 'power', label: 'Power', icon: '\u{1F9E0}' },
    { id: 'use_item', label: 'Item', icon: '\u{1F392}' },
    { id: 'guard_ally', label: 'Guard', icon: '\u{1F6E1}' },
    { id: 'pack_howl', label: 'Howl', icon: '\u{1F43A}' },
    { id: 'end_turn', label: 'End Turn', icon: '\u23ED' },
  ],
  travel: [
    { id: 'navigate', label: 'Navigate', icon: '\u{1F9ED}' },
    { id: 'forage', label: 'Forage', icon: '\u{1F33F}' },
    { id: 'scout', label: 'Scout', icon: '\u{1F441}' },
    { id: 'camp', label: 'Camp', icon: '\u26FA' },
  ],
  rest: [
    { id: 'sleep', label: 'Sleep', icon: '\u{1F634}' },
    { id: 'meditate', label: 'Meditate', icon: '\u{1F9D8}' },
    { id: 'repair', label: 'Repair', icon: '\u{1F527}' },
    { id: 'first_aid', label: 'First Aid', icon: '\u{1FA79}' },
    { id: 'watch', label: 'Keep Watch', icon: '\u{1F441}' },
  ],
  charCreate: [],
};

export function ContextActionBar() {
  const { state, actions } = useGame();
  const mode = state.session?.current_mode || 'conversation';
  const modeActions = MODE_ACTIONS[mode] || [];

  const isMyTurn = mode !== 'tactical' ||
    (state.session?.turn_state?.turn_order[state.session.turn_state.current_actor_index] === state.myCharacterId);

  const handleAction = async (actionId: string) => {
    if (actionId === 'end_turn') {
      await actions.endTurn();
      return;
    }
    if (actionId === 'speak') return;
    if (actionId === 'rest' || actionId === 'camp') {
      await actions.changeMode('rest');
      return;
    }
    await actions.performAction(actionId);
  };

  if (modeActions.length === 0) return null;

  return (
    <div className={`action-bar ${!isMyTurn && mode === 'tactical' ? 'disabled' : ''}`}>
      {modeActions.map(action => (
        <button
          key={action.id}
          className="action-btn"
          onClick={() => handleAction(action.id)}
          disabled={mode === 'tactical' && !isMyTurn}
          title={action.label}
        >
          <span className="action-icon">{action.icon}</span>
          <span className="action-label">{action.label}</span>
        </button>
      ))}
    </div>
  );
}
