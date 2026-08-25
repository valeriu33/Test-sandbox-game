// Global tuning knobs for the simulation. Times are in ticks unless noted;
// one tick is TICK_MS of game time at 1x speed.

export const TICK_MS = 100;
export const TICKS_PER_YEAR = 50; // one sim "year" ≈ 5s at 1x

export const MAP_W = 144;
export const MAP_H = 144;
export const TILE_PX = 8; // base tile size on the pre-rendered layers

export const HUMAN = {
  SPEED: 0.12, // tiles per tick
  CHILD_SPEED: 0.09,
  HUNGER_RATE: 0.32,
  CHILD_HUNGER_RATE: 0.22,
  EAT_AT: 50, // hunger level at which we consume carried food
  SEEK_FOOD_AT: 45,
  FOOD_VALUE: 40, // hunger restored per unit of food
  ADULT_AGE: 14,
  ELDER_AGE: 60,
  MAX_FERTILE_AGE: 45,
  MATE_COOLDOWN: 2.5 * TICKS_PER_YEAR,
  MATE_MAX_HUNGER: 40,
  HUT_WOOD_COST: 4,
  SEARCH_RADIUS: 24, // tiles, for food/tree/partner searches
  START_POP: 14,
};

export const VILLAGE = {
  /** A new hut this close to a village joins it instead of founding one. */
  JOIN_RADIUS: 20,
  /** Food a villager keeps on hand; anything above this goes to the granary. */
  KEEP_FOOD: 3,
  /** Least surplus worth a trip to the granary; scales up with distance. */
  DEPOSIT_AT: 6,
  /** Hands are full at this much surplus — head home whatever the distance. */
  CARRY_CAP: 18,
  WITHDRAW: 2,
  /** Below this per head the village considers itself hungry. */
  TARGET_FOOD_PER_CAPITA: 3,
  /** Above this it stops stockpiling food and does something else. */
  COMFORTABLE_FOOD_PER_CAPITA: 5,
  TARGET_WOOD: 12,
  /**
   * A village only raises children it can feed. Deliberately set above
   * COMFORTABLE_FOOD_PER_CAPITA: villages stock up to that level and stop, so
   * a lower bar here meant every settlement was always rich enough to breed
   * flat out and the brake never engaged at all. Growth now needs a genuine
   * surplus, and tapers as a village outgrows what its land yields per head.
   */
  BIRTH_FOOD_PER_CAPITA: 9,
  /** Past this, a villager heads for the granary regardless of the queue. */
  DESPERATE_HUNGER: 72,
  /** Below this many people a village is one bad decade from vanishing. */
  FRAGILE_SIZE: 20,
  /** Floor on the birth gradient, so a small village still has children. */
  MIN_BIRTH_CHANCE: 0.03,
  /** Hunters leave a species alone below this, so none is hunted to nothing. */
  HUNT_FLOOR: 60,
  /** How far a villager will walk to use the granary. */
  GRANARY_REACH: 45,
};

export const YIELD = {
  BERRIES: 2,
  FISH: 3,
  RABBIT: 3,
  DEER: 8,
};

export const REGROW = {
  BERRIES: 10 * TICKS_PER_YEAR,
  TREE: 20 * TICKS_PER_YEAR,
  FISH: 6 * TICKS_PER_YEAR,
};

export interface AnimalSpec {
  speed: number;
  hungerRate: number;
  seekFoodAt: number;
  maxAge: number; // years
  adultAge: number; // years
  mateCooldown: number;
  crowdRadius: number; // no breeding when too many of a kind nearby
  crowdLimit: number;
  fleeRadius: number; // herbivores: distance at which they run from danger
}

export const ANIMALS: Record<'rabbit' | 'deer' | 'wolf', AnimalSpec> = {
  rabbit: {
    speed: 0.14,
    hungerRate: 0.25,
    seekFoodAt: 50,
    maxAge: 8,
    adultAge: 1,
    mateCooldown: 1.6 * TICKS_PER_YEAR,
    crowdRadius: 9,
    crowdLimit: 5,
    fleeRadius: 5,
  },
  deer: {
    speed: 0.13,
    hungerRate: 0.2,
    seekFoodAt: 50,
    maxAge: 15,
    adultAge: 2,
    mateCooldown: 1.5 * TICKS_PER_YEAR,
    crowdRadius: 10,
    crowdLimit: 5,
    fleeRadius: 6,
  },
  wolf: {
    // must be clearly faster than fleeing prey (herbivore speed × 1.3) so a
    // chase ends well before the wolf starves, or wolves go extinct
    speed: 0.24,
    // high enough that a wolf without prey actually starves within ~4 years,
    // keeping the pack size coupled to the prey population
    hungerRate: 0.25,
    seekFoodAt: 55,
    maxAge: 14,
    adultAge: 1.5,
    mateCooldown: 2.5 * TICKS_PER_YEAR,
    crowdRadius: 14,
    crowdLimit: 4,
    fleeRadius: 0,
  },
};

export const START_ANIMALS = { rabbit: 46, deer: 22, wolf: 6 };
