# Amber — TODO

**Live:** https://dbikard.github.io/amber/ · repo: github.com/dbikard/amber

Forward-looking only. **The record of what has shipped is not here** — it is in the git
history, in `CLAUDE.md` (which states every rule the code now lives by, and why), in
`REALM_PLAN.md` (the Reach War's two lives) and in `DESIGN_PRINCIPLES.md` (the balance
methodology). This file had grown to 1,339 lines, nine tenths of it a `[x]` archive that
duplicated those three; it was cut back at v0.10.x and everything removed is recoverable
with `git log -p -- TODO.md`.

Everything below is open. `[REF]` means `node sim.js` before and after; `[SAFE]` means it
touches no balance surface.

## From play — bugs with a witness

- [ ] **A LAN guest who takes command of a vassal leaves his own seat unrun.** The host's own
      seat has a driver skipped while his hand is on it, but a guest's seat has none (a human
      holds it) and the host does not know a guest's hand. Carry the guest's hand on the wire
      (`{t:'hand', as}`) so the host can drive the guest's home court while he commands another.
- [ ] **The heirs' ANSWER to a walk is the next balance job.** With a walker who fortifies
      first and does not starve (2026-08-19), the contested Pattern share reads 81% (band 25-75)
      and neither an earlier nor a smaller answer moved it: the army that goes to the Shrine
      does not break it. Bring breakers (`v.breakers`) with the answer, commit the whole army
      rather than `WALK_ARMY`, and answer the WALKER's Gates (his income is the walk) as well as
      his Shrine. Measure on `node sim.js`'s contested line; the switches `AMBER_WALKANS`,
      `AMBER_WALKARM`, `AMBER_WALKINC`, `AMBER_WALKTOW`, `AMBER_WALKHOLD` are the rig.
- [ ] **The council rows and the court card could carry each court's livery swatch**
      (`R.liveryCanvas` is ready for it) — the men and the Seat's flag say which court now
      (CLAUDE.md "AND THE MEN SAY WHICH COURT"); the roster does not yet.
- [ ] **`game.armedFlag` survives `startSP`**, so the first tap of a new match on the same page
      is a rally if a company was armed in the previous one. Found by the livery suite, which
      clears it as the other suites do; clear it where a match starts.
- [ ] **The lords — see `LORDS_PLAN.md`.** Stances (warden / steward / marshal, the default by
      geography), vassals as minor lords with no initiative, a pressed court drawing its
      neighbours and TO ARMS all shipped 2026-08-17. Open: a stance for UNSWORN lords by
      geography, and judging the whole thing by hand in a war.

- [ ] **A resumed war can lose its ground texture.** Reported from play with a screenshot: the
      props, works, labels, roads and reach rings all draw, and the LAND under them is black.
      Not the veil — a shrouded world drains the props too, and they are at full colour — so it
      is the ground mesh's own texture. NOT REPRODUCED in three flows, all of which came back
      clean (luma ~50 on a 2237x2684 base): resume with the same seed already built, a fresh
      page load resuming a played war, and a WebGL context lost and restored under
      `WEBGL_lose_context`. Ruled out by reading: both bakers return `{canvas,...}` so the
      `groundDirty` re-bake is not passing an undefined image, and every canvas in `terrain.js`
      is created fresh, so nothing shares a scratch that could be cleared under it.
      What would localise it: whether it was resuming the APP (backgrounded PWA) or resuming a
      saved WAR from the menu; whether it recovers by panning far away and back (which re-bakes
      the detail tiles but not the base); and the chronicle from that match. The most likely
      remaining mechanism is a phone's browser discarding a large canvas backing store — the
      base is ~24MB — where a desktop keeps it, which would explain why it survives every rig
      here. If so the fix is to re-bake on `webglcontextrestored` / `visibilitychange` rather
      than trusting the texture to survive, and to make that measurable with a debug hook.

- [ ] **Judge the lapse ladder by hand, on a phone.** Difficulty is decision quality now
      (CONST.DIFFICULTY `lapses`, DESIGN_PRINCIPLES §6): the tables were tuned against a
      head-to-head rig (a lapsed heir against the same heir straight, twenty duels a case) and
      the numbers are in the commit that shipped them, but nobody has PLAYED a Squire since it
      stopped being poor. What to watch for: does SQUIRE read as a beginner (hoards, forgets his
      halls, wanders, dribbles men at you) rather than as a slow copy of PRINCE; is HEIR a real
      opponent at the default; and does a war's minor lord — the footing plus `CONST.MINOR` —
      still expand enough to be worth conquering. The two knobs that are known to bite weakest
      are `trickle` (a duel finds the Seat late, when the army is already large) and `siege` (a
      no-op for any heir whose recruits already break stone). Never answer a weak rung with a
      purse: the economy is not a difficulty lever, on the designer's call.
- [ ] **Watch a country of heirs and judge it.** The retrofit is measured on ECONOMY (Gates,
      springs, works, men — all roughly tripled) and on cost (0.96 → 2.3ms a frame), not on
      whether the war is any GOOD to play against. Nobody has watched one yet. `?reach=SEED`
      now seats the country exactly as a war does, so that is the way in. Do NOT reach for long
      war simulations to answer this — the doctrines are already proven in the duel and what is
      wanted here is judgement about the war's shape: whether minor lords at `CONST.MINOR` are
      weak enough to be minor and strong enough to be worth conquering, whether contenders
      actually contend, and whether sixteen busy economies make the map legible or noisy.
- [ ] **Let an heir throw down his own work.** There is no way to remove a building you raised —
      a Gate on a spring that has stopped mattering, a hall in the wrong place, a curtain drawn
      where it now blocks your own march — so an early misplacement is permanent, and the ground
      under it is spoken for until a rival breaks it for you. Wants a command — NOT
      `{c:'raze'}`, which already exists and throws down a YIELDED COURT (world.js; issued by
      nobody yet, see the audit note below) — say `{c:'demolish', id}`, a place on the work
      sheet, and a decision about what it costs and
      returns: instant with no refund is the simplest honest rule, and a partial refund makes
      "raise it, look at it, take it down" a free way to survey the map. Rubble already has a
      meaning for walls (`WALL.rubble`), so a razed curtain should probably follow that path
      rather than vanish. `[REF]` — anything that makes a misplaced work cheap changes how
      freely the heirs build.

- [ ] **A country at six minutes costs 18.5ms a tick in the sim alone** (1,096 men, seed 17,
      HEIR footing; 22ms at nine minutes; worst 96ms) against a 33ms frame, before rendering —
      measured 2026-08-17 after equal economies put more men on the map. Profiled: `update`'s
      own per-unit loop 31%, `acquire` 16%, `jostle` 6%, `castFrom` 5%, GC 4%, `pactOn` 2.7%
      (asked by `foe` for every candidate of every man). TWO CUTS MEASURED AND REJECTED
      (2026-08-17, A/B on the same box, twice each, both traces identical to HEAD): a per-tick
      `foe` memo inside `update` is neutral (17.8 against 17.75ms — the 2.7% is the calls that
      DO reach `pactOn`, and the memo's own build costs about what it saves); a squared
      pre-reject before `foe` in `acquire` is WORSE by ~2ms — most men in a man's nine cells
      are his own company and `foe(a, a)` was already the cheapest test there is, so the
      distance was added for every friendly neighbour. THREE CUTS THAT PAID, each with traces
      identical to HEAD (two seeded countries man for man, twelve seeded duels) and A/B'd twice
      on the same box: the unit bins keyed by owner within a cell so `acquire` skips whole owners
      and never walks its own men (18.3 → 16.4ms); `acquire`'s stone pass through the works
      bins in the full walk's own order (→ 13.4); `worksNear` memoised per (cell, reach) for the
      tick (→ 12.25). Line-level profile is the instrument (`positionTicks`; V8 inlines
      `acquire` into `update`, so it reads as update's own line). What is left is diffuse —
      `jostle` 3%, `castFrom` 2.7%, `project` 2.4%, `markSeen` 1.9% — and the BIN item below,
      which reorders and is a referee change.
- [ ] **The unit `BIN` is a duel number, and `acquire` pays for it.** With the works binned, the
      sim over a country is 20.13ms/tick at 1111 men — half what it was, and still the biggest
      thing in the frame. Profiled, what is left is `acquire` and its call site: **~40% of the
      tick together**, and it is the nine-cell look over `world.bins`. `BIN` is **280**, so a
      3x3 look scans an 840x840 box for an aggro radius of ~180 — **7x the area the question
      needs**, and in a country men stack (a reported screenshot shows a column of ~80 in one
      place), so a cell holds well over a hundred of them. `jostle` is worse in ratio: a
      `CROWD.pull` of 44 asking through 280-unit cells scans ~360x the area it wants.
      A smaller `BIN` (or a second, finer grid for the short-radius askers) should be most of
      another halving. **NOT free, and this is the whole reason it is written down rather than
      done**: `forNear` visits cells in grid order, so changing `BIN` reorders the candidates,
      and `acquire` breaks ties by first-found — men would pick different targets. That is a
      behaviour change in a duel as much as in a war, so it is a `node sim.js` change: run the
      full 176 matches before and after and keep DESIGN_PRINCIPLES.md green.
      (An alternative with no reordering at all: keep `BIN` and give `acquire` an early reject
      on squared distance before it does any real work — cheaper, smaller win, no referee.)
- [x] Fenced flow fields are sparse to their bound (2026-08-17): a field is a window over its
      disc, `NAV.fieldAt` is the one way to read a cell, the Dijkstra heap grows instead of
      silently overflowing, and every man's position every second over three minutes of two
      seeded countries hashes identical before and after. 80 resident fields: 14.6MB against
      61.4MB, 4.2x.
- [ ] **Detail tiles cost 91-199ms each, one per frame.** After a pan the ground is the cheap
      base until they arrive — and the base is 0.28 px per world unit against a tile's 1.1, so
      an untiled patch is a 3.9x magnification whose cliff colouring reads as hard dark wedges.
      Reported from play as artifacts that never lift. They bake centre-first now, so the middle
      of the screen sharpens first, but the cost itself is untouched: measured on the most
      road-heavy tile, ~83ms is the painterly base and ~67ms is the cobblestone road pass. The
      obvious trades are a lower tile `px` (cost scales with area: 1.1 → 0.85 is ~40% faster and
      still 3x the base) or caching the road's stone courses instead of drawing rotated stones
      per cell. Wants a phone to judge the quality loss, not a desktop.

## Measured — open questions that already have data behind them

These are not guesses. Each carries the numbers it was decided on, and the rig that produced
them; re-measure before re-deciding.

- [ ] **An army through a narrow path should behave like sand in an hourglass — and the maps
      have no narrow paths.** Measured, now that the terrain rule makes it meaningful. A rig
      traced the marching route city-to-city by the flow field, took the narrowest passable
      span on it clear of both cities' ground as the neck, and classified every man's first
      crossing of the neck's line by PERPENDICULAR OFFSET — through the gap, through some
      other corridor, or across the impassable ground beside it. Three seeds, ~87 crossings
      each: every one through the gap, zero elsewhere, zero on impassable ground. The ground
      binds completely. But the "necks" measured 408, 500 and 564 wide — an army of sixty is
      a disc of radius ~100, so nothing on the war road ever constricts it, and the arrival
      tail (median ~28s, last ~148s) is reinforcements trickling in, not a queue at a choke.
      Same verdict as the curtain rig before it (0 of 60 through a 30-wide gateway on a run
      it was cheaper to walk round): the flow field is honest, the ground is just too open.
      **If the design wants hourglass fights, the lever is WORLDGEN** — somewhere on the road
      between Seats the passable ground has to close below ~150, reliably enough to plan
      around. Then the rig above becomes the test.
      (Watch the rig, still: the first curtain version counted anyone crossing the wall's
      LINE and so read men walking round it as a torrent through the gap — classify by
      offset along the line, never by the line alone.)
- [ ] **The corridor through a gateway is CLEARER, not clear — 30 men to 17.** *(and since:
      the two rules that keep it clear had disagreed about how wide a door is — `station` was
      dropping foot slots across ±1.35·`WALL.gate` while `jostle` refused pushes across
      ±`WALL.gate`. One `inCorridor` and one `GATE_WIDE` now; measured at sixty men on a 300
      run, 8 in the gateway before and 7 after.)* Reported from
      play: the reserve at the foot of a wall stands across its own door, so a company sent out
      has to shove through them. Two things fixed, each measured on a 300-length run with sixty
      men, counting the reserve inside a corridor 60 wide and 120 deep through the gate:
      the foot slots that fall in the gate's band are now DROPPED and the displaced men fall
      through to the next rank (remapping `t` instead merely COMPRESSED the row — twenty places
      into the shorter length, eleven apart where the spacing is fifteen, so `jostle` pushed
      them straight back into the gap: 30 became 24, a rule that looks like it works and does
      not); and a push that would put a posted man INTO the corridor is now refused, the way a
      push toward the water and a push through stone already are (24 → 20 → 17).
      **What is left is men who SETTLE there.** A settled man (`u.set`) is deliberately not
      moved — the formation already spaced him and a push on him is the pass arguing with the
      order — so a man who ends up in the corridor early, before the roster stabilises, stays.
      The fix is probably to treat the corridor like the waterline in the MARCH as well (a step
      turned along the band rather than refused), not to add another force. Worth a rig that
      watches ONE man from muster to station rather than a tally at the end.
- [ ] **One or two men still contend for a place at the foot of a wall.** The garrison at rest
      is otherwise still now (`a garrison at rest stands still`): median walking per reserve man
      over twenty seconds with no enemy on the board went from 2.57 units a second to 0.00, and
      the median man stands 2-3 units from his place rather than 15. The MEAN is 5.04 → 2.77,
      and the whole of that remainder is one man of sixteen walking his 1.48-unit stride into a
      1.5-unit shove, twelve units from a place he never reaches. Two candidate cures were
      written and both measured WORSE, so neither shipped: spacing the foot rows at `CROWD.space`
      rather than on the parapet's berth grid (the honest fix for a formation packed tighter
      than the crowd allows — but it makes the rows deeper and produced TWO runners instead of
      one, mean 3.35), and refusing a step that does not close the distance (no measurable
      effect at all — the step DOES close it, and the shove after it opens it again). The real
      answer is probably that a settled man should ignore the crowd the way a berthed man does,
      which is a change to who is in `jostle`'s grid and wants its own measurement.
- [ ] **A wall's own reshuffling could not be reproduced.** Reported alongside the jitter above:
      "archers on walls keep reshuffling even when the wall is not under attack". Measured three
      ways on a two-run curtain with the garrison settled: with no enemy anywhere, ZERO places
      change hands in twenty seconds; with a hall mustering a recruit every three seconds for a
      minute, exactly one place changes hands per recruit and no man already standing is moved;
      with one rival strolling the length of the wall at 400/300/200/120 units out, 0/2/5/2
      places change hands in thirty seconds, which is the curtain gathering toward him and is
      the rule working. `WALL.alarm` is 420 — four times an archer's reach — so a bystander
      does move the roster, and that is the one lever if it is reported again.
- [ ] **The rebuild ration is a TRADE, and `NAV.perTick: 0` is the way back.** It halves the
      worst tick — 27ms to 13 on today's board, 97 to 27 at twice the width, 285 to 66 at three
      times — by building at most one cold flow field a tick and letting a man whose field is
      not ready walk straight at his goal for that tick (0.06% of a match's ticks). It also
      makes every measured pairing run LONGER: at forty games a matchup the outcomes do not
      move (greedy's mirror 15-17 with eight timeouts either way, bleys' 60% against 55%) but
      greedy's median goes 10.8m → 16.1m, bleys' 7.8 → 8.9m, and bleys' timeouts 1 → 4 of 40.
      Inside the 5-20m band, one-directional, and not fully explained: only two steer calls a
      match are ever deferred, so a 50% median shift is more than the mechanism obviously
      accounts for. Worth understanding before the dial is trusted at other sizes.
      Shipped at 1 to be PLAYED and judged by hand. `perTick: 0` restores the old behaviour
      exactly and the suite holds both halves.

- [ ] **How big can the board get?** Measured on the shipped code, `CONST.MAP` overridden in
      process, two heirs actually playing six minutes at each size. The steady state barely
      moves — mean tick 0.54ms at 2000×2400 and 1.19ms at 6000×7200, p99 1.9ms against 3.9ms —
      because it is unit-bound, not map-bound. Vision is FLAT (0.54 → 0.70ms; it is bounded by
      sight radius) and `update()` is flat. What scales is worldgen (118 → 327ms, sublinear) and
      the flow field, which is dead linear: 6.3ms → 59ms.
      With the rebuild ration in (`NAV.perTick`) the worst tick is 13ms at 2000×2400, 27ms at
      4000×4800 and 66ms at 6000×7200 on a desktop-class core. **The renderer, not the sim, is
      the next wall**: the ground MESH is one vertex per 10 units, so 48k verts and 1.7MB today
      against 433k and 14.9MB at three times the width, and the ground TEXTURE self-caps at
      22.9MB (terrain.js already guards at 6 megapixels) — which means at 3× the same pixels
      cover nine times the ground and the painted land gets three times blurrier. Frame time was
      NOT measured: this container runs software GL and the numbers it gave were transparent
      noise (276ms at the smallest size, 58ms at 5000×6000). That needs a real phone.
      And `NAV.cell` is not a dial: it is also the worldgen resolution, and at 24, 30 and 40
      ZERO of six boards built at all.
      So: 1.5× linear is free today, 2× wants a ground-mesh LOD first, and past that somebody
      has to look at it on a phone. A bigger board is also longer marches and longer matches,
      which is a referee question before it is a frame-rate one.

- [ ] **The heirs play one army and one and a half orders.** Surveyed against the grammar and
      the content tables, with the claims measured over real headless matches (seeds 1000-1005).
      Ordered by impact over effort; `[REF]` needs `node sim.js` before and after, `[SAFE]` does
      not touch a balance surface.
      1. [x] The wall misprice — `spanFor` sizes the run to the purse (see its note in ai.js).
      2. [x] Marching on a walker's Shrine — "the answer to a walk is an army at the Shrine".
      3. **The shooter deadlock.** `[REF]` `strike` refuses to march without three breakers, and
         julian's own doctrine forks every hall to archers once two towers stand — which its
         plan guarantees by minute three. Measured: julian ending a match with **74 archers and
         one champion**; benedict with 7 binders + 14 archers and **zero breakers**, winning
         only by walking. Fixes: fork only half the halls to shooters, drop `army >= 5` from the
         Siege Works want when `breakers === 0`, and add the missing buildings to `upPref` (next
         item) so the Works can actually fork.
      4. **Dead branch doctrines.** `[REF]` A fork happens only inside the `upPref` loop, so a
         building absent from that heir's `upPref` never levels and never forks. julian's
         `branch.spire` is unreachable (no spire in the plan *or* the list); brand builds two
         Spires and can raise a Works, but its `upPref` is `['tower','gate','barracks']`, so
         **brand's Spires and Works never fork** and it fields Sorcerers and Engines all match.
         The Warden branch is reachable by benedict alone, and only under two threats.
      5. [x] `homeThreat` no longer recalls the whole army for one fiend (2026-08-17): three
         hostiles at the gate or any RIVAL's man there; a fiend is the Seat gun's business.
      6. [x] The assault has hysteresis (2026-08-17): sets out at the COMMIT floor and goes on
         down to two thirds of it. Refereed together with 5 and the spawn offset — `node sim.js`
         before/after: mirrors 50/75% → 35/55% (n=20, both within noise of even), gradient
         100/90/90 → 90/95/100, contested Pattern share 55% → 67% (target 50, tolerate 25-75 —
         nearer the lip, watch it), greedy convergence median 25.3m → 14.3m; benedict vs random
         at n=40 unchanged (37-1/2 timeouts against 37-2/1).
      7. [x] The errand company is chosen by content and cached ("the errand gets a company
         of its own", ai.js).
      8. [x] The Jewel and the Trump are asked for only when the purse and a living champion
         would not refuse them (2026-08-17); whether Chaos should be storm bait at all is a
         doctrine question left open.
      9. [x] A breach is mended ("a breach is mended, not mourned", ai.js); `flip` is still
         never issued by an heir.
      10. **Half the springs are invisible.** `[REF]` `v.nodes.enemy` — the far seven of
          fourteen — is referenced nowhere in the file. Measured finished Gates per match: 1.2
          to 4.6 of 14.
      11. **One strike force, not five followers.** `[REF]` `{c:'assign'}` would fold every
          fighting hall onto one company and leave the errand hall on its own. With items 5 and
          7 this is the "troop management" the brief asks for.
      Latent: the upgrade affordability test omits `sizeOf`, exactly as item 1 does. It cannot
      bite only because no `upPref` contains `'wall'` — the moment items 1 or 9 make walls worth
      levelling, it is the same bug again.
      Decorative, worth deleting or implementing rather than leaving to be tuned: `wantGates`'s
      and `wantWatch`'s `n` argument (`slice(0, n)[0]` is `[0]` for every n >= 1).
- [ ] **The Pattern is at the top of its tolerance.** Opening the economy moved it from
      deciding 10% of matches to 45%, and 67-75% of CONTESTED ones against a 25-75 band. If a
      full `node sim.js` pushes it past 75, the lever is the Shrine's `drain` or `rate` — NOT
      undoing the errand company, since "no heir can afford to walk" was the actual defect.
      Measured 74% after the movement rework (crush/flow/SDF, 2026-08-07) against 67% before
      it on the same day — the same referee section, so some of the spread is the n=20
      sections' own noise, but it is sitting on the lip. First thing to re-read on the next
      full run.
- [ ] **The Jewel of Judgment is stronger than it was.** A body that stays a body is better
      storm-bait: 44% → 79% of a 64-man host harvested by the worst 85-disc after a war of
      attrition. If it is too strong, widen the berth passed to `bodyPlace`; a comment at the
      call site gives the geometry (a body of n at berth b is a disc of radius b·√(n/π)).

## Housekeeping — from an architecture review (2026-08)

### From a repo audit (2026-08-17) — verified against the source, act in this order

- [x] CLAUDE.md split (2026-08-17): the rules stay (993 lines, from 1,238), the measurement
      prose moved to `LEDGER.md` (572 lines) under the same headings with `(→ LEDGER: …)`
      pointers, and the wall bullet is its own H2. A harder pass toward ~550 lines would have
      to drop rule sentences — the biggest remaining blocks are "EVERY SEAT IN A WAR IS AN
      HEIR" (~50 lines, nearly all rule) and the wall section (~127).
- [x] Stale claims in CLAUDE.md fixed (2026-08-17): thirteen commands, seven rules (+ `walkMul`
      in the war's list), the hook stamps index.html + sw.js only, the Reach War intro no
      longer claims a lord brake or the `lord` baseline, and the sheet asks `World.forkAt`.
- [x] GAME_VISION.md's Long War rewritten as the Reach War; War Banner and the four-heir ladder
      dropped; OPEN_WORLD_PLAN.md bannered as a record and listed in Key Documents; REALM_PLAN's
      header says the lord brake was removed.
- [x] Dead code deleted (2026-08-17): the `lord` baseline (its default ported into `warOrders`),
      `CONST.REALM`/`COUNTRY`/`BIOMES` and the biome plumbing, the renderer's phantom `sgate`/
      `watch`/`veiled` arms, ui.js's no-op `pointerdown` listener, `RENDER_MODE`, `Rec.abandon`,
      `head.adopted`, `w.seq`, and six renderer debug hooks nobody called.
- [ ] **Deliberately kept, and to be LABELLED so**: `WG.fromSpec` + `ch.spec` (no chapter uses a
      spec yet), `proto/reach/` (deployed, imports live worldgen and will rot silently — freeze
      its own copies or say so).
- [ ] **`{c:'raze'}` is a finished sim command nobody can issue** — the dead-BUTTON failure
      inverted: a dead ENTRANCE. Its consumers all exist (the wire, the council map, the
      renderer, the lords' doctrine reads `city.razed`). Either the council offers "throw down"
      on a yielded court, or the command and its tests go.
- [x] `?reach=` boot: `game.bot` is null wherever `game.bots` exists (2026-08-17), so "play
      again" from a country goes to the menu instead of starting a marcher duel.

- [ ] **`update()` wants breaking up.** It is ~480 lines (world.js 1955–2432) with a ~215-line
      per-unit loop in the middle, and the TICK ORDER is load-bearing — vision, rebin, the
      players' pass, Chaos, storms, the parapet roster, the march, the crowd — but written
      down nowhere as an order. Extract `stepUnit`/`stepBuilding` and state the order in one
      place. Behaviour-neutral, so the suite is the referee.
- [x] `applyCommand` is a handler table (2026-08-17): `COMMANDS[cmd.c](world, pi, pl, cmd)`,
      the winner, seat and halt gates in front of it; twelve seeded duels trace identical.
- [x] `spawnUnit`'s two-lane offset is gone (2026-08-17): the Trump's champion appears on the
      Seat's side that faces the middle of the board. Refereed with the batch below.
- [x] The module list is one list (2026-08-17): a suite reads index.html's script tags and
      holds sw.js `CORE`, sim.js's requires, this suite's requires and every `js/*.js` on disk
      against it, and checks the version stamp on both files the hook writes.
- [ ] **The pre-push gate is slow because it plays whole matches.** The headless suite's
      longest stretches are full bot games — `the solo ladder` alone is on the order of 100s,
      and the other match-length suites add ~90s more. Match-scale questions are `sim.js`'s
      job; consider moving them to a sim tier so `node test/run.js` answers in well under a
      minute. The suite already names its slowest suites — start there.

## Phase 1 — Feel & fairness
- [ ] Human playtest pass: essence pacing, march speeds, chaos curve on the big map
- [ ] Corwin (skirmish AI) lacks a >60% counter — teach one or trim his contest play
- [ ] Mechanic ablation runs (each building/power must move win rates)
- [ ] Guest-side interpolation polish; RECONNECT (pairing again into a match already running —
      the goodbye/quiet work above ends a table cleanly, it does not rejoin one)
- [ ] Victory/defeat presentation (Pattern blaze / castle fall)

## Phase 2 — Content
- [ ] More Trumps (hero variety), 5th building?, per-heir portraits on menu/end screens
- [ ] Campaign framing text between ladder rungs (Zelazny-flavored) — the chapters, briefings
      and objectives all shipped; this is the prose between them, not a new mechanism
- [ ] Audio (procedural, perils-style sfx.js)

## Phase 4 — Polish + infra
- [ ] Rebma / Tir-na Nog'th expansions, Jewel weather control

(Phase 3, the 4-player LAN, is done: the star topology, the lobby, both beginnings, seats up
to four, and bots on every seat nobody holds — including one a heir walks out of.)

## Known decisions
- Host-authoritative netcode (not lockstep) — fog of war + no cross-browser determinism trust.
- Pattern walk is an *instant win at 100%* but revealed at start — the anti-stall keystone.
- Portrait-first; the world pans on both axes at a fixed visible width (`CONST.VIEW_W`) —
  the one-screen, no-pan MVP board is long gone.

- [ ] **The referee's probe floors julian and benedict fail** (the player's openings, first
      run): under a standing raid at natural economy both end with income 7 and 8-9 Gates lost —
      the adaptive towers are not enough when the purse is real (they arrive too late to pay for
      them). The named next AI work: earlier tower-with-gate pairing for the exposed doctrines,
      or a cheaper first answer (a garrisoned company posted at the most raided spring). [REF]
- [ ] **Where a Shrine may stand** — the design lever left on the walk: it hides behind the
      throne inside the court's guns, which is why no bot answer stops a fortified walker and
      the contested share cannot reach 50 by length alone (65% at a 10.4-minute walk). E.g. a
      Shrine must stand outside `CITY.seatR + margin`, or on a spring. The designer's call.
- [ ] **Batched reinforcements** — the honest fix for the trickle a human farms (fifth
      chronicle: fourteen minutes of 10-20-man packets into a 120-man army). Newly-mustered men
      should POOL at their hall/court until a body of ~8 forms, then march to the standard
      together; the standing army is untouched. Needs sim support (a per-company staging rule in
      the muster, not an AI clause — `AMBER_CONSOL=1` shows why: recalling the ARMY to pool
      loses the map, tripwire 40-46% vs 63%). [REF]
    - REOPENED (2026-08-21): after the gated-springs set-diff fix the contested share reads
      89% at rate 0.16 (5 by force, 39 by the Pattern) — heirs who defend their Gates are
      harder to starve mid-walk, so the walk decides even more. The band (25-75) is red
      again; next levers are a slower rate still (0.12 measured next) or the 'where a
      Shrine may stand' design lever. Corwin now PASSES his raid floor (was a named
      failure); julian and benedict still fail theirs (8 gates lost against a floor of 6).
