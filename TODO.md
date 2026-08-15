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

- [ ] **Delete the `lord` baseline, or give it a job.** The war seats heirs now (`warBot`), so
      `BASELINES.lord` is unreachable from the shipped game and only four suites still exercise
      it. That would be merely untidy except that the liege's five words — `hold`, `gates`,
      `walls`, `attack`, `support` — are now implemented TWICE: once in `lord.custom`, where
      nothing runs them, and once in `warOrders`, where everything does. Two spellings of one
      rule is the drift hazard this codebase keeps warning about, and the unreachable copy is
      the one a reader will find first. Either delete it and rewrite those suites against
      heirs, or keep it deliberately as the weakest handicap preset and make `warOrders` the
      single implementation both use. `[SAFE]` — it cannot touch a duel.
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
      under it is spoken for until a rival breaks it for you. Wants a command
      (`{c:'raze', id}`), a place on the work sheet, and a decision about what it costs and
      returns: instant with no refund is the simplest honest rule, and a partial refund makes
      "raise it, look at it, take it down" a free way to survey the map. Rubble already has a
      meaning for walls (`WALL.rubble`), so a razed curtain should probably follow that path
      rather than vanish. `[REF]` — anything that makes a misplaced work cheap changes how
      freely the heirs build.

- [ ] **Make a fenced flow field sparse to its bound.** A field is a `Float32Array` over the
      WHOLE nav grid — 750KB on a country — and a bounded one only ever fills the cells inside
      its city's reach: measured, **21% of the grid**. So a country's 74-field working set holds
      ~55MB where ~12MB would do. The Dijkstra already visits only the disc, so this is
      allocation and indexing, not search: give the field an origin and a stride of its own and
      map (gx,gy) into it, returning "unreachable" outside. It would also make a bigger cache
      ceiling cheap, which is the knob that fixed the war's stutter. `[SAFE]` — no rule changes,
      and the suite's steering tests are the referee.
      (Asked and answered while measuring this: a scheme where a company shares ONE field and
      men orient by PROXIMITY to each other does not help. Reads are 92,793 against 15 builds,
      6,186 to one — the cost is the Dijkstra, and builds are per distinct GOAL, already
      essentially one per company. It would also strand followers behind terrain their leader
      rounded, and collide with `shove`/cohesion, which is local-proximity behaviour already.)

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
      1. **The wall is priced wrong and the misprice eats the plan.** `[REF]` `spanFor` sizes a
         run at up to `WALL.unit * 2` — two crews, 220 — but the affordability test compares
         against `BUILDINGS.wall.cost`, 110. So `saving` is never set, the order goes out, it is
         refused for essence, the plan `break`s on it anyway, and because `saving` is false the
         upgrade scan then spends the treasury below the wall price again. Measured, benedict
         seed 1000: **18 wall orders, 17 refused, every one a 300-length run tested against a
         one-crew price** — for minutes at a time, blocking everything behind it in the plan.
         Have `spanFor` return the run's real price, clamp the candidate length to the purse,
         and set `saving` when even the shortest legal run is unaffordable. This is why the
         curtain work has no referee signal: the two heirs who ask for walls mostly fail to get
         them.
      2. **Nobody marches on a walker's Shrine.** `[REF]` `v.walkers` carries every walker's
         **Shrine coordinates**, and it is read at exactly one place — to refuse a race already
         lost. Three of five heirs have no response to a rival's walk whatsoever; the two that
         do send the army at his *Seat*. A Shrine is one of the few works `menOnly` shooters may
         attack, so the `breakers >= 3` gate in `strike` is precisely backwards here. Two
         mechanical cautions when wiring it: a banner by coordinate needs its own memo (the
         current one compares site ids and would re-issue every think), and **every `banner`
         clears every company's rally**.
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
      5. **`homeThreat` recalls the whole army for one fiend.** `[REF]` `atGate > 0` is a single
         hostile within 116 of the Seat — Chaos included, though `rivals` exists for exactly
         that distinction. Measured: benedict's banner sat on its own Seat **51% of samples**.
         Recall a *company* rather than the banner, and only turn the banner home at `atGate >= 3`
         or a falling Seat.
      6. **The assault has no hysteresis.** `[REF]` `ready` is a flat `army >= 22` re-read every
         think; a marching column that dips to 21 turns around. Start at 22, continue at ~13,
         and remember which it is doing.
      7. **The errand company is chosen by accident and does not stay.** `[SAFE]` It is
         `cos[cos.length - 1]` — the youngest standard. Measured: seed 1000 that was the Spire's
         company, **7 Binders, every one `menOnly`**, sent to take springs they cannot hold;
         seed 1004 it was the Siege Works' company with **zero men in it**. And it leaves the
         moment the Gate finishes, because `nodeHolder` answers the instant the raise completes
         — so **nothing garrisons a taken spring, ever**. Pick by content, cache the choice, and
         hold the rally until the ground is quiet.
      8. **The Jewel is spent on the weather.** `[SAFE]` Both storm clusters include Chaos
         fiends, and neither cast checks the purse: **166 `power:essence` refusals and 24
         `power:alive` refusals in one 11-minute match.** Three lines.
      9. **Walls are one-shot and face the wrong way.** `[SAFE]` No heir has ever issued
         `{c:'fix'}` — a breach is never mended — or `{c:'flip'}`, though `spanFor` already has
         the perpendicular in hand at build time and a flip costs nothing and takes no crew.
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

- [ ] **`update()` wants breaking up.** It is ~480 lines (world.js 1955–2432) with a ~215-line
      per-unit loop in the middle, and the TICK ORDER is load-bearing — vision, rebin, the
      players' pass, Chaos, storms, the parapet roster, the march, the crowd — but written
      down nowhere as an order. Extract `stepUnit`/`stepBuilding` and state the order in one
      place. Behaviour-neutral, so the suite is the referee.
- [ ] **`applyCommand` is eleven `if (cmd.c === …)` branches in a flat chain.** A handler
      table is a cheap, safe refactor; the pause gate and the winner gate stay in front of it.
- [ ] **`spawnUnit` still carries the dead two-lane rule.** With no spawn point given the
      y-offset is `owner === 0 ? -60 : 60` (world.js ~1443) — "toward the other end of the
      lane", on a board that has not had ends since v0.8, and wrong for seats 1-3 in a
      free-for-all. Behavioural fix: `node sim.js` referees it.
- [ ] **The module list is written in four places** — index.html, sw.js `CORE`, sim.js and
      test/headless.js — and nothing asserts they agree. Only index.html fails loudly when a
      file is missed; the others degrade quietly (a stale offline cache, a global leaking in
      from an earlier require). One list, or a test that reads index.html and checks the rest
      against it.
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
