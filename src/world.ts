import { MAP_H, MAP_W, REGROW } from './config';
import { fbm } from './noise';
import { hash2, mulberry32, type Rng } from './rng';

export enum Terrain {
  DeepWater,
  Water,
  Sand,
  Grass,
  Forest,
  Rock,
  Snow,
}

export interface Tile {
  terrain: Terrain;
  /** true while a full-grown tree stands here */
  tree: boolean;
  /** harvestable berry charges (0 = none / regrowing) */
  berries: number;
  /** harvestable fish in this water tile */
  fish: number;
  /** ticks until the depleted resource comes back (0 = nothing pending) */
  regrowAt: number;
  hut: boolean;
  /** set at generation: tile can ever host trees/berries again */
  fertile: boolean;
  fishery: boolean;
}

export class World {
  readonly w = MAP_W;
  readonly h = MAP_H;
  readonly tiles: Tile[] = [];
  readonly seed: number;
  /** tile indices whose looks changed since the renderer last drained this */
  dirty: number[] = [];
  private regrowing: Set<number> = new Set();

  constructor(seed: number) {
    this.seed = seed;
    this.generate();
  }

  idx(x: number, y: number): number {
    return y * this.w + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  tileAt(x: number, y: number): Tile | null {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    return this.inBounds(tx, ty) ? this.tiles[this.idx(tx, ty)] : null;
  }

  isWalkable(x: number, y: number): boolean {
    const t = this.tileAt(x, y);
    if (!t) return false;
    return (
      t.terrain === Terrain.Sand ||
      t.terrain === Terrain.Grass ||
      t.terrain === Terrain.Forest
    );
  }

  isWater(x: number, y: number): boolean {
    const t = this.tileAt(x, y);
    return (
      !!t && (t.terrain === Terrain.Water || t.terrain === Terrain.DeepWater)
    );
  }

  markDirty(i: number): void {
    this.dirty.push(i);
  }

  private generate(): void {
    const rng = mulberry32(this.seed);
    const eSeed = Math.floor(rng() * 1e9);
    const mSeed = Math.floor(rng() * 1e9);
    const fSeed = Math.floor(rng() * 1e9);

    const elevation = new Float32Array(this.w * this.h);
    const cx = this.w / 2;
    const cy = this.h / 2;
    const maxD = Math.min(cx, cy);

    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        let e = fbm(x, y, eSeed, 5, 1 / 48);
        // Radial falloff turns the map into an island like Worldbox worlds.
        const dx = (x - cx) / maxD;
        const dy = (y - cy) / maxD;
        const d = Math.sqrt(dx * dx + dy * dy);
        e -= Math.max(0, d - 0.55) * 0.9;
        elevation[this.idx(x, y)] = e;
      }
    }

    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = this.idx(x, y);
        const e = elevation[i];
        const m = fbm(x, y, mSeed, 4, 1 / 32);
        let terrain: Terrain;
        if (e < 0.3) terrain = Terrain.DeepWater;
        else if (e < 0.4) terrain = Terrain.Water;
        else if (e < 0.44) terrain = Terrain.Sand;
        else if (e > 0.82) terrain = Terrain.Snow;
        else if (e > 0.72) terrain = Terrain.Rock;
        else terrain = m > 0.55 && e > 0.5 ? Terrain.Forest : Terrain.Grass;
        this.tiles[i] = {
          terrain,
          tree: false,
          berries: 0,
          fish: 0,
          regrowAt: 0,
          hut: false,
          fertile: false,
          fishery: false,
        };
      }
    }

    this.carveRivers(elevation, rng);
    this.placeVegetation(fSeed, rng);
    this.placeFish(rng);
  }

  /** Walk downhill from a few mountain tiles, turning the path into water. */
  private carveRivers(elevation: Float32Array, rng: Rng): void {
    const sources: number[] = [];
    for (let tries = 0; tries < 4000 && sources.length < 5; tries++) {
      const x = 8 + Math.floor(rng() * (this.w - 16));
      const y = 8 + Math.floor(rng() * (this.h - 16));
      if (elevation[this.idx(x, y)] > 0.68) sources.push(this.idx(x, y));
    }
    for (const src of sources) {
      let x = src % this.w;
      let y = Math.floor(src / this.w);
      for (let step = 0; step < 500; step++) {
        const t = this.tiles[this.idx(x, y)];
        if (t.terrain === Terrain.DeepWater || t.terrain === Terrain.Water) {
          break;
        }
        t.terrain = Terrain.Water;
        // Move to the lowest neighbour; nudge elevation down as we go so a
        // river stuck in a dip digs itself out instead of looping forever.
        let bx = x;
        let by = y;
        let best = Infinity;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (!this.inBounds(nx, ny)) continue;
            const ne = elevation[this.idx(nx, ny)] + rng() * 0.02;
            if (ne < best) {
              best = ne;
              bx = nx;
              by = ny;
            }
          }
        }
        elevation[this.idx(x, y)] = best - 0.01;
        if (bx === x && by === y) break;
        // On diagonal steps also wet an orthogonal neighbour so the river
        // reads as a connected line instead of a chain of dots.
        if (bx !== x && by !== y) {
          const side = this.tiles[this.idx(bx, y)];
          if (side.terrain !== Terrain.DeepWater) side.terrain = Terrain.Water;
        }
        x = bx;
        y = by;
      }
    }
  }

  private placeVegetation(fSeed: number, rng: Rng): void {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = this.idx(x, y);
        const t = this.tiles[i];
        if (t.terrain === Terrain.Forest) {
          t.fertile = true;
          if (hash2(x, y, fSeed) < 0.75) t.tree = true;
        } else if (t.terrain === Terrain.Grass) {
          if (hash2(x, y, fSeed + 7) < 0.06) {
            t.fertile = true;
            t.tree = true;
          }
        }
      }
    }
    // Berry bushes grow in small clusters on grass.
    let clusters = 0;
    for (let tries = 0; tries < 6000 && clusters < 26; tries++) {
      const x = Math.floor(rng() * this.w);
      const y = Math.floor(rng() * this.h);
      if (this.tiles[this.idx(x, y)].terrain !== Terrain.Grass) continue;
      clusters++;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (!this.inBounds(nx, ny)) continue;
          const nt = this.tiles[this.idx(nx, ny)];
          if (nt.terrain === Terrain.Grass && !nt.tree && rng() < 0.45) {
            nt.fertile = true;
            nt.berries = 2 + Math.floor(rng() * 2);
          }
        }
      }
    }
  }

  private placeFish(rng: Rng): void {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const t = this.tiles[this.idx(x, y)];
        if (t.terrain !== Terrain.Water) continue;
        // Fish live in shallow water that touches land, so humans can reach it.
        let touchesLand = false;
        for (let dy = -1; dy <= 1 && !touchesLand; dy++) {
          for (let dx = -1; dx <= 1 && !touchesLand; dx++) {
            if (this.isWalkable(x + dx, y + dy)) touchesLand = true;
          }
        }
        if (touchesLand && rng() < 0.35) {
          t.fishery = true;
          t.fish = 1 + Math.floor(rng() * 3);
        }
      }
    }
  }

  // ---- runtime mutation (harvesting + regrowth) ----

  harvestBerries(i: number): boolean {
    const t = this.tiles[i];
    if (t.berries <= 0) return false;
    t.berries--;
    if (t.berries === 0) this.scheduleRegrow(i, REGROW.BERRIES);
    this.markDirty(i);
    return true;
  }

  harvestFish(i: number): boolean {
    const t = this.tiles[i];
    if (t.fish <= 0) return false;
    t.fish--;
    if (t.fish === 0) this.scheduleRegrow(i, REGROW.FISH);
    this.markDirty(i);
    return true;
  }

  chopTree(i: number): boolean {
    const t = this.tiles[i];
    if (!t.tree) return false;
    t.tree = false;
    this.scheduleRegrow(i, REGROW.TREE);
    this.markDirty(i);
    return true;
  }

  buildHut(i: number): void {
    const t = this.tiles[i];
    t.hut = true;
    t.tree = false;
    t.berries = 0;
    this.markDirty(i);
  }

  private scheduleRegrow(i: number, delay: number): void {
    // Stagger regrowth a bit so a stripped patch doesn't pop back all at once.
    this.tiles[i].regrowAt = delay + Math.floor(Math.random() * delay * 0.5);
    this.regrowing.add(i);
  }

  tickRegrowth(): void {
    for (const i of this.regrowing) {
      const t = this.tiles[i];
      if (--t.regrowAt > 0) continue;
      this.regrowing.delete(i);
      t.regrowAt = 0;
      if (t.hut) continue;
      if (t.fishery) t.fish = 2;
      else if (t.terrain === Terrain.Forest && t.fertile) t.tree = true;
      else if (t.fertile) {
        // regrown grass tiles come back as whatever they were: tree or bush
        if (t.berries === 0 && !t.tree) {
          if (hash2(i, 1, this.seed) < 0.5) t.tree = true;
          else t.berries = 2;
        }
      }
      this.markDirty(i);
    }
  }
}
