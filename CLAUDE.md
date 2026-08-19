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
- **OPEN_WORLD_PLAN.md** — the RECORD of the open-world migration (site graph → free
  movement, free placement, springs, walls, forks); all shipped.
- **REALM_PLAN.md** — the RECORD of the fourth mode's two lives: the region-graph realm it
  describes shipped and was then superseded by the Reach War (one continuous land, cities with
  a reach), which kept its structure-independent parts. Read for the staging discipline.
- **DESIGN_PRINCIPLES.md** — pillars + the sim-based balance methodology.
- **TODO.md** — phases and current state.
- **LEDGER.md** — the EVIDENCE behind the rules in this file: every measurement, report from
  play, rejected alternative and war story, under the same headings as this file, in the same
  order. A `(→ LEDGER: heading)` pointer here means the numbers live there. Consult it before
  re-deciding anything a rule says was measured; it is not loaded into every session.

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
  is noise, not a template — but what stands on it is dealt by QUARTER (the designer's rule,
  2026-08-19): the Seats in the corners (two heirs on a diagonal, rerolled rather than seated
  along one edge; three or four in corners of their own, `C.WORLD.cornerBox` from one and never
  nearer the edge than `inland`), and `C.WORLD.perQuarter` (two) springs in every quarter, the
  starting springs among them — each Seat's own at arm's length with a Gate ring, the rest
  outside every writ, so a Seat opens with exactly one spring it can draw on. Fairness is what
  is left to choose: the room around the corner Seats (`js/worldgen.js` `placeCities`,
  `placeNodes`; the old scatter-and-score is gone, and worldgen runs in ~10ms against 60-100).
  A guest's renderer mirrors nothing: its camera simply starts over its own Seat
  (`js/render3d.js`).
  **AND THE EDGE OF THE WORLD IS A COAST OR A RANGE, NEVER A LINE** (the designer,
  2026-08-19, boards and countries alike; `G.generate`, `CONST.WORLD` `rim/shoreW/cliffShore/
  inletOdds/inletDeep/rangeW/rangeOdds`). Each edge is dealt sea or crag by the seed. A coast's
  water runs inland by a depth that wanders along the edge, its shore is BEACH (marsh and sand)
  on some stretches and CLIFF (crag out of the water) on others, and an ESTUARY cuts a narrow
  inlet deeper here and there; a range is foothills rising to crag, its foot wandering too.
  The last cell of every edge is water or crag whatever the noise said, and `flatten` leaves the
  last two cells of the world alone (a spring's hollow once levelled a beach into plain).
  `gen.edges` says what each edge was dealt. In the renderer the same sea or the same stone
  CONTINUES past the map (the `skirt`: four strips, vertex-coloured from the bake's border
  rows for water and from the rock palette for a range, ridged and rock-strewn as it recedes,
  fog-patched like everything in `worldG`), so nothing past the limit of the world is black;
  and the camera is held so only a little of the screen ever looks past the edge —
  `VIEW.overscroll` 0.06 (it was 0.42) on the scroll box, and `clampCam` then asks the AIM ROW
  of the real frustum where its ends fall and walks the camera back until they sit inside the
  map (or centres a world narrower than the screen). The far side of the screen sees past the
  top edge whatever is done — that is what the skirt and the distance fog are for.
  (→ LEDGER: THE EDGE OF THE WORLD IS A COAST OR A RANGE)
- `world.events` is an append-only queue for the renderer/UI (shots, deaths, rifts, alerts);
  the sim never reads it. Consumers drain it each frame.
- Fourteen commands, all validated in `applyCommand(world, playerIdx, cmd)`. None carries a
  slot — a work is named by `id` and ground by `x`/`y`: `{c:'pause',on}`,
  `{c:'build',x,y,bt,co}` (a wall adds `x2,y2`), `{c:'up',id,br}` (`br` read at the fork level
  only), `{c:'fix',id}`, `{c:'flip',id,on}`, `{c:'walk',on}`, `{c:'muster',pause[,co]}`,
  `{c:'rally',co,x,y}`, `{c:'assign',id,co}`, `{c:'banner',x,y}`, `{c:'power',k,x,y}`,
  `{c:'pact',p,on}` (a standing offer of terms; war only), `{c:'raze',id}` (throw down a
  yielded court you are standing in; war only, and issued by nothing yet — see TODO) and
  `{c:'demolish',id}` (throw down a work of your OWN — any of them, finished or not, half the
  stone back; through `hurtBuilding`'s own teardown, said as a `demolish` event and never a
  raze, so nothing cries that the enemy did it. The designer, 2026-08-19: a mistake must be
  undoable and the ground wanted for something else freed).
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
`CONST.RULES` is the table of the rules a MODE may change (`endOnSeat`, `occupy`, `truce`,
`hush`, `onePattern`, `reach`, `walkMul`),
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
  and re-stamps index.html + sw.js — this is what triggers installed PWAs to auto-update
  (manifest.json carries no version; index.html cache-busts it by query). For minor/major
  bumps sed both yourself (hook still +1s patch after).
  Skip with AMBER_NO_BUMP=1. sw.js precaches per-version; update flow lives in game.js setupPWA().
- Balance changes: run `node sim.js` before and after; keep the targets in
  DESIGN_PRINCIPLES.md green. `node sim.js --a=brand --b=julian --n=40` for a matchup.
  The full run is 176 matches (5 series x 20 games, 10 round-robin matchups x 6, and 2
  convergence series x 8) across `os.cpus().length` workers, and the julian mirror runs to the
  45-minute cap — call it twenty minutes on four cores. `--quick` plays every section at a third of the games for iterating;
  the full run is what decides whether to ship.
- The suite prints its slowest suites when a run is slow — start there rather than bisecting
  by hand. Most browser-suite time is FRAME time, so renderer performance and test speed are
  the same problem. Wait on a condition (`until`) rather than a fixed sleep.
- There is ONE renderer. A second, Pixi-based one was kept for years as a "fallback for
  devices without WebGL"; Pixi has been WebGL-only since v7, so it was never a fallback.
  WebGL is a stated requirement, said plainly at boot. `runRenderer` still buffers its own
  rows/timings, which is what a second renderer or viewport size would need to run alongside.
  (→ LEDGER: There is ONE renderer)
- **THE VEIL IS SAMPLED IN THE MATERIALS, not drawn on a canvas** (`R.shaderFog`, on).
  `fogPatch(mat[, slope])` injects into every material in `worldG`: the eased mask rides up as
  a small texture (one texel per fog cell, R = sight, G = ever-seen) and each fragment reads it
  by its own world XZ — no projection to disagree about, which the 2D pass (a WORLD-space field
  drawn as SCREEN-space polygons) could never fix. Fog is DRAINED of colour, not tinted, and the
  three states are ONE CHAIN (shroud → fog as memory arrives, fog → the land as sight does), so
  there is no seam and no rim to draw. The 2D path is kept (`Render.shaderFog = false`) and two
  suites still measure it, so it cannot rot silently.
  **The hazard is the other side of the same coin: it veils only what it was handed.** Three
  ways to lose it, all of which have actually happened: (1) a new mesh created without
  `fogPatch`; (2) `material.clone()` — `onBeforeCompile` is a PROTOTYPE method, not in the
  whitelist `Material.copy()` walks, so a clone falls back to the no-op; (3) a second arm of the
  patch without a `customProgramCacheKey` — Three keys a patched program on
  `onBeforeCompile.toString()`, so every patched material shares one program.
  `R.debugUnpatched()` walks `worldG` and names what escapes; "nothing in the world escapes
  the veil" asserts it is empty. The only things allowed out are meshes named `affordance` —
  the selection ring and the armed-company halo — which answer the PLAYER, not the land.
  (→ LEDGER: THE VEIL IS SAMPLED IN THE MATERIALS)
- **THE GROUND YOU STAND ON IS THE GROUND YOU SEE.** `R.groundH` is where EVERYTHING is put —
  every man, work, pool, ring, and the painterly detail tiles — so it must answer for the surface
  actually DRAWN, never the raw elevation field: it interpolates the drawn mesh's own lattice
  with its own triangulation (Three splits each quad on the diagonal from `(ix, iz+1)` to
  `(ix+1, iz)` — verified by raycast). **A second code path for the big case is where the two
  grounds diverged, and the fix was to make them one surface rather than to tune the gap.**
  Three browser tests hold it — the raycast, a tile's vertices, a country's spring having its
  pool. (→ LEDGER: THE GROUND YOU STAND ON IS THE GROUND YOU SEE)
- **THE CAMERA CANNOT BE AIMED AT A WORLD THE RENDERER HAS NOT BEEN GIVEN.** `clampCam` holds
  the view inside `mapW`/`mapH`, learned in `buildWorld` on the first FRAME — after game.js has
  called `homeCamera()`, so an opening aim is clamped into the PREVIOUS world's extents.
  `R.lookAt` remembers the aim and `buildWorld` replays it once the extents are real (zoom
  first, since the zoom floor scales with the land), then clears it, so a later drag or a council
  row is never undone. (→ LEDGER: THE CAMERA CANNOT BE AIMED AT A WORLD)
- **A MEMORY OF THE LAND IS CUT TO THE LAND.** `World.newSeenMask()` with no dimensions is a
  BOARD; on a country that is a shroud everywhere. The call site takes `refWorld.mapW/mapH`, and
  `markSeen` maps by CELL when the strides differ rather than corrupting silently. Same shape as
  the two notes above: **a second code path for the big case, silently sized for the small one.**
  (→ LEDGER: A MEMORY OF THE LAND IS CUT TO THE LAND)
- **WATER IS ONE BODY, AND ITS DEPTH IS ITS WIDTH.** Water cells go into their own layer at full
  alpha, the layer is blurred (a run of squares becomes a channel with banks) and composited ONCE
  — never a gradient per cell onto the finished land, whose alphas compound. Depth is the same
  mask blurred harder: a lake keeps its alpha in the middle, a one-cell river blurs away, no rule
  about which is which. **No blur may reach past `pad`** — a tile is painted with `cw*2` beyond
  its edge and cropped back, which is why two neighbours meet on identical pixels; the blur is
  clamped to what the pad supports and a suite bakes two overlapping windows and compares the
  strip they share. (→ LEDGER: WATER IS ONE BODY, AND ITS DEPTH IS ITS WIDTH)
- **`node test/run.js` runs the two suites AT ONCE** — they contend for nothing; each child's
  output is buffered and printed whole, because two `report()` tallies interleaved is neither;
  `--serial` puts it back. Two general traps: **a suite that skips itself is claiming something,
  and the claim has to be checked** — `browser.js` tries three ways to launch Chromium and the
  skip line names every one that failed (Playwright resolves a headless launch to
  `chromium_headless_shell-<rev>`, so a "no Chromium" skip on a box with one reported green by
  reporting nothing); and **`process.exit` truncates a piped stdout**: set `process.exitCode`
  and let the process end. (→ LEDGER: `node test/run.js` runs the two suites AT ONCE)
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

**A CITY CIRCLE IS NOT A SPECIAL CASE, AND A STANDARD GOES WHERE YOU POINT.** `hitSite` judges
every tap against the site's own ground: one radius rule, both callers, no `forFlag`. A rule
that moves your order without saying so is worse than no rule.
(→ LEDGER: A CITY CIRCLE IS NOT A SPECIAL CASE)

**SAY IT TWICE AND IT IS MEANT LITERALLY.** An ordinary rally is a SUGGESTION the acquire loop
overrides constantly. A second tap on the order just given sets `hard` on it: the company
acquires NOTHING (a forced march, so an engaged man breaks off and goes) or nothing but the work
the tap named (`tpi`/`tid` → `co.mark`, vetted at the sim's door so a guest cannot ask for a
work it may not strike).
**IT MUST LAPSE, AND IT LAPSES TWO WAYS** — `HARD.span` is the ceiling (an order to ignore the
enemy forever is how a company walks into a mill), and arriving is the ordinary ending, folded
in `bearers`. `hardOn` counts the live ones so `acquire` skips the whole question with one
integer test in every match that never gives one; it is incremented in exactly one place and
decremented in exactly one.
**THE SECOND TAP UPGRADES; THE FIRST NEVER WAITS.** No double-tap window on the first tap — it
would delay every order in the game for a gesture used occasionally. No banner: the standard on
the ground grows a SECOND pennant for as long as the order stands ("say it for as long as it is
true"), which is why hardness is part of the flag pool's KEY.
(→ LEDGER: SAY IT TWICE AND IT IS MEANT LITERALLY)

**A WORK UNDER THE FINGER ALWAYS WINS.** **The tie is broken by what a miss COSTS, not by which
is nearer**: the sheet is the only way to reach a work at all, while a company also has the flag
tray, always on screen. So a work hit at all answers and men answer on the ground around it —
the rule `hitBuilding` already used for a bastion against its curtain. One code path, so every
mode is held to it. **And `hitBuilding` asks for the HAND'S works**, not the viewer's, or a
sworn lord's halls cannot be opened while driving him.
(→ LEDGER: A WORK UNDER THE FINGER ALWAYS WINS)

**A COMPANY'S COLOURS ARE CARRIED BY A MAN.** `World.bearers` names one per company each tick:
the senior man (lowest id) who is out in the open — a man shut in a tower is passed over while
anyone else stands, since the renderer does not draw him. Lowest id is arithmetic, so every
machine at a LAN table flies the standard over the same soldier without a byte agreeing it, and
when he falls the next man has it on the SAME tick. `co.bearer` rides the wire for the owner
only. It is a picture, not a rule: a bearer fights and dies like anyone and losing him costs
nothing — making the flag worth killing would have to go to the referee first. The tray shows
the armed company's ROSTER beside its chip (icons off `CONST.UNITS[k].icon`, so a new kind needs
no code), and the minimap carries one pennant per company at its bearer.
A work's group is cached by a key that must carry **everything drawn into it** — the branch, the
level, the garrison, the damage, a wall's ends and breach, *and the company whose standard it
flies* (once missing, so `{c:'assign'}` left a moved hall flying the old colours).

**A MIXED COMPANY IS TWO LINES, AND THE SHOOTERS ARE THE BACK ONE.** `CONST.UNITS[k].shoots` is
DERIVED from reach (`range >= CONST.LINE_REACH`), so nothing names a kind — an Engine and a
Bombard belong at the back for all that they shoot stone, a Ram at 26 at the front for all that
he crawls. `musterAll` deals the two lines separately (each dense, neither holing the other),
and a body holding both is two discs: the
fighting men on the flag, the shooters set back by the depth of both plus a berth. The bearing is
the way the body is MARCHING, remembered in `world._face` while the order stands — recomputed at
rest it would swing the back line round the flag. A body of one kind is one disc on the flag.

**AND THE PACING IS ASKED LOCALLY — that is the whole difficulty of the rule.** The column
steers at the ORDER, so faster shooters walk through the line. Do NOT hold every shooter behind
his company's average: a hall NEVER STOPS MUSTERING, so late recruits drag the average and the
archers at the front stop dead. A shooter looks at the fighting men of his own company near HIM
(`CROWD.lead`) and keeps `want` — the formation's own depth, not a berth, or the shooters park
on ground the line must cross — behind the most advanced, at full stride when further back and
easing to nothing as he draws level. Re-asked on the `RETARGET` stagger, the COLUMN only: a
shooter kiting a foe moves at his own legs. (→ LEDGER: AND THE PACING IS ASKED LOCALLY)

Building is CHOOSE-THEN-PLACE: the 🔨 BUILD button opens the sheet, a card arms
`game.placing`, and the next tap on the map places it (a wall takes two — anchor, then far
end). Bare ground does nothing. A refusal leaves the work armed so another spot can be tried.
The cards cannot say why a particular spot refuses them any more — the sheet no longer belongs
to one — so they show cost and affordability only.

**AND TERMS SPEAK ONLY WHEN THEY ARE YOURS.** Both `pact` and `offer` are routed on `ours(ev.p)`
(the offer was made to your BANNER), not merely on `!ours(ev.pi)`; `offer` fires whenever an
offer fails to seal, including between two lords who have never heard of you, so it was the
wider hole. The council's roster already names every banner's terms, live; the CHRONICLE still
records third-party pacts (`record.js`). (→ LEDGER: AND TERMS SPEAK ONLY WHEN THEY ARE YOURS)

**A BANNER IS FOR A REFUSAL OR A SURPRISE, NEVER FOR AN ECHO.** The corner stack holds three
lines for 3.4 seconds each, so an echo shoves out what the *rival* is doing. Three tests, all
of which have to pass: does it tell him something he did not just cause? is there no readout
already saying it? would he act differently for knowing? So planting a standard, arming one,
sounding the Recall, halting the muster and cancelling a placement are all SILENT; a refusal
(`r.err`, in `issue`) always speaks, and so does anything a rival or Chaos did. Orders are in
the chronicle (`record.js`). (→ LEDGER: A BANNER IS FOR A REFUSAL OR A SURPRISE)

**A HALL UNDER THE MASONS STILL TAKES A NEW STANDARD, AND ANY WORK OF YOURS MAY BE THROWN
DOWN** (the designer, 2026-08-19). The sheet's scaffolding branch returned with nothing but the
countdown; it offers the standard card (`standardCard`) and the demolish card (`demolishCard`,
LAST, below everything constructive, on every work's sheet) now. The sim allowed `assign` under
`work` all along; only the sheet hid it.

**BACK GOES TO THE PREVIOUS SCREEN, AND EXITS ONLY FROM THE HOME SCREEN** (the designer,
2026-08-19). One history entry is held whenever the page is anywhere but HOME (`atHome`: the
menu with nothing over it — no match, codex, chapters, war setup, rivals, LAN table, chronicle
box or scanner) and not held at home: the FRAME loop arms it whenever `atHome()` is false, so a
screen nobody listed is covered the day it is written (the war setup and the LAN table once
left the site on their first press), `onPopState` peels one layer and re-arms only if still not
home, and at home the next press leaves the app. The old `force`/"while a match runs" arming
is gone.

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
`mustersOf(b)` are the four answers, and the price, the `{c:'up'}` command, the sheet (`forkAt`,
not the table with a default of its own — it had `|| 2` against world.js's `|| 0`, two spellings
of one rule), the model key and the heirs all ask them — this was six hardcoded `bt === 'tower'` tests once, and
generalising it is what let three halls fork for the price of a table entry. `mustersOf` is the
one answer to who a hall raises and how often; `def.spawns` is only ever its level-1 answer now.
`cmd.br` is read at the fork level and nowhere else, which is what makes the choice permanent.
A hall that forks clamps `b.paid` — a part-paid dear recruit becoming a cheap one would hand out
several men at once. `br` never rides the wire to a rival (`net.js`), so a fork stays private.

**A MAN ENGAGES WHAT HE CAN ACTUALLY HIT.** `acquire`'s radius is `max(aggro, range, ...)` —
`range` must be in it. `aggro` is "how far will I go LOOKING for a fight", rightly the smaller
number for a man who walks up to what he strikes; for every unit bar one it is also the LARGER
of the two, so the omission could not show. The Bombard was the exception on purpose — 365 reach
against 240 aggro — and being a SHOOTER it is held in the back line, precisely the band where it
sees the throne and, without `range` in the radius, does not fire. Nothing names the Bombard: a
longer-reaching kind added later lands right by having a reach. **AND NO GUN OUT-REACHES THE
TOWERS ANY MORE** (the designer, 2026-08-18): the Bombard's reach is 240, under a plain
Watchtower's 250 and every branch and level above it — a gun that shelled stone from beyond every
tower left a defender no counter. It still out-reaches the Seat's own gun (200), and its
`aggro` (200) stays under its reach so it remains the one kind the rule can be seen on.
(→ LEDGER: NO GUN OUT-REACHES THE TOWERS)

**A WALKER FORTIFIES FIRST** (ai.js, the walk clause; the designer, 2026-08-19, from a
chronicle at PRINCE in which Brand walked at 3:57 with nothing beside his Shrine, sent his army
at the player's court in the same breath, had his Gates raided, ran dry and was torn off the
lines at 52%). Two gates on the walk: the affordability sum counts only `WALK_INCOME` (0.8) of
the income — a raid takes income away, never the bank; and `WALK_TOWERS` (two) finished towers
within `CLAIM.seat` of the Seat (or a curtain) must stand before he steps on, and while the
doctrine wishes to walk the crew WANTS them (`fortify`, prepended to the missions — on the
vantages near home, else beside the throne and the home spring). Past the hour (`late`) the
stall-breaker outranks both. A third gate — the walker's banner held at home with no assault —
was built, measured and REJECTED: the Pattern decided 97% of contested matches with it on
(target 50, tolerate 25-75); it stays behind `AMBER_WALKHOLD=1` for the referee.
(→ LEDGER: A WALKER FORTIFIES FIRST)

**THE ANSWER TO A WALK GOES OUT AT ONCE, AND GOES FOR THE WALKER'S GATES WHEN IT IS THE
SMALLER ARMY** (ai.js `answerAt`; `WALK_ANSWER` 1, was 10). Measured: an answering army that
could not reach a Shrine behind a fortified court died on the court's guns in thirties; a
smaller army starves the walker instead (his outlying Gates pay for the walk, and the drain
comes before the muster), a plainly bigger one goes straight for the Shrine. **AND AN HEIR
RAISES NO STUB**: `spanFor` refuses a run under `WALL.gateMin + 16` — a shorter run has no
gateway and bars its OWNER; benedict's thirty-eight-unit piece across his own muster ground
jammed ninety men at home for the rest of a match (measured, seed 7). The contested Pattern
share did not come back inside the band for any of it (90%): a fortified, funded walker with
an army at home is not stopped by an equal army in five minutes, whatever it aims at; the
levers left are the walk's LENGTH (`AMBER_WALKRATE`, the referee's knob on `shrine.rate`) and
where a Shrine may stand — the designer's to pull. (→ LEDGER: THE ANSWER TO A WALK)

**AN IDLE ARMY ANSWERS A RAIDED WORK, AND RAIDS IN KIND** (ai.js `troubleAt`/`raidAt` in
`decide`; from a second chronicle at PRINCE, 2026-08-19: the player's raid company razed four of
julian's Gates in four minutes, julian's war body stood at home throughout and never raided
back, and he ended with an income of 7 and three men). On a board as in a war: a hostile at a
finished work of his beyond the court takes the war body there (outranking an errand — the Gate
under attack IS the economy), and an army of `RAID_MEN` (8) or more with nothing of his touched
and nothing but home, the choke or a crew-only errand to go to marches on the rival's nearest
outlying Gate — or with twice `RAID_MEN` whatever errand stands (brand sat at home with a hundred
men and an income of seven while his errand wanted a spring the rival had taken: the chronicle of
seed 1443391195) — never one under his throne's guns (that is the assault), never one the
footing's `hold` covers. Coordinate banners through the same `aimed` memo as a walk's answer.

**A MOMENT SAYS WHERE** (record.js): the chronicle wrote "the enemy is inside your city" for
every `hurtcity`, a Gate on a spring four hundred out included (reported from play: the enemy
never was in the city, only at gates and towers). It names the work, by whom and where, and keeps
the cry for the court's own ground — the same test the banner makes.

**THE ARMY AT HOME STANDS ON ITS WALLS, AND A HALL JOINS A STANDARD** (ai.js `defencePost`,
`hallCo`; the designer, 2026-08-18). A man is posted to a wall or a tower by his ORDER
(`postWalls`/`postTowers` read the company's rally, else the banner), and the heirs' home banner
was the city SITE — the throne — so every curtain and tower an heir raised stood empty while his
archers milled at the Seat. At home the banner goes to the finished defence facing the enemy
(a curtain run first, its bastions post with it; a tower otherwise; only inside `CLAIM.seat`),
as a coordinate banner with the same memo `aimed` a walk's answer uses. And a heir's halls
flew a new standard each (`joinCo` raises one for a hall built with no company), which handed a
human who took the court five flags to reassign; the doctrine wants exactly two — the war body
and the errand — so the first two halls of a city fly their own and every hall after joins the
SENIOR standard of that city (`hallCo`; under the reach law `joinCo` still refuses a standard of
another city). Both refereed: (→ LEDGER: THE ARMY AT HOME STANDS ON ITS WALLS).
(→ LEDGER: A MAN ENGAGES WHAT HE CAN ACTUALLY HIT)

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

**THE SIM GREW NO THIRD WIN CONDITION.** `win` still has exactly two callers. A chapter ends a
match from OUTSIDE, having watched the world game.js already holds — `World.declare(world,
winner, reason)`: guarded (it cannot overrule a Seat that has already fallen) and emitting the
same `win` event every other ending emits, so the end screen, the chronicle and the seat's
collapse behave as they always did. The objective is POLLED once per simulated frame in
game.js's own loop. Do not put triggers in `world.js`: the sim is headless-first, the netcode
is host-authoritative, and a spec board cannot cross the wire (a guest rebuilds from the seed
alone), so a scripted chapter is a single-player concern by construction.

`CAMPAIGN.run(chapter, me)` is what game.js holds for the length of one: `tick` answers
`'won'`/`'lost'`/null and never writes to the world, `say` is the HUD line (asked every frame,
so it can count down), and `hint` fires the tutorial one lesson at a time, **in order**, each
waiting for the BOARD to be true rather than for the clock to reach a number.

Adding a chapter is a table entry: `{key, title, heir, seed, opts, brief, obj, won, hints}`.
`opts` merges OVER the player's chosen footing, so a chapter may hold a rival back (`hold`) or
let him off the leash without taking the footing away. The chapter screen, the briefing, the
lock, the progress and the end screen all follow from the table with no code.

**A BANNER MUST SAY WHERE.** The `hurtcity` alert carries `bt` and `x`/`y`; the banner names
the WORK when the trouble is out in Shadow and keeps the old cry ("the enemy is inside your
city!") only for something standing on the court (`CITY.r`) — a Gate four hundred out gnawed by
one fiend must not read like a column at the throne.

**AND THE MINIMAP SHOWS WHERE THE FIGHTING IS.** A flashpoint is a PLACE, not an event
(`R.debugFlash`): violence near an existing one bumps and moves it rather than making another,
so a battle is one mark and not forty, and it decays so it says where the fighting IS. Fed from
`die`/`hurtcity`/`breach`/`raze`/`siege` — what is HIT, never a shot leaving a gun, or every
Watchtower would light the map — and from the events the viewer was already handed, which are
sight-filtered in `routeEvents`, so it cannot show what the veil is hiding. Crimson when it is
yours, gold when it is his: "I am attacked here" and "I am attacking there" are the two
questions a glance at a minimap asks.

## The Reach War (the fourth mode)

**THE COUNTRY IS ONE WORLD.** The region-graph realm (a country as a grid of little boards —
see git history and REALM_PLAN.md §9-10) is gone: what made a single big map unaffordable was
the flow field, a Dijkstra dead linear in area, and the REACH is what tamed it. Every city owns
a disc (`world.cities[].reach`); a company belongs to a city (`co.city`) and may be ordered only
inside that city's reach (`rules.reach` — refusals speak: 'reach', 'city'); and every flow field
is FENCED by the owning city's disc (nav.js `bound`), so a field costs what a field costs on
today's board however large the land grows. To strike a city two hops away you must first hold
the one between — the affordability rule IS the strategic rule. ORDERS are bounded; violence is
not: standing, pursuit and combat cross the rim freely. (→ LEDGER: THE COUNTRY IS ONE WORLD)

`WG.buildCountry` grows the land (CONST.REACHWAR: 8000×9600, 16 cities; connectivity is a
PLACEMENT LAW, not a reroll — a candidate city must be pathable inside an already-placed reach).
**AMBER STANDS IN THE MIDDLE OF THE MAP AND THE FOUR HEIRS IN THE FOUR CORNERS** (the designer,
2026-08-19): the first city is the candidate nearest the centre (the Pattern's, last in seat
order), the next four the candidates nearest the corners inside `cornerBox` — seats 0..3 in the
order top-left, top-right, bottom-left, bottom-right, each required to OPEN (one writ spring
with a Gate ring) and to reach two others, or the country is rerolled — and the rest are dealt
by max-min between them. **And every city reaches at least two others** (`minNbrs`): the reach
grows until two are in it, as it grew for one; a court with one neighbour is a cul-de-sac. RIVERS run
from the interior to the sea and ROADS are FOUND over the land's own costs (climb charged
dearly, reuse half-price so trunks emerge), with BRIDGES where a crossing beats the toll — all
stamped as real terrain (`WG.T.ROAD/BRIDGE`, cost 1, unbuildable), so columns funnel onto the
highway on their own and a bridge is a chokepoint nobody declared. The renderer draws a country
as TWO GROUNDS: a cheap ImageData base at any size, and painterly detail tiles that follow the
camera (one baked per frame, twelve resident, seams killed by pad-and-crop plus per-site
seeding); the veil's per-frame CPU is windowed to the view. `realm.js` v2
is only persistence + `REALM.run` (CAMPAIGN.run's shape; endings via `World.declare`): the save
regenerates the country from its seed and writes down only what was DONE (~7-100KB under
`amber_realm` v2; a v1 record loads as null and `REALM.lost` says so once). The one Pattern
lives in the sim (`placementError`: a Shrine only for AMBER's holder); there is no lord brake
any more (see "what you break and hold, you keep" below). Every seat runs an HEIR's doctrine
through `warOrders` (see "every seat in a war is an heir"), and AMBER's holder builds the Shrine
and walks, which is the war's clock. `?reach=SEED` dev-boots a country through the real renderer. A LAN table is
dealt INTO the host's war when one is open: the wire carries `{war: {seed}}` and nothing else
of the country (a guest regenerates the ground from the seed; history rides the ordinary
absolute snapshots), humans take the contender seats in join order, and the host's lords play
the rest.

**A WAR HAS TWO SIDES — OR AS MANY AS IT HAS HEIRS** (`REALM.create(seed, spec)`, `REALM.setup`,
createWorld `opts.sides`). Two to four CONTENDERS in two sides — seat 0, the human at the table,
always first on side A — and the rest of the country minor lords. A FREE-FOR-ALL (the designer,
2026-08-19) is every contender his own side (`{ffa: n}` on the setup screen, `[[0],[1],[2],[3]]`
as sides; the LAN lobby's `#lan-ffa`), and nothing downstream knows the difference: `World.lost`,
`endMatch`'s verdict, `refound` and the coalition against a walker all read `world.sides` as a
list, and `REALM.setup` tidies any number of sides (seat 0 leads the first, a seat named twice
keeps its first side, empty sides are dropped, a lone side is given an enemy). A side is ONE BANNER FROM GENESIS: every member's
`realm` is the side's first seat, so wins and losses (the run judges by banner), sight,
hostility and terms all follow from the realm code and nothing in the sim knows the word "team".
The designer's default is you against three heirs, each contending for AMBER and the walk. The
setup screen (`UI.warSetup`) takes COUNTS — heirs at your side, heirs against — and the ally
courts are dealt BY GEOGRAPHY once the country exists (the contender courts nearest yours); a
LAN lobby's sides are explicit seats (humans on 0..n-1 in join order, replacing the heirs, bots
on the seats after; `lanSides`, the `#lan-sides` panel — TWO COLUMNS, one per side, a chip per
heir, a tap on a human's chip moves him across and each column adds or removes bots of its own;
the designer, 2026-08-19, from a photograph of the old stack of rows). The sides ride the save (`rec.sides`)
and the wire (`{war: {seed, sides}}`), because a guest regenerates the country from the seed
and must deal the same banners. AN ALLY IS A CONTENDER, NOT A VASSAL: a heir of your side plays
at the footing with his own initiative and the walk, only does not treat (the founder does), and
the council offers neither COMMAND nor a stance on his court. `won` at the end screen is by
banner, and a lost war names the ENEMY side's founder, never seat 1 (which may be your ally).
**A FOUNDER BROKEN RE-FOUNDS HIS BANNER, AND A PLAYER BROKEN HAS LOST** (`World.refound`, in
`holdCities`; `REALM.run.tick`). A banner is NAMED for its founder, so when the oath swears him
to the taker every lord still pointing at his index points at a man of another banner — an
orphan: `foe` to its own former liege, no terms row (its founder's `realmOf` is not himself),
and the pact command normalising onto him and refusing with `seat`. Found on the council page,
where the first lord sworn by hand was the heirs' founder; the sim did the same to a
contender's sworn lords all along. The vassals re-found under the senior member — a CONTENDER
before a minor lord, so a side that loses one heir is led by the other — and the banner's terms
fall with the founder. They do NOT follow him (one court would hand over a side) and do NOT
each go free (allies stay allied). And the loss: "your banner holds no city" was written when
a taken court changed OWNER; under the oath a conquered player kept his court and was counted a
member of his conqueror's banner — told he had WON when the conqueror walked. `tick` asks
first whether seat 0's realm is still inside the side he was DEALT (`world.sides[0]`; the wire
carries `sides` so a guest's `endMatch` judges the same way). The council page (test) SILENCES
the bots after the war starts — its questions are about the roster and the map, and a rival
asking you for terms in the first minute changes every one of their answers.

**The rules of a war**, all of them off in every other mode: `reach`, `occupy` (a Seat yields
and the ground must be taken), `endOnSeat: 0` (dispossession, not death), `truce`,
`onePattern` (a Shrine may rise only in the Pattern's city, held), and `walkMul: 0.4` (the walk
is slower on a country, so a walk begun three reaches away is not a win nobody can touch).

### A CONQUEST TAKES AN OATH, NOT A DEED

**`players[i]` IS THE LORD OF `cities[i]`, PERMANENTLY, AND A CITY IS THE ECONOMIC UNIT.** A
country builds one player per city, each with its own purse, Gates, halls, crews and companies;
conquest must not dissolve that (moving `city.owner` left a beaten lord with a treasury he could
not spend and his works inert in the taker's court). (→ LEDGER: A CONQUEST TAKES AN OATH)

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
  his BANNER'S, and drives the HUD's count, and winning and losing. The
  46-owner-comparison hazard in the CLAUDE.md note above is now a THREE-way question: "my
  realm's" (sight, hostility, terms), "my city's" (purse, crews, writ, formations, wall gates,
  muster cap), and "may I strike this".
- **A realm SHARES ITS SIGHT and nothing else.** `visionSources` unions the banner's sources and
  `refreshVision` casts ONE mask per realm and shares the object. Memory (`seen`, `explored`,
  `ghosts`) stays each lord's own and converges, because it rides the wire and the save per seat.
  (→ LEDGER: A realm SHARES ITS SIGHT)
- **Terms are sworn between banners.** `pactOn` and the `{c:'pact'}` command both normalise to
  the realm's founder, so a vassal cannot keep a private peace with the army besieging his liege.
- **A war can be LOST** (`REALM.run.tick`: your banner holds no city) **and WON by absorption**
  (`holdCities`: one banner left holding ground → `win(..., 'castle')`, only where `endOnSeat`
  is off, so toppling still owns that rule everywhere else).
- **WHAT YOU BREAK AND HOLD, YOU KEEP.** The lord brake is gone on the designer's call, and with
  it `pl.lords`, `CONST.REALM.lords0`, the `refused` event and its banner. The brake on a
  conquest is the army it takes to break a Seat and the twenty uncontested seconds in the court.
  (→ LEDGER: WHAT YOU BREAK AND HOLD, YOU KEEP)
- **EVERY COURT IS NAMED, AND A LORD IS NOT HIS CITY.** `REACHWAR.names` is twenty (add a city,
  add a name) and the fallback is a NUMBERED shadow, so a bag that runs short is visible instead
  of collapsing several courts onto one name. **And a CONTENDER is named for himself.** `warName`
  answers it: seat 0 is the player, a minor lord IS his city and keeps its name, and a contender
  wears the name of the doctrine he is actually running (`warKind`), so the name can never
  disagree with the brain in the seat. A CITY is still named as a city everywhere a city is
  meant — the attack-order labels, the neighbour lists, the map.
  (→ LEDGER: EVERY COURT IS NAMED, AND A LORD IS NOT HIS CITY)
- **AND A MINOR LORD HOLDS GROUND; HE DOES NOT CONQUER.** An heir's whole game is to take the
  nearest rival court — on the thirteen non-contenders that was fifteen little empires eating
  each other. `warOrders` turns a minor lord's war body away from a rival COURT and onto the
  nearest spring worth taking (`springTo`), so he still expands, answers trouble and defends; an
  explicit `attack`/`support` from his LIEGE is exempt, because the player's order outranks his
  doctrine. (→ LEDGER: AND A MINOR LORD HOLDS GROUND; HE DOES NOT CONQUER)
- **A HOSTILE IS SOMEBODY I MAY STRIKE, AND `World.foe` IS THE ONE SPELLING.** `AI.view`'s
  `visHostiles` asks `World.foe`, never `owner !== me` — that gets a PACT PARTNER's men and a
  SWORN LORD's men both wrong. The sim stays permissive on purpose (a human may storm ground
  beside a partner to catch Chaos in it); what was wrong was the CHOICE. A no-op for the
  referee: `RULES.truce` is 0 in a skirmish, so `foe` is always true there.
  (→ LEDGER: A HOSTILE IS SOMEBODY I MAY STRIKE)
- **EVERYONE AT THE TABLE EARNS BY THE SAME ECONOMY.** The designer's rule (2026-08-17): no
  footing and no seat carries an income handicap; a lesser heir DECIDES WORSE (see "the footing
  scales the whole country" below and `CONST.DIFFICULTY`) — an income handicap made every death
  spiral permanent. `players[].eco` still exists in the sim, for a scripted CHAPTER only
  (`opts.eco`, a story's feeble tutorial rival); nothing else writes it below 1.
  (→ LEDGER: EVERYONE AT THE TABLE EARNS BY THE SAME ECONOMY)
- **AND A LORD WHO CANNOT AFFORD HIS PLANS STOPS BUYING MEN.** A doctrine issues `{c:'muster'}`
  so a lord whose halls drink everything he earns can save for the Gate. WAR ONLY
  (`rules.reach`), like `warOrders`: the duel economy is tuned against a referee. It asks for a
  STATE and only when that state differs, and the test is the WANT rather than the wallet — he
  shuts it only with something he means to build and cannot, and opens it the moment he can pay.
  **Judged on what his halls WOULD drink (`musterCap`), never on the live `drainRate`**, which
  flaps: a shut muster drains nothing, so he reads solvent, opens, drains, shuts. The rig that
  holds it asserts the lord is actually in the red.
  (→ LEDGER: AND A LORD WHO CANNOT AFFORD HIS PLANS STOPS BUYING MEN)
- **A COURT THAT HAS FALLEN IS OUT OF THE FIGHT UNTIL IT SWEARS** (`World.fallen`), or the
  claimant's men spend the twenty seconds knocking down the halls and Gates he is about to
  inherit. Its works are **nobody's target** (guarded in `acquire` AND at `hurtBuilding`'s door,
  so a splash pass added later cannot forget) and **its towers do not fire** — without that
  second half the claimant would be forbidden to strike the stone while the stone went on
  striking him. His MEN fight on: what is decided is the court, not the man. `players[i]` is
  the lord of `cities[i]` permanently, so the test is one array read; and it cannot touch a duel
  by construction, because a Seat only yields under `rules.occupy`.
  (→ LEDGER: A COURT THAT HAS FALLEN IS OUT OF THE FIGHT UNTIL IT SWEARS)
- **AND AN ORDER BIASES THE CREW, NOT ONLY THE COLUMN.** `warOrders` rewrites where the war BODY
  goes and nothing else; the mason must hear the order too. `wantGates` picks from `nodes.own`
  and `nodes.mid`, capped, filtered to springs NOBODY holds — null for an inner lord in a
  developed country. `ordered()` prepends the order's own want to `P.missions(v)`, recomputed
  every think, so as soon as one spring is taken the next free one inside his reach is wanted.
  FREE only there, though the march will happily go and take a rival's: a crew cannot raise a
  Gate where another stands. `walls` gets the works arm it never had for an heir (`wantWatch`).
  (→ LEDGER: AND AN ORDER BIASES THE CREW, NOT ONLY THE COLUMN)
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
- **NOTHING IS SPECIAL ABOUT THE STARTING CITY.** Every seat in a war has a driver
  (`game.bots[i]` for all `i`, seat 0 included), and the sim loop skips exactly one — the HAND
  (`game.handOf()`). So while the player commands another court his home court is run by an
  inner lord like any other, and the court under his hand is driven by nobody but his taps. On
  a LAN table the host's own seat has a driver too; a guest's seat has none (a human holds it),
  which leaves a guest's own court unrun while he commands a vassal — the host does not know a
  guest's hand (TODO). Held by the browser suite on the drivers' own `step` counts.
- **A LORD OF THE PLAYER'S BANNER IS A MINOR LORD, NO STRONGER, AND TAKES NO INITIATIVE**
  (`warFooting`, the designer's rule). He plays at the footing plus `CONST.MINOR` exactly as an
  unsworn lord does — seat 0 included while the hand is elsewhere, though it was born a
  contender — so the vassals are never strong enough that the player has nothing to do; he
  neither treats nor walks (`noTerms`, `noWalk`: the human's decisions; a walk from a court a
  vassal holds means taking COMMAND of it); and `obey` turns his war body away from every rival
  court as a minor lord's is turned — the player's ⚔ order is the one way a vassal attacks.
  Re-dealt on the oath: the frame loop re-makes a lord's bot when the sim's `taken` event names
  him. The rest of the lords' design is proposed in `LORDS_PLAN.md`.
- **A MINOR LORD NEVER WALKS THE PATTERN** (`warFooting` deals every non-contender `noWalk`; a
  `noWalk` bot raises no Shrine either). From a chronicle in which AMBER's own lord — sworn to
  another minor lord — walked to a hundred and ended the war with no heir near it: the walk is a
  contender's and only a contender's, and a minor lord holding AMBER holds it FOR whoever conquers
  him. The war's clock is the heirs taking the cities between them and AMBER.
- **TERMS HOLD FOR THIRTY SECONDS** (`PACT_HOLD` in ai.js). A doctrine on a knife-edge — Bleys
  treats only while his army is under fourteen, so every recruit and every death flipped it — made
  and unmade terms every think and every reciprocator followed him: a chronicle carried "X breaks
  with AMBLERASH / X and AMBLERASH come to terms" once a second for minutes, and every seal
  disengages men mid-fight. An offer made or withdrawn stands `PACT_HOLD` before the doctrine may
  change its mind.
- **A COMPANY WITHOUT ITS STANDARD IS STILL SENT, AND THE COURT YOU CAN STRIKE IS THE ONE THAT
  MATTERS.** Two holes that together left the heirs taking no court in twenty minutes at PRINCE:
  `warOrders` remembered the aim so a banner was not fanned out every think, and so a company that
  lost its rally afterwards (struck when it stopped being the errand; raised after the aim was set)
  stood at home for the rest of the war — measured, bleys with two thirty-two-man companies at
  home and a two-man company carrying the assault; the memo now decides only whether the aim MOVED
  and each company is rallied when its own standard is not already there. And `AI.view` oriented
  on the nearest rival court by distance alone, which under the reach law can be a court just past
  the rim — every rally clamped into the reach parked the whole army on the rim toward it forever;
  a court inside the seat's own reach now comes before any beyond it (a board has no reach and
  reads exactly as it did — twelve seeded duels trace identical).
- **A WALKER IS EVERYBODY'S ENEMY, AND EVERYBODY ELSE'S FRIEND.** While anyone is on the lines,
  every founder who is not walking offers terms to every other who is not (the coalition) and
  none to the walker; the answer to a walk (`WALK_ANSWER`) is NOT held off by the footing — a
  walk is the endgame begun and a beginner who stepped on under a thirteen-minute hold would win
  uncontested (GAME_VISION pillar 4) — and it is exempt from the minor lord's turning-away in
  `warOrders` (`cmd.walk`), or thirteen seats of sixteen would answer a walk with a spring.
- **A LORD OF YOUR BANNER PLAYS UNDER A STANCE, AND EVERY STANCE HAS TO MEAN SOMETHING**
  (`LORDS_PLAN.md` §3.1; ai.js `stanceOf`/`STANCE_OF`, game.js `ORDERS`). Three stances — a
  way of PLAYING, not a destination: WARDEN keeps and fortifies the court (standards struck,
  towers on the vantages), STEWARD grows the country (the errand takes the springs in reach —
  `springTo`, the same answer the crew's Gate want uses, so the march and the mason want the same
  spring — and never a court), MARSHAL is an army for the banner (the pressed court of the banner
  first, the liege's own war body afield next, home between). ⚔ <court> and SUPPORT <court> are
  TARGETS over a stance, and ⚔ is the one way a vassal ever attacks a court. The old five words
  are read as stances (`hold`/`walls` → warden, `gates` → steward) so a saved helm keeps its
  meaning. **A lord given no stance takes one from his geography** — a rival court on his border
  makes him a warden, an interior court a steward — and the council row says "by default", so it
  is never a secret and can be overruled. **A PRESSED COURT OF THE BANNER DRAWS ITS NEIGHBOURS**
  (§3.3, `pressedCourt`): for every lord of the banner whose reach covers it, whatever his stance,
  the liege's court first — unless his own court is the one pressed. **TO ARMS** (game.js
  `onToArms`/`liftArms`) is the one banner-wide order: every lord in reach of the court under
  your hand is set to SUPPORT it, timed (`until`, `arms`, `was`), and the frame loop lifts it
  when the court has been quiet `TO_ARMS.quiet` seconds or the span is out, giving each lord his
  stance back. A timed order past its hour is no order (`stanceOf`). Bounded by the reach law
  like every order: a lord two hops from a siege cannot help, and the alarm says how many could.
  (→ LEDGER: AND EVERY ONE OF THE FIVE WORDS HAS TO MEAN SOMETHING)
- **AND A SPRING A RIVAL HOLDS IS STILL A SPRING TO TAKE.** A reach is fully spoken for far more
  often than it sounds. `springTo` prefers free ground (walk on and build) and falls to the
  nearest spring held by somebody `World.foe` says he may strike; the WORKS arm still asks for a
  free one only, because a crew cannot raise a Gate where another stands. When there is nothing
  to take **the order withdraws its claim rather than becoming "stand still"** — null, not
  `'home'`, which under the reach law strikes every standard — so the lord falls back to the
  doctrine he would have had without it. (→ LEDGER: AND A SPRING A RIVAL HOLDS)
- **AND HIS DEFAULT — no order at all — HAD THE SAME THREE HOLES, all reported from play** (an
  interior lord stood at home all war; **Chaos could gnaw an outlying Gate**; **he could never
  build on one**). The default lives in `warOrders` (every seat is an heir, and this is the one
  seam): with no standing order, trouble at an outlying work of his (`troubleAt`) sends the war
  body to the WORK — a minor lord always, a contender only when his own doctrine had him standing
  at home, because an assault is not turned back for one fiend at a Gate — and when nothing of
  his is touched and the doctrine would keep him in the yard, he goes to the neighbouring court
  of his banner that is pressed or exposed (`reserveAt`). The spring inside his reach is the
  heir's own errand, and the turning-away from a rival court is the "minor lord does not conquer"
  clause beside it. **A lord behind the lines is a reserve, not a statue.**
  (→ LEDGER: AND HIS DEFAULT)
- **EVERY SEAT IN A WAR IS AN HEIR, AND A MINOR LORD IS A WEAKER ONE.** An heir moves its army
  with `{c:'banner'}`, and under the reach law there is no one banner an army answers
  (`standingOrder` falls back to a company's own city), so an heir in a country was MUTE. The
  word is translated and the doctrine is not rewritten: **`warOrders`** (ai.js) wraps `issue`
  for every bot under `rules.reach` — a banner becomes a rally for each of his companies at that
  point, the Recall (`site: -1`) strikes every standard, and any rally is CLAMPED into its
  company's city disc. Clamped, not refused: the sim refuses a human's order past the rim on
  purpose, and a bot with nobody to tell wants *march as far toward it as I may*. Off entirely
  without `rules.reach`, so a board and `node sim.js` see the caller's own `issue` byte for byte.
  **The liege's five words are applied at the SAME seam**, because an heir has no `custom` and
  would otherwise have read none of them. `attack`/pressed `support`/`gates` replace the war
  body's destination; `hold`, `walls` and an unpressed `support` strike the standards, which
  under the reach law is what "keep your own court" means. Everything else the heir does runs
  untouched underneath — "a bias on the same brain".
  **`warBot(world, pi)`** in game.js seats it, and **the footing scales the whole country**: the
  picker says "how hard the heirs play" and a war must read it, and never stamp into the
  CHRONICLE a footing nothing read. `warFooting` is the one answer: a contender plays at the
  player's footing, a minor lord at that footing made worse by `CONST.MINOR`, composed per field
  by what each field IS — `slow` MULTIPLIES (a think-interval multiplier), `noise` and each LAPSE
  take the WORSE of the two (stacking double-charges one axis), `hold` is the footing's own.
  **A FOOTING IS A QUALITY OF MIND, NOT A PURSE.** The income fraction (`eco`, dealt by
  `warPurses`) is retired — difficulty is decision quality. Each rung carries LAPSES
  (`CONST.DIFFICULTY[..].lapses`), named flaws wired at the exact decision points in ai.js
  `decide`: `gates` (overlooks expansion — his own errands and the spring under his feet, never a
  liege's order), `up` (forgets the upgrade scan, levels and forks alike), `aim` (a NEW order
  sends the army somewhere known and wrong, and it sticks for half a minute — never while his
  Seat is threatened, never onto a rival's court, so it is no way round `hold`), `trickle` (the
  COMMIT floor falls toward a handful, so assaults arrive in dribs), `siege` (marches on the Seat
  with nothing that breaks stone and never raises the Works answer), `hoard` (reads his own purse
  at 1/(1+hoard), so every purchase waits for a multiple of its price). `gates`/`up`/`siege` are
  SPELLS — a flaw rolled fresh every think is almost no flaw, because missions and errands are
  sticky — holding `SPELL` seconds, with the entry chance derived so the table's number is the
  long-run FRACTION of the match spent lapsed. **Every roll draws from the bot's RNG only when
  the flaw is set**, so an heir made with no footing — every heir `node sim.js` seats — plays
  byte-identical to before: held by a suite that plays twelve seeded duels both ways and hashes
  the traces. PRINCE has no lapses.
  **AND `hold` IS A PROMISE TO ONE BANNER.** It is checked against the heir's NEAREST rival
  court — the player's in a duel, mostly another bot in a war — and ungated, an easy footing
  stops **the whole country making war on itself**, a duller war rather than an easier one.
  `opts.holdOn` (the viewer's banner, seat 0 by default, so a duel is identical to the byte)
  gates both places `hold` is read: the banner march and the answer to a rival's walk.
  `CASTLE_ZONE` still makes any man within 46 of a throne strike it, so a lord fighting over a
  spring beside your court scratches it whatever his orders say. The temperament is chosen by
  SEAT so a court fields the same character on every machine and across a save without a byte
  of state saying so. **The `lord` baseline is DELETED** (2026-08-17): two implementations of
  the five words drifted once, so its default was ported into `warOrders` and its suites drive
  an heir, which is what the game seats.
  (→ LEDGER: EVERY SEAT IN A WAR IS AN HEIR, AND A MINOR LORD IS A WEAKER ONE)
- **A COUNTRY PAYS FOR ITS OWN PATHFINDING.** `NAV.cacheMax` (48) and `NAV.perTick` (1) are
  DUEL numbers; a country's working set sits above them, so the cache filled, dropped EVERYTHING
  and rebuilt it, and a deferred field is a man steering straight at his goal. A country gets
  `world.navCache` 96 and `world.navRation` 4, both per-WORLD so a board is untouched to the
  byte. **The reads were never the problem and a proximity scheme would not have helped**: the
  cost is the Dijkstra, per distinct GOAL — essentially one per ordered company — so the lever
  is fewer distinct goals (one doorway per wall run), never fewer readers. **What IS wasted is
  size**: a bounded field is fenced to a disc but allocates the whole grid; sparse-to-the-bound
  is written down rather than done. (→ LEDGER: A COUNTRY PAYS FOR ITS OWN PATHFINDING)
- **AND THE STONE NEAR A MAN IS BINNED TOO.** `rebin` binned only the MEN while `stand` (via
  `project`) and `steerClear` walked every building of every player **per man, per tick** —
  the reported lag on a country. `world.wbins` is rebuilt once a tick in `rebin` (O(works), so
  staleness is impossible to observe) and `worksNear` answers from it. Three things the fix
  turns on, each found by measuring: (1) **the ORDER is part of the answer** — `stand` MUTATES
  the man as it projects him off each work, so `_ord` records the full walk's position and the
  candidates are sorted back into it; (2) **the query must cover where he ENDS, not where he
  began** — hence `pad * 3`, free at `WBIN` 96 (the same 3x3 of cells); (3) **a work thrown down
  MID-tick** is spliced from `pl.buildings` and a bin cannot notice — `hurtBuilding` stamps
  `b.gone` and `worksNear` skips it. **The control ships with the code**: `World.slowWorks` is
  the full walk in its original order, and the suite plays the same seeded country BOTH WAYS and
  compares man for man every tick — a faster pass that plays a different game is not an
  optimisation. What is left is `acquire`; see TODO.md — the unit `BIN` is 280, 7x the area an
  aggro radius needs, but changing it reorders `forNear` and therefore tie-breaks, so it is a
  referee change and not a free one. (→ LEDGER: AND THE STONE NEAR A MAN IS BINNED TOO)
- **A DECIDED WAR IS REMEMBERED AS DECIDED, WHOEVER DECIDED IT.** A war ends through the SIM as
  often as through its run and neither asks `run.tick`, so `done` is set at `endMatch`, the door
  every ending passes through; and it is written to the RECORD and read back by `REALM.load`,
  or the menu's "a decided war is not resumed" check never fires.
  (→ LEDGER: A DECIDED WAR IS REMEMBERED AS DECIDED)
- **A guest plays a REALM.** `mine` in `Net.snapFor` and in `hostView` is same-realm, not
  same-seat; `realm` and `heirs` ride the wire; a guest's command carries `as` (the lord it is
  for) and the host vets it against the seat it arrived on, which is the only unforgeable thing.
  **And `hand()` reads the SNAPSHOT's banners on a guest**, never `refWorld` — the country as it
  was at genesis, every lord his own banner — or a court a guest has just conquered is "not of
  his banner" at the hand while the council offers COMMAND for it, and the tap does nothing
  (reported from a LAN war, 2026-08-19; held by the guest's-half suite).
- **A LAN TABLE HAS TWO BEGINNINGS, and the button says which.** `lan-start` deals a board;
  `lan-start-war` appears only when there is an undecided war and deals the table into it. Every
  `Net.send` in the deal is guarded: one channel throwing takes the whole handler down, which
  looks exactly like a BEGIN that is not wired up. (→ LEDGER: A LAN TABLE HAS TWO BEGINNINGS)
- **A GUEST IS IN THE WAR TOO, and `game.war` is the CLIENT'S word for it.** Set on host AND
  guest, or a guest gets no ⚑ chip, no council, and no way to reach anything he owns. The two
  things that really are the host's alone are `game.realm` and `game.run`, and every writer of
  state guards on **those** (`saveWar`, the `REALM.save` ticks, `onSteward`), never on
  `game.war`. The helm rides the realm when there is one to save it in and lives on `game.helm`
  when there is not. A guest may take command of a sworn lord (`issue` carries `as`) but is
  offered no STANDING ORDER — doctrines are stepped on the host, so it would sit in a helm
  nothing reads, the dead-button failure. (→ LEDGER: A GUEST IS IN THE WAR TOO)
- **THE COUNCIL ASKS THE VIEW, NEVER THE WORLD.** `players[viewer].explored` never crosses the
  wire. `view.sites` is the memory-filtered list both views already carry (live if seen,
  `live:false` if remembered, absent if neither), written once for the host's screen and the
  wire alike; crews come off `World.masons(view, pi)` for the same reason. A fog rule must not
  be able to land on one of these screens and miss the other.
  (→ LEDGER: THE COUNCIL ASKS THE VIEW, NEVER THE WORLD)

### WHEN THE TABLE BREAKS UP

**A CHANNEL CLOSING SAYS NOTHING ABOUT WHY, AND A KILLED APP SAYS NOTHING AT ALL.** A killed
app, a flat battery or a dropped Wi-Fi arrive as *nothing* — `dc.onclose` never fires — so a
staleness check is required. (→ LEDGER: WHEN THE TABLE BREAKS UP)

- **Leaving says so**: `Net.bye` sends `{t:'bye'}` to every peer before `Net.close`, each send
  guarded on its own so one dead channel cannot swallow the other goodbyes. It is the only
  difference between "the table is ended" and "the link is lost", and they are told apart.
- **Silence is read as what it is** (`LINK` in game.js): `quiet` 3s → one banner, still in the
  match, because a host who backgrounds his phone may come back; `dead` 10s → the table ends.
  A snapshot landing clears both, so a bad moment on the Wi-Fi costs nothing.
- **HOST MIGRATION IS OFF THE TABLE, and that is an answer rather than a gap.** Only the host
  holds a world; a guest holds fog-filtered snapshots, so there is nothing on his phone to
  continue from. `endTable` ends it cleanly, keeps the chronicle, and — in a war — says the
  country is the host's save.
- **A DESERTED SEAT IS PLAYED BY SOMEBODY** (`adoptSeat`), never a statue. `game.bots[i]` is
  null on every seat a HUMAN holds, so filling in the departed index is the same statement a war
  already makes about the seats nobody claimed — the lord's doctrine in a war, an heir on a
  board. One banner, not two: "the link is severed" and "a shadow of him fights on" are one
  piece of news.
- **The host's back press asks once**, and only his, and only with somebody seated. Back is free
  and instant everywhere else and must stay so, which rules out a modal; the phone's own idiom
  is the answer, where the first press says what the second will do.
- **A SEAT THAT HAS LOST WATCHES, AND THE TABLE ENDS WHEN THEY ALL HAVE** (`World.lost`,
  game.js `spectatorTick`/`endAllLost`, `Net.snapFor(..., watching)`, `UI.spectate`).
  `World.lost` is the ONE spelling of "out of the fight": toppled on a board (`pl.out`), or in a
  war his court sworn to a banner outside the SIDE HE WAS DEALT (`world.sides`; seat 0 alone
  when there are none) — the one thing conquest cannot rewrite; `REALM.run.tick` asks it of
  seat 0 and the host asks it of every human seat (`humanSeats`: the viewer plus every guest
  whose channel is open). A human seat that has lost joins `game.spect`: his veil is lifted at
  the VIEW (`hostView`'s `see`, the snapshot's `allSeen` — never in the sim, whose sight the
  driver now running his court reads), his controls go (`#hud.watching`), his orders are refused
  three times over (`issue`, the host's queue, and for a toppled heir the sim's own `out` door,
  which lets only the halt through), and in a war his court gets a driver like any seat nobody
  human holds. **He keeps his colours**: `watchView` pins the view's copy of him to the banner his
  dealt side fights under, or the enemy would turn gold the moment he fell. The table ends ONLY
  when the last human seat has lost — solo, that is seat 0 at once, as before — through
  `World.declare`, naming the banner that broke the viewer (`realmOf(viewer)` IS the conqueror
  under the oath; on a board the strongest heir standing). `endMatch`'s `won` is "the winner's
  banner is founded inside my dealt side", never the viewer's CURRENT realm, which after the
  oath is the conqueror's. Found while testing: **the shader veil never lifted for a spectator**
  (`uFogOn` left at 1 when the veil block was skipped) and **a guest could never lift a halt**
  (his commands were drained inside the step loop, which takes no steps while halted).
  (→ LEDGER: A SEAT THAT HAS LOST WATCHES)

### ⚑ THE WAR COUNCIL, AND WHAT THE MAP STOPPED SAYING

**A WAR'S STATE IS A PLACE YOU GO, NOT A CORNER OF THE MAP.** A duel's HUD held nine things and
a war's additions collided on a phone. (→ LEDGER: A WAR'S STATE IS A PLACE YOU GO)

- **`#war-chip`** stands alone on the right rail: `⚑ held/all` and a DOT that appears only when
  something is waiting on you (a rival asking terms, a court of yours hurt, a yielded court
  nobody holds, a sworn lord with no order). A chip permanently reading "at war — tap to offer"
  is an ECHO, which the banner rule forbids.
- **`#council`** is the Muster Roll's shape (a panel over everything, packed from the top, one
  way out at the end of the scroll) but it returns to the MATCH and the war keeps running. It
  carries the banner's totals, a row per court — colour, lord, its OWN income and men, its
  standing order, its throne — and terms per rival banner. **A row is the way to a city**: on
  8000×9600 you cannot find a court by dragging.
- **A COURT IS PUBLIC, AND THE COUNCIL MAY NOT INVENT A FOG THE SIM DOES NOT HAVE.**
  `world.cities` carries where every court stands and WHOSE it is, to every seat — in a country
  "whose is that" IS the map — so no row hides behind having laid eyes on the site. What stays
  fogged is where the ARMIES are. Noise is a PRESENTATION problem: terms sort by what is waiting
  on you (asking → at terms → your offer standing → the rest by how much of the country they
  hold), never by withholding what the sim publishes. (→ LEDGER: A COURT IS PUBLIC)
- **ONE ROSTER, AND TERMS ARE AN ACTION UNDER A COURT.** Terms are an inline `cc-acts` strip
  under the row, exactly as COMMAND and the standing orders are for a court of your own; there
  is no TERMS heading (banner header rows were tried and do not condense). Drawn under a
  banner's FIRST court only — terms are sworn between BANNERS — which is why `cities` is ordered
  so a banner's courts are adjacent. The strip carries `data-pi` because its LABEL may repeat.
  A rival court's sub-line says whose banner he answers to, when it is not his own, never its
  own name back at you. (→ LEDGER: ONE ROSTER, AND TERMS ARE AN ACTION UNDER A COURT)
- **The masons moved to the purse.** They are the same question — what can I spend — and the top
  of the screen had no room left.
- **THE COUNTRY IS DRAWN, because a roster is a list and a war is a SHAPE.** The council opens
  on a MAP: the land, a mark per court in its BANNER's colour, its name, and its reach as a
  faint disc — the war's real geometry. Ownership is LIVE, on the owner's call, because it is
  what the sim publishes. Built from the same `view.cities` the rows are, and a tap on a court
  goes through the SAME handler as its row — one way to reach a city, not two that drift. The
  ground is `Render.groundImage()`, handed over rather than baked again. It is NOT the minimap
  and must not become it. **AND A COURT ON THE MAP OPENS THE COURT.** A tap on a mark opens a
  card OVER the council (never jump the camera and close the panel): who holds it, what it
  earns, its throne, its standing order, and every action its row offers — GO THERE (kept as an
  action), COMMAND and the five words for a court of your own, terms for a rival's — built from
  the same `d.cities` entry as the row and calling the same handlers. `c.terms` rides on EVERY
  court of a banner and `c.termsHere` says which one DRAWS the strip. It peels before the
  council in `onPopState`, or one back press would read two steps at once.
  (→ LEDGER: THE COUNTRY IS DRAWN)
- **BACK IS THE WAY OUT OF THE COUNCIL**, peeled FIRST in `onPopState` because it is a panel over
  everything including a sheet still open beneath it — and it returns to the MATCH, never the
  menu: the war is running behind it.
- **The right rail is a STACK and the chip is its top item.** `#walkers` is anchored at the same
  place, so `UI.warChip` measures the chip and pushes the board below it; without that the two
  sit on each other the moment anybody steps onto the Pattern.

### THE MAP SAYS WHOSE

**"MINE" IS ASKED EVERY FRAME, AND IT IS THE BANNER'S.** `g.own` decided once in `buildCity` as
`pi === viewer` is the assumption `redressCities` exists to undo, left standing one level down
— it dressed every work in a conquered court as an enemy's, with **no company standard at all**.
`mineOf(view, viewer, pi)` is the one answer (realm, with the seat rule as the fallback for a
view that carries no realms), asked in the works loop each frame, and **it is part of the work
group's cache key** — a group built before the oath must not survive it, exactly as a level or
a breach must not. (→ LEDGER: "MINE" IS ASKED EVERY FRAME)

**A THRONE LEFT ALONE MENDS ITSELF** (`seatMend`, beside `seatFire`). Every other work already
self-mends (`STRUCT_REGEN` after `STRUCT_REGEN_WAIT`); the Seat is the CITY record, not one of
`pl.buildings`, so every loop that mends stone walks past it and it needs a pass of its own.
The WAIT is the shared one, so "has this been hit lately" has a single spelling; only the RATE
is the Seat's own (`maxHp / CITY.mend`, a whole throne in five minutes). **A yielded throne is
not mended, it is TAKEN** — healing one off the floor would quietly repeal `occupy`, so it stops
at zero and `holdCities` owns everything below. It says nothing: the castle bar already says it.
(→ LEDGER: A THRONE LEFT ALONE MENDS ITSELF)

Four seat colours answer a table of four; a war seats sixteen. Colour is by **banner**:
`CONST.REALM_TINT` gives you gold and each contending heir (`world.heirs`) a colour of its own
for the whole war, `CONST.NEUTRAL_TINT` is every lord sworn to nobody, Chaos is green.
`Render.tintOf` is the one answer and `UI.seatColor` asks IT rather than spelling a second
palette. Four sites keyed on the seat an heir was BORN to are keyed on the holder now: the Seat's
tower re-dresses when a court changes hands (`redressCities`), the ground bake repaints
(`Terrain.courtOwn`; the cheap base is redone and the painterly tiles near the court dropped),
the minimap mark follows, and the castle bar belongs to the city and reads its own `hp`.
(→ LEDGER: THE MAP SAYS WHOSE — colours)

## The Curtain Wall

**A work with a LENGTH** (only the Curtain Wall today): `span:[min]` in the table makes it a
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
first, so a berth freed by a death is taken by the next archer on the SAME tick — the queue is
the dealing, not a rule of its own. The ranks behind are unbounded (wrapping at `WALL.rows`
dealt men places somebody was already standing in). A man's FINAL APPROACH is judged on his own
station unless he is climbing — near the RUN is right for a man walking a parapet to his berth
and wrong for a reserve ranked far behind it. Only berthed men shoot over and are exposed. It
reads the order rather than `u.goal` because goals are assigned in the march loop, which runs
after it. (→ LEDGER: THE PARAPET IS CAPPED AND THE FOOT IS NOT)
**AND A BERTH IS AN ERRAND UNTIL HE IS STANDING IN IT.** `postWalls` deals `u.post` + `u.berth`
+ `u.toBerth`; `u.man` is set by `postAll` from where he actually IS: `atWall` (within
`NAV.arrive` of his station, or of any run of his own curtain) is the final approach, `WALL.step`
of his station is arrival. Every rule that matters keeps reading `u.man` — the cover in `hurt`,
`WALL.over` reach, the wire, the renderer's lift. Being NAMED to a berth must not be the whole
of manning (men "teleporting" to a wall). It is the tower's `tow`/`in` split, done for stone.
Four things had to be true before a man could walk there at all: (1) **he steers at the run's
GATEWAY, not at his berth** — a field is cached by its goal CELL and a berth per man mints a
goal per berth and thrashes the cache; (2) **the last stretch is `stand` alone, never
`project`** — as the tower branch does, so a man can walk into a bastion inside a curtain's
slab; he is not walking THROUGH the stone, he is climbing onto it; (3) **the parapet's line
clears `shove`'s band** (`PARAPET` = `thick + 8` against a pin at `thick + 6`), or an arrived
man is re-projected every tick; (4) **the final approach is out of the crowd** — cohesion is
what stops a man LEAVING one. (→ LEDGER: AND A BERTH IS AN ERRAND UNTIL HE IS STANDING IN IT)
**AND A GARRISON DOES NOT GIVE CHASE.** A man with a berth walks to his place and shoots
whatever comes into it (a foe just out of range must not drag him off his own wall); he also
keeps walking WHILE he shoots, because a roster that moves with the fighting is useless if
being in range stops a man answering it. (→ LEDGER: AND A GARRISON DOES NOT GIVE CHASE)
**A CURTAIN GATHERS TO THE FIGHTING, AND SPLITS FOR TWO.** Every enemy within `WALL.alarm` is
projected onto the curtain and the projections are CLUSTERED (`WALL.alarms`, `alarmSpan`) — one
alarm per body of attackers, anchored on the STONE and not on the enemy, so a Bombard shelling
from beyond anyone's reach counts. `postWalls` sorts the PLACES by distance to the nearest
alarm rather than moving men. One alarm would answer a feint perfectly, which is why there is
more than one. `world._alarms` is kept for the tests, because "did not gather" and "gathered to
the wrong place" look identical from outside. (→ LEDGER: A CURTAIN GATHERS TO THE FIGHTING)
**AND THE PARAPET IS HALF A SHIELD.** `WALL.cover` multiplies every blow that lands on a man
carrying `u.man`, in `hurt()` — the same door the tower's immunity and the chains' amplifier
use, so a splash pass or a new weapon added later cannot forget to ask. That does mean the
Jewel's storm is halved on a parapet too, the honest reading of cover; the alternative is a
list of exceptions at six call sites. Note when testing that the geometry around a run is NOT
a controlled comparison; the suite plays the same seeded world twice and varies only the
constant. (→ LEDGER: AND THE PARAPET IS HALF A SHIELD)
**AND CONTIGUOUS RUNS ARE ONE CURTAIN.** `noteWalls` unions runs of one owner whose ends fall
within `WALL.join` of each other (measured end-to-segment, so a broadside junction joins too)
and stamps `w.curtain`, named by the LOWEST run id so every machine at a LAN table groups the
same stone without a byte about it. `postWalls` rosters by curtain and deals places ROUND-ROBIN
across its runs and their bastions — dealing one run out before the next packs the men into the
first run and leaves every tower past them empty. The reserve spreads the same way.
(→ LEDGER: AND CONTIGUOUS RUNS ARE ONE CURTAIN)
**A TOWER IS A ROOM, AND THE STONE IS THE SHIELD.** `TOWER.berths` shooters whose order falls
near one of their own finished towers go INSIDE it, carry `u.tow` (NOT `u.man` — the renderer
and `station()` read that as "the wall he holds"), and throw `TOWER.over`. While `u.tow` is set
`hurt()` refuses every blow — guarded there so a splash pass added later cannot forget —
`acquire` skips him as a target, and the renderer does not draw him at all. The only way to the
men is to bring the tower down, and `hurtBuilding` spills them out **on that tick**, where it
stood, with the hp they went in with; a man left carrying `tow` for a tower that no longer
exists is a man nothing can hurt. The garrison shoots as well as the tower. The tower wears one
shield on its crown per man, keyed into the model as `+n` — the *only* sign ten archers are in
there.
**A bastion is part of its run.** A tower with `onWall` is not `postTowers`' business: it is a
place on that curtain, and `postWalls` deals the roster round the parapet and every tower in
the run together. `postAll` clears `man`/`tow` once and runs the two passes in order — each
used to clear `tow` at its own start, so whichever ran second wiped the other's answer.
**A CURTAIN HAS ONE SHELTERED FACE, AND IT IS THE POLYLINE'S.** Facing each run at the Seat
independently flips the sheltered side past a right angle of bend. `noteWalls` puts each
curtain's runs in ORDER along the wall, turns them to point the same way down it, and takes the
same HAND for every normal — all left or all right — with the hand settled at the run nearest
the Seat; curvature cannot touch that. (Chaining by "agree with your neighbour's NORMAL" is
wrong for a zigzag — measured making things worse.) `w.norm` is the sim's copy and `b.face`
(+1/-1 against the run's own perpendicular) is stamped on the WORK so it rides the wire: the
renderer cannot re-derive a chain it only holds part of. `faceOf` is the one place the question
is answered. **And a man walking to a place on it may cross the run he is CLIMBING ONTO and
nothing else of his own** (`ownStoneClear`), and he walks in at a DOORSTEP one row inside the
gateway rather than at the gateway itself — aimed at the gateway, a hole in his own nav layer,
the field routes a garrison out one gate and back in the next on a dogleg.
(→ LEDGER: A CURTAIN HAS ONE SHELTERED FACE)
**A run's sheltered face is a guess the heir may overrule.** `{c:'flip', id, on}` sets `b.flip`
and `station` (and the renderer's parapet facing) negate the normal, per run, at the point of
use. It asks for a STATE, not a toggle, takes no crew and no stone, and may be given while the
masons are still on the run.
**A wall bars its OWNER too, except at his gate** — the middle of the run, `WALL.gate` wide,
punched out of his nav layer alone. A rival is stopped everywhere including the gateway.
**AND THE DOOR DECIDES WHO PASSES.** Coming from OUTSIDE an heir's own troops always pass;
going from INSIDE the door is shut to a man POSTED to that wall, and open to everyone else. One
test does both, because a posted man's station is always on the sheltered side: inside he
steers on a second layer where his own gateways are stone, outside on the ordinary one; no
direction is modelled anywhere. `masksFor` keeps TWO layers per heir — not one per company —
and `NAV.steer`/`fieldFor` take a `shut` flag that is part of the field-cache key. It is
switched on **the side he is standing on** (`curtainSide`), never on whether the field can reach
him (keyed on reachability a doorway fills with men jittering — measured worse than open gates,
twice). A man standing IN a doorway has no field on the shut layer: he is told to step off the
threshold along the sheltered face. (→ LEDGER: AND THE DOOR DECIDES WHO PASSES)
**A breach is a ruin, but a SHELL is not.** Only a run that actually stood is breached; one
knocked over while `raise > 0` is razed like any other work — nothing stood, so there is
nothing to mend. A work under construction is attackable exactly like a finished one: `acquire`
aims at the nearest point of a rising RUN (not its midpoint), and the raise ADDS its share of
`b.maxHp` rather than setting hp from the card, so damage done to a shell stays done. `b.breach`
keeps the record on the board, out of `world.walls`, and `{c:'fix'}` puts it back for a crew and
half the stone. A mend takes a crew (`b.fixing`); a LEVEL does not — see the note on the `up`
command. Rubble keeps `WALL.rubble` of its stone so a stray blow cannot sweep the record away,
does NOT regenerate (masons only), and can be knocked down for good to free the ground.
(→ LEDGER: A breach is a ruin, but a SHELL is not)
**A tower does not shoot through stone, not even its own** — build it INTO the run (`onWall`)
and it shoots over that wall like a man on the parapet; behind the wall it covers the ground
behind the wall. `clearOfWorks` takes the owner so a tower may stand on its own curtain.
**The Seat is the exception, and the hardest gun on the board.** `seatFire` is its own pass —
the Seat is not in `pl.buildings`, it is the city site with its hp in `pl.castleHp`, so its
cooldown lives in `pl.seatCd`. `CONST.SEAT_GUN` is DERIVED from the two Watchtower branches at
their top level added together (retune a branch, retune the Seat), and it alone is **not
stopped by stone**: the Seat stands where worldgen put it forever, so if stone could shade it
the cheapest work in the game would switch the throne's guns off from outside their reach.

- **AND THE MEN SAY WHICH COURT.** The tint says whose SIDE a man is on and stays the primary
  read; a realm of six courts fields six lords' men in one colour, so LIVERY is the second: a
  pattern in a secondary colour worn on ONE cloth part of every man and flown LARGE on his
  court's tower. It is BY SEAT (`CONST.LIVERY`, `CONST.liveryOf(i)` — the one answer; twenty
  distinct pairs like `REACHWAR.names` has twenty names, plain for Chaos and nobody): `players[i]`
  is the lord of `cities[i]` permanently, so a sworn lord's men keep their own court's cloth under
  their liege's tint, it is arithmetic on every machine, and nothing rides the wire. In
  `render3d.js`: `part(..., cloth)` marks the part and `merge` carries a `cloth` attribute; the
  army draws on `MATU`, the Lambert with the `livery` arm of `fogPatch` (its own
  `customProgramCacheKey`, `userData.livFrag` the proof), fed per instance by `livB`/`livP` in
  `makeIM`; `towerModel(tint, livery)` is a GROUP now — the merged tower plus a fog-patched
  `seat-flag` textured by `liveryCanvas` (`R.liveryCanvas`, also the UI's swatch), and
  `disposeTower`/the sweep dispose its texture. A tap on another lord's man answers at the finger
  (`R.hitAnyUnit` → `UI.tapLabel`, in game.js beside `hitUnit`) with the court and the relation —
  an ANSWER, not a banner. `R.debugUnpatched()` must stay empty; a suite in each half holds it.

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
- **A work with a LENGTH**, manning, towers, gates, breaches, the Seat gun: see "The Curtain
  Wall" above.
- **Touch a number**: sim before/after. The referee is `node sim.js`, not vibes.
- **The Muster Roll is a GRID, and a man belongs to one place in it.** Small cards — emblem,
  name, what raises him, price, three numbers — under the hall that musters him, and the
  remainder (`Champion`, `Fiend`) under one last section computed as *what no hall raised*, so
  a new kind lands in exactly one of them. A tap opens a large card that spans the grid with
  the turning figure, the prose and every field the table carries; the FIGURE belongs to that
  one card, so `Render.rollStart` is handed one berth or none. It reads `CONST` and nothing
  else: `rollStat` drives the tag line off a unit def's OWN KEYS, so a mechanic the sim gains is
  never silently missing and one it drops stops being advertised. Nothing here names a building
  — which work raises a man comes off the card's `data-bt`. (→ LEDGER: The Muster Roll is a GRID)
- **A report from play**: ask for the chronicle. The end screen (and the menu, after an
  abandoned match) copies a whole match — seed, footing, a table every 20s, every order given,
  the moments — as text. `node sim.js` plays bots and cannot see what a human's match felt
  like; the chronicle can. `Rec` reads the sim and never writes to it.
