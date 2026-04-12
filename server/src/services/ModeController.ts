import { gameState } from './GameStateService.js';
import { turnEngine } from './TurnEngine.js';
import { worldClock } from './WorldClockService.js';
import { consequenceEngine } from './ConsequenceEngine.js';
import { broadcastToSession } from '../ws/handler.js';
import type { GameMode, GameEvent } from '@gate-life/shared';

const VALID_TRANSITIONS: Record<GameMode, GameMode[]> = {
  charCreate: ['conversation'],
  conversation: ['tactical', 'travel', 'rest'],
  tactical: ['conversation', 'travel'],
  travel: ['conversation', 'tactical'],
  rest: ['conversation', 'tactical'],
};

export class ModeController {
  transitionMode(sessionId: string, newMode: GameMode, data?: Record<string, unknown>): {
    success: boolean;
    events: GameEvent[];
    error?: string;
  } {
    const session = gameState.getSession(sessionId);
    if (!session) return { success: false, events: [], error: 'Session not found' };

    const currentMode = session.current_mode;
    if (!VALID_TRANSITIONS[currentMode]?.includes(newMode)) {
      return { success: false, events: [], error: `Cannot transition from ${currentMode} to ${newMode}` };
    }

    const events: GameEvent[] = [];
    const campaign = gameState.getCampaign(session.campaign_id);
    if (!campaign) return { success: false, events: [], error: 'Campaign not found' };

    // Exit current mode
    switch (currentMode) {
      case 'tactical':
        turnEngine.endCombat(sessionId);
        break;
      case 'travel':
        // Process final travel leg for all party members
        break;
      case 'rest':
        // Process rest completion
        break;
    }

    // Enter new mode
    switch (newMode) {
      case 'tactical': {
        const turnState = turnEngine.startCombat(sessionId, session.campaign_id);
        events.push(gameState.logEvent({
          campaign_id: session.campaign_id,
          session_id: sessionId,
          event_type: 'mode_change',
          data: { from: currentMode, to: newMode, turn_state: turnState },
          narrative: 'Combat begins!',
          visibility: 'party',
        }));
        break;
      }
      case 'conversation':
        gameState.updateSessionMode(sessionId, 'conversation');
        gameState.updateTurnState(sessionId, null);
        events.push(gameState.logEvent({
          campaign_id: session.campaign_id,
          session_id: sessionId,
          event_type: 'mode_change',
          data: { from: currentMode, to: newMode },
          narrative: currentMode === 'tactical' ? 'The battle is over.' : 'The party gathers to talk.',
          visibility: 'party',
        }));
        break;
      case 'travel':
        gameState.updateSessionMode(sessionId, 'travel');
        events.push(gameState.logEvent({
          campaign_id: session.campaign_id,
          session_id: sessionId,
          event_type: 'mode_change',
          data: { from: currentMode, to: newMode },
          narrative: 'The party sets out on the road.',
          visibility: 'party',
        }));
        break;
      case 'rest':
        gameState.updateSessionMode(sessionId, 'rest');
        events.push(gameState.logEvent({
          campaign_id: session.campaign_id,
          session_id: sessionId,
          event_type: 'mode_change',
          data: { from: currentMode, to: newMode },
          narrative: 'The party makes camp to rest.',
          visibility: 'party',
        }));
        break;
    }

    broadcastToSession(sessionId, {
      type: 'mode_change',
      payload: { mode: newMode, events },
      timestamp: new Date().toISOString(),
    });

    return { success: true, events };
  }

  processTravelLeg(sessionId: string): GameEvent[] {
    const session = gameState.getSession(sessionId);
    if (!session || session.current_mode !== 'travel') return [];

    const events: GameEvent[] = [];
    const party = gameState.getPartyCombatants(session.campaign_id);

    for (const combatant of party) {
      const legEvents = consequenceEngine.processTravelLeg(session.campaign_id, sessionId, combatant);
      events.push(...legEvents);
    }

    worldClock.advanceTime(session.campaign_id, 'travel', 60);

    return events;
  }

  processRestShift(sessionId: string, meditatingIds: string[] = []): GameEvent[] {
    const session = gameState.getSession(sessionId);
    if (!session || session.current_mode !== 'rest') return [];

    const events: GameEvent[] = [];
    const party = gameState.getPartyCombatants(session.campaign_id);

    for (const combatant of party) {
      const meditating = meditatingIds.includes(combatant.id);
      const shiftEvents = consequenceEngine.processRestHour(
        session.campaign_id, sessionId, combatant, meditating,
      );
      events.push(...shiftEvents);
    }

    worldClock.advanceTime(session.campaign_id, 'rest', 120);

    return events;
  }
}

export const modeController = new ModeController();
