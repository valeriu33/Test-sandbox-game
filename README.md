# Tiny Society — a Worldbox-inspired society simulation (POC)

A zero-player society simulation in the spirit of Worldbox, minus the god
powers: you just watch. Every human is an individual who gathers berries,
fishes, hunts, chops wood, builds huts, pairs up, has children, grows old and
dies — while a small animal ecosystem (rabbits, deer, wolves) lives alongside
them on a procedurally generated island.

**Live demo:** https://valeriu33.github.io/Test-sandbox-game/

## Features

- **Procedural island worlds** — seeded value-noise elevation & moisture,
  biomes (ocean, shallow water, beach, grass, forest, rock, snow), rivers
  carved downhill from the mountains, berry-bush clusters, forests, and fish
  in shallow water.
- **Individual humans** — hunger, aging (child → adult → elder), a behavior
  loop of gathering, fishing, hunting, wood-chopping and hut building.
  Villages emerge because new huts prefer to be built near existing ones.
- **Reproduction & death** — fed adult couples have children; people die of
  starvation, old age, or wolves.
- **Animal ecosystem** — rabbits and deer graze and breed (with local
  crowding limits), wolves hunt them and, when starving, humans.
- **Sustainable resources** — berries, trees, and fish regrow over time.
- **Mobile-first UI** — drag to pan, pinch (or mouse-wheel) to zoom, big
  touch controls for pause/1×/4×/16× speed, live stats bar, and a 🌍 button
  to generate a fresh world. Append `?seed=12345` to the URL to replay a
  specific world.

## Development

```bash
npm install
npm run dev      # local dev server
npm run build    # typecheck + production build into dist/
```

No runtime dependencies — plain TypeScript + HTML5 Canvas, bundled with Vite.

## Deployment

Pushes to `main` (and the POC branch) trigger `.github/workflows/deploy.yml`,
which builds the app and deploys it to GitHub Pages. One-time setup: in the
repo settings, set **Settings → Pages → Source** to **GitHub Actions**.
