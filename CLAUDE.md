# Amber — Claude Instructions

## Project Overview

**Amber — The Succession**: a mobile-first, competitive, real-time, lane-based city-builder
in the browser, deployed on **GitHub Pages**. Inspired by Zelazny's *Chronicles of Amber*.
Build your city, defend the black road, break the rival's castle or walk the Pattern first.
Single-player vs AI heirs; LAN 1v1 via serverless WebRTC + QR pairing (ported from
`../perils/`).

**Vanilla HTML/CSS/JS + Canvas 2D — no frameworks, no build step, no dependencies.**

## Key Documents

- **GAME_VISION.md** — concept, board, buildings/units/powers, AI heirs, fog, art direction.
- **DESIGN_PRINCIPLES.md** — pillars + the sim-based balance methodology.
- **TODO.md** — phases and current state.

## Architecture — headless-first (non-negotiable)

The entire game simulation runs in Node with no DOM/Canvas references. The browser is just
render + input + net on top. The AI and `sim.js` depend on this.

```
index.html      — entry, canvas, DOM overlays, GAME_VERSION, script order
styles.css      — HUD/menus (dark + gold, painterly-fantasy theme)
js/rng.js       — seeded RNG (headless-safe)
js/const.js     — content tables: BUILDINGS, UNITS, POWERS, CHAOS, HEIRS (headless-safe)
js/world.js     — sim core: createWorld / applyCommand / update(world, dt) (headless-safe)
js/ai.js        — bot policies: personalities + random/greedy baselines (headless-safe)
js/sprites.js   — procedural painterly sprites pre-rendered to offscreen canvases (browser)
js/render.js    — all canvas drawing; takes a "view" object + viewer index (browser, ISOLATED)
js/qrcode.js    — QR encoder (verbatim from perils)
js/net.js       — WebRTC pairing (from perils) + host-authoritative snapshot/command sync
js/ui.js        — DOM HUD, build sheet, menus, LAN lobby, banners
js/game.js      — orchestration: modes, fixed-timestep loop, input routing, MP wiring (last)
sim.js          — Node balance runner: mirror / gradient / round-robin / durations
```

Script load order = the order above. Headless files use the UMD pattern
`(function(global){...})(typeof window !== 'undefined' ? window : globalThis)` and attach
globals (`RNG`, `CONST`, `World`, `AI`) so `sim.js` can `require()` them in order.

## Sim model

- Fixed timestep `SIM_DT = 1/30`; browser uses an accumulator; `sim.js` steps the same dt.
  Seeded RNG (`world.rng`) — deterministic replays/balance runs (netcode does NOT rely on it).
- Lane coordinate `p ∈ [0,1000]`: player 0 castle at p=0 (rendered bottom), player 1 at
  p=1000. Units also carry a small lateral `x` for visuals. Guest's renderer flips the view.
- `world.events` is an append-only queue for the renderer/UI (shots, deaths, rifts, alerts);
  the sim never reads it. Consumers drain it each frame.
- Commands: `{c:'build',slot,bt}`, `{c:'up',slot}`, `{c:'walk',on}`,
  `{c:'power',k,p}` — all validated in `applyCommand(world, playerIdx, cmd)`.

## Multiplayer model (differs from perils!)

Perils = deterministic lockstep (co-op). Amber = **host-authoritative**: competitive play
needs fog of war and must not trust cross-browser determinism.
- Pairing (QR/SDP/wake-lock/diag) ported from perils `js/net.js` — do not reinvent it.
- Host simulates everything; guest sends commands, receives fog-filtered snapshots ~10 Hz
  (`Net.snapFor(world, viewerIdx)`), interpolates unit positions between the last two snaps.
- Host = player 0 (Corwin), guest = player 1 (Eric).

## Fog rules (enforced at snapshot/render, respected by AI)

Rival slot *occupancy* is public, building *type/level* is veiled. Road units, castle HP,
storms: public. A started Pattern walk reveals that shrine + progress. AI reads only what a
human could see (see `AI.view()`).

## Development Practices

- **Do not push after every commit.** Batch; push when the user asks.
- Version in `index.html` as `GAME_VERSION` + `?v=X.Y.Z` cache-bust queries on all assets.
  `.githooks/pre-commit` (core.hooksPath) auto-bumps the PATCH version on shipping commits
  and re-stamps index.html + sw.js + manifest.json — this is what triggers installed PWAs
  to auto-update. For minor/major bumps sed all three yourself (hook still +1s patch after).
  Skip with AMBER_NO_BUMP=1. sw.js precaches per-version; update flow lives in game.js setupPWA().
- Balance changes: run `node sim.js` before and after; keep the targets in
  DESIGN_PRINCIPLES.md green. `node sim.js --a=brand --b=julian --n=40` for a matchup.
- Colors: gold=player, crimson=rival, green=Chaos, blue-white=Pattern. Don't drift.
- `render.js` stays isolated: game logic never draws; drawing never mutates the world.

## Common Tasks

- **Add a building**: table entry in `const.js` (cost/up/effect) → handle in `world.js`
  (spawn/aura/etc.) → sprite in `sprites.js` → card auto-appears in the build sheet →
  teach the AI when to want it (`ai.js` desired-counts) → `node sim.js`.
- **Add a unit**: `const.js` stats → spawn source in `world.js` → sprite → sim.
- **Add an heir**: personality entry in `ai.js` HEIRS block + menu entry in `ui.js`.
- **Touch a number**: sim before/after. The referee is `node sim.js`, not vibes.
