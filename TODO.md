# Amber — TODO

**Live:** https://dbikard.github.io/amber/ · repo: github.com/dbikard/amber

## Phase 0 — Headless core + tracers (MVP foundation)
- [x] Docs (vision / principles / CLAUDE / TODO)
- [x] `rng.js`, `const.js`, `world.js`: full sim (economy, buildings, units, combat, chaos,
      powers, pattern walk, win conditions) running headless
- [x] `ai.js`: random / greedy baselines + Julian, Bleys, Brand, Benedict
- [x] `sim.js` suites: mirror, gradient, round-robin, durations — targets green
- [x] Browser: sprites, render, HUD, build/upgrade sheets, powers, single-player vs AI
- [x] LAN: perils pairing ported + host-authoritative snapshot sync (2P duel)
- [x] Playwright smoke test (boots, menu → match, no console errors)
- [x] Deploy: repo + GitHub Pages

## Phase 0.5 — "The Shadow March" (v0.2)  ✅ DONE
- [x] Site-graph Shadow map (700×2400, mirrored, seeded jitter) — scrollable, portrait
- [x] Fog of war: vision from city/units/outposts; explored-memory; geography stays public
- [x] Outposts: Shadow Gates on springs (map economy), Watchposts (vision+arrows), Ramparts (path-blocking walls)
- [x] City Walls building (ring HP absorbs siege first, self-mends) + war-banner army control
- [x] Economy rework: units + powers cost essence (no more idle 20k banks — sim-verified)
- [x] AI heirs: expansion missions + banner strategy; suite re-balanced (triangle intact)
- [x] Vision-filtered MP snapshots (banner secret, units fogged) — loopback PASS
- [x] Minimap with alert pings + camera drag

## Phase 0.6 — "The Painted World" (v0.3)  ✅ DONE
- [x] PixiJS v8 renderer (vendored, no build step) — WebGL, additive glows, soft fog holes
- [x] Procedural painterly terrain bake: biomes (golden Arden → shadow midlands → ashen north),
      ~500 forest trees, corruption bleeding from the black road, cobbled paths, cliff vantages,
      mirror-pool springs with shimmer, baked site nameplates, city auras + vignette
- [x] Retained scene graph: unit pools, per-site caches, march bob, banner wave
- [x] Same render.js API — sim/AI/netcode/UI untouched; MP loopback re-verified

## Phase 0.7 — "The Raised World" (v0.4)  ✅ DONE
- [x] Three.js renderer (vendored r158) — true 3D, AoE2-pitch perspective camera
- [x] Painterly terrain bake draped over rolling ground mesh (flattened along paths/sites)
- [x] Procedural low-poly models: castles, all buildings/outposts, instanced units (+bob/facing)
      and ~500 instanced forest trees — merged geometry, phone-friendly draw calls
- [x] Screen-space projected fog of war (perspective-correct soft holes); overlay canvas for
      HP bars / nameplates / minimap / storm targeting
- [x] Guest = camera on the other side of the table (no world mirroring)
- [x] Renderer selector: 3D default, ?r=2d or no-WebGL falls back to the Pixi painted map
- [x] Smoke + MP loopback PASS on 3D

## Phase 0.8 — "The Walled City" (v0.5)  ✅ DONE
- [x] Cities are real places: court disc, Seat-TOWER at the heart, 8 building plots on a ring
- [x] City Walls = a true perimeter (city sheet purchase, L1-3): enemies cannot enter while it
      stands — they batter the ring from whichever path they came; breach event when it falls
- [x] Buildings have HP and can be RAZED (economy/defense losses are real; shrine raze stops a walk)
- [x] Towers guard their own plot (placement matters); AI doctrine: military mans the front arc,
      economy shelters behind the Seat; emergency walls under raid; garrison aggro mans the walls
- [x] HUD shows NET essence rate (income − muster/walk upkeep), crimson when negative
- [x] Sheets/renderers/netcode updated; wall-siege scenario + smoke + MP loopback PASS

## Phase 0.9 — Installable + self-updating (v0.6)  ✅ DONE
- [x] PWA: manifest (portrait/standalone), Seat-tower icons (PIL-generated), apple-touch
- [x] Service worker (refined from perils): versioned precache = offline from first visit;
      old caches purged on activate; network-first navigations, cache-first ?v assets
- [x] LIVE auto-update: new sw.js detected while app is open → applied instantly at the
      menu, or deferred to match end ("a new shadow of Amber is drawn") — verified e2e
- [x] .githooks/pre-commit bumps the patch version on every shipping commit (the update
      trigger); core.hooksPath configured; AMBER_NO_BUMP=1 to skip

## Phase 0.10 — Companies (v0.6.4)  ✅ DONE
- [x] Independent troop groups, mobile-first: each mustering building (barracks/spire) is a
      COMPANY; tap it → "Post the Company Standard" → tap any site: its troops (present and
      future) hold that front regardless of the War Banner; "Rejoin" folds them back
- [x] Razed building = fallen standard: survivors rally back to the royal banner
- [x] Pennant flags per company (both renderers); rally orders fog-safe (never leak to rival)
- [x] Onboarding hint #4; headless + browser flow verified

## Phase 0.11 — The Flag Tray (v0.6.6)  ✅ DONE
- [x] Movement and building are separate grammars: flags = arm-then-tap from a bottom-left
      tray (royal ⚑ + one pennant ⚐ per mustering building); sheets = pure build/info menus
- [x] Royal flag on the rival city = the assault; company flags auto-detach; ⟲ REJOIN chip
- [x] Mustering halls fly their company pennant in-world; tray dots mark detached companies
- [x] Hints teach the tray; storm arming and flag arming cancel each other
- [x] Full touch-emulated flow verified (arm/plant/split/rejoin/sheet-purity)

## Phase 0.12 — Watchtower fork (v0.7)
- [x] The level-2 Watchtower upgrade FORKS: **Ballista** (long range, heavy single bolt —
      elites and fiends) vs **Cannon** (splash, shorter range — swarms and columns). Permanent
      choice, branch-specific upgrade costs.
- [x] Branch never leaks through fog (rival slots stay veiled); heirs pick a branch,
      Benedict picks adaptively off the rival's army size.

## Phase 0.13+ — The Open World  ← see `OPEN_WORLD_PLAN.md`
The site graph gives way to a continuous map. Anti-stall moves from Chaos escalation to the
essence race; match length moves to 15–30 min. Staged, sim-green at every step:
- [x] **Continuous movement** (`js/nav.js`) — a cost grid over the world with the site web
      baked in as corridors; per-(goal, owner) Dijkstra flow fields steer units cell to cell.
      Enemy ramparts seal their site in the grid, so they must still be broken, not walked
      around. Suite held to within noise; mirror symmetry improved (bleys 57% → 53%).
      Fixed on the way: `mid` is the only self-mirroring site and was being jittered — an
      off-centre centre gave one player a shorter road (a real, pre-existing seat bias); and
      the grid cell size must divide MAP.W/MAP.H or the grid is half a cell out of step with
      the board's mirror.
- [x] **Terrain** — ROAD/OPEN/FOREST passable at rising cost, ROCK/WATER impassable; the
      country closes with distance from any way through, so ~3 corridors emerge rather than
      being authored. Mirror-generated; `NAV.audit` proves no site is ever stranded. Both
      renderers now draw the sim's own terrain (real crags in 3D) — no decorative forest.
      Path bends live on the map as world truth so sim and paint agree on where a road is.
- [x] **Free placement** — works are placed things with ids and positions; the 8-slot ring is
      gone. Outposts and city works unified into ONE table (a Watchpost was always a tower).
      Your writ = the Seat's country plus every Shadow Gate's; a Gate may be raised beyond it
      only on a free spring your troops are standing on. Springs are the economy — a Gate
      elsewhere merely trickles. Fog rule swapped: a rival's work is visible only while seen,
      and remembered as a ghost otherwise.
      **Balance is RED and stage 6 must fix it** — see the note below.
- [x] **A wider world + two-axis panning** (v0.7.6) — map 700x2400 -> 1400x3000 (2.5x area),
      sites spread into the new width plus an outer western shoulder. Both renderers pan on
      BOTH axes with a fixed visible width (`CONST.VIEW_W`) instead of fit-to-width, and the
      minimap is a true rectangle of the world with a viewport box. Corridor width scales with
      the board (`NAV.wildR`), unit speeds x1.35 so a crossing still takes ~45s.
      Two deadlocks fell out, both real: the 240-unit cap was GLOBAL, so one full army starved
      everyone's muster including Chaos (55,694 rift spawns refused in one measured stall);
      and the Pattern walk was all-or-nothing, freezing a poor walker at 1% forever. Caps are
      per-owner now and the walk pays what it can. Draws went from 15-of-30 in the worst
      matchup to ZERO across the whole suite.
- [ ] **Walls & siege** — drag-a-line segments, towers joining curtains, Siege Works line,
      Chaos repurposed as the price of the best ground
- [x] **Retune** (pulled FORWARD, before walls — tuning siege against a broken triangle
      would have been guesswork). Pacing: Seat 1000→2500 hp, walls 900/1500/2200→1600/2600/3800,
      the walk 6min→7.6min at L1, spring income 5/8/12→4.5/7/10.5. Heir doctrine rewritten so
      the strategies stop converging on one win route.
      Field spread 89 → 45 points; 0% matchups 6 → 1; heir-match medians ~8m → 9–19m.
      Three real bugs fell out, all of them invisible until the open map made them bite:
      - Mission staleness was a flat 75s, tuned for the old small board. On the open map a
        middle spring is a 90s march, so **every** forward mission expired before the troops
        arrived — Julian sat on 2 springs at six minutes while Bleys held 4. Now scales with
        distance.
      - Plans were fixed 8-entry lists against MAX_BUILDINGS=14, so heirs stopped building and
        **hoarded** (Bleys banked 9k idle essence — the exact anti-pattern this project fixed
        once before). Plans extended with each personality's staple.
      - A turtle with a Shrine is just a slower greed: Julian was out-walking Brand and every
        heir was winning the same way. His walk is now a genuine last resort (t>900).
      **Still red, carried to the next pass:** Bleys tops the field at 76 with no >60% counter
      (Corwin at 53% is closest); Brand is still weakest at 31 and 0% vs Benedict; up to 6
      draws per 30 at the 45-min cap in Corwin/Benedict; and medians sit at 9–19m against the
      15–30 target rather than inside it.
## Phase 1 — Feel & fairness
- [ ] Human playtest pass: essence pacing, march speeds, chaos curve on the big map
- [ ] Corwin (skirmish AI) lacks a >60% counter — teach one or trim his contest play
- [ ] Mechanic ablation runs (each building/power must move win rates)
- [ ] Guest-side interpolation polish; reconnect/disconnect UX
- [ ] Victory/defeat presentation (Pattern blaze / castle fall)

## Phase 2 — Content
- [ ] More Trumps (hero variety), 5th building?, per-heir portraits on menu/end screens
- [ ] Campaign framing text between ladder rungs (Zelazny-flavored)
- [ ] Audio (procedural, perils-style sfx.js)

## Phase 3 — 4-player LAN
- [ ] Host-as-hub star topology (per perils COOP_4P_PLAN.md), lobby, bots fill empty seats

## Phase 4 — Polish + infra
- [ ] PWA (manifest, sw, icons), version-bump pre-commit hook
- [ ] Rebma / Tir-na Nog'th expansions, Jewel weather control

## Known decisions
- Host-authoritative netcode (not lockstep) — fog of war + no cross-browser determinism trust.
- Pattern walk is an *instant win at 100%* but revealed at start — the anti-stall keystone.
- One screen, no camera pan (MVP); portrait-first.
