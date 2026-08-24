import { HUMAN, TICK_MS } from './config';
import { Renderer } from './render';
import { Sim, type Animal, type Human } from './sim';
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
renderer.attachInput((wx, wy) => selectAt(wx, wy));

// ---- UI ----

const topbar = document.getElementById('topbar')!;
const statEls = new Map<string, HTMLElement>();
for (const key of ['year', 'pop', 'births', 'deaths', 'huts', 'village', 'wild']) {
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
  statEls.get('village')!.innerHTML =
    `🛖 <b>${s.villages}</b> <span style="opacity:.7">📦 ${s.stored}</span>`;
  statEls.get('wild')!.innerHTML =
    `🐇 <b>${s.rabbits}</b> 🦌 <b>${s.deer}</b> 🐺 <b>${s.wolves}</b>`;
}

// ---- entity inspector ----

type Selection = { type: 'human' | 'animal'; id: number } | null;
let selection: Selection = null;

const inspector = document.getElementById('inspector')!;
const inspTitle = document.getElementById('insp-title')!;
const inspSub = document.getElementById('insp-sub')!;
const inspRows = document.getElementById('insp-rows')!;
document.getElementById('insp-close')!.addEventListener('click', () => {
  selection = null;
  inspector.classList.remove('open');
});

function selectAt(wx: number, wy: number): void {
  // pick whatever is closest to the tap, with a generous touch radius
  const maxD = Math.max(0.8, 14 / renderer.zoom);
  let best: Selection = null;
  let bestD = maxD * maxD;
  for (const h of sim.humans) {
    const d = (h.x - wx) ** 2 + (h.y - wy) ** 2;
    if (d < bestD) {
      bestD = d;
      best = { type: 'human', id: h.id };
    }
  }
  for (const a of sim.animals) {
    const d = (a.x - wx) ** 2 + (a.y - wy) ** 2;
    if (d < bestD) {
      bestD = d;
      best = { type: 'animal', id: a.id };
    }
  }
  selection = best;
  inspector.classList.toggle('open', !!selection);
  if (selection) updateInspector();
}

function selectedEntity(): Human | Animal | null {
  if (!selection) return null;
  return selection.type === 'human'
    ? (sim.humans.find((h) => h.id === selection!.id) ?? null)
    : (sim.animals.find((a) => a.id === selection!.id) ?? null);
}

function row(label: string, value: string): string {
  return `<div>${label}</div><div style="text-align:right">${value}</div>`;
}

function hungerBar(hunger: number): string {
  const pct = Math.min(100, Math.max(0, hunger)).toFixed(0);
  const color = hunger > 75 ? '#d14b4b' : hunger > 45 ? '#d9a54a' : '#5fae6b';
  return `<div class="bar"><i style="width:${pct}%;background:${color}"></i></div>`;
}

function updateInspector(): void {
  const e = selectedEntity();
  if (!e) {
    if (selection) {
      selection = null;
      inspector.classList.remove('open');
      showToast('💀 They are gone…');
    }
    return;
  }
  if ('sex' in e) {
    const h = e;
    const stage = h.age < HUMAN.ADULT_AGE ? 'child' : h.age >= HUMAN.ELDER_AGE ? 'elder' : 'adult';
    inspTitle.textContent = `${h.sex === 'm' ? '👨' : '👩'} ${h.name}`;
    inspSub.textContent = `${stage}, ${Math.floor(h.age)} y`;
    const kids =
      h.sex === 'f' ? sim.humans.filter((k) => k.motherId === h.id).length : -1;
    const village = sim.villageOf(h);
    inspRows.innerHTML =
      row('Doing', h.activity) +
      row('Home', h.homeId >= 0 ? 'has a hut 🏠' : 'homeless') +
      row(
        'Village',
        village ? `${village.name} (${village.memberCount})` : 'no village',
      ) +
      (village
        ? row('Granary', `🍖 ${Math.round(village.food)} · 🪵 ${village.wood}`)
        : '') +
      row('Carrying', `🍖 ${h.food} food, 🪵 ${h.wood} wood`) +
      (kids >= 0 ? row('Children', String(kids)) : '') +
      row('Hunger', `${h.hunger.toFixed(0)} / 100`) +
      hungerBar(h.hunger);
  } else {
    const a = e;
    const icon = a.kind === 'rabbit' ? '🐇' : a.kind === 'deer' ? '🦌' : '🐺';
    let doing = 'wandering around';
    if (a.kind === 'wolf') {
      if (a.huntId >= 0) doing = 'hunting prey 🎯';
      else if (a.huntHumanId >= 0) doing = 'stalking a human ⚠️';
      else if (a.hunger > 80) doing = 'starving, desperate';
    } else if (a.fleeing) {
      doing = 'fleeing a wolf 💨';
    } else if (a.hunger > 20) {
      doing = 'grazing 🌿';
    }
    inspTitle.textContent = `${icon} ${a.kind}`;
    inspSub.textContent = `${Math.floor(a.age)} y old`;
    inspRows.innerHTML =
      row('Doing', doing) +
      row('Hunger', `${a.hunger.toFixed(0)} / 100`) +
      hungerBar(a.hunger);
  }
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
  selection = null;
  inspector.classList.remove('open');
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

  renderer.render(sim, selectedEntity());

  statTimer += dt;
  if (statTimer > 250) {
    statTimer = 0;
    updateStats();
    if (selection) updateInspector();
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
