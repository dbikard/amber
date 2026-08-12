# Amber — The Long War (v1.0+ design)

> **SUPERSEDED IN PART (2026-08-12): THE REACH WAR.** Stages 0–4 (rules, foe, cities,
> occupation, the quiet tick) shipped exactly as written below and stand. Stages 5–7 — the
> country as a GRAPH OF BOARDS — shipped, played, and were then replaced by the Reach War:
> one continuous land where every city owns a REACH, a company belongs to a city, and every
> flow field is fenced by its city's disc — which is what §1's own measurement said a big
> map needed and this plan solved with regions instead. The reach turned out to be the
> better spelling: the border became a rule of play rather than a seam. `js/country.js`,
> enter/compact/march and the map screen are gone (this file and git history are their
> record); the lord brake, `onePattern`, the save idiom and the run shape were ported. See
> CLAUDE.md "The Reach War" for what stands now, and `proto/reach/` for the rig that
> decided it.

The plan for a fourth mode: a country-size world of many regions and many cities, conquest that
yields ground rather than rubble, truces that can be made and broken, and a war you can put down
and pick up over many evenings.

This document is the target. `GAME_VISION.md` describes the game as it ships today; entries
migrate from here to there as each stage lands. `OPEN_WORLD_PLAN.md` is the record of the last
change of this size and is worth reading first — for its staging discipline more than its
content.

---

## 1. What changes, and why

Amber today is one board, one Seat per heir, five to twenty minutes, and everyone is everyone's
enemy from the first frame. All three are right for a duel and all three are what stops a match
becoming a *war* — something with a history, a map you have taken piece by piece, and an evening
that ends without the story ending.

Four things follow, and they are one design:

- **A country is many regions, never a bigger grid.** Measured before anything was written: a
  cold flow field is a Dijkstra over every cell and so is dead linear in area — 6.3ms on today's
  board, 59ms at three times the width, and a 4.8MB `Float32Array` at ten. The ground texture
  self-caps around 22.9MB, so a board three times as wide is simply three times blurrier. The
  steady-state tick, by contrast, is unit-bound and almost flat (0.54ms → 1.19ms at 3×). So the
  thing that must not grow is the GRID, and the thing that may grow freely is the number of them.
  **A region is today's board**, at today's size, with today's `NAV.cell`, today's ground mesh and
  today's fog. That is what keeps `sim.js` a referee and the headless suite meaningful.
- **Conquest must yield ground, not rubble.** A Seat falling ends a match today, which is right
  when there is one apiece and absurd when there are fifteen: you would fight for a city in order
  to destroy it. So a Seat at zero **yields**, and is then **taken by standing in it** — the same
  verb as a spring. Breaking a place and holding it become different problems, which is the
  difference between a raid and a conquest.
- **The world away from you keeps going, and it is the SAME sim.** Not a second, abstract combat
  model — two models is two balance surfaces, and players learn to fight their battles on the
  kinder one. One sim, at a variable rate: a region with nothing contested in it has nothing to
  simulate that is not arithmetic, and arithmetic may be taken in one large step exactly.
- **Heirs may treat with each other.** A four-cornered war with no diplomacy is three people
  taking turns to be everyone's enemy. A pact is mutual and breaks instantly, because being
  surprised is the price of having trusted somebody.

**The Pattern is still the clock, and there is only one of it.** One Shrine site, in one city, in
the whole country. Everyone knows where. Holding it is the only way to walk, so the map has a
centre without anybody declaring one, and the endgame is a convergence rather than a grind
through fifteen sieges. Every rule about the walk — public, unrefusable, one rate for everyone,
`World.walkers` — is unchanged; only the theatre is larger.

## 2. Layers

```
js/realm.js     the country: regions, cities, lords, marches, the pacts at country scale, the
                Pattern's city, the save record. Holds no live world.        (headless-safe)
js/country.js   country-scale generation: coarse noise → a region graph, biomes, which borders
                are ocean or mountain and where the crossings are.           (headless-safe)
js/world.js     UNCHANGED IN SHAPE. A region is a `world`.
js/game.js      a fourth `game.mode`, holding a realm the way it holds a `CAMPAIGN.run`.
```

`js/nav.js` needs nothing at all: `nav` is built per world from its own `gen`, so regions are
isolated for free. `js/worldgen.js` gains a `biome` and an `edges` option and is otherwise itself.

The seams in `js/game.js` already exist and are the ones to use: `startSP(kind, opts, chapter)`
takes an `opts` bag that already carries `seed`, `spec`, `players` and `eco`; `game.mode` is a
plain string everything downstream switches on; `onPopState` already peels layers in order;
`Rec.begin({mode})` already labels the chronicle per mode.

## 3. `world.rules` — today's game is the default — SHIPPED

`CONST.RULES` is the table, `createWorld(seed, players, spec, rules)` copies it onto the world,
and the sim asks the world rather than a global. Three entries so far:

| rule | default | off/on |
|---|---|---|
| `endOnSeat` | 1 | a Seat at zero ends the match (or eliminates its heir). Off, it yields. |
| `occupy` | 0 | a yielded Seat may be occupied, relieved or thrown down. |
| `truce` | 0 | heirs may offer, seal and break pacts. |

Copied and not shared, deliberately: two worlds in one process must be able to disagree, which is
the whole reason a region can be a world. A headless suite asserts the defaults ARE today's game,
because every claim in this document about "the existing modes are untouched" rests on it.

## 4. `World.foe` — one predicate — SHIPPED

The one spelling of *"may I strike this"*. Written inline as `owner !== owner` at a dozen sites,
which was correct exactly as long as the answer could only be "everybody who is not me".

**It is not the same question as "is this mine", and they wore one spelling.** `js/world.js`
carries 46 owner comparisons and only some are hostility: the muster cap, the wall roster, the
crowd's cohesion, company assignment, vision and a heir's own ghosts all ask whether a man is
HIS, and a pact must change none of them. A truce is not an alliance — his men do not join my
formations, my Wardens do not mend them, my walls do not open to them and I see nothing he sees.
So the change was a classification of all 46 and a substitution of one class:

- **through `foe`**: `cached`/`acquire` (both the unit scan and the works-and-Seats loop),
  `bindNear`, `seatFire` and its splash, tower gunnery and its splash, the storms, the curtain's
  alarm, the spring contest, and the Seat's own siege damage;
- **and at the door damage comes through**: `hurt` and `hurtBuilding` refuse a blow between
  heirs at peace outright — the same guard the tower's shelter, the parapet's cover and the
  chains' amplifier are written at, and for the same reason: a pass added later cannot forget to
  ask. It makes a MISSED site a no-op rather than an arrow.
- **left alone**: every "is this mine" above.

Chaos is a foe of everyone and can be treated with by nobody: the black road has no seat to
offer terms with, and `CHAOS_ID` is not a player index.

Proved rather than asserted, with a control that fails on the pre-refactor code — see
`nothing crosses a pact` in `test/headless.js`. On the old code the peaceful board is *identical*
to the warring one (the throne falls for its full 2500, the Gate is razed, the Seat's gun answers
for 186); on the new one every reading is nought, and the warring board is unchanged to the byte.

## 5. Truces — a pact is two standing offers — SHIPPED

Deliberately not a state machine. `pl.offers[j]` is a boolean — *"I am willing"* — and a pact is
sealed while both stand. Symmetric by construction, so two seats cannot disagree about whether
they are at peace, and there is no agreement object to keep in step across a wire.

```
{c:'pact', p, on}      // p = the other seat; on = 1 offer/accept, 0 withdraw/break
```

It asks for a STATE, not a toggle — the rule the `pause` and `flip` commands already follow — so
two taps at once cannot cancel each other out.

- **Sealing clears both sides' targets**, or men go on swinging until the retarget stagger.
- **A sealed pact is public; a pending offer is seen only by its target.** You cannot play
  against a diplomacy you cannot see, and an unanswered offer is nobody else's business.
- **Banners**: offering is silent (it is an echo of your own tap); a rival ACCEPTING is a banner;
  a rival BREAKING is the loudest banner in the game. Both are chronicle moments.
- **The heirs need a doctrine or truces are decoration** — whom to accept from, when to seek one,
  when to break. Cheap to teach: `AI.view` already picks *the* rival as the nearest living seat
  it has found, so a pact partner simply drops out of that list and every downstream decision
  re-orients on its own.
- Scoped to the new mode and to campaign chapters. Skirmish and LAN keep `rules.truce` off, so
  `node sim.js` is untouched by the whole feature.

## 6. Cities as first-class — SHIPPED

`world.cities = [{id, site, x, y, owner, born, hp, maxHp, cd, level, name}]`, in SEAT ORDER at
the start so worldgen, the camera, the minimap and every mirror-fairness test read exactly as
they did. `pl.castleHp` and `pl.seatCd` are gone. Three answers, and nothing spells them itself:
`seatOf(w, pi)` (the city he rules from — his first held, else the one he was born to, so a
dispossessed heir still has a place and a toppled one still has a ruin to draw),
`citiesOf(w, pi)`, `cityAt(w, x, y)`. `cityOf` is kept and keeps its meaning — the SITE his seat
stands on — because a hundred call sites want a place and not a record, and it tolerates a world
with no city list at all, because `visionSources` is asked of a guest's snapshot dressed as one.

The gun moved with it: `seatFire` takes a CITY, so a heir who holds three has three guns on three
cadences. On the wire the whole list rides on the snapshot root (public — a Seat's hit points
always were, and in a country "whose is that" IS the map), and `players[pi].castleHp` survives as
a derived convenience meaning "the hit points of the Seat he rules from".

**One real regression, caught by the browser suite and not by reading it:** the host's
throne-collapse check read `world.players[pi].castleHp`, which had become `undefined` —
`undefined <= 0` is false, so no throne fell and the end screen cut straight to the tally. A
stale reader of a retired field fails silently in exactly this shape, which is why the suite
asserts the field is gone rather than merely that the new one works.

## 7. Yield, take, or throw down — SHIPPED

With `rules.occupy` on, a city at zero hit points yields: gates open, works inert, gun stopped,
belonging to nobody.

- **Take it** by standing in the court, and it comes back **hurt** — works dropped a level,
  garrison gone, writ shrunk to the court. It is a liability until you invest in it.
- **Throw it down** and nobody gets it. That is what gives "losing costs ground" its edge: losing
  a city you can win back is one thing, losing one that no longer exists is another.
- **Relieve it**: its owner standing in his own court takes it back at full price — not a
  special case, because from the ground's point of view there is no difference between a relief
  and a conquest.

Constants live in `CONST.CITY`: `court` (the Seat's own disc, so it is the ground the game
already draws and the player already reads), `take` (20s uncontested — long enough that a raid
cannot do it in passing) and `back` (0.35 of the throne, which is what stops one conquest paying
for the next). Two heirs at TERMS standing in the same court are NOT contesting it: neither can
push the other out, so the first to arrive keeps his claim.

**The bug this stage was really about, found by a probe and not by reading:** `acquire` chose a
Seat by walking the PLAYERS and taking `map.cities[ci]` — his BIRTH seat — which was the same
thing for exactly as long as a city could not change hands. Two rules broke at once: a captured
city could not be besieged by the heir who lost it, and a YIELDED one was still a target, so
every blow that landed on it fired the yield again. It measured as a court that could never be
taken, with its claim clock resetting every 0.93 seconds — which is a soldier's attack cooldown,
and the only reason the cause was findable at all. `acquire` asks about the CITY now, and the
siege damage goes to the city that was aimed at rather than to whichever the heir holds first.

## 8. The quiet tick — SHIPPED

**A region ticks at `SIM_DT` whenever anything contested is in it, and is otherwise advanced
exactly, at a coarse dt, by the passes that are linear in time.** `World.update` gains a cheap
front test — are two mutually hostile parties present at all? — and when the answer is no it runs
income, build and upgrade work, muster timers and cooldowns, and nothing else. Acquisition,
damage, splash, the crowd, vision and the flow fields are skipped because they have nothing to
do, not because anything was approximated.

**What shipped is the exact half, and it is the half that matters.** `world.hush` is computed
once per tick — is any heir with MEN a foe of anything standing? — and when nothing is, the sim
skips the passes that provably have nothing to do: target acquisition above all (profiled at 94%
of a busy tick), the tower and Seat gunnery SCANS, and the curtain's alarm clustering. The
gunnery cooldowns still run, because a gun that found nothing would have set exactly that
cooldown and skipping the arithmetic would be a different world. Nothing is approximated, which
is why the suite can demand identical state rather than a tolerance.

Measured on a region with one heir in it, quiet the whole way:

| men standing | quiet tick on | off | saving |
|---|---|---|---|
| 2 | 0.052ms | 0.054ms | 3% |
| 62 | 0.220ms | 0.341ms | 35% |
| 152 | 0.511ms | 0.924ms | 45% |
| 302 | 0.990ms | 1.971ms | **2.0×** |

The saving grows with the army because acquisition is the part that grows with it — which is the
shape you want: a region costs about what is happening in it. `rules.hush = 0` is the one-line
way back and the suite holds both halves.

The licence is the equivalence suite: the same seeded region played twice, once with the quiet
tick and once without, landing on **identical state** — with the control that it really was quiet
for >90% of the run, that a duel is not quiet for long and plays out identically either way, and
that one fiend, one storm or one hostile heir with men is enough to end it. Two heirs at TERMS
are a quiet world, which falls out of `World.foe` for free.

Still open, and deliberately not guessed at: the COARSE-dt half. Income, cooldowns and build
progress are linear in dt and could be taken in one large step, but muster and rifts are discrete
events and movement is not linear, so a safe large step is "time until the next event" — worth
doing when the realm layer can ask for it, and not before, because nothing today would use it.

## 9. The realm — SHIPPED

`js/country.js` generates the country from one seed: coarse elevation and moisture at country
scale, a graph of regions, a biome each, and for every border either **closed** (ocean, a
mountain wall) or a small number of **crossings** (a pass, a ford, a road). A region's own seed
is derived from the country seed and its key, so it is reproducible and generated on demand.

**The cost of a seam is proportional to how much border there is**, which is why the borders are
hard terrain with few crossings — the geography is doing the engineering. A column ordered past a
border steers at its crossing and is handed to the neighbour at the matching point: the wall
gateway trick one level up, and `postWalls` already has exactly that shape (steer at `w.gx/w.gy`,
then a local approach). The neighbour is loaded when a column comes within a margin of the
border, at reduced ground detail, and sharpens as you cross. Prefetch never blocks — a region
generates in ~118ms and an army takes minutes to reach a border.

**Liveness and region boundaries are kept apart, deliberately.** A live bubble is a radius around
troops and spans borders freely, always with a margin into the neighbour, so the live/quiet
transition never coincides with anything a player can see or aim at. Let them coincide and the
boundary becomes a game rule, and gets played against.

## 10. Lords, and the shape of a war — SHIPPED

- **A lord is an existing heir AI scoped to one city**, with an order — hold, build, raid,
  reinforce — which is a table in the shape of a chapter's `opts`.
- **Lords are the brake on the snowball, and it is enforced at the seam.** One city by right and
  one more per lord; past that a court simply **will not swear to you** — it goes back to being
  free and the map says which one and why, rather than a number being quietly ignored. A lord is
  **won**: taking a city from an HEIR brings his lord over with it, taking one from a minor
  holding wins ground and nothing else. So conquest pays for conquest only when it is conquest of
  a rival, and a war cannot be won by eating the weak. Checked in `REALM.leave`, which is the one
  place the country learns anything — `world.js` goes on knowing nothing above a board.
- **One Pattern, enforced as a placement rule.** `rules.onePattern` (set by `REALM.enter`, off in
  every single match) refuses a Shrine anywhere but the region `world.pattern` marks. So holding
  AMBER is not winning — it is being *allowed to walk* — and the endgame is a convergence on one
  place. A walk completed there wins the country, through `World.declare`, the same door every
  other ending goes out of: `REALM.run` has the shape `CAMPAIGN.run` has, so game.js polls both
  with one branch and neither ever writes to a world.
- **Losing your last city is dispossession, not death.** You keep your army and your lords and
  may take a city back. A bad evening must not end a campaign played over weeks.
- **Most cities belong to nobody who is playing.** Minor lords hold the rest — that is where the
  early game lives, and it is why a LAN opening is not "rush your friend before he has built
  anything".

`REALM.run` mirrors `CAMPAIGN.run`: held by game.js for the length of a war, polled once per
simulated frame, and **never writing to the world** — anything that ends goes through
`World.declare`, the one door out of the sim. Persistence mirrors `CAMPAIGN.progress`: one key
`amber_realm`, versioned, every `localStorage` access wrapped, because a private-mode browser
that throws must still be able to open the menu.

## 11. Staging

Every stage ends green on `node test/run.js`, and stages 0–6 each end with `node sim.js` against
the targets in `DESIGN_PRINCIPLES.md`. No stage begins before the previous is green.

| # | Stage | Ships on its own? | Referee |
|---|---|---|---|
| 0 | `world.rules` + `World.foe` — pure refactor | invisible | **byte-identical** |
| 1 | Truces: the command, the wire, the HUD, the doctrine, a chapter | yes — playable | unchanged |
| 2 | Cities first-class | invisible | **byte-identical** |
| 3 | Yield / take / throw down | yes, as a variant | its own run |
| 4 | The quiet tick + the equivalence suite | yes — cheaper 4-player | unchanged |
| 5 | `country.js` + `realm.js`: a generated country, biomes, closed borders, marches | **shipped** | — |
| 6 | The mode: a map screen, enter a region, march, save and resume | **shipped — playable** | — |
| 5c | Seamless border rendering (the neighbour drawn across the seam) | open | |
| 6b | Lords as a countable resource, and the walk as the war's ending | **shipped** | |
| 7 | LAN over the realm | open, severable | |
| 7 | LAN over the realm | severable | |

Stages 1, 3 and 4 each ship something playable on their own. That is the mitigation for the
size of this: if the realm is never finished, truces, occupation and the quiet tick are still in
the game.

## 12. Known risks

- **A missed hostility site.** The worst failure here, because it looks like a bug rather than a
  design error. Mitigated by making `foe` the only spelling, by guarding the two damage doors,
  and by the all-pacts rig with its control.
- **The quiet tick's honesty.** The equivalence suite is what finds out; nothing is approximated
  to make a number work.
- **AI diplomacy is a new competence**, as positional competence was the last plan's largest
  risk. Kept deliberately small: accept, seek and break predicates — not negotiation.
- **Two live regions on a phone host.** The tick is unit-bound and cheap; the flow fields are
  not, and `NAV.perTick` is per world and so already per region. Two players in different regions
  is the case to measure early.
- **Scope.** Seven stages, two new files, `world.js` and `game.js` substantially changed. This is
  a version-defining change, not a patch.
