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
js/terrain.js   — bakes the painted ground + shared writ-outline helpers (browser)
js/render3d.js  — ALL drawing: Three.js, pitched camera; takes a "view" + viewer (ISOLATED)
js/render_select.js — hands game.js the renderer, or null when the device has no WebGL
js/qrcode.js    — QR encoder (verbatim from perils)
js/net.js       — WebRTC pairing (from perils) + host-authoritative snapshot/command sync
js/record.js    — the chronicle: a pasteable record of a played match (headless-safe)
js/ui.js        — DOM HUD, build sheet, menus, LAN lobby, banners
js/game.js      — orchestration: modes, fixed-timestep loop, input routing, MP wiring (last)
sim.js          — Node balance runner: mirror / gradient / round-robin / durations
test/run.js     — the whole suite: test/headless.js (Node) + test/browser.js (Playwright)
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
- **The halt** is world state (`world.paused = {by, at}`), not a session flag, so it is
  host-authoritative and rides the snapshot to every seat. `update()` returns early and
  `applyCommand` refuses everything but `{c:'pause',on}` — a pause you can build through is a
  planning phase, and in a duel it buys thinking time the other heir does not get. Anyone at
  the table may call one and anyone may lift it. The command asks for a STATE, not a toggle,
  so two people tapping at once cannot cancel each other out. game.js zeroes the accumulator
  while halted: banked time would fast-forward the match on resume.

## Players

2-4. `World.createWorld(seed, n)` and `WorldGen.build(seed, RNG, n)` take the count; two is a
duel and behaves as it always did. Chaos is `CONST.CHAOS_ID = -1`, NOT a player index. In a
free-for-all a toppled Seat eliminates that heir (`pl.out`) and the last standing wins; in a
duel the first fall still ends it. You are always `SEAT_TINT[0]` (gold); rivals take the rest
in seat order with the viewer removed from the line.

## Multiplayer model (differs from perils!)

Perils = deterministic lockstep (co-op). Amber = **host-authoritative**: competitive play
needs fog of war and must not trust cross-browser determinism.
- Pairing (QR/SDP/wake-lock/diag) ported from perils `js/net.js` — do not reinvent it.
- A STAR: the host holds one peer per guest (`Net.peers`, up to 3), each paired by the same
  QR offer/answer. Host simulates everything and sends each guest its OWN fog-filtered
  snapshot (`Net.snapFor(world, seat)`); commands carry the sender's seat. The host hands out
  seed, player count and seat in the start message — a guest never guesses its own index.
- Host = seat 0. A guest may hold ANY other seat, so never hardcode 1.

## Fog rules (enforced at snapshot/render, respected by AI)

A WALK IS PUBLIC: while an heir walks the Pattern their Shrine and `VISION.pattern` of
ground around it are a vision source for everyone (see `visionSources`), and every walker's
progress is on the top-right board. `World.walkers(world)` is the one answer to who is
walking, where, and how far along.

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
- The suite prints its slowest suites when a run is slow — start there rather than bisecting
  by hand. Most browser-suite time is FRAME time, so renderer performance and test speed are
  the same problem. Wait on a condition (`until`) rather than a fixed sleep.
- There is ONE renderer. A second, Pixi-based one was kept for years as a "fallback for
  devices without WebGL"; Pixi has been WebGL-only since v7, so it was never a fallback and
  died on a black screen when it was called on. WebGL is now a stated requirement, said
  plainly at boot. `runRenderer` still buffers its own rows/timings, which is what a second
  renderer or viewport size would need to run alongside.
- **Run `node test/run.js` before you push.** `test/headless.js` covers worldgen, movement,
  the placement rules, the command grammar and the snapshot contract; `test/browser.js`
  drives a real page (both renderers) for input, camera, the writ, HUD layering, the back
  button and the LAN guest path. It skips itself cleanly where Playwright is missing.
  Screen positions in tests must come from `Render.project`/`toWorld`, never re-derived —
  a test that reimplements the projection tests itself, not the game.
- Colors: gold=player, crimson=rival, green=Chaos, blue-white=Pattern. Don't drift.
- `render3d.js` stays isolated: game logic never draws; drawing never mutates the world.

## The opening

Every heir starts with **exactly one spring inside his writ** and **a finished Shadow Gate on
it**. Worldgen enforces both (`traits` in `placeCities` requires one *usable* spring and one
inside `CLAIM.seat`) and hands the Gate's spot out as `gen.homeGates`, so `createWorld` places
it rather than re-deriving the search. Every further spring is beyond the writ and must be
TAKEN — troops standing on it — which is the whole shape of expansion now.

Crews are hired **one per Gate** (`MASONS.base` is 0), so the opening Gate is the opening
mason and nobody starts unable to build. Tests that assume `players[pi].buildings[0]` is the
work they just raised are wrong: it is the Gate.

## Veterancy and the masons

A hall's LEVEL makes better men, not more of them. `period` is flat across levels; `CONST.TIER`
(`[1, 1.25, 1.6]` — the old rate ratios exactly) multiplies the recruit's hp, damage, price and
bounty, and the man carries `u.tier` for life. Because the multiplier is on the price too, the
essence buys the same total hit points and damage per minute the throughput upgrade bought, at
the same drain: what changed is the packaging, and the gain is that a veteran column is harder
to storm and harder to splash.

An upgrade is MASONRY. `{c:'up'}` sets `b.work`/`b.workFor` (`raise * CONST.UP_WORK`), takes a
mason crew (`rising()` counts `work > 0` as well as `raise > 0`), and while it runs the work
does its JOB for nobody — no muster, no tower shot, no Gate income — while still standing,
blocking, seeing and holding its spring. Both `tier` and `work` ride the wire.

Rank and level must be VISIBLE or the whole change is a number in a tooltip. The army's
instanced meshes are bucketed `kind#tier` (a rank without a bucket silently draws as a
recruit), `buildingModel` keys on `bt[:br]@level`, and a work with masons in it wears the same
translucent scaffolding a rising one does.

## Common Tasks

- **Add a building**: table entry in `const.js` (cost/up/effect) + `BUILD_ORDER_UI` → handle
  in `world.js` (spawn/aura/etc.) → geometry in `render3d.js` `buildingModel` → card
  auto-appears → teach the AI when to want it (`ai.js` plans/upPref, and the `rear` set if it
  is economy rather than a fighting position) → `node sim.js`.
- **Add a unit**: `const.js` `UNITS` stats → spawn source in `world.js` → a case in
  `render3d.js` `unitGeo` → sim. The renderer buckets by every key in `UNITS`, so a kind with
  no geometry silently draws as a soldier — add the case.
- **Add an heir**: personality entry in `ai.js` HEIRS block + menu entry in `ui.js`.
- **A work with a LENGTH** (only the Curtain Wall today): `span:[min]` in the table makes it a
  two-tap placement. It is stored by its MIDPOINT with `x2`/`y2` as the far end, so every
  point-shaped consumer — fog, minimap, ghosts, the snapshot — keeps working; anything that
  needs the run uses `World.wallEnds` / the `segD2` family. `placementError` only judges the
  first tap; `World.wallError` judges the run. `world.walls` is the standing list, rebuilt by
  `noteWalls` whenever one rises or falls, and `world.anyWall` is what keeps a match without
  walls from paying for the crossing tests at all.
  **There is no longest run** — only how many mason CREWS you can put on one. `WALL.unit` is
  the length one crew covers, so a run's crews, cost, hit points and upgrade price all
  multiply together (`b.crews`), `rising()` counts crews rather than works, and
  `World.wallReach` is the longest run a heir could start right now. A run past it is
  `'crews'`, which is a different refusal from `'busy'` and has a different fix.
  **Manning is a ROSTER, not a distance.** `postWalls` runs once a tick, before anything moves:
  every man whose ORDER (company rally, else banner) is within `WALL.man*1.5` of one of his own
  runs is posted to it, ranked by id, and the first `len/WALL.berth` take the parapet — `u.man`
  is the wall he holds a place on and the rest wait at the FOOT in rows. Only berthed men shoot
  over and are exposed. It reads the order rather than `u.goal` because goals are assigned in
  the march loop, which runs after it.
  **A wall bars its OWNER too, except at his gate** — the middle of the run, `WALL.gate` wide,
  punched out of his nav layer alone. A rival is stopped everywhere including the gateway.
  **A breach is a ruin**: `b.breach` keeps the record on the board, out of `world.walls`, and
  `{c:'fix'}` puts it back for a crew and half the stone. A mend takes a crew (`b.fixing`); a
  LEVEL does not — see the note on the `up` command. Rubble keeps `WALL.rubble` of its stone so
  a stray blow cannot sweep the record away, does NOT regenerate (masons only), and can be
  knocked down for good to free the ground.
  **A tower does not shoot through stone, not even its own** — build it INTO the run (`onWall`)
  and it shoots over that wall like a man on the parapet; behind the wall it covers the ground
  behind the wall. `clearOfWorks` takes the owner so a tower may stand on its own curtain.
- **Touch a number**: sim before/after. The referee is `node sim.js`, not vibes.
- **A report from play**: ask for the chronicle. The end screen (and the menu, after an
  abandoned match) copies a whole match — seed, footing, a table every 20s, every order given,
  the moments — as text. `node sim.js` plays bots and cannot see what a human's match felt
  like; the chronicle can. `Rec` reads the sim and never writes to it.
