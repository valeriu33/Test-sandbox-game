import {
  ANIMALS,
  HUMAN,
  START_ANIMALS,
  TICKS_PER_YEAR,
  YIELD,
  type AnimalSpec,
} from './config';
import { mulberry32, type Rng } from './rng';
import { Terrain, World } from './world';

export type Sex = 'm' | 'f';
export type HumanState =
  | 'idle'
  | 'gather'
  | 'fish'
  | 'hunt'
  | 'chop'
  | 'build'
  | 'wander';

export interface Human {
  id: number;
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
  state: HumanState;
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
  huntId: number; // wolves: prey animal id; -2 means hunting a human
  huntHumanId: number;
  mateCooldown: number;
}

export interface Hut {
  id: number;
  x: number; // tile coords
  y: number;
  occupants: number;
}

export interface Stats {
  year: number;
  population: number;
  children: number;
  births: number;
  deaths: number;
  huts: number;
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

  private makeHuman(x: number, y: number, sex: Sex, age: number): Human {
    return {
      id: this.nextId++,
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
      state: 'idle',
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

  private nearbyWalkable(x: number, y: number, r: number): { x: number; y: number } {
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
  private findTile(
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

  private moveToward(
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

  private tileCenter(i: number): { x: number; y: number } {
    return { x: (i % this.world.w) + 0.5, y: Math.floor(i / this.world.w) + 0.5 };
  }

  private animalById(id: number): Animal | undefined {
    return this.animals.find((a) => a.id === id);
  }

  // ---------- main tick ----------

  tick(): void {
    this.ticks++;
    this.world.tickRegrowth();

    const deadHumans = new Set<number>();
    const deadAnimals = new Set<number>();

    for (const h of this.humans) this.tickHuman(h, deadHumans, deadAnimals);
    for (const a of this.animals) this.tickAnimal(a, deadHumans, deadAnimals);

    if (this.ticks % 10 === 0) {
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
    if (h.hunger > HUMAN.EAT_AT && h.food > 0) {
      h.food--;
      h.hunger = Math.max(0, h.hunger - HUMAN.FOOD_VALUE);
    }

    const speed =
      (adult ? HUMAN.SPEED : HUMAN.CHILD_SPEED) *
      (h.age >= HUMAN.ELDER_AGE ? 0.75 : 1);

    if (h.stuck > 30) {
      // Hopelessly walled in on the way somewhere — give up on this plan.
      h.state = 'idle';
      h.stuck = 0;
    }

    switch (h.state) {
      case 'idle':
        this.decide(h);
        break;

      case 'wander':
        if (this.moveToward(h, h.tx, h.ty, speed)) h.state = 'idle';
        break;

      case 'gather':
        if (this.moveToward(h, h.tx, h.ty, speed)) {
          if (this.world.harvestBerries(h.workTile)) h.food += YIELD.BERRIES;
          h.state = 'idle';
        }
        break;

      case 'fish':
        if (this.moveToward(h, h.tx, h.ty, speed)) {
          if (this.world.harvestFish(h.workTile)) h.food += YIELD.FISH;
          h.state = 'idle';
        }
        break;

      case 'chop':
        if (this.moveToward(h, h.tx, h.ty, speed)) {
          if (this.world.chopTree(h.workTile)) h.wood++;
          h.state = 'idle';
        }
        break;

      case 'build':
        if (this.moveToward(h, h.tx, h.ty, speed)) {
          const t = this.world.tiles[h.workTile];
          if (!t.hut && h.wood >= HUMAN.HUT_WOOD_COST) {
            h.wood -= HUMAN.HUT_WOOD_COST;
            this.world.buildHut(h.workTile);
            const c = this.tileCenter(h.workTile);
            const hut: Hut = { id: this.nextId++, x: c.x - 0.5, y: c.y - 0.5, occupants: 1 };
            this.huts.push(hut);
            h.homeId = hut.id;
          }
          h.state = 'idle';
        }
        break;

      case 'hunt': {
        const prey = this.animalById(h.huntId);
        if (!prey || deadAnimals.has(prey.id)) {
          h.state = 'idle';
          break;
        }
        this.moveToward(h, prey.x, prey.y, speed * 1.05);
        if (Math.hypot(prey.x - h.x, prey.y - h.y) < 0.8) {
          deadAnimals.add(prey.id);
          h.food += prey.kind === 'deer' ? YIELD.DEER : YIELD.RABBIT;
          h.state = 'idle';
        } else if (Math.hypot(prey.x - h.x, prey.y - h.y) > HUMAN.SEARCH_RADIUS * 1.5) {
          h.state = 'idle'; // prey escaped
        }
        break;
      }
    }
  }

  private decide(h: Human): void {
    const w = this.world;
    const adult = isAdult(h);
    h.stuck = 0;

    if (h.hunger > HUMAN.SEEK_FOOD_AT && h.food === 0) {
      const berry = this.findTile(h.x, h.y, HUMAN.SEARCH_RADIUS, (i) => w.tiles[i].berries > 0);
      if (berry >= 0) {
        this.setWork(h, 'gather', berry);
        return;
      }
      const fishSpot = this.findTile(h.x, h.y, HUMAN.SEARCH_RADIUS, (i) => w.tiles[i].fish > 0);
      if (fishSpot >= 0) {
        const shore = this.walkableNeighbor(fishSpot);
        if (shore >= 0) {
          h.state = 'fish';
          h.workTile = fishSpot;
          const c = this.tileCenter(shore);
          h.tx = c.x;
          h.ty = c.y;
          return;
        }
      }
      if (adult) {
        const prey = this.nearestAnimal(h.x, h.y, HUMAN.SEARCH_RADIUS, (a) => a.kind !== 'wolf');
        if (prey) {
          h.state = 'hunt';
          h.huntId = prey.id;
          return;
        }
      }
      // Nothing edible nearby — strike out in a random direction and retry.
      this.wanderFrom(h, h.x, h.y, 10);
      return;
    }

    if (adult && h.homeId < 0) {
      if (h.wood >= HUMAN.HUT_WOOD_COST) {
        const spot = this.findHutSpot(h);
        if (spot >= 0) {
          this.setWork(h, 'build', spot);
          return;
        }
      } else {
        const tree = this.findTile(h.x, h.y, HUMAN.SEARCH_RADIUS, (i) => w.tiles[i].tree);
        if (tree >= 0) {
          this.setWork(h, 'chop', tree);
          return;
        }
      }
    }

    // Downtime: children shadow their mother, everyone else potters about home.
    if (!adult) {
      const mom = this.humans.find((m) => m.id === h.motherId);
      if (mom && Math.hypot(mom.x - h.x, mom.y - h.y) > 3) {
        h.state = 'wander';
        h.tx = mom.x;
        h.ty = mom.y;
        return;
      }
    }
    const hut = this.huts.find((q) => q.id === h.homeId);
    const cx = hut ? hut.x + 0.5 : h.x;
    const cy = hut ? hut.y + 0.5 : h.y;
    this.wanderFrom(h, cx, cy, hut ? 5 : 8);
  }

  private setWork(h: Human, state: HumanState, tile: number): void {
    h.state = state;
    h.workTile = tile;
    const c = this.tileCenter(tile);
    h.tx = c.x;
    h.ty = c.y;
  }

  private wanderFrom(h: Human, cx: number, cy: number, r: number): void {
    const p = this.nearbyWalkable(cx, cy, r);
    h.state = 'wander';
    h.tx = p.x;
    h.ty = p.y;
  }

  private walkableNeighbor(tile: number): number {
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

  private findHutSpot(h: Human): number {
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

  private nearestAnimal(
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
      const partner = this.humans.find(
        (m) =>
          m.sex === 'm' &&
          isAdult(m) &&
          m.mateCooldown <= 0 &&
          m.hunger <= HUMAN.MATE_MAX_HUNGER &&
          Math.hypot(m.x - f.x, m.y - f.y) < 4,
      );
      if (!partner) continue;
      f.mateCooldown = HUMAN.MATE_COOLDOWN;
      partner.mateCooldown = Math.floor(HUMAN.MATE_COOLDOWN / 2);
      const baby = this.makeHuman(f.x, f.y, this.rng() < 0.5 ? 'f' : 'm', 0);
      baby.hunger = 15;
      baby.food = 0;
      baby.motherId = f.id;
      baby.homeId = -1;
      this.humans.push(baby);
      this.births++;
    }
  }

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
    return {
      year: Math.floor(this.ticks / TICKS_PER_YEAR),
      population: this.humans.length,
      children,
      births: this.births,
      deaths: this.deaths,
      huts: this.huts.length,
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
