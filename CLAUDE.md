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
- **REALM_PLAN.md** — the RECORD of the fourth mode's two lives: the region-graph realm it
  describes shipped and was then superseded by the Reach War (one continuous land, cities with
  a reach), which kept its structure-independent parts. Read for the staging discipline.
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
js/ai.js        — bot policies: personalities + random/greedy/marcher/lord baselines. A lord's
                  `step` takes his liege's standing ORDER as a parameter (headless-safe)
js/terrain.js   — bakes the painted ground + shared writ-outline helpers (browser)
js/render3d.js  — ALL drawing: Three.js, pitched camera; takes a "view" + viewer (ISOLATED)
js/render_select.js — hands game.js the renderer, or null when the device has no WebGL
js/qrcode.js    — QR encoder (verbatim from perils)
js/net.js       — WebRTC pairing (from perils) + host-authoritative snapshot/command sync
js/record.js    — the chronicle: a pasteable record of a played match (headless-safe)
js/campaign.js  — the chapters: boards, briefings, objectives, progress (headless-safe)
js/realm.js     — the Reach War: create the one-world war, the run shape, the pocket save (headless-safe)
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
duel the first fall still ends it. You are always gold; rivals take the rest in seat order with
the viewer removed from the line (`SEAT_TINT`) — except in a war, where colour is by BANNER and
not by seat (`REALM_TINT`; see "The map says whose"). `Render.tintOf` is the one answer to
"whose colour is this" and the HUD asks it rather than keeping a palette of its own.

**A MATCH CARRIES ITS RULES, AND `World.foe` IS THE ONLY SPELLING OF "MAY I STRIKE THIS".**
`CONST.RULES` is the table of the few rules a MODE may change (`endOnSeat`, `occupy`, `truce`),
`createWorld(seed, players, spec, rules)` COPIES it onto `world.rules`, and the sim asks the
world rather than a global — so two worlds in one process may disagree, which is what lets a
region be a world. Every default is today's game, and a suite asserts it.
`World.foe(world, a, b)` answers hostility and `World.pactOn` answers peace; **a pact is two
standing offers** (`pl.offers[j]`), sealed while both stand and broken the instant either is
withdrawn — symmetric by construction, so two seats cannot disagree about it.
The trap is that `js/world.js` carries 46 owner comparisons and they are **three different
questions wearing one spelling**: "is this MINE" (the muster cap, the wall roster, the crowd's
cohesion, company assignment, the purse, the crews, a heir's own ghosts) must NOT go through
`foe` — a truce is not an alliance and neither is a chain of command, so neither a pact partner's
men nor a sworn lord's join my formations, and my Wardens mend neither. "Is this my BANNER'S"
(`World.realmOf` — hostility, terms, and the one thing sworn lords do share, SIGHT) is the
second. Only "may I strike this" goes through `foe`. And it is guarded at the
door damage comes through as well — `hurt` and `hurtBuilding` refuse a blow between heirs at
peace outright, the same place the tower's shelter, the parapet's cover and the chains' amplifier
are written, so a pass added later cannot forget to ask and a MISSED site is a no-op rather than
an arrow. Chaos is a foe of everyone and treats with nobody. See `REALM_PLAN.md`.

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
walking, where, and how far along. **The heirs read it, and refuse the race.** Every heir walks
at the same `rate` — the Shrine has one, not one per level — so whoever steps on first finishes
first, and a walk cannot be called off. An heir therefore never begins one while a rival is
already on the lines (`v.walkers` in `ai.js`, filled from `World.walkers`, so he knows exactly
what a human at the table knows). `late` does NOT override it: the stall-breaker exists because
a board where nobody walks runs to the cap, and a board where somebody is walking has a clock
running already. The answer to a rival's walk is an army at his Shrine.

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
- **THE VEIL IS SAMPLED IN THE MATERIALS, not drawn on a canvas** (`R.shaderFog`, on).
  `fogPatch(mat[, slope])` injects into every material in `worldG`: the eased mask rides up as
  a small texture (one texel per fog cell, R = sight, G = ever-seen) and each fragment reads it
  by its own world XZ. There is no projection to disagree about, which is what the 2D pass
  could never fix — it drew a WORLD-space field as SCREEN-space polygons and every veil defect
  of 2026 lived in that gap. Fog is DRAINED of colour, not tinted, and the three states are
  ONE CHAIN (shroud → fog as memory arrives, fog → the land as sight does), so there is no
  seam and no rim to draw. The 2D path is kept and still works — `Render.shaderFog = false`
  — and two suites still measure it, so it cannot rot silently.
  **The hazard is the other side of the same coin: it veils only what it was handed.** Three
  ways to lose it, all of which have actually happened:
  (1) a new mesh created without `fogPatch` — the writ was an unpatched `LineBasicMaterial`
  and read as the writ and the sight disagreeing about where the ground was;
  (2) `material.clone()` — `onBeforeCompile` is a PROTOTYPE method and an assigned one is not
  in the whitelist `Material.copy()` walks, so a clone falls back to the no-op. Ghosts,
  scaffolding and a toppling tower all clone, and all three escaped;
  (3) a second arm of the patch without a `customProgramCacheKey` — Three keys a patched
  program on `onBeforeCompile.toString()`, identical for both arms when the difference is a
  closed-over variable, so every patched material shares one program.
  `R.debugUnpatched()` walks `worldG` and names what escapes; "nothing in the world escapes
  the veil" asserts it is empty. The only things allowed out are meshes named `affordance` —
  the selection ring and the armed-company halo — which answer the PLAYER, not the land.
- **THE GROUND YOU STAND ON IS THE GROUND YOU SEE.** `R.groundH` is where EVERYTHING is put —
  every man, every work, every pool, every ring, and the painterly detail tiles a country is
  painted with — so it must answer for the surface actually DRAWN. For years it sampled the raw
  elevation field while the ground mesh is a `PlaneGeometry` capped at 180 segments; measured by
  raycasting the real geometry, up to 8.75 units of disagreement on a board and 21.5 on a
  country. A board hid it because nothing stands between the eye and the ground there. A country
  has the detail tiles — the same field sampled FINER, so they rose off the base by exactly that
  error and were lifted 3.0 units clear to stop it poking through, which then swallowed every
  spring's pool (water sits 1.5 up), every site ring and the feet of the props. `groundH`
  interpolates the drawn mesh's own lattice with its own triangulation now (Three splits each
  quad on the diagonal from `(ix, iz+1)` to `(ix+1, iz)` — verified by raycast, 0.0002 error
  against 2.35 for the bilinear it used to do), so a tile lands exactly ON the base. **The lesson
  is the general one: a second code path for the big case is where the two grounds diverged, and
  the fix was to make them one surface rather than to tune the gap.** Three browser tests hold
  it — the raycast, a tile's vertices, and a country's spring having its pool.

- **THE CAMERA CANNOT BE AIMED AT A WORLD THE RENDERER HAS NOT BEEN GIVEN.** `clampCam` holds
  the view inside `mapW`/`mapH`, and those are learned in `buildWorld` — which runs on the first
  FRAME, after game.js has already called `homeCamera()`. So every opening aim was clamped into
  the extents of the PREVIOUS world. Board to board that is invisible (same rectangle); walking
  into a country it strands you, and it stranded the HOST too: measured, a court at (7670, 9030)
  on 8000×9600 opened looking at (1950, 2446) — the middle of a 2000×2400 board, 7,330 units
  from the host's court and 8,721 from a guest's. `R.lookAt` remembers the aim and `buildWorld`
  replays it once the extents are real (re-applying the zoom first, since the zoom floor scales
  with the land too), then clears it, so a later drag or a council row is never undone.

- **A MEMORY OF THE LAND IS CUT TO THE LAND.** `World.newSeenMask()` with no dimensions is a
  BOARD — right for a duel, and the guest's war mask asked for exactly that. On a country the
  grid covered its top-left sixteenth, `markSeen` OR-ed a country-sized live mask into it index
  for index across two different strides (silently dropping the overflow off the end of a typed
  array), and the veil's own view window — clamped to that grid — could not reach the ground the
  camera was over, so every cell in sight stayed SHROUD. That is the black world a LAN guest at
  a war table was photographed looking at. The call site takes `refWorld.mapW/mapH` now, and
  `markSeen` maps by CELL when the strides differ rather than corrupting silently. Same shape as
  the two notes above: **a second code path for the big case, silently sized for the small one.**

- **WATER IS ONE BODY, AND ITS DEPTH IS ITS WIDTH.** The bake painted a radial gradient PER
  WATER CELL onto the finished land, so the alphas compounded where discs overlapped and a
  one-cell river came out as a chain of beads with a bright core in every cell — and the pass
  ran AFTER the blur that softens everything else, so a hard saturated cutout sat on a
  painterly landscape. Reported from play as "that river looks very weird". The cells go into
  their own layer at full alpha (a shape has no alpha to compound), the layer is blurred — which
  is what turns a run of squares into a channel with banks — and it is composited ONCE. Depth
  falls out of the same mask blurred harder: a lake keeps its alpha in the middle and a
  one-cell river blurs away, so the deep colour only reaches broad water, with no rule about
  which is which. Measured down a channel's centreline: the step between neighbouring cell
  centres was 14.9 of 255 and is 1.0. **No blur may reach past `pad`** — a tile is painted with
  `cw*2` of ground beyond its edge and cropped back, and that is the whole reason two neighbours
  meet on identical pixels; the blur is clamped to what the pad can support and a suite bakes
  two overlapping windows and compares the strip they share.

- **`node test/run.js` runs the two suites AT ONCE** — they contend for nothing (pure Node vs
  Chromium on its own ephemeral port), so the wall clock was simply the sum of them. Each
  child's output is buffered and printed whole as it finishes, because two `report()` tallies
  interleaved is neither. `--serial` puts it back. Two traps were found doing this and both are
  general: **a suite that skips itself is claiming something, and the claim has to be checked**
  — `browser.js` skipped with "no Chromium" on a box with a perfectly good one, because
  Playwright resolves a headless launch to `chromium_headless_shell-<rev>` pinned to the
  library's revision, so the whole browser half reported green by reporting nothing; it tries
  three ways now and the skip line names every one that failed. And **`process.exit` truncates a
  piped stdout**: both suites ended with `process.exit(report(...))`, which was harmless while
  they wrote to a terminal and silently ate the tally the moment the runner captured them.
  `process.exitCode` and let the process end.

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

**A WORK UNDER THE FINGER ALWAYS WINS.** Men were asked first once, so a company standing on a
hall made that hall unopenable; then the NEARER of the two answered, which is better and still
not right — a work is a fixed point the size of a fingertip, and men are many, they move, and
they gather exactly where the works are, so a hall with its own company mustered round it had a
ring of men nearer to almost every part of it than its own centre was. Reported from play as
buildings being very hard to select. **The tie is broken by what a miss COSTS, not by which is
nearer**: the sheet is the only way to reach a work at all — no upgrade, no fork, no mend, no
way even to see what it is — while a company also has the flag tray, which names every one of
them and is always on screen. So a work hit at all answers and men answer on the ground around
it, which is the same rule `hitBuilding` already used one level down for a bastion against the
curtain it stands in. One code path, so every mode is held to it.
**And `hitBuilding` asks for the HAND'S works**, not the viewer's. It was the one place in the
renderer that asked the viewer for something belonging to the hand, so while driving a sworn
lord every tap on his works returned an id his liege did not own and fell through to bare
ground — a conquered court whose halls could not be opened at all.

**A COMPANY'S COLOURS ARE CARRIED BY A MAN.** `World.bearers` names one per company each tick:
the senior man (lowest id) who is out in the open — a man shut in a tower is passed over while
anyone else stands, since the renderer does not draw him. Lowest id is arithmetic, so every
machine at a LAN table flies the standard over the same soldier without a byte agreeing it, and
when he falls the next man has it on the SAME tick. `co.bearer` rides the wire for the owner
only, like the rest of a company. It is a picture, not a rule: a bearer fights and dies like
anyone and losing him costs nothing — making the flag worth killing would have to go to the
referee first. The tray shows the armed company's ROSTER beside its chip (icons straight off
`CONST.UNITS[k].icon`, so a new kind needs no code), and the minimap carries one pennant per
company at its bearer, which is the only thing on that map that says where your army is.
A work's group is cached by a key that must carry **everything drawn into it** — the branch, the
level, the garrison, the damage, a wall's ends and breach, *and the company whose standard it
flies*. The company was the one thing missing, so `{c:'assign'}` moved a hall and its flag went
on flying the old colours until something else rebuilt the group.

**A MIXED COMPANY IS TWO LINES, AND THE SHOOTERS ARE THE BACK ONE.** `CONST.UNITS[k].shoots` is
DERIVED from reach (`range >= CONST.LINE_REACH`), so nothing names a kind and a new one lands on
the right side by having a reach — an Engine and a Bombard belong at the back for all that they
shoot stone, and a Ram at 26 belongs at the front for all that he crawls. `musterAll` deals the
two lines separately (each dense, neither holing the other), and a body holding both is two
discs: the fighting men on the flag, the shooters set back by the depth of both plus a berth.
The bearing is the way the body is MARCHING, remembered in `world._face` for as long as the
order stands — recomputed at rest it would swing the back line round the flag the instant the
last man stopped. A body of one kind is one disc on the flag exactly as it always was.

**AND THE PACING IS ASKED LOCALLY — that is the whole difficulty of the rule.** A place at the
back is not enough: the column steers at the ORDER, so a 50-speed archer walked straight through
a 44-speed shieldwall and the company met the enemy shooters-first. But the obvious cure — hold
every shooter behind his company's average — is wrong in a game where a hall NEVER STOPS
MUSTERING: ten recruits who left the yard a minute after the column is ten men a thousand units
back dragging that average with them, and the archers already at the front stop dead waiting for
men they will not meet. So a shooter looks at the fighting men of his own company standing near
HIM (`CROWD.lead`) and keeps `want` — the formation's own depth — behind the most advanced of
them, at full stride when further back and easing to nothing as he draws level. The standoff must
be that depth and not a berth, or the shooters park on the ground the line still has to cross and
the march ends with the fighting men shoving through their own archers. Re-asked on the
`RETARGET` stagger, the COLUMN only: a shooter kiting a foe moves at his own legs.

Building is CHOOSE-THEN-PLACE: the 🔨 BUILD button opens the sheet, a card arms
`game.placing`, and the next tap on the map places it (a wall takes two — anchor, then far
end). Bare ground does nothing. A refusal leaves the work armed so another spot can be tried.
The cards cannot say why a particular spot refuses them any more — the sheet no longer belongs
to one — so they show cost and affordability only.

**A BANNER IS FOR A REFUSAL OR A SURPRISE, NEVER FOR AN ECHO.** The corner stack holds three
lines for 3.4 seconds each, so every banner that says what the player has just done shoves out
one that says what the *rival* is doing. Three tests, all of which have to pass: does it tell
him something he did not just cause? is there no readout already saying it? and would he act
differently for knowing? An order confirmed is none of the three — the armed ring, the lit BUILD
button, the company chip and the essence rate each say their own thing for as long as it is
true. So planting a standard, arming one, sounding the Recall, halting the muster and cancelling
a placement are all SILENT; a refusal (`r.err`, in `issue`) always speaks, and so does anything
a rival or Chaos did. The Recall made the case on its own: it clears every company's rally, so a
four-company realm emitted four identical banners for one tap and the stack held nothing else.
Orders are still in the chronicle (`record.js`) — that is where "what did I do" belongs.

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

## The campaign

Chapters, not a rung counter. `js/campaign.js` holds `CHAPTERS` — key, title, briefing, rival,
a PINNED seed (a story wants its own country, not whatever the noise produced this morning),
an objective, and predicate-driven hints — plus `OBJ` (`raise`, `hold`, `raze`, `survive`,
`walk`, `seat`), `FAIL`, and the progress record under `amber_campaign` (`{v:1,done:[keys]}`).
It is **headless-safe on purpose**: an objective is a predicate over world state, and a
predicate that cannot be run in Node cannot be tested.

**THE SIM GREW NO THIRD WIN CONDITION.** `win` still has exactly two callers. What a chapter
needed was not another rule inside `update` but a way to end a match from OUTSIDE, having
watched the world game.js already holds — that is `World.declare(world, winner, reason)`:
guarded (it cannot overrule a Seat that has already fallen) and emitting the same `win` event
every other ending emits, so the end screen, the chronicle and the seat's collapse all behave
exactly as they always did. The objective is POLLED once per simulated frame in game.js's own
loop. Do not put triggers in `world.js`: the sim is headless-first, the netcode is
host-authoritative, and a spec board cannot cross the wire (a guest rebuilds from the seed
alone), so a scripted chapter is a single-player concern by construction.

`CAMPAIGN.run(chapter, me)` is what game.js holds for the length of one: `tick` answers
`'won'`/`'lost'`/null and never writes to the world, `say` is the HUD line (asked every frame,
so it can count down), and `hint` fires the tutorial one lesson at a time, **in order**, each
waiting for the BOARD to be true rather than for the clock to reach a number.

Adding a chapter is a table entry: `{key, title, heir, seed, opts, brief, obj, won, hints}`.
`opts` merges OVER the player's chosen footing, so a chapter may hold a rival back (`hold`) or
let him off the leash without taking the footing away. The chapter screen, the briefing, the
lock, the progress and the end screen all follow from the table with no code.

**A BANNER MUST SAY WHERE.** The `hurtcity` alert fired for ANY work of yours being scratched
and cried "the enemy is inside your city!" about all of them — so a Gate four hundred out,
gnawed by one fiend, read exactly like a column at the throne. It carries `bt` and `x`/`y`, and
the banner names the WORK when the trouble is out in Shadow and keeps the old cry for something
standing on the court (`CITY.r`).

**AND THE MINIMAP SHOWS WHERE THE FIGHTING IS.** A flashpoint is a PLACE, not an event
(`R.debugFlash`): violence near an existing one bumps and moves it rather than making another,
so a battle is one mark and not forty, and it decays so it says where the fighting IS. Fed from
`die`/`hurtcity`/`breach`/`raze`/`siege` — what is HIT, never a shot leaving a gun, or every
Watchtower would light the map — and from the events the viewer was already handed, which are
sight-filtered in `routeEvents`, so it cannot show what the veil is hiding. Crimson when it is
yours, gold when it is his: "I am attacked here" and "I am attacking there" are the two
questions a glance at a minimap asks.

## The Reach War (the fourth mode)

**THE COUNTRY IS ONE WORLD.** The region-graph realm (a country as a grid of little boards,
entered one at a time — see git history and REALM_PLAN.md §9-10 for its record) is gone: what
made a single big map unaffordable was the flow field, a Dijkstra dead linear in area, and the
REACH is what tamed it. Every city owns a disc (`world.cities[].reach`); a company belongs to a
city (`co.city`) and may be ordered only inside that city's reach (`rules.reach` — refusals
speak: 'reach', 'city'); and every flow field is FENCED by the owning city's disc (nav.js
`bound`), so a field costs what a field costs on today's board however large the land grows
(measured: 5.5ms fenced vs 70ms open over a country). To strike a city two hops away you must
first hold the one between — the affordability rule IS the strategic rule. ORDERS are bounded;
violence is not: standing, pursuit and combat cross the rim freely.

`WG.buildCountry` grows the land (CONST.REACHWAR: 8000×9600, 16 cities; connectivity is a
PLACEMENT LAW, not a reroll — a candidate city must be pathable inside an already-placed reach);
AMBER, the Pattern's city, is the neighbour graph's centre and last in seat order. RIVERS run
from the interior to the sea and ROADS are FOUND over the land's own costs (climb charged
dearly, reuse half-price so trunks emerge), with BRIDGES where a crossing beats the toll — all
stamped as real terrain (`WG.T.ROAD/BRIDGE`, cost 1, unbuildable), so columns funnel onto the
highway on their own and a bridge is a chokepoint nobody declared. The renderer draws a country
as TWO GROUNDS: a cheap ImageData base at any size, and painterly detail tiles that follow the
camera (one baked per frame, twelve resident, seams killed by pad-and-crop plus per-site
seeding); the veil's per-frame CPU is windowed to the view. `realm.js` v2
is only persistence + `REALM.run` (CAMPAIGN.run's shape; endings via `World.declare`): the save
regenerates the country from its seed and writes down only what was DONE (~7-100KB under
`amber_realm` v2; a v1 record loads as null and `REALM.lost` says so once). The lord brake lives
IN the sim now (`holdCities` refuses the swear past `1 + pl.lords`; a lord is won only from a
CONTENDER, `world.heirs`), as does the one Pattern (`placementError`: a Shrine only for AMBER's
holder). Every lord — sworn or not — runs the `lord` baseline (ai.js), whose whole vocabulary is
rallies plus a few probed works, and AMBER's holder builds the Shrine and walks, which is the
war's clock. `?reach=SEED` dev-boots a country through the real renderer. A LAN table is
dealt INTO the host's war when one is open: the wire carries `{war: {seed}}` and nothing else
of the country (a guest regenerates the ground from the seed; history rides the ordinary
absolute snapshots), humans take the contender seats in join order, and the host's lords play
the rest.

**The rules of a war**, all of them off in every other mode: `reach`, `occupy` (a Seat yields
and the ground must be taken), `endOnSeat: 0` (dispossession, not death), `truce`, and
`onePattern` (a Shrine may rise only in the Pattern's city, held).

### A CONQUEST TAKES AN OATH, NOT A DEED

**`players[i]` IS THE LORD OF `cities[i]`, PERMANENTLY, AND A CITY IS THE ECONOMIC UNIT.** That
was always half-true — a country builds one player per city, each with its own purse, Gates,
halls, crews and companies — and conquest DISSOLVED it: `city.owner` moved to the taker, the
beaten lord kept a treasury he could no longer spend, and his works stood inert in the taker's
new court forever, refusing the taker's own masons the ground. What a conquest won was a name
on a map with no economy under it.

What changes hands is **allegiance**. `pl.realm` names the banner a lord answers to (his own
index at genesis, so a board is today's game to the byte); `holdCities` gives a taken court back
to its own lord with `players[lord].realm` set to the breaker's; and he goes on running his own
city with everything he had — purse, Gates, halls, crews, surviving men, his whole writ. There
is no `CLAIM.sworn` skirt any more, because there is no absentee landlord to ration.

- **`World.foe` asks the REALM** — one banner, one side, before the pact is even considered. A
  sworn lord's men fight for you and cannot be struck by you. `realmOf`, `realmMembers` and
  `realmCities` are the three answers, and nothing spells them itself.
- **The two scales must not be confused.** `citiesOf(w, pi)` is HIS city — one, or none while
  his court lies yielded — and drives his writ, his gun, his companies. `realmCities(w, pi)` is
  his BANNER'S, and drives the lord brake, the HUD's count, and winning and losing. The
  46-owner-comparison hazard in the CLAUDE.md note above is now a THREE-way question: "my
  realm's" (sight, hostility, terms), "my city's" (purse, crews, writ, formations, wall gates,
  muster cap), and "may I strike this".
- **A realm SHARES ITS SIGHT and nothing else.** `visionSources` unions the banner's sources and
  `refreshVision` casts ONE mask per realm and shares the object (sixteen boards of cells cast
  four times over for four identical answers was the alternative). Memory (`seen`, `explored`,
  `ghosts`) stays each lord's own and converges, because it rides the wire and the save per seat.
- **Terms are sworn between banners.** `pactOn` and the `{c:'pact'}` command both normalise to
  the realm's founder, so a vassal cannot keep a private peace with the army besieging his liege.
- **A war can be LOST** (`REALM.run.tick`: your banner holds no city) **and WON by absorption**
  (`holdCities`: one banner left holding ground → `win(..., 'castle')`, only where `endOnSeat`
  is off, so toppling still owns that rule everywhere else).
- **WHAT YOU BREAK AND HOLD, YOU KEEP.** There was a lord brake — one city by right and one more
  per LORD, a lord won only from a contender — so a court you had broken, stood in and held for
  its full twenty seconds could refuse you outright. Gone on the designer's call, and with it
  `pl.lords`, `CONST.REALM.lords0`, the `refused` event and its banner. The brake on a conquest
  is the army it takes to break a Seat and the twenty uncontested seconds in the court.
- **A HALL MAY ONLY FLY A STANDARD OF ITS OWN CITY** (`joinCo`). A company may only be ORDERED
  inside its city's disc, so a hall raised in a court you have just taken under a standard of
  your home city musters men no order of yours can reach. Asked at the sim's door, so a guest's
  order and a bot's are held to it too; a hall whose city cannot take the named company raises
  one of its own.
- **There is no steward brain, and no `{c:'seat'}`.** The player's instruction to a sworn lord is
  a PARAMETER to that lord's own doctrine — `AI.make().step(world, me, issue, dt, order)`, five
  words: `hold`, `gates`, `walls`, `attack{target}`, `support{target}` — not a second, thinner
  driver fighting it for the same company's standard. And a lord holds one city, so "which court
  do I rule from" has no second answer; which of his sworn lords the PLAYER is hand-playing is
  `game.hand` (client-side, on `realm.helm`, never in the world), because `pl.seat` pointed a
  lord's WRIT at a vassal's court. `Render.hand` tells the renderer the same thing — the writ
  outline, the reach ring, the armed halo, the minimap pennants and "did I tap my own men"
  answer for the hand; the veil, the camera and the colours answer for the viewer.
- **A guest plays a REALM.** `mine` in `Net.snapFor` and in `hostView` is same-realm, not
  same-seat; `realm` and `heirs` ride the wire; a guest's command carries `as` (the lord it is
  for) and the host vets it against the seat it arrived on, which is the only unforgeable thing.
- **A LAN TABLE HAS TWO BEGINNINGS, and the button says which.** One BEGIN used to mean a plain
  board or the whole table dealt into the host's war depending on whether a war happened to be
  saved — the same button, two games, nothing on screen saying which. `lan-start` deals a board;
  `lan-start-war` appears only when there is an undecided war and deals the table into it. And
  every `Net.send` in the deal is guarded: one channel throwing used to take the whole handler
  down, which looks exactly like a BEGIN that is not wired up.
- **A GUEST IS IN THE WAR TOO, and `game.war` is the CLIENT'S word for it.** It was set inside
  the HOST arm of `startMP` only, so on a guest every reader answered "an ordinary match": no ⚑
  chip, no council, and therefore — on 8000×9600, where a court cannot be found by dragging —
  no way to reach anything he owned. The two things that really are the host's alone are
  `game.realm` and `game.run`, and every writer of state guards on **those** (`saveWar`, the
  `REALM.save` ticks, `onSteward`), never on `game.war`. The helm goes the same way: which court
  the player is hand-playing is a choice about whose taps these are, so it rides the realm when
  there is one to save it in and lives on `game.helm` when there is not. A guest may take
  command of a sworn lord (`issue` already carries `as`) but is offered no STANDING ORDER — the
  doctrines are stepped on the host, so an order set on a guest would sit in a helm nothing ever
  reads, which is the dead-button failure the end screen already taught once.
- **THE COUNCIL ASKS THE VIEW, NEVER THE WORLD.** It read `players[viewer].explored` — a field
  of the world that never crosses the wire — so a guest's council knew of no court he had found
  and offered terms to nobody, while a host's listed them all. `view.sites` is the same
  memory-filtered list both views already carry (live if seen, `live:false` if remembered,
  absent if neither), written once for the host's screen and the wire alike; crews come off
  `World.masons(view, pi)` for the same reason. A fog rule must not be able to land on one of
  these screens and miss the other.

### WHEN THE TABLE BREAKS UP

**A CHANNEL CLOSING SAYS NOTHING ABOUT WHY, AND A KILLED APP SAYS NOTHING AT ALL.** An heir
walking out and a phone in a tunnel arrived as the same `onclose`; a killed app, a flat battery
or a dropped Wi-Fi arrived as *nothing*, because `dc.onclose` never fires for those. There was
no staleness check anywhere — `snapAt` was read only for the interpolation alpha — so a guest
went on drawing the last snapshot forever, men sliding to the ends of their velocities, taps
going into a channel nobody was listening on.

- **Leaving says so**: `Net.bye` sends `{t:'bye'}` to every peer before `Net.close`, each send
  guarded on its own so one dead channel cannot swallow the other goodbyes. It is the only
  difference between "the table is ended" and "the link is lost", and they are told apart.
- **Silence is read as what it is** (`LINK` in game.js): `quiet` 3s → one banner, still in the
  match, because a host who backgrounds his phone may come back; `dead` 10s → the table ends.
  A snapshot landing clears both, so a bad moment on the Wi-Fi costs nothing.
- **HOST MIGRATION IS OFF THE TABLE, and that is an answer rather than a gap.** Only the host
  holds a world; a guest holds fog-filtered snapshots of it, so there is nothing on his phone to
  continue from, and handing the match on would mean shipping a whole world over a link that has
  just proved unreliable. `endTable` ends it cleanly, keeps the chronicle, and — in a war — says
  the country is the host's save, because dropping a guest at a menu offering a brand new war
  reads as the whole evening being gone.
- **A DESERTED SEAT IS PLAYED BY SOMEBODY** (`adoptSeat`). The host used to play on against a
  statue: the departed heir's cities kept earning and his men held whatever ground they were
  last ordered to, forever. `game.bots[i]` is null on every seat a HUMAN holds, so filling in
  the departed index is the same statement a war already makes about the seats nobody claimed —
  the lord's doctrine in a war, an heir on a board. One banner, not two: "the link is severed"
  and "a shadow of him fights on" are one piece of news.
- **The host's back press asks once**, and only his, and only with somebody seated. Back is free
  and instant everywhere else and must stay so, which rules out a modal; the phone's own idiom
  is the answer, where the first press says what the second will do.

### ⚑ THE WAR COUNCIL, AND WHAT THE MAP STOPPED SAYING

**A WAR'S STATE IS A PLACE YOU GO, NOT A CORNER OF THE MAP.** A duel's HUD held nine things and
a war added more: the two-line war line was left-anchored to `min(58vw, 300px)` and the terms
tray was right-anchored and as wide as its text, so on a 420-wide phone they collided by ~60px
— and a fourth banner would have run the chips into the minimap (measured: chips ended 6px above
it). Reported from play with a screenshot.

- **`#war-chip`** stands alone on the right rail: `⚑ held/all` — the whole of what the war line
  said, in four characters — and a DOT that appears only when something is waiting on you (a
  rival asking terms, a court of yours hurt, a yielded court nobody holds, a sworn lord with no
  order). Three chips permanently reading "at war — tap to offer" was an ECHO, which the banner
  rule forbids; the dot is the same information said only when it is news.
- **`#council`** is the Muster Roll's shape (a panel over everything, packed from the top, one
  way out at the end of the scroll) but it returns to the MATCH and the war keeps running. It
  carries the banner's totals, a row per court — colour, lord, its OWN income and men, its
  standing order, its throne — and a row per rival banner for terms. **A row is the way to a
  city**: on 8000×9600 you cannot find a court by dragging, which is why take-command was
  effectively unreachable.
- **Everything in it is FOGGED like everything else** — `councilData` reads the VIEW, so a court
  nobody of yours has seen is not listed, and a banner you have never met is not offered terms.
  That last one is the same rule as the chip's dot: fifteen identical rows reading "at war" is
  the noise the tray was moved out of the HUD for, reprinted on a bigger screen.
- **The masons moved to the purse.** They are the same question — what can I spend — and the top
  of the screen had no room left.
- **The right rail is a STACK and the chip is its top item.** `#walkers` is anchored at the same
  place, so `UI.warChip` measures the chip and pushes the board below it; without that the two
  sit on each other the moment anybody steps onto the Pattern, which is this same bug one
  element along.

### THE MAP SAYS WHOSE

Four seat colours answer a table of four. A war seats sixteen, so from the fifth lord on every
banner came out the same crimson — an ally at terms, an unaligned neutral and the army marching
on you were one colour, and a court that swore looked no different the tick after. Colour is by
**banner**: `CONST.REALM_TINT` gives you gold and each contending heir (`world.heirs`) a colour
of its own for the whole war, `CONST.NEUTRAL_TINT` is every lord sworn to nobody, Chaos is green.
`Render.tintOf` is the one answer and `UI.seatColor` asks IT rather than spelling a second
palette. Four sites keyed on the seat an heir was BORN to are keyed on the holder now: the Seat's
tower re-dresses when a court changes hands (`redressCities`), the ground bake repaints
(`Terrain.courtOwn`; the cheap base is redone and the painterly tiles near the court dropped),
the minimap mark follows, and the castle bar — which used to hang over the born city while
drawing the hp of the seat its heir currently ruled FROM, two different cities — belongs to the
city and reads its own `hp`.

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
  `post` and stations at the FOOT in rows, in cover, which is where a Shieldwall belongs.
  **THE PARAPET IS CAPPED AND THE FOOT IS NOT.** The roster is re-dealt every tick, shooters
  first, so a berth freed by a death is taken by the next archer on the SAME tick and he walks
  up — the queue is the dealing, not a rule of its own. The ranks behind used to wrap at
  `WALL.rows`, which meant a curtain held `berths * 4` men and dealt every one after that a
  place somebody was already standing in (measured: 21 overlapping pairs of 60 men on one run);
  they are unbounded now. And a man's FINAL APPROACH is judged on his own station unless he is
  climbing — near the RUN is the right question for a man walking a parapet to his berth and
  the wrong one for a reserve whose rank is a hundred and thirty behind it, who otherwise
  beelines away from the wall, stops being "at" it, is handed back to the field, is steered at
  the doorstep beside it and comes back (173 transits became 1,418, by 31 men). A
  swordsman on a parapet was only ever a man in the open holding a berth an archer needed. Only
  berthed men shoot over and are exposed. It reads the order rather than `u.goal` because goals
  are assigned in the march loop, which runs after it.
  **AND A BERTH IS AN ERRAND UNTIL HE IS STANDING IN IT.** `postWalls` deals `u.post` + `u.berth`
  + `u.toBerth` — which run, which place, and that it is a place on the stone. `u.man` is set by
  `postAll`, from where he actually IS: `atWall` (within `NAV.arrive` of his station, or of any
  run of his own curtain) is the final approach, `WALL.step` of his station is arrival. Every
  rule that matters keeps reading `u.man` and so silently gains the right meaning — the cover in
  `hurt`, `WALL.over` reach, the wire, the renderer's lift. Being NAMED to a berth used to be the
  whole of manning: measured on the old rule, **thirteen of twenty-four men were on the stone one
  second after the order, still 279 units away from it**. Reported from play as men teleporting
  to a wall. It is the tower's `tow`/`in` split, done for stone, and for the same reason.
  Four things had to be true before a man could walk there at all, each measured:
  (1) **he steers at the run's GATEWAY, not at his berth** — a flow field is cached by its goal
  CELL and the cache evicts by dropping every field it holds, so a berth per man mints a goal
  cell per berth: 29 fields held and thrashing, against 3 with one door per run. The tower has
  always done this;
  (2) **the last stretch is `stand` alone, never `project`** — as the tower branch does, which is
  why a man can walk into a bastion standing inside a curtain's 19-unit slab. It is also how he
  crosses to the sheltered face: he is not walking THROUGH the stone, he is climbing onto it;
  (3) **the parapet's line clears `shove`'s band** (`PARAPET` = `thick + 8` against a pin at
  `thick + 6`), or an arrived man is re-projected every tick;
  (4) **the final approach is out of the crowd** — cohesion is what stops a man LEAVING one, and
  a man dealt a berth 200 along his own wall gained one unit in eight seconds against a 50/s
  stride until it was lifted.
  **AND A GARRISON DOES NOT GIVE CHASE.** An archer sees 150 and throws 105, so a foe just out of
  range dragged him off his own wall to close the difference — six men pinned dead at a junction,
  their walk cancelled tick for tick by a chase after a man they could not have hit. A man with a
  berth walks to his place and shoots whatever comes into it; he also keeps walking WHILE he
  shoots, because a roster that moves with the fighting is useless if being in range stops a man
  answering it.
  **A CURTAIN GATHERS TO THE FIGHTING, AND SPLITS FOR TWO.** Every enemy within `WALL.alarm` is
  projected onto the curtain and the projections are CLUSTERED (`WALL.alarms`, `alarmSpan`) — one
  alarm per body of attackers, anchored on the STONE and not on the enemy, so a Bombard shelling
  from beyond anyone's reach counts. `postWalls` sorts the PLACES by distance to the nearest
  alarm rather than moving men: the roster is dealt fresh every tick, so the same stable line of
  men lands on different stone and walks there. One alarm would answer a feint perfectly — hit
  one end, watch the wall run to it, walk in at the other — which is why there is more than one.
  Measured on a three-run curtain with twelve men: at rest 4/4/4, one assault 12 of 12, two
  assaults 6 and 6. `world._alarms` is kept for the tests, because "the wall did not gather" and
  "the wall gathered to the wrong place" look identical from outside.
  **AND THE PARAPET IS HALF A SHIELD.** `WALL.cover` multiplies every blow that lands on a man
  carrying `u.man`, in `hurt()` — the same door the tower's immunity and the chains' amplifier
  use, so a splash pass or a new weapon added later cannot forget to ask. That does mean the
  Jewel's storm is halved on a parapet too, which is the honest reading of cover; the
  alternative is a list of exceptions kept at six call sites, which is what the guard exists to
  avoid. Without it a berth bought reach and nothing else, and holding a curtain was strictly
  worse for the man than standing in the field beside it. Note when testing this that the
  geometry around a run is NOT a controlled comparison — a berthed archer beside one in the
  open took exactly half with the cover switched OFF, because one of his two attackers could
  not land a shot. The suite plays the same seeded world twice and varies only the constant.
  **AND CONTIGUOUS RUNS ARE ONE CURTAIN.** There is no longest run, so a long wall is drawn as
  several — and the roster is dealt round ALL of them. `noteWalls` unions runs of one owner
  whose ends fall within `WALL.join` of each other (measured end-to-segment, so a broadside
  junction joins too) and stamps `w.curtain`, named by the LOWEST run id so every machine at a
  LAN table groups the same stone without a byte about it. `postWalls` then rosters by curtain
  and deals places ROUND-ROBIN across its runs and their bastions — the order of that list is
  the order the wall fills in, and dealing one run out before starting the next is what packed
  forty men into the first two hundred feet of a board-long wall and left every tower past them
  empty. The reserve spreads the same way. Reported from play with a picture.
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
  **A CURTAIN HAS ONE SHELTERED FACE, AND IT IS THE POLYLINE'S.** `station` used to face each
  run at the owner's Seat independently, which is invisible on a straight wall and wrong on
  every other: past a right angle of bend the direction home swings across the run's own
  perpendicular and the sheltered side flips halfway along the stone. `noteWalls` now puts each
  curtain's runs in ORDER along the wall, turns them to point the same way down it, and takes
  the same HAND for every normal — all left or all right — with the hand settled at the run
  nearest the Seat. Curvature cannot touch that: it is a property of the traversal, not of any
  pair of bearings. (Chaining by "agree with your neighbour's NORMAL" is the obvious rule and is
  wrong for a zigzag, where neighbours differ by more than a right angle — it was measured
  making things worse.) `w.norm` is the sim's copy, `w.seq` the order, and `b.face` (+1/-1
  against the run's own perpendicular) is stamped on the WORK so it rides the wire: the renderer
  draws the parapet and swings the gates from it and cannot re-derive a chain it only holds part
  of. `faceOf` is the one place the question is answered. **And a man walking to a place on it
  may cross the run he is CLIMBING ONTO and nothing else of his own** (`ownStoneClear`), and he
  walks in at a DOORSTEP one row inside the gateway rather than at the gateway itself — aimed
  at the gateway, which is a hole in his own nav layer, the field cheerfully routes a garrison
  out one gate and back in the next, because on a dogleg that is the short way.
  **A run's sheltered face is a guess the heir may overrule.** `{c:'flip'}` negates it, per run,
  at the point of use — the chain has no opinion about a run its heir has turned about. `{c:'flip', id, on}` sets `b.flip` and `station` (and the renderer's
  parapet facing) negate the normal. It asks for a STATE, not a toggle, takes no crew and no
  stone, and may be given while the masons are still on the run.
  **A wall bars its OWNER too, except at his gate** — the middle of the run, `WALL.gate` wide,
  punched out of his nav layer alone. A rival is stopped everywhere including the gateway.
  **AND THE DOOR DECIDES WHO PASSES.** Coming from OUTSIDE an heir's own troops always pass;
  going from INSIDE the door is shut to a man POSTED to that wall, and open to everyone else.
  One test does both, because a posted man's station is always on the sheltered side: inside he
  steers on a second layer where his own gateways are stone, outside on the ordinary one, and no
  direction is modelled anywhere. `masksFor` keeps TWO layers per heir — not one per company: it
  depends on the owner and one bit, so all his men share them — and `NAV.steer`/`fieldFor` take
  a `shut` flag that is part of the field-cache key. It is switched on **the side he is standing
  on** (`curtainSide`), never on whether the field can reach him: keyed on reachability a man
  falls back to the open layer, strides, and is turned round, and a doorway fills with men
  jittering — measured worse than leaving the gates open, twice. A man standing IN a doorway is
  in masonry on the shut layer and has no field: he is told to step off the threshold along the
  sheltered face, which is the only useful thing to say to him. Without this a garrison
  reshuffling on a zigzag went out one gateway and in the next — 4,222 transits in a hundred
  seconds, against 173 now.
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
- **The Muster Roll is a GRID, and a man belongs to one place in it.** Small cards — emblem,
  name, what raises him, price, three numbers — under the hall that musters him, and the
  remainder (`Champion`, `Fiend`) under one last section computed as *what no hall raised*, so
  a new kind lands in exactly one of them. A tap opens a large card that spans the grid with
  the turning figure, the prose and every field the table carries; the FIGURE belongs to that
  one card, so `Render.rollStart` is handed one berth or none (it used to turn eighteen men at
  once, on a phone). It reads `CONST` and nothing else: `rollStat` drives the tag line off a
  unit def's OWN KEYS, so a mechanic the sim gains is never silently missing and one it drops
  stops being advertised. Nothing here names a building — which work raises a man comes off the
  card's `data-bt`.
- **A report from play**: ask for the chronicle. The end screen (and the menu, after an
  abandoned match) copies a whole match — seed, footing, a table every 20s, every order given,
  the moments — as text. `node sim.js` plays bots and cannot see what a human's match felt
  like; the chronicle can. `Rec` reads the sim and never writes to it.
