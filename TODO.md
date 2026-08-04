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
- [x] **A world made new each match** (v0.8) — `js/worldgen.js`. No template, no edges, no
      corridors, no mirror. Elevation (folded/ridge noise) and moisture make the land; seven
      terrain types come off them — water, marsh, plain, meadow, forest, hill, crag — and
      climbing costs movement, so armies find the saddle on their own. Springs, high ground
      and BOTH Seats are then placed on whatever land came out.
      **The rival's Seat is hidden** until somebody lays eyes on it: renderers, minimap and
      the AI all wait on `explored`. That is why the mirror had to go — a point-mirrored world
      tells you exactly where the enemy stands. Fairness is now *chosen* instead: hundreds of
      candidate Seat pairs are scored on springs and buildable ground in reach, and the least
      skewed pair wins.
      Seats sit inland, so there is world to explore on every side. Heirs scout: they march at
      the nearest place they have never seen and only assault a Seat they have found.
- [x] **Companies: a standard is its own thing, not a property of a barracks.** A dozen halls
      used to mean a dozen flags. Raising a mustering hall now asks which standard it answers
      to — the War Banner, an existing company, or a new one — and it can be moved between
      them afterwards from its own sheet. The tray shows one chip per COMPANY with a count of
      the halls under it, and the gold chip says how many standards are posted afield and so
      NOT answering it. Colours follow a company's id, which never repeats: pennants used to
      be indexed by `buildings.indexOf(b)`, so every razed hall reshuffled the colours of the
      survivors. Commands: `build {co}`, `rally {co}`, and a new `assign {id, co}`.
- [x] **A walk on the Pattern is a beacon.** Reaching for the throne can no longer be done
      quietly: while an heir walks, their Shrine and `VISION.pattern` (380) of ground around it
      are lit for EVERY other heir — fog, snapshot and renderer all follow, because they all
      read the same vision sources. The light goes out the moment the walk stops, and a fallen
      heir stops burning. `World.walkers(world)` is the shared answer to "who is on the
      Pattern, where, and how far along".
      The count is public too: a board top-right lists every walker in their own seat colour
      with their percentage, yours marked. The minimap yields (`Render.miniTop`) rather than
      being overlapped by it.
- [ ] **Four heirs (LAN, free-for-all).** Sim, world, view, renderer and netcode all take
      2-4 now; what is left is play-testing it with real devices and the lobby polish.
      - Chaos moved off owner index 2 (`CHAOS_ID = -1`) — it collided with the third heir.
      - `placeCities` grows a SET greedily and scores the spread across all Seats, not the gap
        between two. Separation scales with the count: four cannot stand as far apart as two.
      - A Seat falling ELIMINATES that heir in a free-for-all (works, men and ghosts go with
        them) and the last standing takes the throne; a duel still ends on the first fall.
      - Per-tick service order rotates the ring rather than flipping, or seat 0 would win
        every simultaneous finish.
      - `seatSeen` per seat replaces the single `foeSeen`; the renderer builds a city per
        player; you are always gold and every rival keeps its own colour by seat order.
      - Netcode is a STAR: the host holds up to three peers, each paired by the same QR
        offer/answer as before, and sends each guest its OWN fog-filtered snapshot. Commands
        carry the sender's seat. The host hands out seed, player count and seat at start.
      - Measured: 22.4 KiB per snapshot round at four players = 1.75 Mbit/s at 10 Hz.
      - Solo is still 1v1 by choice. The AI no longer CRASHES on a four-way (it picks a
        primary rival instead of `players[1 - me]`) but it has not been taught to play one.
      - Not yet done: a lobby that shows who has joined, reconnection, and any real-device
        testing of three simultaneous WebRTC pairings.
- [x] **The Pattern Shrine does not upgrade, and the walk costs more.** The upgrade path made
      the walk both CHEAPER and FASTER (L1 12/s over 7.6min = 5.5k essence; L3 16/s over
      4.4min = 4.2k), so it was never the commitment it was supposed to be — and heirs held it
      at L3 in 13 of 16 measured cases. There is one Pattern and one way to walk it: level 1
      only, drain 12 → 24/s, ~10.9k essence over 7.6 minutes. `up` on a work is now optional,
      and a work without one refuses the command (`noup`) and shows no upgrade card.
      Measured over 12 heir-vs-heir matches to a 30-minute cap:
        before  pattern 8 / castle 4, median 9.0m
        after   pattern 5 / castle 7, median 11.9m (4.6–17.4m)
      The Pattern stops being the default route and matches run longer, toward the 15–30
      minutes the design asks for.
- [x] **The 2D renderer is gone.** Its only justification was as a fallback for devices
      without WebGL — and it ran on PixiJS, WebGL-only since v7, so a device that could not
      run 3D could not run it either: it died a little later on a black screen with
      "CanvasRenderer is not yet implemented" (verified by simulating a no-WebGL device).
      Meanwhile it was unreachable except via an undocumented `?r=2d`, cost every player a
      650 KB vendor download, and taxed every feature twice — the fog memory, the writ, the
      edge-of-sight rim, company pennants, construction shells and HUD layering were all
      written twice this session alone.
      Removed: `render.js` (724 lines), `sprites.js` (237, its only consumer), `pixi.min.js`.
      WebGL is now a stated requirement with a plain message at boot instead of a black
      screen. Suite 37s → 28s; download roughly halved.
      Kept: `terrain.js`, which bakes the ground for the 3D renderer too.
- [x] **The suite: 94s → ~37s.** Most of it was the renderer fix above (browser-test time is
      frame time). The rest: the two renderers now run concurrently, each buffering its rows
      and timings so the report still reads in a fixed order; fixed sleeps (13s of them)
      replaced by waits on the condition the assertion is about to check — as fast as the game
      on success, and on failure the assertion still reports the real state; and the harness
      prints its slowest suites so the next slowdown does not need bisecting by hand.
      Parallelism gains less than 2x because two software-GL renderers contend for the same
      cores — the back-button suites go 8.3s each to ~11s each while overlapping.
- [x] **The 2D renderer was running at about one frame per second.** The fog is two
      full-screen render targets rebuilt every frame (the holes follow the units, so they
      cannot simply be cached) and it was costing ~950ms of a ~1020ms frame. Now: both targets
      at 0.4 resolution (the veil is soft — there is no pixel in it worth preserving), the
      remembered-ground layer cached in its own target and rebuilt only when the camera or the
      memory changes rather than re-tessellating hundreds of rects and re-running a blur every
      frame, the rim band drawn from sprite pools instead of rebuilding ~160 circles of
      geometry, and the whole pass throttled to ~15Hz whenever the camera is still. 951ms →
      239ms in software rendering; the throttle only bites at real frame rates, so a device
      with a GPU should gain more.
      NOTE: these are SwiftShader numbers from CI. They are honest as a ratio and meaningless
      as absolutes — a real phone must be measured on a real phone.
- [x] **A Shadow Gate stands on a spring, and only there.** The off-spring "waystone" — a
      Gate anywhere in your writ, trickling 1/1.5/2 — is gone, along with the `income` table
      that fed it. A Gate is the one thing that draws Shadow out of the ground, so the essence
      is out on the map and your writ can only follow it there. New refusal `nospring`; the
      beyond-the-writ rule (a free spring your troops hold and the enemy's do not) is
      unchanged, and is now the ONLY way a claim grows. Measured over 12 minutes the heirs
      hold 8–10 of 14 springs and the income gap between an expanding and a turtling side runs
      65 v 13, which is the anti-stall model doing its job.
- [x] **Solo difficulty (SQUIRE / HEIR / PRINCE).** Skirmish always handed the heir full
      strength — the only ramp was the campaign ladder — so solo played as hard as the heirs
      play each other. Difficulty now blunts how often an heir acts (`slow`, `noise`) AND what
      it draws from the same ground (`eco`, a new per-player income scalar). Measured at six
      minutes, an heir holds income 13 / 25 / 39 and an army of 60 / 74 / 83 across the three
      rungs; PRINCE against a full-strength mirror is a 50/50. Default is HEIR, remembered
      across sessions. The campaign ladder gained `eco` too. The handicap is the heir's alone —
      it plays its own game, only poorer; your own side is never touched.
- [x] **You open with a spring you can actually use.** Seat selection required a spring
      within the writ, but "within" counted one lying in the castle's lap — visible, cramped,
      and crowding the court. A candidate Seat is now scored on springs it can DRAW ON: at
      arm's length (200–400), inside the writ, with ground beside them that bears a Gate,
      tested against the same rule `placementError` enforces. Nothing closer than 200 is
      allowed at all. Costs no extra worldgen retries (max 79ms across 30 seeds).
- [x] **The remembered-ground edge is softened.** The fog memory is kept on a coarse grid and
      its raw boundary was a staircase of cells along the lit edge. Both renderers now blur
      the mask on the way in, sized to how big a cell currently looks on screen.
- [x] **No cap on works; the masons are the constraint.** `MAX_BUILDINGS = 14` is gone —
      hold as much country as you can defend. What is rationed instead is construction: ONE
      work rises at a time, and each takes time (Gate 10s, Tower 11s, Barracks 13s, Spire 17s,
      Shrine 26s). An unfinished work is a shell — paid for and breakable, but it earns
      nothing, musters nobody, shoots at nothing, watches nothing and holds no ground, and it
      cannot be upgraded. `placementError` gained `busy`, deliberately as the LAST word: what
      is wrong with the *ground* is what you need to know while you wait, so `ground`,
      `crowded`, `claim` and `unique` all still speak first.
      Upgrades remain instant — the same one-at-a-time rule could reasonably cover them too,
      but that changes what an upgrade costs you defensively, so it is a separate decision.
- [x] **The standard goes anywhere.** Planting a flag used to demand a site and refused
      everything else ("the standard needs ground to stand on"). A standard is an ORDER TO
      MARCH, not a claim: banner and rally now carry a free point `{x, y, site}` (site = -1
      on open ground, kept only so the banner text can name a place). Off-map is clamped, and
      when the flow field admits no route the column heads straight at the goal and gets as
      close as the land allows.
- [x] **Veterans, not crowds.** A hall's level bought THROUGHPUT — the same soldier arriving
      faster — so an upgraded realm fought with bigger crowds of identical men and there was
      nothing to see. The muster interval is flat now and the level rides on the RECRUIT:
      `CONST.TIER` multiplies his hit points, his blow, his price and his bounty, and he keeps
      it for life.
      The multipliers are the old rate ratios exactly (8/8, 8/6.4, 8/5) and they are on the
      PRICE as well as the stats on purpose — the essence buys precisely the same total hit
      points and damage per minute at the same drain, so this is a repackaging and not a buff.
      The gain is that fewer, tougher men are harder to storm, harder to splash and arrive as
      a column rather than a crowd.
      **An upgrade is masonry**: it takes a crew and `raise × UP_WORK` seconds, and the work
      does its job for nobody meanwhile — no muster, no tower shot, no Gate income — while
      still standing, blocking, seeing and holding its spring. That makes WHEN to upgrade a
      decision rather than a formality, and it is what the AI now weighs before shutting its
      only hall down under threat.
      **And all of it is visible**: the army's instanced meshes bucket `kind#tier` (a rank
      without a bucket silently draws as a recruit), a veteran gets a crest and heavier build
      and an elite a standard, `buildingModel` keys on the level so a raised hall is a bigger
      hall, and a work with masons in it wears the scaffolding a rising one does.
- [x] **The halt, in every mode.** `world.paused` is world state, not a session flag, so the
      host owns it and it rides the snapshot — which is what makes it work in LAN at all: a
      guest holds no world, so the only way it can learn the match has stopped is the wire.
      Anyone at the table may call one and anyone may lift it (whoever called it may be the
      one who walked away from the phone), and the panel names who did.
      Two clauses matter more than the feature: **no orders through a halt** — otherwise it is
      a planning phase, and in a duel it is thinking time the other heir does not get — and
      **a halt banks no time**, since an accumulator left filling would fast-forward the match
      the moment you lifted it. The command asks for a state rather than toggling, so two
      guests tapping at once cannot cancel each other out.
- [x] **The Curtain Wall.** Walls are back, and they are ONE WORK WITH A LENGTH — a building
      record carrying a second end (`x2`/`y2`), not a chain of segments. That was the plan's
      shape (drag-a-line pieces, id-keyed netcode deltas) and it bought nothing the shipped
      version does not do, at the price of a second netcode path; a wall now rides the
      ordinary building list and the snapshot did not grow a case.
      - Two taps: the card arms the run, the next tap names the far end. The ground between
        them previews the length and whether the masons will take it (span 110–300).
      - It bars the ground to everyone but its owner — rasterised into every other heir's nav
        mask, Chaos included — and since marching is not collision-checked, anyone standing
        in another heir's stone is put back on the side they came from.
      - It stops shots crossing it. **Except from the men on it**, and that clause is the
        whole balance of the thing: come within `WALL.man` of your own wall and you throw
        `WALL.over` (further than any soldier reaches on the ground) and are shot at in
        return. A wall alone kills nobody; a wall that kills exposes its defenders.
      - Stone is a LAST-RESORT target. A curtain is the nearest thing to any man standing at
        it, so weighing it by distance had assaults hacking masonry while the parapet shot
        down at them untouched — walls are weighed only when nothing alive is in reach.
      - A tower shoots over stone. Towers are taller: a wall is worth having behind one and
        is no answer to one.
      - Julian curtains his approach early (he holds a line, and a line is stone); Benedict
        walls only when he is being pressed.
      **Still open from the plan:** towers structurally joining a curtain, partial breaches,
      and the Chaos repurposing of §2.
      **What the referee said.** Full `node sim.js` before and after, 30 games a matchup, then
      focused runs on the four rows that changed. A wall bought on a SCHEDULE does not pay:
      masons are `1 + gates/3`, so an early curtain occupies the only crew a heir has and
      delays the Gate that would pay for the next one — 110 essence and a tempo of economy
      spent against opponents who win by walking, which no wall touches. Julian at slot 3 fell
      47%→27% against Brand with the win reasons moving to pattern:20; moved later he was 40%,
      still under the 47% he had with no wall at all. Gated on pressure he beats his own
      baseline everywhere: brand 47→57, corwin 40→43, bleys 0→3, benedict 43→47.
      Benedict was the control — his wall was threat-gated from the start and he came through
      51→53. Field: `bleys 110 · benedict 51 · corwin 49 · brand 45 · julian 45`, spread
      71→65, and Julian is no longer alone at the bottom. Bleys at 110 with no counter is the
      carried regression from before this work, untouched by it.
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
- [x] **The menu says what it does.** Four things it was getting wrong, all reported off one
      screenshot:
      - **A claimed throne walked you straight back into BENEDICT.** The rung index was
        clamped to `LADDER.length - 1` rather than wrapped, so the reward for finishing the
        succession was to be dropped onto its hardest step. It restarts at Julian now, on the
        end screen as well as the menu, and the button says so.
      - **The footing governed a skirmish and did nothing to the campaign.** It lived inside
        the skirmish fold-out, and the ladder ran on a private ramp (`RUNG_OPTS`) that no menu
        ever mentioned. That ramp is gone: the LADDER says WHO you face, the footing says how
        strong, and one strip above both modes sets it.
      - **"LAN DUEL — CORWIN vs ERIC"** has been up to four heirs since v0.7.30. Now "LAN — UP
        TO FOUR HEIRS", HOST/JOIN THE TABLE, and the HUD names "3 HEIRS CONTEND" rather than a
        single rival that does not exist at a four-way table.
      - The campaign button carries its progress underneath — `rung 2 of 4 · ✔ · · ·` — so the
        ladder is legible without playing it.
      Fixed on the way: `.diff-note` carries `flex-basis: 100%` for the ROW it was written
      for, and in a column that is a claim on the whole height — it opened a hand's width of
      nothing down the middle of the menu the moment the footing moved out of the fold-out.
- [x] **The Pattern is a clock again, and a work is stone rather than sand.**
      The four draws in twenty-four were the anti-stall failing, and the cause was measurable:
      across fourteen mirrors, **every match that ran to the 45-minute cap had somebody walking
      for the whole of it and BROKE for 90-95% of that**; every match that ended had a walker
      broke 0-27% of the time. Paying proportionally was right — all-or-nothing froze a poor
      heir at 1% forever — but it has the same disease more slowly: at income 5 against a drain
      of 32 a walk advances a sixth of a percent a minute, which is not a clock, it is a
      stopped one. `shrine.minRate` is the floor: channel what you have and the Pattern carries
      you at no less than half speed. It is still ruinous — every penny goes into the lines and
      none into an army — it simply cannot stop. Worst possible walk now arrives in 19 minutes.
      **Every work has twice the hit points** (Gate 300→600, Barracks 360→720, Watchtower
      480→960, Spire 320→640, Siege Works 380→760, Shrine 450→900). A realm was a sandcastle:
      59 razes in one reported match, 26 in another, and a raze-and-rebuild treadmill at one
      spring neither side could win. Breaking a work is a commitment now, which is also what
      makes an Engine worth raising rather than another handful of men. The **Seat is
      untouched at 2500** — a tougher Seat pulls against the clock, and the clock is what was
      broken.
      `node sim.js`, against v0.7.35: benedict mirror 50%/10.2m with **4 draws → 50%/13.3m with
      0**, and the win routes even at castle 14 / pattern 10; stalls 2 in 14 → **0 in 14**;
      greedy mirror unchanged. bleys/julian is 100%/7.3m — Julian's turtle doctrine has no
      answer to fast expansion and is now simply dead. Left there on purpose: turtling is not
      meant to be a way to win.
- [x] **The black road is not the war; the masons follow the Gates.** Two reports from play,
      and my first reading of the chronicle was wrong — I inferred a strategy story from the
      order list instead of testing the mechanic. Tested, it says something else:
      - **The assault was never the problem.** 120 soldiers ordered onto a Seat 1500 units
        away take it in 33–36 seconds — empty road, 60 defenders, Chaos at ten minutes, all
        four, even behind eight ballista towers. What fails is *having 120 spare troops*.
      - **Chaos was taking 73% of the player's dead** (rival 199, Chaos 572, towers 13, tagged
        across four whole matches; one game 100%). Capping fiend strength had left the RATE
        alone at ~32/min. Schedule cut about 2.5×: now **26% of the dead overall, median 18% a
        game**, and the games Chaos still decides are the ones where the heirs never met —
        which is what it is for.
      - **One storm deleted an army.** 36 dps × 2.5s = 90 damage against a 70-hp soldier, so
        everyone under the disc vanished: measured at 31 of 120 men, 496 essence of troops for
        the 90 it cost, back every 50 seconds. Now 24 dps — 60 damage, which leaves a
        full-strength soldier on ten hit points. It opens a fight; it does not end one.
      - **The muster spreads with the host** (rings scale with the army), so a blow that lands
        on a big army costs proportionally less than one on a small one.
      - **`the enemy is inside your city!` fired for fiends too**, so a rift gnawing an
        outlying Gate read exactly like a rival's assault. It names Chaos or the heir now — and
        `die`/`raze` carry `by`, so the chronicle reports **YOUR DEAD: n to the heirs, m to
        Chaos** with a per-interval `foe|Chaos` column. That gap is why I misread the first
        chronicle; the instrument can answer it now.
      - **The masons follow the Gates** (`MASONS = {base 1, per 3, max 4}`). One crew capped
        spending at ~15 essence/s against a realm earning fifty — the reason two chronicles
        ended with five figures banked in matches that were lost. Four crews absorb ~43/s.
        Works take ~40% longer to raise, because crews multiply TEMPO as well as spending and
        only the second was ever the point.
      Fixed in passing: `hurt` paid the bounty only to seats 0 and 1 — a duel's assumption that
      quietly paid the third and fourth heirs nothing for the whole war.
      **The regression this left is FIXED in the entry above — except the turtle, deliberately.**
      **(was) KNOWN REGRESSION:** the masons are a snowball and the field got worse. Proved
      by ablation — with everything else new but a single crew bleys/julian is 75%/9.1m; with
      the crews it is 90–100%/5.9m whatever else changes. Capping at 3 and slowing raises were
      both measured and neither fixes it. Against v0.7.34: benedict mirror 63%/15.2m with 1
      draw → 50%/10.2m with **4 draws in 24**; bleys/julian 58%/12.2m → 92%/7.3m. The draws are
      the anti-stall failing and matter most. Levers not yet tried: the Pattern as a reliable
      clock again (slowed in v0.7.32 and given decay), `CASTLE_HP` so a rush cannot end a match
      at seven minutes, tower strength, and Julian's turtle doctrine, which has no answer to
      fast expansion and is the oldest skew on this list.
- [x] **No ceiling on the muster, and a Siege Works to spend on.** The first chronicle from
      real play said it plainly: army pinned at exactly 110 from minute six, **21,966 essence
      banked** at the end, both Seats at 100% for seventeen of seventeen minutes, 59 works
      razed and 26 lost. The treasury had stopped being a decision by minute four, because
      every tap it could flow through was shut: the muster capped, and the masons rate-limit
      works to ~14.6 essence/s against an income of 50.
      Found on the way and fixed: **a hall at the cap still CHARGED for recruits `spawnUnit`
      turned away** — measured at 6 essence a second, silently. The price is taken only when
      a man walks out of the hall.
      The cap was load-bearing for performance, so that went first. Target acquisition walked
      every unit for every unit — fine at a hundred, quadratic at a thousand — and is now a
      look at the nine grid cells around you (`rebin`/`forNear`, also used by towers and by
      cannon splash). The renderer's instance buffers were a fixed 260, which past the cap is
      a *silent truncation*, and now grow in doublings; and its "forget the dead" pass was
      `units.some()` per remembered id, the one place the renderer went quadratic. Measured:
      sim 4.55 → 1.89 ms/tick at 1200 men (6% of realtime), frame cost at 1400 down 1.8×,
      fogged snapshot 27 KB against a 120 KB budget. Played out with no cap, armies settle at
      **125-239 a side** — the economy is the brake, exactly as hoped.
      **The Siege Works** (300, mustering Engines) is the other half. A Seat is 2500 hit
      points behind towers and men are a poor tool for stone. An Engine is slow, short-ranged,
      half a soldier in a fight at four times the price — and `siege: 14` against a work or a
      Seat, which is seven soldiers' worth of stone-breaking. It arrives escorted or not at
      all. Julian, Bleys, Corwin and Benedict all reach for one.
      `node sim.js`, before → after: **bleys/julian 28.5m → 12.2m and 25% → 58%** — the turtle
      can now be broken, which was the whole complaint; benedict mirror 14.8m → 15.2m; greedy
      mirror unchanged. Two timeouts appeared across 96 games where there had been none —
      worth watching, not yet a stall.
- [x] **The chronicle** (`js/record.js`, headless-safe). Balance arguments are settled by
      `node sim.js`, which plays bots — a match a HUMAN played left no trace at all, so every
      report from play had to be re-derived from first principles. A match now writes itself
      down: a header (build, seed, footing, seats, result, your peaks), a table sampled every
      20 sim-seconds of essence / income / works / army / Pattern / castle for every seat plus
      the fiends alive, the orders you gave with the hour you gave them, and the moments worth
      naming. About 5 KB for a six-minute game — small enough to paste into a conversation, and
      the seed in the header rebuilds the exact board.
      It records the TRUTH where the truth is at hand (solo and host hold the world); a guest
      only has its own snapshots and the header says so rather than pass fog off as fact.
      Two buttons on the end screen: COPY (clipboard, because pasting is the point) and SAVE
      (a .txt to attach). A browser that refuses the clipboard gets a box to select by hand —
      a refusal must not be a dead end. And because the match you WALK OUT OF is often the
      telling one, `toMenu` closes the record and the menu offers it too.
      Consecutive identical orders collapse (`War Banner ×5`), so a heavy tapper cannot turn
      it into a megabyte. `Rec` is a READER of the sim and never a writer — a test asserts it.
- [x] **A walk is held, not banked.** Reported from play: the Pattern is now winnable by hand,
      but breaking the rival's Seat — or their Shrine — still is not. Both halves were real.
      Progress was PERMANENT the instant it was bought, so the Shrine was a savings account:
      walk while rich, stop while poor, and nothing already paid for was ever at risk. Which
      is exactly why razing a rival's Shrine felt pointless — it cost them 380 essence and the
      time to raise another, and not one point of the walk.
      Three changes, in the order they matter:
      - the lines **fade** whenever nobody is channelling (`decay` 0.05 %/s), so a pause costs
        you and poverty costs you. It is a cost, not a reset: a minute of standing still gives
        back 3 points, not the walk.
      - throwing the Shrine down tears the walker off the Pattern AND takes `breakLoss` = 22
        points with it, announced to both sides. The assault is now the answer it looked like.
      - and it is a heavier commitment: drain 24 → 32/s, rate 0.22 → 0.175 %/s — ~9.5 minutes
        and ~18k essence at full pay, up from ~7.6 minutes and ~10.9k.
      Measured with `node sim.js`: the Pattern went from the DEFAULT route to a minority one
      without vanishing. benedict mirror [castle:11 pattern:13] → [castle:17 pattern:7], med
      11.9m → 14.8m; bleys/julian [pattern:14 castle:10] → [pattern:10 castle:14], med 25.0m
      → 28.5m; greedy mirror unchanged at 3.9m; no draws at the cap in either.
      A first pass at drain 34 / rate 0.155 was measured and pulled back: it cut the mirror to
      4 Pattern wins in 24 and put a draw back on the board at the 45-minute cap, which is the
      anti-stall failing.
- [x] **The gold banner outranks every company standard.** Reported twice — first as "the main
      yellow flag sometimes fails to direct all troops", which I could not reproduce, and then
      as the design it should have been. Both were the same thing: the royal War Banner moved
      only the men under NO company standard, which once a few halls are up is a shrinking
      minority. A company is a DETACHMENT from the army, not a rival army, so raising the gold
      banner now strikes every standing detachment order and the whole force answers as one;
      planting a company's own standard peels it back off. `onRecall` collapses to the single
      `banner` command it always meant.
- [x] **The solo ladder is a ladder.** Reported: the AI is too strong. Measured, and it was
      worse than that — the DEFAULT footing was no handicap at all. `slow` and `noise` are
      decorative: an heir polled at half the rate, or skipping 45% of its turns, still won its
      mirror 42–50% of the time, because its decisions are "spend the essence on the next thing
      in the plan" and the essence is still there a few seconds later. HEIR at eco 0.80
      measured a **50% mirror** — PRINCE by another name — while putting an army on the
      player's ground at 5.3 minutes. And income alone cannot fix it: a poorer heir builds less
      realm and marches EARLIER, so cutting eco brought the assault sooner.
      New knob `hold`: the hour before an heir will march on your Seat at all. It expands,
      garrisons and defends as always, it is not weakened in the fight it eventually brings —
      it simply gives you the opening minutes. Table retuned on both axes.
      | footing | eco | hold | mirror | army at 5 min | at your gate |
      | --- | --- | --- | --- | --- | --- |
      | SQUIRE | 0.55 | 12m | 8% | 34 | never |
      | HEIR | 0.72 | 6m | 25% (was 50%) | 47 | 6.0m |
      | PRINCE | 1.00 | — | 58% | 59 | 7.3m |
      eco 0.42 was tried and rejected: the heir went broke, never mustered, and lost its Seat
      to Chaos inside three minutes on some maps. An easy opponent is still an opponent.
      Bot-vs-bot is untouched (sim bots carry no footing): benedict mirror 42%, med 11.9m
      before and after. DESIGN_PRINCIPLES §6 rewritten — it described the knobs that don't work.
- [x] **A rematch keeps the link.** Pairing by QR is the price of getting into a LAN game;
      paying it again to play a second game against the person sitting next to you is not.
      The link is now a LOBBY that outlives the match: the host's end screen offers REMATCH,
      which rolls a fresh seed and re-sends the very start message the lobby sends, and every
      guest is already listening for it (`Net.onStart`), so nobody scans anything. A guest's
      end screen says AWAITING THE HOST on a dead, slowly pulsing button — the host is the
      authority on when a match begins, this one included — and a start message alone puts it
      back in play. Seats are peer indices, so replaying with the same count keeps everyone
      where they were; if an heir has DROPPED that is no longer true (a seat with nobody
      behind it would stand in the new world and be walked over), so the rematch is offered
      only while everyone who played is still linked, and the button simply goes away when
      they are not. Drawing the end screen was split from ending the match, because what
      comes next can change while the screen is up.
      Fixed in passing: the losing line named the winner as `names[1 - viewer]`, which with
      four seats is "the other one" and, from seat 2, `undefined`.
- [x] **Chaos stops escalating.** Reported from play: the fiends are too strong. They were.
      `hpScale` and `dmgScale` both ramped without a ceiling and multiplied into each other,
      so measured against the stat block a lone fiend ate 5 soldiers by minute 10, 9 by
      minute 15 and 26 by minute 30, while the rift schedule climbed to 40 fiends a minute.
      Bots never felt it — they mass 150 troops and fight in a blob, where a dozen swords
      answer one fiend at once — but a human holding a road with six men met the arithmetic
      head-on. That is a doomsday timer, which DESIGN_PRINCIPLES §4 says Chaos is not.
      Both curves are capped (hp x2.0, damage x1.35): a fiend grows into a soldier's better,
      about two swords to put down, and stays there. The rift COUNT still swells, so late
      Chaos presses by being many. Duration held: benedict mirror 12.0m → 11.9m, greedy
      mirror 3.9m → 3.9m, bleys/julian 17.6m → 25.0m (top of the 15–30 band; that matchup
      also flipped 58% → 21%, which is the known heir skew moving, not a new one).
      A softer cap (x2.4/x1.5, three swords) was measured too and moved durations by 0.2m —
      the escalation, not its ceiling, was what set the length.
- [x] **The ranks stand still.** Troops ordered home shivered around the Seat. A soldier on
      the muster ground steers to his own place in the ring directly; one outside it rides
      the flow field in. That handover was judged by `NAV.arrive` around the Seat CENTRE,
      which put the ring itself on the wrong side of the line: 12 of 50 men froze on the
      tower's own ground (the field reckoned them arrived and stopped pushing, the direct
      rule did not yet apply), and in AI play 13 of 102 stepped out toward their place, fell
      back under the field and repeated at 30 Hz. The muster ground now reaches past the
      outermost place in the ring, so the handover happens once. The renderer's march bob
      was making it worse by hopping standing men two and a half times a second; it now
      scales with a smoothed speed, so men at rest are at rest.
- [x] **Springs sit in level ground.** A pool and its ownership ring are drawn as FLAT discs
      at one height. Elevation varied by up to 18 units across that footprint, so the land
      poked through and took a wedge out of the water. Worldgen levels a `springLevel` radius
      around every spring; measured spread across the pool+ring is now 0.00 on every seed.

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
