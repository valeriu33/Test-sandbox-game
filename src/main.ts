import { TICK_MS } from './config';
import { Renderer } from './render';
import { Sim } from './sim';
import { World } from './world';

function newSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}

const canvas = document.getElementById('view') as HTMLCanvasElement;

const params = new URLSearchParams(location.search);
let seed = params.has('seed') ? Number(params.get('seed')) >>> 0 : newSeed();

let world = new World(seed);
let sim = new Sim(world);
const renderer = new Renderer(world, canvas);
renderer.attachInput();

// ---- UI ----

const topbar = document.getElementById('topbar')!;
const statEls = new Map<string, HTMLElement>();
for (const key of ['year', 'pop', 'births', 'deaths', 'huts', 'wild']) {
  const el = document.createElement('div');
  el.className = 'stat';
  topbar.appendChild(el);
  statEls.set(key, el);
}

function updateStats(): void {
  const s = sim.stats();
  statEls.get('year')!.innerHTML = `📅 year <b>${s.year}</b>`;
  statEls.get('pop')!.innerHTML =
    `🧑 <b>${s.population}</b> <span style="opacity:.7">(${s.children} kids)</span>`;
  statEls.get('births')!.innerHTML = `👶 <b>${s.births}</b>`;
  statEls.get('deaths')!.innerHTML = `💀 <b>${s.deaths}</b>`;
  statEls.get('huts')!.innerHTML = `🏠 <b>${s.huts}</b>`;
  statEls.get('wild')!.innerHTML =
    `🐇 <b>${s.rabbits}</b> 🦌 <b>${s.deer}</b> 🐺 <b>${s.wolves}</b>`;
}

let speed = 1;
const speedButtons = new Map<number, HTMLButtonElement>();
for (const v of [0, 1, 4, 16]) {
  const btn = document.getElementById(`speed-${v}`) as HTMLButtonElement;
  speedButtons.set(v, btn);
  btn.addEventListener('click', () => {
    speed = v;
    for (const [val, b] of speedButtons) b.classList.toggle('active', val === speed);
  });
}

const toast = document.getElementById('toast')!;
let toastTimer = 0;
function showToast(msg: string): void {
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.style.opacity = '0'), 2600);
}

document.getElementById('newworld')!.addEventListener('click', () => {
  seed = newSeed();
  world = new World(seed);
  sim = new Sim(world);
  renderer.setWorld(world);
  showToast(`New world generated (seed ${seed})`);
});

// ---- main loop ----

let last = performance.now();
let acc = 0;
let statTimer = 0;

function frame(now: number): void {
  const dt = Math.min(now - last, 250); // don't fast-forward after a background tab
  last = now;
  acc += dt * speed;
  let steps = 0;
  while (acc >= TICK_MS && steps < 40) {
    sim.tick();
    acc -= TICK_MS;
    steps++;
  }
  if (steps === 40) acc = 0;

  renderer.render(sim);

  statTimer += dt;
  if (statTimer > 250) {
    statTimer = 0;
    updateStats();
  }
  requestAnimationFrame(frame);
}

// debug/testing hook
Object.assign(window as never, {
  __game: { sim: () => sim, renderer, world: () => world },
});

updateStats();
showToast('Watch the little society grow 🌱 Drag to pan, pinch to zoom');
requestAnimationFrame(frame);
