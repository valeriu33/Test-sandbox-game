import { TILE_PX } from './config';
import { hash2 } from './rng';
import type { Sim } from './sim';
import { Terrain, World } from './world';

const TERRAIN_COLORS: Record<Terrain, [number, number, number]> = {
  [Terrain.DeepWater]: [18, 55, 96],
  [Terrain.Water]: [42, 111, 158],
  [Terrain.Sand]: [217, 201, 138],
  [Terrain.Grass]: [97, 161, 78],
  [Terrain.Forest]: [74, 131, 64],
  [Terrain.Rock]: [134, 134, 138],
  [Terrain.Snow]: [232, 238, 242],
};

export class Renderer {
  private world: World;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private terrainLayer: HTMLCanvasElement;
  private resourceLayer: HTMLCanvasElement;

  // camera: world-tile coords at the center of the screen + pixels per tile
  cx: number;
  cy: number;
  zoom = 6;

  constructor(world: World, canvas: HTMLCanvasElement) {
    this.world = world;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.terrainLayer = document.createElement('canvas');
    this.resourceLayer = document.createElement('canvas');
    this.cx = world.w / 2;
    this.cy = world.h / 2;
    this.rebuildLayers();
    this.fitToScreen();
  }

  setWorld(world: World): void {
    this.world = world;
    this.cx = world.w / 2;
    this.cy = world.h / 2;
    this.rebuildLayers();
    this.fitToScreen();
  }

  private rebuildLayers(): void {
    const w = this.world;
    this.terrainLayer.width = w.w * TILE_PX;
    this.terrainLayer.height = w.h * TILE_PX;
    this.resourceLayer.width = w.w * TILE_PX;
    this.resourceLayer.height = w.h * TILE_PX;
    const tctx = this.terrainLayer.getContext('2d')!;
    for (let y = 0; y < w.h; y++) {
      for (let x = 0; x < w.w; x++) {
        this.paintTerrainTile(tctx, x, y);
      }
    }
    const rctx = this.resourceLayer.getContext('2d')!;
    rctx.clearRect(0, 0, this.resourceLayer.width, this.resourceLayer.height);
    for (let i = 0; i < w.tiles.length; i++) this.paintResourceTile(rctx, i);
  }

  fitToScreen(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.zoom = Math.max(
      2,
      Math.min(rect.width / this.world.w, rect.height / this.world.h) * 0.98,
    );
  }

  private paintTerrainTile(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const t = this.world.tiles[this.world.idx(x, y)];
    const [r, g, b] = TERRAIN_COLORS[t.terrain];
    // subtle deterministic per-tile shading so large areas don't look flat
    const v = (hash2(x, y, this.world.seed + 99) - 0.5) * 18;
    ctx.fillStyle = `rgb(${r + v | 0},${g + v | 0},${b + v | 0})`;
    ctx.fillRect(x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX);
  }

  private paintResourceTile(ctx: CanvasRenderingContext2D, i: number): void {
    const w = this.world;
    const t = w.tiles[i];
    const x = (i % w.w) * TILE_PX;
    const y = Math.floor(i / w.w) * TILE_PX;
    ctx.clearRect(x, y, TILE_PX, TILE_PX);
    const c = TILE_PX / 2;

    if (t.hut) {
      ctx.fillStyle = '#7a5230';
      ctx.fillRect(x + 1, y + 3, TILE_PX - 2, TILE_PX - 4);
      ctx.fillStyle = '#54371e';
      ctx.beginPath();
      ctx.moveTo(x + 0.5, y + 3.5);
      ctx.lineTo(x + c, y + 0.5);
      ctx.lineTo(x + TILE_PX - 0.5, y + 3.5);
      ctx.closePath();
      ctx.fill();
      return;
    }
    if (t.tree) {
      ctx.fillStyle = '#5d4025';
      ctx.fillRect(x + c - 0.5, y + c, 1.4, c - 1);
      ctx.fillStyle = '#2f6b33';
      ctx.beginPath();
      ctx.arc(x + c, y + c - 1, TILE_PX * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3f8a42';
      ctx.beginPath();
      ctx.arc(x + c - 1, y + c - 2, TILE_PX * 0.2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (t.berries > 0) {
      ctx.fillStyle = '#3a7a35';
      ctx.beginPath();
      ctx.arc(x + c, y + c, TILE_PX * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#d1394a';
      for (const [ox, oy] of [[-1.4, 0.2], [1.2, -0.6], [0, 1.2]]) {
        ctx.beginPath();
        ctx.arc(x + c + ox, y + c + oy, 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    if (t.fish > 0) {
      ctx.fillStyle = 'rgba(214, 233, 245, 0.85)';
      ctx.beginPath();
      ctx.ellipse(x + c - 1.2, y + c, 1.5, 0.8, 0.4, 0, Math.PI * 2);
      ctx.ellipse(x + c + 1.5, y + c + 1.2, 1.2, 0.6, -0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Repaint tiles whose resources changed since last frame. */
  private drainDirty(): void {
    if (this.world.dirty.length === 0) return;
    const rctx = this.resourceLayer.getContext('2d')!;
    for (const i of this.world.dirty) this.paintResourceTile(rctx, i);
    this.world.dirty = [];
  }

  /** Convert a screen (CSS px) position to world tile coordinates. */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: this.cx + (sx - rect.left - rect.width / 2) / this.zoom,
      y: this.cy + (sy - rect.top - rect.height / 2) / this.zoom,
    };
  }

  render(sim: Sim, selected?: { x: number; y: number } | null): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const pw = Math.round(rect.width * dpr);
    const ph = Math.round(rect.height * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.drainDirty();
    this.clampCamera(rect.width, rect.height);

    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#08243a';
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.imageSmoothingEnabled = this.zoom < TILE_PX;

    const scale = this.zoom / TILE_PX;
    const ox = rect.width / 2 - this.cx * this.zoom;
    const oy = rect.height / 2 - this.cy * this.zoom;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
    ctx.drawImage(this.terrainLayer, 0, 0);
    ctx.drawImage(this.resourceLayer, 0, 0);

    // Entities are drawn in world-tile space.
    ctx.setTransform(dpr * this.zoom, 0, 0, dpr * this.zoom, dpr * ox, dpr * oy);
    const px = 1 / this.zoom; // one screen pixel in tile units
    const minR = 1.6 * px;

    for (const a of sim.animals) {
      let color = '#e9e2cf';
      let r = 0.17;
      if (a.kind === 'deer') {
        color = '#a4713d';
        r = 0.23;
      } else if (a.kind === 'wolf') {
        color = '#4d545e';
        r = 0.24;
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(a.x, a.y, Math.max(r, minR), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.lineWidth = Math.max(0.05, px);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    for (const h of sim.humans) {
      const adult = h.age >= 14;
      ctx.fillStyle = h.sex === 'm' ? '#3f7fd1' : '#d16fae';
      ctx.beginPath();
      ctx.arc(h.x, h.y, Math.max(adult ? 0.26 : 0.17, minR), 0, Math.PI * 2);
      ctx.fill();
      if (this.zoom > 8) ctx.stroke();
    }

    if (selected) {
      const pulse = 0.55 + 0.12 * Math.sin(performance.now() / 220);
      ctx.strokeStyle = '#ffe08a';
      ctx.lineWidth = Math.max(0.08, 1.5 * px);
      ctx.beginPath();
      ctx.arc(selected.x, selected.y, Math.max(pulse, 5 * px), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private clampCamera(vw: number, vh: number): void {
    this.zoom = Math.min(48, Math.max(2, this.zoom));
    const halfW = vw / 2 / this.zoom;
    const halfH = vh / 2 / this.zoom;
    const pad = 6;
    this.cx = Math.min(this.world.w + pad - halfW, Math.max(halfW - pad, this.cx));
    this.cy = Math.min(this.world.h + pad - halfH, Math.max(halfH - pad, this.cy));
    if (vw / this.zoom > this.world.w + pad * 2) this.cx = this.world.w / 2;
    if (vh / this.zoom > this.world.h + pad * 2) this.cy = this.world.h / 2;
  }

  /**
   * Attach touch (pan/pinch) and mouse (drag/wheel) camera controls.
   * A short single-pointer press without movement fires onTap with the
   * tapped world position.
   */
  attachInput(onTap?: (wx: number, wy: number) => void): void {
    const el = this.canvas;
    const pointers = new Map<number, { x: number; y: number }>();
    let lastPinchDist = 0;
    let gesturePointers = 0; // max simultaneous pointers in this gesture
    let downAt = 0;
    let downX = 0;
    let downY = 0;
    let moved = 0;

    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      gesturePointers = Math.max(gesturePointers, pointers.size);
      if (pointers.size === 1) {
        downAt = performance.now();
        downX = e.clientX;
        downY = e.clientY;
        moved = 0;
      }
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        lastPinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    el.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      if (pointers.size === 1) {
        this.cx -= (e.clientX - prev.x) / this.zoom;
        this.cy -= (e.clientY - prev.y) / this.zoom;
        moved = Math.max(moved, Math.hypot(e.clientX - downX, e.clientY - downY));
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastPinchDist > 0) {
          this.zoomAround(
            (a.x + b.x) / 2,
            (a.y + b.y) / 2,
            dist / lastPinchDist,
          );
        }
        lastPinchDist = dist;
      }
    });
    el.addEventListener('pointerup', (e) => {
      pointers.delete(e.pointerId);
      lastPinchDist = 0;
      if (pointers.size === 0) {
        const isTap =
          gesturePointers === 1 &&
          moved < 8 &&
          performance.now() - downAt < 450;
        gesturePointers = 0;
        if (isTap && onTap) {
          const p = this.screenToWorld(e.clientX, e.clientY);
          onTap(p.x, p.y);
        }
      }
    });
    el.addEventListener('pointercancel', (e) => {
      pointers.delete(e.pointerId);
      lastPinchDist = 0;
      if (pointers.size === 0) gesturePointers = 0;
    });

    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoomAround(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
      },
      { passive: false },
    );
  }

  private zoomAround(sx: number, sy: number, factor: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const wx = this.cx + (sx - rect.width / 2) / this.zoom;
    const wy = this.cy + (sy - rect.height / 2) / this.zoom;
    this.zoom = Math.min(48, Math.max(2, this.zoom * factor));
    this.cx = wx - (sx - rect.width / 2) / this.zoom;
    this.cy = wy - (sy - rect.height / 2) / this.zoom;
  }
}
