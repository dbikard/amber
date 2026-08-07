# Amber — Claude Instructions

## Project Overview

**Amber — The Succession**: a mobile-first, competitive, real-time, open-world city-builder
in the browser, deployed on **GitHub Pages**. Inspired by Zelazny's *Chronicles of Amber*.
Build your city, take the springs, break a rival's Seat or walk the Pattern first.
Single-player vs AI heirs; LAN 2-4 via serverless WebRTC + QR pairing (ported from
`../perils/`).

**Vanilla HTML/CSS/JS — no frameworks, no build step.** The one dependency is Three.js,
vendored into the repo (`js/vendor/three.min.js`) and loaded as a plain script tag — no CDN,
no bundler. WebGL is a hard requirement, stated plainly at boot (`js/render_select.js`).

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
js/vendor/three.min.js — Three.js, vendored; loaded first, the renderer's one dependency
js/rng.js       — seeded RNG (headless-safe)
js/const.js     — content tables: BUILDINGS, UNITS, POWERS, CHAOS, HEIRS (headless-safe)
js/worldgen.js  — the land made new each match: noise → terrain → springs/Seats (headless-safe)
js/nav.js       — movement: cost grid + per-(goal, owner) Dijkstra flow fields (headless-safe)
js/world.js     — sim core: createWorld / applyCommand / update(world, dt) (headless-safe)
js/ai.js        — bot policies: personalities + random/greedy baselines (headless-safe)
js/terrain.js   — bakes the painted ground + shared writ-outline helpers (browser)
js/render3d.js  — ALL drawing: Three.js, pitched camera; takes a "view" + viewer (ISOLATED)
js/render_select.js — hands game.js the renderer, or null when the device has no WebGL
js/qrcode.js    — QR encoder (verbatim from perils)
js/net.js       — WebRTC pairing (from perils) + host-authoritative snapshot/command sync
js/record.js    — the chronicle: a pasteable record of a played match (headless-safe)
js/ui.js        — DOM HUD, build sheet, menus, LAN lobby, banners, the Muster Roll
js/game.js      — orchestration: modes, fixed-timestep loop, input routing, MP wiring (last)
sim.js          — Node balance runner: mirror / gradient / round-robin / durations
test/run.js     — the whole suite: test/headless.js (Node) + test/browser.js (Playwright)
```

Script load order = the order above. Headless files use the UMD pattern
`(function(global){...})(typeof window !== 'undefined' ? window : globalThis)` and attach
globals (`RNG`, `CONST`, `WorldGen`, `NAV`, `World`, `AI`) so `sim.js` can `require()` them
in order.

## Sim model

- Fixed timestep `SIM_DT = 1/30`; browser uses an accumulator; `sim.js` steps the same dt.
  Seeded RNG (`world.rng`) — deterministic replays/balance runs (netcode does NOT rely on it).
- Open world: `CONST.MAP` is 2000×2400 and units and works carry real `x`/`y` on it. The land
  is noise, not a template — asymmetric on purpose (a mirrored world tells you where the rival
  stands), with fairness *chosen* by scoring candidate Seat pairs (`js/worldgen.js`). A guest's
  renderer mirrors nothing: its camera simply starts over its own Seat (`js/render3d.js`).
- `world.events` is an append-only queue for the renderer/UI (shots, deaths, rifts, alerts);
  the sim never reads it. Consumers drain it each frame.
- Eleven commands, all validated in `applyCommand(world, playerIdx, cmd)`. None carries a
  slot — a work is named by `id` and ground by `x`/`y`: `{c:'pause',on}`,
  `{c:'build',x,y,bt,co}` (a wall adds `x2,y2`), `{c:'up',id,br}` (`br` read at the fork level
  only), `{c:'fix',id}`, `{c:'flip',id,on}`, `{c:'walk',on}`, `{c:'muster',pause[,co]}`,
  `{c:'rally',co,x,y}`, `{c:'assign',id,co}`, `{c:'banner',x,y}`, `{c:'power',k,x,y}`.
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

A rival's work is seen or it is not: while any part of it is in sight it rides the snapshot
plainly — type, level, hp, scaffolding, breaches — and out of sight it survives only as a
GHOST, the viewer's memory of it. A branch (`br`) and a hall's company never cross the wire
to a rival; essence, income, banner and standards are the owner's alone. Units and storms
exist for a viewer only while seen; castle HP is public; the rival's Seat itself is hidden
until somebody lays eyes on it (`seatSeen`). A started Pattern walk reveals that shrine +
progress. AI reads only what a human could see (see `AI.view()`).

## Development Practices

- **Before believing a measurement, prove the control is alive.** Eight probes in one session
  returned confident, wrong answers because the instrument silently did nothing: bots driven
  with `think` when the API is `step` (a still world read as a stalled game), a `s.holder`
  field that does not exist (read as "no springs held"), a click swallowed by the sheet's
  320ms fat-finger guard (read as "the button is broken"), `en.hp -= 7` asserting subtraction
  rather than the sim, probe attackers dead before their first blow — twice — a render pass
  "disabled" by nulling a field the view rebuilds every frame, and a `grep|head` pipe that
  never flushed a tally. All of them LOOKED like results. The discipline: make the rig show it
  can move before trusting that it did not, write tests that FAIL on the old code, and treat
  "no effect" as "the switch was never thrown" until shown otherwise. A suite run loads its
  files at START — a tally is evidence about the code the process loaded, never about edits
  that landed mid-run.

- **Do not push after every commit.** Batch; push when the user asks.
- Version in `index.html` as `GAME_VERSION` + `?v=X.Y.Z` cache-bust queries on all assets.
  `.githooks/pre-commit` (core.hooksPath) auto-bumps the PATCH version on shipping commits
  and re-stamps index.html + sw.js + manifest.json — this is what triggers installed PWAs
  to auto-update. For minor/major bumps sed all three yourself (hook still +1s patch after).
  Skip with AMBER_NO_BUMP=1. sw.js precaches per-version; update flow lives in game.js setupPWA().
- Balance changes: run `node sim.js` before and after; keep the targets in
  DESIGN_PRINCIPLES.md green. `node sim.js --a=brand --b=julian --n=40` for a matchup.
  The full run is 470 matches (15 matchups x 30 games + 2 convergence series) across
  `os.cpus().length` workers, and the julian mirror runs to the 45-minute cap — call it ten
  minutes on four cores. `--quick` plays every section at a third of the games for iterating;
  the full run is what decides whether to ship.
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
  drives a real page for input, camera, the writ, HUD layering, the back
  button and the LAN guest path. It skips itself cleanly where Playwright is missing.
  Screen positions in tests must come from `Render.project`/`toWorld`, never re-derived —
  a test that reimplements the projection tests itself, not the game.
- Colors: gold=player, crimson=rival, green=Chaos, blue-white=Pattern. Don't drift.
- `render3d.js` stays isolated: game logic never draws; drawing never mutates the world.

## Orders and building

There is no gold banner. Every mustering hall flies a COMPANY standard — `joinCo` never
returns 0, so a hall raised without one raises its own — and the tray is one chip per company.
The `{c:'banner'}` command survives as **the Recall**: one order that strikes every standing
standard and turns the army home. The AI still uses it as its general muster, which is why
removing it outright would mean rewriting every heir's doctrine.
Tapping your own troops arms their company (`Render.hitUnit`, tight 24 reach on purpose).

Building is CHOOSE-THEN-PLACE: the 🔨 BUILD button opens the sheet, a card arms
`game.placing`, and the next tap on the map places it (a wall takes two — anchor, then far
end). Bare ground does nothing. A refusal leaves the work armed so another spot can be tried.
The cards cannot say why a particular spot refuses them any more — the sheet no longer belongs
to one — so they show cost and affordability only.

The mason readout must mirror `World.rising` EXACTLY: a crew is busy when `raise > 0` **or**
`work > 0` (an upgrade or a mend). It once counted only `raise` and cheerfully reported a free
crew that every order then bounced off as 'busy'.

## The opening

Every heir starts with **exactly one spring inside his writ**, **a finished Shadow Gate on
it**, and **a finished mustering hall**. Worldgen enforces the spring (`traits` in
`placeCities` requires one *usable* spring and one inside `CLAIM.seat`) and hands the Gate's
spot out as `gen.homeGates`, so `createWorld` places it rather than re-deriving the search. A
Gate always lands on the spring's exact centre, in `createWorld` and in the build command
alike. Every further spring is beyond the writ and must be TAKEN — troops standing on it —
which is the whole shape of expansion now.

The hall's spot is `openingHall()`: a fixed-order search out from `CITY.seatR`, angles fanning
out from the bearing toward the middle of the board, so it lands between the Seat and the war
and lands in the SAME place on every machine. It flies its own standard (`joinCo` never
returns 0), so the flag tray has a chip in it from the first frame. Without it every match
opened with the same forced first build, chosen by nobody.

Crews are hired **one per Gate** (`MASONS.base` is 0, floored at `MASONS.floor`), so the
opening Gate is the opening mason and nobody starts unable to build — and the floor means an
heir whose last Gate is thrown down can still raise another. Tests that assume
`players[pi].buildings[0]` is the work they just raised are wrong: it is the Gate, and
`buildings[1]` is the hall.

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
recruit), `buildingModel` keys on `bt[:br]@level[+garrison][%hurt]`, and a work with masons in it
wears the same translucent scaffolding a rising one does. **`R.modelKey` is the only place that
key is written**, and the frame's cache key is built from it rather than beside it — the two were
separate expressions once and drifted, so the cache learned the branch and the model did not, and
every branch arm below the Watchtower's was unreachable code.

## The fork — a level and a branch are different axes

A level makes the same man better armed; a **branch** makes him somebody else. Any work carrying
`branches` in `CONST.BUILDINGS` forks at its `fork` level, permanently: the Watchtower into a
Ballista or a Cannon, the Barracks into a Shieldwall / Outriders / Archers, the Spire into the
Warden's Art or the Binding, the Works into a Ram Shed or a Gun Pit. Per-branch arrays are
indexed by `level - fork`.

**Nothing names a building.** `World.branchesOf(bt)`, `forkAt(bt)`, `branchOf(b)` and
`mustersOf(b)` are the four answers, and the price, the `{c:'up'}` command, the sheet, the model
key and the heirs all ask them — this was six hardcoded `bt === 'tower'` tests once, and
generalising it is what let three halls fork for the price of a table entry. `mustersOf` is the
one answer to who a hall raises and how often; `def.spawns` is only ever its level-1 answer now.
`cmd.br` is read at the fork level and nowhere else, which is what makes the choice permanent.
A hall that forks clamps `b.paid` — a part-paid dear recruit becoming a cheap one would hand out
several men at once. `br` never rides the wire to a rival (`net.js`), so a fork stays private.

**Three flags on `CONST.UNITS` decide what a man is for.** `menOnly` — no target among works or
Seats *at all*; `acquire` returns before it looks, so he walks past stone hunting men. Every
shooter has it, which is why no host of archers, sorcerers, wardens and binders can end a match,
and why the AI carries `v.breakers`. `mans` — may hold a berth or a tower place. `siege` — his
blow against stone, multiplied.

## Common Tasks

- **Add a building**: table entry in `const.js` (cost/up/effect) + `BUILD_ORDER_UI` → handle
  in `world.js` (spawn/aura/etc.) → geometry in `render3d.js` `buildingModel` → card
  auto-appears → teach the AI when to want it (`ai.js` plans/upPref, and the `rear` set if it
  is economy rather than a fighting position) → `node sim.js`.
- **Add a unit**: `const.js` `UNITS` stats — *plus `name`/`icon`/`blurb`, which the Muster Roll
  reads* → spawn source in `world.js` → a case in `render3d.js` `unitGeo` → sim. The renderer
  buckets by every key in `UNITS`, so a kind with no geometry silently draws as a FIEND, and a
  kind with no bucket is dropped from the frame entirely — add the case.
- **Add a branch**: `branches` + `branchUI` + `fork` + `forkHint` on the building in
  `const.js` → an arm in `buildingModel` keyed off `br` → a doctrine in each heir's `branch`
  block in `ai.js` (anything unnamed falls to `branchUI[0]`) → `node sim.js`. The sheet card,
  the price, the command and the Muster Roll all follow from the table with no code.
- **Add an heir**: personality entry in `ai.js` HEIRS block (including a `branch` doctrine per
  forking building) + menu entry in `ui.js`.
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
  **Manning is a ROSTER, not a distance — and STONE IS FOR SHOOTERS.** `postWalls` runs once a
  tick, before anything moves: every man whose ORDER (company rally, else banner) is within
  `WALL.man*1.5` of one of his own runs is posted to it. The roster is sorted **shooters first,
  then by id**, and only a unit the table marks `mans` (archer, sorcerer) may take one of the
  `len/WALL.berth` berths — `u.man` is the wall he holds a place on. Everyone else still gets a
  `post` and stations at the FOOT in rows, in cover, which is where a Shieldwall belongs. A
  swordsman on a parapet was only ever a man in the open holding a berth an archer needed. Only
  berthed men shoot over and are exposed. It reads the order rather than `u.goal` because goals
  are assigned in the march loop, which runs after it.
  **A TOWER IS A ROOM, AND THE STONE IS THE SHIELD.** `TOWER.berths` shooters whose order falls
  near one of their own finished towers go INSIDE it, carry `u.tow` (NOT `u.man` — the renderer
  and `station()` read that as "the wall he holds"), and throw `TOWER.over`. While `u.tow` is set
  `hurt()` refuses every blow — guarded there rather than at each place that deals damage, so a
  splash pass added later cannot forget — `acquire` skips him as a target, and the renderer does
  not draw him at all. The only way to the men is to bring the tower down, and `hurtBuilding`
  spills them out **on that tick**, where it stood, with the hp they went in with; a man left
  carrying `tow` for a tower that no longer exists is a man nothing can hurt. The tower's own
  gunnery is unaffected: the garrison shoots as well as the tower. The tower does not change
  shape for it — it wears one shield on its crown per man, keyed into the model as `+n`, and
  since the men are invisible that badge is the *only* sign ten archers are in there.
  **A bastion is part of its run.** A tower with `onWall` is not `postTowers`' business: it is a
  place on that curtain, and `postWalls` deals the roster round the parapet and every tower in
  the run together, so holding a wall fills its bastions too. `postAll` clears `man`/`tow` once
  and runs the two passes in order — they each used to clear `tow` at their own start, so
  whichever ran second wiped the other's answer.
  **A run's sheltered face is a guess the heir may overrule.** `station` faces the owner's Seat,
  which is right for the one curtain across the road home and wrong for a run around a forward
  spring or along a flank. `{c:'flip', id, on}` sets `b.flip` and `station` (and the renderer's
  parapet facing) negate the normal. It asks for a STATE, not a toggle, takes no crew and no
  stone, and may be given while the masons are still on the run.
  **A wall bars its OWNER too, except at his gate** — the middle of the run, `WALL.gate` wide,
  punched out of his nav layer alone. A rival is stopped everywhere including the gateway.
  **A breach is a ruin, but a SHELL is not.** Only a run that actually stood is breached; one
  knocked over while `raise > 0` is razed like any other work — nothing stood, so there is
  nothing to mend, and `fix` for half the stone would have been cheaper than finishing it.
  A work under construction is attackable exactly like a finished one: `acquire` aims at the
  nearest point of a rising RUN (not its midpoint, which put most of a long shell out of
  reach), and the raise ADDS its share of `b.maxHp` rather than setting hp from the card, so
  damage done to a shell stays done and a run bought by the foot finishes on all its stone.
  `b.breach` keeps the record on the board, out of `world.walls`, and
  `{c:'fix'}` puts it back for a crew and half the stone. A mend takes a crew (`b.fixing`); a
  LEVEL does not — see the note on the `up` command. Rubble keeps `WALL.rubble` of its stone so
  a stray blow cannot sweep the record away, does NOT regenerate (masons only), and can be
  knocked down for good to free the ground.
  **A tower does not shoot through stone, not even its own** — build it INTO the run (`onWall`)
  and it shoots over that wall like a man on the parapet; behind the wall it covers the ground
  behind the wall. `clearOfWorks` takes the owner so a tower may stand on its own curtain.
  **The Seat is the exception, and the hardest gun on the board.** `seatFire` is its own pass —
  the Seat is not in `pl.buildings`, it is the city site with its hp in `pl.castleHp`, so its
  cooldown has nowhere to live but `pl.seatCd`. `CONST.SEAT_GUN` is DERIVED from the two
  Watchtower branches at their top level added together (retune a branch, retune the Seat), and
  it alone is **not stopped by stone**: a Watchtower shut in by a curtain can be rebuilt on the
  curtain, the Seat stands where worldgen put it forever, so if stone could shade it the cheapest
  work in the game would switch the throne's guns off from outside their reach.
- **Touch a number**: sim before/after. The referee is `node sim.js`, not vibes.
- **A report from play**: ask for the chronicle. The end screen (and the menu, after an
  abandoned match) copies a whole match — seed, footing, a table every 20s, every order given,
  the moments — as text. `node sim.js` plays bots and cannot see what a human's match felt
  like; the chronicle can. `Rec` reads the sim and never writes to it.
