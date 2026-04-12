import { gameState } from './GameStateService.js';
import { broadcastToSession } from '../ws/handler.js';
import { VITAL_SAMPLE_INTERVAL_MS } from '@gate-life/shared';

let samplerInterval: ReturnType<typeof setInterval> | null = null;
let activeSessions = new Set<string>();

export function startVitalSampling(sessionId: string): void {
  activeSessions.add(sessionId);
  if (!samplerInterval) {
    samplerInterval = setInterval(() => sampleAll(), VITAL_SAMPLE_INTERVAL_MS);
    console.log('[vitals] Sampling started');
  }
}

export function stopVitalSampling(sessionId: string): void {
  activeSessions.delete(sessionId);
  if (activeSessions.size === 0 && samplerInterval) {
    clearInterval(samplerInterval);
    samplerInterval = null;
    console.log('[vitals] Sampling stopped');
  }
}

function sampleAll(): void {
  for (const sessionId of activeSessions) {
    const session = gameState.getSession(sessionId);
    if (!session) continue;

    const party = gameState.getPartyCombatants(session.campaign_id);
    for (const combatant of party) {
      if (combatant.status === 'dead') continue;

      // Record the current pulse and temp as a sample
      gameState.recordVitalSample(
        combatant.id,
        combatant.pulse_bpm,
        combatant.internal_temp,
      );

      broadcastToSession(sessionId, {
        type: 'vital_sample',
        payload: {
          combatant_id: combatant.id,
          pulse_bpm: combatant.pulse_bpm,
          internal_temp: combatant.internal_temp,
          sampled_at: new Date().toISOString(),
        },
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Periodic pruning (every 60 samples = 1 minute)
  if (Math.random() < 1 / 60) {
    gameState.pruneVitalSamples(30);
  }
}
