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
