import {
  ANIMALS,
  HUMAN,
  START_ANIMALS,
  TICKS_PER_YEAR,
  VILLAGE,
  type AnimalSpec,
} from './config';
import { FETCH_FOOD, humanTree, type HumanCtx } from './ai';
import { mulberry32, pick, type Rng } from './rng';
import { assessNeed, housingShort, type Village } from './village';
import { Terrain, World } from './world';

export type Sex = 'm' | 'f';

export interface Human {
  id: number;
  name: string;
  x: number;
  y: number;
  sex: Sex;
  age: number; // years
  lifespan: number; // years
  hunger: number; // 0 fed .. 100 starved
  food: number;
  wood: number;
  homeId: number; // hut id, -1 = homeless
  motherId: number;
  villageId: number;
  /** What the behaviour tree had them doing this tick, for the inspector. */
  activity: string;
  /** Set when a wolf is stalking them, so the tree can react. -1 = safe. */
  huntedBy: number;
  tx: number; // current movement target (tile coords, center-ish)
  ty: number;
  workTile: number; // tile index being harvested / built on, -1 = none
  huntId: number; // animal id being hunted, -1 = none
  mateCooldown: number;
  stuck: number;
}

export type AnimalKind = 'rabbit' | 'deer' | 'wolf';

export interface Animal {
  id: number;
  kind: AnimalKind;
  x: number;
  y: number;
  age: number; // years
  hunger: number;
  tx: number;
  ty: number;
  huntId: number; // wolves: prey animal id
  huntHumanId: number;
  mateCooldown: number;
  /** transient, refreshed every tick — herbivore currently running from a wolf */
  fleeing: boolean;
}

export interface Hut {
  id: number;
  x: number; // tile coords
  y: number;
  occupants: number;
  villageId: number;
}

export interface Stats {
  year: number;
  population: number;
  children: number;
  births: number;
  deaths: number;
  huts: number;
  villages: number;
  stored: number;
  rabbits: number;
  deer: number;
  wolves: number;
}

const isAdult = (h: Human) => h.age >= HUMAN.ADULT_AGE;

export class Sim {
  readonly world: World;
  humans: Human[] = [];
  animals: Animal[] = [];
  huts: Hut[] = [];
  villages: Village[] = [];
  /** Refreshed on the village pass; read by hunters choosing a target. */
  speciesCount: Record<AnimalKind, number> = { rabbit: 0, deer: 0, wolf: 0 };
  births = 0;
  deaths = 0;
  ticks = 0;
  private nextId = 1;
  private rng: Rng;

  constructor(world: World) {
    this.world = world;
    this.rng = mulberry32(world.seed ^ 0x5eed);
    this.spawnInitialPopulation();
    this.spawnInitialAnimals();
  }

  // ---------- setup ----------

  private randomLandTile(): { x: number; y: number } {
    const w = this.world;
    for (;;) {
      const x = Math.floor(this.rng() * w.w);
      const y = Math.floor(this.rng() * w.h);
      if (w.isWalkable(x, y)) return { x, y };
    }
  }

  private spawnInitialPopulation(): void {
    // Settle the founders on the grass tile with the richest surroundings.
    let best = this.randomLandTile();
    let bestScore = -1;
    for (let i = 0; i < 300; i++) {
      const c = this.randomLandTile();
      let score = 0;
      for (let dy = -8; dy <= 8; dy++) {
        for (let dx = -8; dx <= 8; dx++) {
          const t = this.world.tileAt(c.x + dx, c.y + dy);
          if (!t) continue;
          if (t.berries > 0) score += 3;
          if (t.tree) score += 1;
          if (t.fish > 0) score += 2;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    for (let i = 0; i < HUMAN.START_POP; i++) {
      const spot = this.nearbyWalkable(best.x + 0.5, best.y + 0.5, 6);
      this.humans.push(this.makeHuman(spot.x, spot.y, i % 2 ? 'f' : 'm', 16 + this.rng() * 14));
    }
  }

  private makeName(): string {
    const parts = ['ka', 'ru', 'mi', 'ta', 'lo', 'ne', 'sa', 'el', 'ri', 'on', 'ba', 'du', 'we', 'na'];
    let n = pick(this.rng, parts) + pick(this.rng, parts);
    if (this.rng() < 0.4) n += pick(this.rng, parts);
    return n[0].toUpperCase() + n.slice(1);
  }

  private makeHuman(x: number, y: number, sex: Sex, age: number): Human {
    return {
      id: this.nextId++,
      name: this.makeName(),
      x,
      y,
      sex,
      age,
      lifespan: 58 + this.rng() * 28,
      hunger: 20 + this.rng() * 20,
      food: 1,
      wood: 0,
      homeId: -1,
      motherId: -1,
      villageId: -1,
      activity: 'looking around',
      huntedBy: -1,
      tx: x,
      ty: y,
      workTile: -1,
      huntId: -1,
      mateCooldown: Math.floor(this.rng() * HUMAN.MATE_COOLDOWN),
      stuck: 0,
    };
  }

  private spawnInitialAnimals(): void {
    // Animals start in packs/herds — scattered singles would never find a
    // mate on a map this size and the species would age out.
    const groupSize: Record<AnimalKind, number> = { rabbit: 5, deer: 4, wolf: 3 };
    for (const kind of Object.keys(START_ANIMALS) as AnimalKind[]) {
      let left = START_ANIMALS[kind];
      while (left > 0) {
        const n = Math.min(groupSize[kind], left);
        left -= n;
        this.spawnAnimalGroup(kind, this.randomLandTile(), n);
      }
    }
  }

  private spawnAnimalGroup(
    kind: AnimalKind,
    center: { x: number; y: number },
    count: number,
  ): void {
    for (let i = 0; i < count; i++) {
      const p = this.nearbyWalkable(center.x + 0.5, center.y + 0.5, 3);
      this.animals.push({
        id: this.nextId++,
        kind,
        x: p.x,
        y: p.y,
        age: ANIMALS[kind].adultAge + this.rng() * 1.5,
        hunger: this.rng() * 40,
        tx: p.x,
        ty: p.y,
        huntId: -1,
        huntHumanId: -1,
        mateCooldown: Math.floor(this.rng() * ANIMALS[kind].mateCooldown),
        fleeing: false,
      });
    }
  }

  /**
   * When a species is all but extinct, a small group migrates onto the
   * island. Keeps the ecosystem alive over very long runs without visibly
   * interfering — small predator populations die out stochastically.
   */
  private immigrationPass(): void {
    const counts: Record<AnimalKind, number> = { rabbit: 0, deer: 0, wolf: 0 };
    for (const a of this.animals) counts[a.kind]++;
    for (const kind of Object.keys(counts) as AnimalKind[]) {
      if (counts[kind] < 3) this.spawnAnimalGroup(kind, this.randomLandTile(), 4);
    }
  }

  // ---------- helpers ----------

  nearbyWalkable(x: number, y: number, r: number): { x: number; y: number } {
    for (let i = 0; i < 20; i++) {
      const nx = x + (this.rng() - 0.5) * 2 * r;
      const ny = y + (this.rng() - 0.5) * 2 * r;
      if (this.world.isWalkable(nx, ny)) return { x: nx, y: ny };
    }
    return { x, y };
  }

  /**
   * Spiral outward from (cx, cy) and return the index of the closest tile
   * matching `match`, or -1. Cheap early-exit nearest-tile search.
   */
  findTile(
    cx: number,
    cy: number,
    radius: number,
    match: (i: number) => boolean,
  ): number {
    const w = this.world;
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    if (w.inBounds(x0, y0) && match(w.idx(x0, y0))) return w.idx(x0, y0);
    for (let r = 1; r <= radius; r++) {
      let best = -1;
      let bestD = Infinity;
      for (let dx = -r; dx <= r; dx++) {
        for (const dy of dx === -r || dx === r ? range(-r, r) : [-r, r]) {
          const x = x0 + dx;
          const y = y0 + dy;
          if (!w.inBounds(x, y)) continue;
          const i = w.idx(x, y);
          if (!match(i)) continue;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  moveToward(
    e: { x: number; y: number; stuck?: number },
    tx: number,
    ty: number,
    speed: number,
  ): boolean {
    const dx = tx - e.x;
    const dy = ty - e.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.15) return true;
    const step = Math.min(speed, d);
    const ang = Math.atan2(dy, dx);
    // Try straight ahead first, then progressively sharper detours around water.
    for (const off of [0, 0.5, -0.5, 1.1, -1.1, 1.8, -1.8]) {
      const nx = e.x + Math.cos(ang + off) * step;
      const ny = e.y + Math.sin(ang + off) * step;
      if (this.world.isWalkable(nx, ny)) {
        e.x = nx;
        e.y = ny;
        return d - step < 0.15;
      }
    }
    if (e.stuck !== undefined) e.stuck++;
    return false;
  }

  tileCenter(i: number): { x: number; y: number } {
    return { x: (i % this.world.w) + 0.5, y: Math.floor(i / this.world.w) + 0.5 };
  }

  animalById(id: number): Animal | undefined {
    return this.animals.find((a) => a.id === id);
  }

  // ---------- main tick ----------

  tick(): void {
    this.ticks++;
    this.world.tickRegrowth();

    const deadHumans = new Set<number>();
    const deadAnimals = new Set<number>();

    // Publish who the wolves are stalking so the humans' tree can see it.
    for (const h of this.humans) h.huntedBy = -1;
    for (const a of this.animals) {
      if (a.huntHumanId < 0) continue;
      const victim = this.humans.find((h) => h.id === a.huntHumanId);
      if (victim) victim.huntedBy = a.id;
    }

    for (const h of this.humans) this.tickHuman(h, deadHumans, deadAnimals);
    for (const a of this.animals) this.tickAnimal(a, deadHumans, deadAnimals);

    if (this.ticks % 10 === 0) {
      this.villagePass();
      this.matingPass();
      this.feedChildrenPass();
      this.claimHutsPass();
      this.animalMatingPass();
    }
    if (this.ticks % (8 * 50) === 0) this.immigrationPass();

    if (deadHumans.size) {
      for (const h of this.humans) {
        if (!deadHumans.has(h.id)) continue;
        this.deaths++;
        if (h.homeId >= 0) {
          const hut = this.huts.find((q) => q.id === h.homeId);
          if (hut) hut.occupants--;
        }
      }
      this.humans = this.humans.filter((h) => !deadHumans.has(h.id));
    }
    if (deadAnimals.size) {
      this.animals = this.animals.filter((a) => !deadAnimals.has(a.id));
    }
  }

  // ---------- humans ----------

  private tickHuman(h: Human, dead: Set<number>, deadAnimals: Set<number>): void {
    const adult = isAdult(h);
    h.age += 1 / TICKS_PER_YEAR;
    h.hunger += adult ? HUMAN.HUNGER_RATE : HUMAN.CHILD_HUNGER_RATE;
    if (h.mateCooldown > 0) h.mateCooldown--;

    if (h.age > h.lifespan || h.hunger >= 100) {
      dead.add(h.id);
      return;
    }

    // The tree decides everything from here: it is re-run from the root each
    // tick, so a starving villager or one being stalked drops what they are
    // doing without any explicit transition.
    const ctx: HumanCtx = {
      sim: this,
      h,
      speed:
        (adult ? HUMAN.SPEED : HUMAN.CHILD_SPEED) *
        (h.age >= HUMAN.ELDER_AGE ? 0.75 : 1),
      activity: 'idle',
      deadAnimals,
    };
    humanTree.run(ctx);
    h.activity = ctx.activity;
  }

  // ---------- villages ----------

  villageOf(h: Human): Village | null {
    if (h.villageId < 0) return null;
    return this.villages.find((v) => v.id === h.villageId) ?? null;
  }

  /**
   * Raise a hut for `h` and attach it to a village — joining the nearest one
   * in range, or founding a new settlement if there is none.
   */
  raiseHut(h: Human, tile: number): void {
    this.world.buildHut(tile);
    const c = this.tileCenter(tile);
    const hut: Hut = {
      id: this.nextId++,
      x: c.x - 0.5,
      y: c.y - 0.5,
      occupants: 1,
      villageId: -1,
    };
    this.huts.push(hut);
    h.homeId = hut.id;

    let village = this.nearestVillage(hut.x, hut.y, VILLAGE.JOIN_RADIUS);
    if (!village) {
      village = {
        id: this.nextId++,
        name: this.makeName(),
        x: hut.x + 0.5,
        y: hut.y + 0.5,
        hutIds: [],
        food: 0,
        wood: 0,
        memberCount: 0,
        enRoute: 0,
        need: 'food',
        foundedTick: this.ticks,
      };
      this.villages.push(village);
    }
    hut.villageId = village.id;
    village.hutIds.push(hut.id);
    h.villageId = village.id;
  }

  private nearestVillage(x: number, y: number, radius: number): Village | null {
    let best: Village | null = null;
    let bestD = radius * radius;
    for (const v of this.villages) {
      const d = (v.x - x) ** 2 + (v.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  /**
   * The settlement-level tick: recentre each village on its huts, count its
   * people, work out what it is short of, and take in nearby strays.
   */
  private villagePass(): void {
    this.speciesCount = { rabbit: 0, deer: 0, wolf: 0 };
    for (const a of this.animals) this.speciesCount[a.kind]++;

    const members = new Map<number, number>();
    const enRoute = new Map<number, number>();
    for (const h of this.humans) {
      if (h.villageId < 0) continue;
      members.set(h.villageId, (members.get(h.villageId) ?? 0) + 1);
      if (h.activity === FETCH_FOOD) {
        enRoute.set(h.villageId, (enRoute.get(h.villageId) ?? 0) + 1);
      }
    }

    for (const v of this.villages) {
      v.hutIds = v.hutIds.filter((id) => this.huts.some((q) => q.id === id));
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (const id of v.hutIds) {
        const hut = this.huts.find((q) => q.id === id);
        if (!hut) continue;
        sx += hut.x + 0.5;
        sy += hut.y + 0.5;
        n++;
      }
      if (n) {
        v.x = sx / n;
        v.y = sy / n;
      }
      v.memberCount = members.get(v.id) ?? 0;
      v.enRoute = enRoute.get(v.id) ?? 0;
      v.need = assessNeed(v, housingShort(v));
    }

    // A village with nobody left in it is a ruin, not a settlement.
    this.villages = this.villages.filter((v) => v.memberCount > 0 || v.hutIds.length > 0);

    // Unaffiliated people standing in a village's shadow throw in with it.
    for (const h of this.humans) {
      if (h.villageId >= 0) continue;
      const v = this.nearestVillage(h.x, h.y, VILLAGE.JOIN_RADIUS);
      if (v) h.villageId = v.id;
    }
  }

  walkableNeighbor(tile: number): number {
    const x = tile % this.world.w;
    const y = Math.floor(tile / this.world.w);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (this.world.isWalkable(x + dx, y + dy)) {
          return this.world.idx(x + dx, y + dy);
        }
      }
    }
    return -1;
  }

  findHutSpot(h: Human): number {
    const w = this.world;
    const free = (i: number): boolean => {
      const t = w.tiles[i];
      if (t.hut || t.tree || t.berries > 0) return false;
      if (t.terrain !== Terrain.Grass && t.terrain !== Terrain.Sand) return false;
      // keep a one-tile gap between huts so villages stay readable
      const x = i % w.w;
      const y = Math.floor(i / w.w);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const n = w.tileAt(x + dx, y + dy);
          if (n?.hut) return false;
        }
      }
      return true;
    };
    // Prefer joining an existing village.
    if (this.huts.length) {
      let nearest: Hut | null = null;
      let nd = Infinity;
      for (const hut of this.huts) {
        const d = Math.hypot(hut.x - h.x, hut.y - h.y);
        if (d < nd) {
          nd = d;
          nearest = hut;
        }
      }
      if (nearest && nd < HUMAN.SEARCH_RADIUS * 2) {
        const spot = this.findTile(nearest.x, nearest.y, 7, free);
        if (spot >= 0) return spot;
      }
    }
    return this.findTile(h.x, h.y, 10, free);
  }

  nearestAnimal(
    x: number,
    y: number,
    radius: number,
    match: (a: Animal) => boolean,
  ): Animal | null {
    let best: Animal | null = null;
    let bestD = radius * radius;
    for (const a of this.animals) {
      if (!match(a)) continue;
      const d = (a.x - x) ** 2 + (a.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    return best;
  }

  private matingPass(): void {
    for (const f of this.humans) {
      if (
        f.sex !== 'f' ||
        !isAdult(f) ||
        f.age > HUMAN.MAX_FERTILE_AGE ||
        f.mateCooldown > 0 ||
        f.hunger > HUMAN.MATE_MAX_HUNGER
      ) {
        continue;
      }
      const partner = this.humans.find((m) => {
        if (
          m.sex !== 'm' ||
          !isAdult(m) ||
          m.mateCooldown > 0 ||
          m.hunger > HUMAN.MATE_MAX_HUNGER
        ) {
          return false;
        }
        // Fellow villagers meet around the huts and the granary, so they pair
        // up at settlement range. Villagers now work spread out across the
        // fields, and requiring them to be standing side by side had all but
        // stopped births.
        const reach = f.villageId >= 0 && m.villageId === f.villageId ? 12 : 4;
        return Math.hypot(m.x - f.x, m.y - f.y) < reach;
      });
      if (!partner) continue;
      const village = this.villageOf(f);
      // Stock per head is the brake, applied as a gradient rather than a
      // threshold. A hard cutoff synchronised the whole village: everyone
      // bred the moment the store crossed the line, drained it, and then no
      // child was born until that entire generation had aged out — which
      // eventually took a village with it. Housing is deliberately not a
      // second brake; on a map short of trees it pinned villages at their
      // starting huts and stopped them growing at all.
      if (village) {
        const wellFed =
          village.food / Math.max(1, village.memberCount * VILLAGE.BIRTH_FOOD_PER_CAPITA);
        // The floor exists so a small village cannot age out to nothing for
        // want of a single child. A large village that is already starving
        // does not need it — leaving it in place let one grow from 50 to 138
        // on an empty store and then starve three quarters of itself.
        const floor =
          village.memberCount < VILLAGE.FRAGILE_SIZE ? VILLAGE.MIN_BIRTH_CHANCE : 0;
        const chance = Math.max(floor, Math.min(1, wellFed));
        if (this.rng() > chance) continue;
      }
      f.mateCooldown = HUMAN.MATE_COOLDOWN;
      partner.mateCooldown = Math.floor(HUMAN.MATE_COOLDOWN / 2);
      const baby = this.makeHuman(f.x, f.y, this.rng() < 0.5 ? 'f' : 'm', 0);
      baby.hunger = 15;
      baby.food = 0;
      baby.motherId = f.id;
      baby.homeId = -1;
      baby.villageId = f.villageId;
      this.humans.push(baby);
      this.births++;
    }
  }

  /**
   * A hungry child takes food from any adult beside them. Village children can
   * also help themselves at the granary, but a toddler cannot walk halfway
   * across the island before starving, so this stays their main meal.
   */
  private feedChildrenPass(): void {
    for (const kid of this.humans) {
      if (isAdult(kid) || kid.food > 0 || kid.hunger < HUMAN.SEEK_FOOD_AT) continue;
      const provider = this.humans.find(
        (p) => isAdult(p) && p.food > 1 && Math.hypot(p.x - kid.x, p.y - kid.y) < 3,
      );
      if (provider) {
        provider.food--;
        kid.food++;
      }
    }
  }

  private claimHutsPass(): void {
    for (const h of this.humans) {
      if (!isAdult(h) || h.homeId >= 0) continue;
      const hut = this.huts.find(
        (q) => q.occupants < 2 && Math.hypot(q.x - h.x, q.y - h.y) < HUMAN.SEARCH_RADIUS,
      );
      if (hut) {
        hut.occupants++;
        h.homeId = hut.id;
        if (hut.villageId >= 0) h.villageId = hut.villageId;
      }
    }
  }

  // ---------- animals ----------

  private tickAnimal(a: Animal, deadHumans: Set<number>, dead: Set<number>): void {
    const spec = ANIMALS[a.kind];
    a.age += 1 / TICKS_PER_YEAR;
    a.hunger += spec.hungerRate;
    if (a.mateCooldown > 0) a.mateCooldown--;
    if (a.age > spec.maxAge || a.hunger >= 100) {
      dead.add(a.id);
      return;
    }

    if (a.kind === 'wolf') {
      this.tickWolf(a, spec, deadHumans, dead);
      return;
    }

    // Herbivores: flee danger first, otherwise graze/wander.
    const threat = this.nearestAnimal(a.x, a.y, spec.fleeRadius, (o) => o.kind === 'wolf');
    a.fleeing = !!threat;
    if (threat) {
      const ang = Math.atan2(a.y - threat.y, a.x - threat.x);
      a.tx = a.x + Math.cos(ang) * 4;
      a.ty = a.y + Math.sin(ang) * 4;
      this.moveToward(a, a.tx, a.ty, spec.speed * 1.3);
      return;
    }
    const t = this.world.tileAt(a.x, a.y);
    if (
      a.hunger > 20 &&
      t &&
      (t.terrain === Terrain.Grass || t.terrain === Terrain.Forest)
    ) {
      a.hunger = Math.max(0, a.hunger - 1.2); // grazing while ambling around
    }
    if (this.moveToward(a, a.tx, a.ty, spec.speed * 0.5)) {
      this.pickWanderTarget(a, 5);
    }
  }

  /**
   * Wander randomly — but lonely animals drift toward their nearest kin (so
   * they can find mates), and overcrowded ones disperse far away (so packs
   * split instead of piling up past the breeding crowd limit).
   */
  private pickWanderTarget(a: Animal, r: number): void {
    const spec = ANIMALS[a.kind];
    let kinNearby = 0;
    let nearest: Animal | null = null;
    let nearestD = Infinity;
    for (const o of this.animals) {
      if (o.kind !== a.kind || o === a) continue;
      const d = Math.hypot(o.x - a.x, o.y - a.y);
      if (d < spec.crowdRadius) kinNearby++;
      if (d < nearestD) {
        nearestD = d;
        nearest = o;
      }
    }
    if (kinNearby >= spec.crowdLimit) {
      // too crowded to breed here — strike out and found a new pack
      const p = this.nearbyWalkable(a.x, a.y, 30);
      a.tx = p.x;
      a.ty = p.y;
      return;
    }
    if (nearest && nearestD > 10 && nearestD < 50 && this.rng() < 0.6) {
      const p = this.nearbyWalkable(nearest.x, nearest.y, 3);
      a.tx = p.x;
      a.ty = p.y;
      return;
    }
    const p = this.nearbyWalkable(a.x, a.y, r);
    a.tx = p.x;
    a.ty = p.y;
  }

  private tickWolf(
    a: Animal,
    spec: AnimalSpec,
    deadHumans: Set<number>,
    dead: Set<number>,
  ): void {
    if (a.hunger > spec.seekFoodAt) {
      if (a.huntId >= 0) {
        const prey = this.animalById(a.huntId);
        if (prey && !dead.has(prey.id)) {
          this.moveToward(a, prey.x, prey.y, spec.speed);
          if (Math.hypot(prey.x - a.x, prey.y - a.y) < 1.0) {
            dead.add(prey.id);
            a.hunger = 0;
            a.huntId = -1;
          }
          return;
        }
        a.huntId = -1;
      }
      if (a.huntHumanId >= 0) {
        const victim = this.humans.find((h) => h.id === a.huntHumanId);
        if (victim && !deadHumans.has(victim.id) && a.hunger > 80) {
          this.moveToward(a, victim.x, victim.y, spec.speed);
          if (Math.hypot(victim.x - a.x, victim.y - a.y) < 0.7) {
            deadHumans.add(victim.id);
            a.hunger = 0;
            a.huntHumanId = -1;
          }
          return;
        }
        a.huntHumanId = -1;
      }
      const prey = this.nearestAnimal(a.x, a.y, 14, (o) => o.kind !== 'wolf');
      if (prey) {
        a.huntId = prey.id;
        return;
      }
      // A starving wolf with no prey around turns on humans.
      if (a.hunger > 80) {
        let best: Human | null = null;
        let bd = 14 * 14;
        for (const h of this.humans) {
          const d = (h.x - a.x) ** 2 + (h.y - a.y) ** 2;
          if (d < bd) {
            bd = d;
            best = h;
          }
        }
        if (best) {
          a.huntHumanId = best.id;
          return;
        }
      }
    }
    if (this.moveToward(a, a.tx, a.ty, spec.speed * 0.5)) {
      this.pickWanderTarget(a, 7);
    }
  }

  private animalMatingPass(): void {
    const newborns: Animal[] = [];
    for (const a of this.animals) {
      const spec = ANIMALS[a.kind];
      if (a.age < spec.adultAge || a.mateCooldown > 0 || a.hunger > 60) continue;
      let kin = 0;
      let partner: Animal | null = null;
      for (const o of this.animals) {
        if (o.kind !== a.kind || o === a) continue;
        const d = Math.hypot(o.x - a.x, o.y - a.y);
        if (d < spec.crowdRadius) kin++;
        if (
          !partner &&
          d < 4 &&
          o.age >= spec.adultAge &&
          o.mateCooldown <= 0 &&
          o.hunger <= 60
        ) {
          partner = o;
        }
      }
      if (!partner || kin >= spec.crowdLimit) continue;
      a.mateCooldown = spec.mateCooldown;
      partner.mateCooldown = spec.mateCooldown;
      const litter = a.kind === 'rabbit' ? 2 : 1;
      for (let i = 0; i < litter; i++) {
        newborns.push({
          id: this.nextId++,
          kind: a.kind,
          x: a.x,
          y: a.y,
          age: 0,
          hunger: 10,
          tx: a.x,
          ty: a.y,
          huntId: -1,
          huntHumanId: -1,
          mateCooldown: spec.mateCooldown,
          fleeing: false,
        });
      }
    }
    this.animals.push(...newborns);
  }

  // ---------- stats ----------

  stats(): Stats {
    let children = 0;
    let rabbits = 0;
    let deer = 0;
    let wolves = 0;
    for (const h of this.humans) if (!isAdult(h)) children++;
    for (const a of this.animals) {
      if (a.kind === 'rabbit') rabbits++;
      else if (a.kind === 'deer') deer++;
      else wolves++;
    }
    let stored = 0;
    for (const v of this.villages) stored += v.food;
    return {
      year: Math.floor(this.ticks / TICKS_PER_YEAR),
      population: this.humans.length,
      children,
      births: this.births,
      deaths: this.deaths,
      huts: this.huts.length,
      villages: this.villages.length,
      stored: Math.round(stored),
      rabbits,
      deer,
      wolves,
    };
  }
}

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}
