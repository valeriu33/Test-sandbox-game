import { VILLAGE } from './config';

/**
 * A village is the settlement-level agent: it owns the shared granary and
 * decides what the settlement is short of. Individual villagers read that
 * need and pick their work from it, rather than each deciding in isolation.
 */
export interface Village {
  id: number;
  name: string;
  /** Granary position — the village centre, recomputed from its huts. */
  x: number;
  y: number;
  hutIds: number[];
  /** Shared stores. Villagers deposit surplus here and eat from it. */
  food: number;
  wood: number;
  /** Refreshed on the village pass, so per-villager decisions stay cheap. */
  memberCount: number;
  /**
   * How many villagers are currently walking to the granary. Without this,
   * every hungry villager commits to a store that is already spoken for,
   * arrives to find it empty, and has wasted the trip — a stampede that
   * starved whole villages while food sat in the fields.
   */
  enRoute: number;
  need: VillageNeed;
  foundedTick: number;
}

export type VillageNeed = 'food' | 'wood' | 'none';

/**
 * What the settlement should put its hands to next. Food first — a village
 * that builds while hungry starves — then wood, for housing its overflow.
 */
export function assessNeed(v: Village, housingShort: boolean): VillageNeed {
  if (v.food < v.memberCount * VILLAGE.TARGET_FOOD_PER_CAPITA) return 'food';
  if (housingShort && v.wood < VILLAGE.TARGET_WOOD) return 'wood';
  if (v.food < v.memberCount * VILLAGE.COMFORTABLE_FOOD_PER_CAPITA) return 'food';
  return 'none';
}

/** Housing capacity is two adults per hut, matching claimHutsPass. */
export function housingShort(v: Village): boolean {
  return v.memberCount > v.hutIds.length * 2;
}
