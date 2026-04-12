import { gameState } from './GameStateService.js';
import type { WorldClock, GameMode } from '@gate-life/shared';

export class WorldClockService {
  advanceTime(campaignId: string, mode: GameMode, amount?: number): WorldClock {
    const campaign = gameState.getCampaign(campaignId);
    if (!campaign) throw new Error('Campaign not found');

    const clock = { ...campaign.world_clock };

    switch (mode) {
      case 'tactical':
        // 15 seconds per melee round -- handled by TurnEngine at round end
        this.addMinutes(clock, 0.25);
        break;
      case 'conversation':
        this.addMinutes(clock, amount ?? 5);
        break;
      case 'travel':
        this.addMinutes(clock, amount ?? 60);
        break;
      case 'rest':
        this.addMinutes(clock, amount ?? 60);
        break;
      default:
        break;
    }

    gameState.updateWorldClock(campaignId, clock);
    return clock;
  }

  private addMinutes(clock: WorldClock, minutes: number): void {
    clock.minute += minutes;
    while (clock.minute >= 60) {
      clock.minute -= 60;
      clock.hour += 1;
    }
    while (clock.hour >= 24) {
      clock.hour -= 24;
      clock.day += 1;
    }
  }

  getTimeOfDay(clock: WorldClock): 'dawn' | 'day' | 'dusk' | 'night' {
    if (clock.hour >= 5 && clock.hour < 7) return 'dawn';
    if (clock.hour >= 7 && clock.hour < 18) return 'day';
    if (clock.hour >= 18 && clock.hour < 20) return 'dusk';
    return 'night';
  }

  isDaytime(clock: WorldClock): boolean {
    return clock.hour >= 6 && clock.hour < 20;
  }

  formatClock(clock: WorldClock): string {
    const h = String(Math.floor(clock.hour)).padStart(2, '0');
    const m = String(Math.floor(clock.minute)).padStart(2, '0');
    return `Day ${clock.day}, ${h}:${m}`;
  }
}

export const worldClock = new WorldClockService();
