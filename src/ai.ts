import { HUMAN, VILLAGE, YIELD } from './config';
import {
  action,
  guard,
  selector,
  type BehContext,
  type BehNode,
  type BehStatus,
} from './behaviour';
import type { Human, Sim } from './sim';

/**
 * Everything a task needs to act. `activity` is filled in by whichever leaf
 * ends up doing the work, and is what the inspector card displays.
 */
export interface HumanCtx extends BehContext {
  sim: Sim;
  h: Human;
  speed: number;
  deadAnimals: Set<number>;
}

const isAdult = (h: Human) => h.age >= HUMAN.ADULT_AGE;

/**
 * Step toward a point. 'running' while still walking, 'success' on arrival,
 * 'fail' when hopelessly walled in — which lets the parent selector give up
 * on this plan and try the next one.
 */
function travel(ctx: HumanCtx, tx: number, ty: number, speedMul = 1): BehStatus {
  const { sim, h } = ctx;
  if (sim.moveToward(h, tx, ty, ctx.speed * speedMul)) {
    h.stuck = 0;
    return 'success';
  }
  if (h.stuck > 30) {
    h.stuck = 0;
    return 'fail';
  }
  return 'running';
}

/** Claim a work tile matching `match`, keeping the one already claimed if it is still good. */
function claimTile(
  ctx: HumanCtx,
  match: (i: number) => boolean,
  radius = HUMAN.SEARCH_RADIUS,
): boolean {
  const { sim, h } = ctx;
  if (h.workTile >= 0 && match(h.workTile)) return true;
  const i = sim.findTile(h.x, h.y, radius, match);
  if (i < 0) {
    h.workTile = -1;
    return false;
  }
  h.workTile = i;
  const c = sim.tileCenter(i);
  h.tx = c.x;
  h.ty = c.y;
  h.stuck = 0;
  return true;
}

// ---------- survival ----------

const fleeFromWolf = action<HumanCtx>('running from a wolf 😱', (ctx) => {
  const { sim, h } = ctx;
  const wolf = sim.nearestAnimal(h.x, h.y, 12, (a) => a.huntHumanId === h.id);
  if (!wolf) return 'fail';
  const ang = Math.atan2(h.y - wolf.y, h.x - wolf.x);
  sim.moveToward(h, h.x + Math.cos(ang) * 5, h.y + Math.sin(ang) * 5, ctx.speed * 1.15);
  h.workTile = -1;
  return 'running';
});

const eatCarried = action<HumanCtx>('eating 🍖', (ctx) => {
  const h = ctx.h;
  h.food--;
  h.hunger = Math.max(0, h.hunger - HUMAN.FOOD_VALUE);
  return 'success';
});

// ---------- food production ----------

const gatherBerries = action<HumanCtx>('picking berries 🫐', (ctx) => {
  const { sim, h } = ctx;
  if (!claimTile(ctx, (i) => sim.world.tiles[i].berries > 0)) return 'fail';
  const status = travel(ctx, h.tx, h.ty);
  if (status !== 'success') {
    if (status === 'fail') h.workTile = -1;
    return status;
  }
  if (sim.world.harvestBerries(h.workTile)) h.food += YIELD.BERRIES;
  h.workTile = -1;
  return 'success';
});

const goFish = action<HumanCtx>('fishing 🎣', (ctx) => {
  const { sim, h } = ctx;
  // The fish are in the water; the fisher stands on the shore beside them.
  if (h.workTile < 0 || sim.world.tiles[h.workTile].fish <= 0) {
    const spot = sim.findTile(h.x, h.y, HUMAN.SEARCH_RADIUS, (i) => sim.world.tiles[i].fish > 0);
    if (spot < 0) return 'fail';
    const shore = sim.walkableNeighbor(spot);
    if (shore < 0) return 'fail';
    h.workTile = spot;
    const c = sim.tileCenter(shore);
    h.tx = c.x;
    h.ty = c.y;
    h.stuck = 0;
  }
  const status = travel(ctx, h.tx, h.ty);
  if (status !== 'success') {
    if (status === 'fail') h.workTile = -1;
    return status;
  }
  if (sim.world.harvestFish(h.workTile)) h.food += YIELD.FISH;
  h.workTile = -1;
  return 'success';
});

const huntAnimal = action<HumanCtx>('hunting 🏹', (ctx) => {
  const { sim, h } = ctx;
  let prey = h.huntId >= 0 ? sim.animalById(h.huntId) : undefined;
  if (prey && ctx.deadAnimals.has(prey.id)) prey = undefined;
  if (!prey) {
    prey = sim.nearestAnimal(h.x, h.y, HUMAN.SEARCH_RADIUS, (a) => a.kind !== 'wolf') ?? undefined;
    if (!prey) {
      h.huntId = -1;
      return 'fail';
    }
    h.huntId = prey.id;
    h.stuck = 0;
  }
  const dist = Math.hypot(prey.x - h.x, prey.y - h.y);
  if (dist > HUMAN.SEARCH_RADIUS * 1.5) {
    h.huntId = -1; // it got away
    return 'fail';
  }
  const status = travel(ctx, prey.x, prey.y, 1.05);
  if (status === 'fail') {
    h.huntId = -1;
    return 'fail';
  }
  if (Math.hypot(prey.x - h.x, prey.y - h.y) < 0.8) {
    ctx.deadAnimals.add(prey.id);
    h.food += prey.kind === 'deer' ? YIELD.DEER : YIELD.RABBIT;
    h.huntId = -1;
    return 'success';
  }
  return 'running';
});

const searchFurther = action<HumanCtx>('searching for food 👀', (ctx) => {
  const { sim, h } = ctx;
  const status = travel(ctx, h.tx, h.ty);
  if (status === 'running') return 'running';
  const p = sim.nearbyWalkable(h.x, h.y, 12);
  h.tx = p.x;
  h.ty = p.y;
  h.stuck = 0;
  return 'running';
});

// ---------- the granary: shared stores ----------

export const FETCH_FOOD = 'at the granary 🧺';

const withdrawFood = action<HumanCtx>(FETCH_FOOD, (ctx) => {
  const { sim, h } = ctx;
  const v = sim.villageOf(h);
  if (!v) return 'fail';
  if (Math.hypot(v.x - h.x, v.y - h.y) > VILLAGE.GRANARY_REACH) return 'fail';
  if (v.food < 1) return 'fail';
  // Only set out if there will still be a share left once everyone already
  // walking there has taken theirs; otherwise go and find food instead. The
  // starving ignore the queue — being turned away from a full granary and
  // sent to forage stripped land is what killed them.
  if (h.hunger < VILLAGE.DESPERATE_HUNGER) {
    const alreadyGoing = h.activity === FETCH_FOOD ? v.enRoute - 1 : v.enRoute;
    if (v.food < (Math.max(0, alreadyGoing) + 1) * VILLAGE.WITHDRAW) return 'fail';
  }
  const status = travel(ctx, v.x, v.y);
  if (status !== 'success') return status;
  const take = Math.min(VILLAGE.WITHDRAW, v.food);
  if (take <= 0) return 'fail';
  v.food -= take;
  h.food += take;
  return 'success';
});

const depositAtGranary = action<HumanCtx>('stocking granary 📦', (ctx) => {
  const { sim, h } = ctx;
  const v = sim.villageOf(h);
  if (!v) return 'fail';
  const status = travel(ctx, v.x, v.y);
  if (status !== 'success') return status;
  const spare = Math.max(0, h.food - VILLAGE.KEEP_FOOD);
  v.food += spare;
  h.food -= spare;
  v.wood += h.wood;
  h.wood = 0;
  return 'success';
});

const withdrawWood = action<HumanCtx>('collecting timber 🪵', (ctx) => {
  const { sim, h } = ctx;
  if (h.wood >= HUMAN.HUT_WOOD_COST) return 'fail';
  const v = sim.villageOf(h);
  if (!v || v.wood < HUMAN.HUT_WOOD_COST) return 'fail';
  const status = travel(ctx, v.x, v.y);
  if (status !== 'success') return status;
  const take = Math.min(HUMAN.HUT_WOOD_COST, v.wood);
  v.wood -= take;
  h.wood += take;
  return 'success';
});

// ---------- wood and housing ----------

const chopWood = action<HumanCtx>('chopping wood 🪓', (ctx) => {
  const { sim, h } = ctx;
  if (!claimTile(ctx, (i) => sim.world.tiles[i].tree)) return 'fail';
  const status = travel(ctx, h.tx, h.ty);
  if (status !== 'success') {
    if (status === 'fail') h.workTile = -1;
    return status;
  }
  if (sim.world.chopTree(h.workTile)) h.wood++;
  h.workTile = -1;
  return 'success';
});

const buildHut = action<HumanCtx>('building a hut 🔨', (ctx) => {
  const { sim, h } = ctx;
  if (h.wood < HUMAN.HUT_WOOD_COST) return 'fail';
  if (h.workTile < 0 || sim.world.tiles[h.workTile].hut) {
    const spot = sim.findHutSpot(h);
    if (spot < 0) return 'fail';
    h.workTile = spot;
    const c = sim.tileCenter(spot);
    h.tx = c.x;
    h.ty = c.y;
    h.stuck = 0;
  }
  const status = travel(ctx, h.tx, h.ty);
  if (status !== 'success') {
    if (status === 'fail') h.workTile = -1;
    return status;
  }
  const tile = sim.world.tiles[h.workTile];
  if (!tile.hut && h.wood >= HUMAN.HUT_WOOD_COST) {
    h.wood -= HUMAN.HUT_WOOD_COST;
    sim.raiseHut(h, h.workTile);
  }
  h.workTile = -1;
  return 'success';
});

/** Timber from the village store if there is any, otherwise fell a tree. */
const makeHome = selector<HumanCtx>(
  'make a home',
  buildHut,
  withdrawWood,
  guard('still short of timber', (c) => c.h.wood < HUMAN.HUT_WOOD_COST, chopWood),
);

// ---------- social ----------

const followMother = action<HumanCtx>('following mother 👣', (ctx) => {
  const { sim, h } = ctx;
  const mother = sim.humans.find((m) => m.id === h.motherId);
  if (!mother) return 'fail';
  if (Math.hypot(mother.x - h.x, mother.y - h.y) < 3) return 'fail';
  travel(ctx, mother.x, mother.y);
  return 'running';
});

const idleAtHome = action<HumanCtx>('resting 🏡', (ctx) => {
  const { sim, h } = ctx;
  const status = travel(ctx, h.tx, h.ty);
  if (status === 'running') return 'running';
  const hut = sim.huts.find((q) => q.id === h.homeId);
  const v = sim.villageOf(h);
  const cx = hut ? hut.x + 0.5 : (v?.x ?? h.x);
  const cy = hut ? hut.y + 0.5 : (v?.y ?? h.y);
  const p = sim.nearbyWalkable(cx, cy, hut ? 5 : 8);
  h.tx = p.x;
  h.ty = p.y;
  h.stuck = 0;
  return 'running';
});

// ---------- the tree ----------

/**
 * Pick a food source by yield against how far away it is, rather than always
 * taking the nearest. Berries alone cannot feed a village — they regrow over
 * ten years — so the weighting pushes hunters and fishers out to the sources
 * that renew faster.
 */
function chooseFoodSource(ctx: HumanCtx): BehStatus {
  const { sim, h } = ctx;

  // Stick with work already in hand rather than dithering between sources.
  if (h.huntId >= 0) return huntAnimal.run(ctx);
  if (h.workTile >= 0) {
    const tile = sim.world.tiles[h.workTile];
    if (tile.berries > 0) return gatherBerries.run(ctx);
    if (tile.fish > 0) return goFish.run(ctx);
  }

  const dist = (x: number, y: number) => Math.hypot(x - h.x, y - h.y);
  let bestScore = 0;
  let best: BehNode<HumanCtx> | null = null;

  const berry = sim.findTile(h.x, h.y, HUMAN.SEARCH_RADIUS, (i) => sim.world.tiles[i].berries > 0);
  if (berry >= 0) {
    const c = sim.tileCenter(berry);
    bestScore = YIELD.BERRIES / (dist(c.x, c.y) + 4);
    best = gatherBerries;
  }
  const fish = sim.findTile(h.x, h.y, HUMAN.SEARCH_RADIUS, (i) => sim.world.tiles[i].fish > 0);
  if (fish >= 0) {
    const c = sim.tileCenter(fish);
    const score = YIELD.FISH / (dist(c.x, c.y) + 4);
    if (score > bestScore) {
      bestScore = score;
      best = goFish;
    }
  }
  if (isAdult(h)) {
    const prey = sim.nearestAnimal(
      h.x,
      h.y,
      HUMAN.SEARCH_RADIUS,
      (a) => a.kind !== 'wolf' && sim.speciesCount[a.kind] > VILLAGE.HUNT_FLOOR,
    );
    if (prey) {
      const yieldOf = prey.kind === 'deer' ? YIELD.DEER : YIELD.RABBIT;
      const score = yieldOf / (dist(prey.x, prey.y) + 4);
      if (score > bestScore) {
        bestScore = score;
        best = huntAnimal;
      }
    }
  }
  return best ? best.run(ctx) : 'fail';
}

const produceFood = action<HumanCtx>('finding food 🍎', chooseFoodSource);

export const humanTree: BehNode<HumanCtx> = selector<HumanCtx>(
  'human',
  // Survival interrupts. Re-checked every tick, so they cut in mid-task —
  // the whole point of running a tree instead of a state machine.
  guard('being hunted', (c) => c.h.huntedBy >= 0, fleeFromWolf),
  guard(
    'hungry and carrying food',
    (c) => c.h.hunger > HUMAN.EAT_AT && c.h.food > 0,
    eatCarried,
  ),

  // Nothing to eat: the granary first, then whatever the land offers.
  guard(
    'starving',
    (c) => c.h.hunger > HUMAN.SEEK_FOOD_AT && c.h.food === 0,
    selector<HumanCtx>('find food', withdrawFood, produceFood, searchFurther),
  ),

  // Children tag along with their mother instead of working.
  guard('still a child', (c) => !isAdult(c.h), followMother),

  // Housing comes before restocking, or a homeless villager would hand over
  // the very timber they are trying to build with.
  guard('homeless', (c) => isAdult(c.h) && c.h.homeId < 0, makeHome),

  guard('hands full', worthATripHome, depositAtGranary),

  // Otherwise: work on whatever the village says it is short of.
  guard(
    'village needs food',
    (c) => c.sim.villageOf(c.h)?.need === 'food',
    produceFood,
  ),
  guard('village needs wood', (c) => c.sim.villageOf(c.h)?.need === 'wood', chopWood),

  // Villagers with no settlement to lean on still feed themselves.
  guard(
    'unaffiliated',
    (c) => !sim_hasVillage(c) && isAdult(c.h) && c.h.food < 3,
    produceFood,
  ),

  idleAtHome,
);

function sim_hasVillage(c: HumanCtx): boolean {
  return c.sim.villageOf(c.h) !== null;
}

/**
 * Whether it is worth walking back to the granary yet. A flat threshold made
 * villagers trudge home with four berries at a time; once they had stripped
 * the patches near the village, they spent their lives on the road and the
 * settlement starved with food still in the fields. The further out they are
 * working, the fuller they come home.
 */
function worthATripHome(c: HumanCtx): boolean {
  const v = c.sim.villageOf(c.h);
  if (!v) return false;
  if (c.h.wood >= 3) return true;
  const spare = c.h.food - VILLAGE.KEEP_FOOD;
  if (spare < VILLAGE.DEPOSIT_AT) return false;
  if (spare >= VILLAGE.CARRY_CAP) return true;
  const dist = Math.hypot(v.x - c.h.x, v.y - c.h.y);
  return spare >= VILLAGE.DEPOSIT_AT + dist * 0.4;
}
