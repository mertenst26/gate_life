import { gameState } from './GameStateService.js';
import type { TacticalTile, Combatant, Enemy } from '@gate-life/shared';

interface Position { x: number; y: number }

export class TacticalService {
  generateDefaultGrid(sessionId: string, width = 20, height = 15): TacticalTile[] {
    const tiles: TacticalTile[] = [];
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        tiles.push({
          x, y,
          terrain_type: 'open',
          cover: null,
          elevation: 0,
          revealed: false,
        });
      }
    }
    gameState.setTerrain(sessionId, tiles);
    return tiles;
  }

  getMovementCost(tile: TacticalTile): number {
    switch (tile.terrain_type) {
      case 'open': return 1;
      case 'rough': return 2;
      case 'elevated': return 1.5;
      case 'hazardous': return 1;
      case 'impassable': return Infinity;
      default: return 1;
    }
  }

  isPassable(tile: TacticalTile): boolean {
    return tile.terrain_type !== 'impassable';
  }

  getHazardDamage(tile: TacticalTile): number {
    if (tile.terrain_type !== 'hazardous') return 0;
    return (tile.metadata as any)?.damage ?? 5;
  }

  getCoverBonus(tile: TacticalTile): number {
    switch (tile.cover) {
      case 'partial': return 2;
      case 'full': return Infinity; // blocks line of sight
      default: return 0;
    }
  }

  getElevationAttackBonus(attackerElevation: number, defenderElevation: number): number {
    if (attackerElevation > defenderElevation) return 1;
    return 0;
  }

  isAdjacent(a: Position, b: Position): boolean {
    return Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1 && !(a.x === b.x && a.y === b.y);
  }

  getDistance(a: Position, b: Position): number {
    return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
  }

  getManhattanDistance(a: Position, b: Position): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  checkFlanking(
    targetPos: Position,
    attackerPos: Position,
    allAlliedPositions: Position[],
  ): boolean {
    for (const allyPos of allAlliedPositions) {
      if (allyPos.x === attackerPos.x && allyPos.y === attackerPos.y) continue;
      if (!this.isAdjacent(allyPos, targetPos)) continue;

      const dx1 = attackerPos.x - targetPos.x;
      const dy1 = attackerPos.y - targetPos.y;
      const dx2 = allyPos.x - targetPos.x;
      const dy2 = allyPos.y - targetPos.y;

      if ((dx1 === -dx2 && dy1 === -dy2) || 
          (Math.abs(dx1 + dx2) <= 1 && Math.abs(dy1 + dy2) <= 1 && dx1 !== dx2)) {
        return true;
      }
    }
    return false;
  }

  getFlankingBonus(isFlanking: boolean): number {
    return isFlanking ? 2 : 0;
  }

  checkZoneOfControl(
    moverPos: Position,
    targetPos: Position,
    enemyPositions: Array<Position & { id: string }>,
  ): Array<{ enemyId: string; from: Position }> {
    const threats: Array<{ enemyId: string; from: Position }> = [];

    for (const enemy of enemyPositions) {
      if (this.isAdjacent(enemy, moverPos) && !this.isAdjacent(enemy, targetPos)) {
        threats.push({ enemyId: enemy.id, from: { x: enemy.x, y: enemy.y } });
      }
    }

    return threats;
  }

  hasLineOfSight(
    from: Position,
    to: Position,
    terrain: TacticalTile[],
  ): boolean {
    const terrainMap = new Map<string, TacticalTile>();
    for (const t of terrain) {
      terrainMap.set(`${t.x},${t.y}`, t);
    }

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    if (steps === 0) return true;

    for (let i = 1; i < steps; i++) {
      const x = Math.round(from.x + (dx * i) / steps);
      const y = Math.round(from.y + (dy * i) / steps);
      const tile = terrainMap.get(`${x},${y}`);
      if (tile?.cover === 'full' || tile?.terrain_type === 'impassable') {
        return false;
      }
    }
    return true;
  }

  revealAroundPosition(
    sessionId: string,
    pos: Position,
    visionRange: number,
    terrain: TacticalTile[],
  ): void {
    const toReveal: Position[] = [];

    for (const tile of terrain) {
      if (tile.revealed) continue;
      const dist = this.getDistance(pos, { x: tile.x, y: tile.y });
      if (dist <= visionRange && this.hasLineOfSight(pos, { x: tile.x, y: tile.y }, terrain)) {
        toReveal.push({ x: tile.x, y: tile.y });
      }
    }

    if (toReveal.length > 0) {
      gameState.revealTerrain(sessionId, toReveal);
    }
  }

  placePartyOnGrid(campaignId: string, startPositions?: Position[]): void {
    const party = gameState.getPartyCombatants(campaignId);
    const defaults: Position[] = [
      { x: 2, y: 7 }, { x: 3, y: 6 }, { x: 3, y: 8 }, { x: 4, y: 7 },
    ];
    const positions = startPositions || defaults;

    for (let i = 0; i < party.length; i++) {
      const pos = positions[i] || { x: 2 + i, y: 7 };
      gameState.updateCombatantPosition(party[i].id, pos.x, pos.y);
    }
  }

  getMovablePositions(
    pos: Position,
    speed: number,
    terrain: TacticalTile[],
  ): Position[] {
    const terrainMap = new Map<string, TacticalTile>();
    for (const t of terrain) {
      terrainMap.set(`${t.x},${t.y}`, t);
    }

    const reachable: Position[] = [];
    const visited = new Set<string>();
    const queue: Array<{ pos: Position; remaining: number }> = [{ pos, remaining: speed }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const key = `${current.pos.x},${current.pos.y}`;
      if (visited.has(key)) continue;
      visited.add(key);
      reachable.push(current.pos);

      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const nx = current.pos.x + dx;
          const ny = current.pos.y + dy;
          const nKey = `${nx},${ny}`;
          if (visited.has(nKey)) continue;

          const tile = terrainMap.get(nKey);
          if (!tile || !this.isPassable(tile)) continue;

          const cost = this.getMovementCost(tile);
          if (current.remaining >= cost) {
            queue.push({ pos: { x: nx, y: ny }, remaining: current.remaining - cost });
          }
        }
      }
    }

    return reachable.filter(p => !(p.x === pos.x && p.y === pos.y));
  }
}

export const tacticalService = new TacticalService();
