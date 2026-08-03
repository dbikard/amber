# Amber — The Open World (v0.7+ design)

The plan for replacing the site-graph board with a continuous map: free movement over real
terrain, free placement inside claimed ground, essence nodes worth fighting for, walls built
piece by piece, and defence trees that fork.

This document is the target. `GAME_VISION.md` describes the game as it ships today; entries
migrate from here to there as each stage lands.

---

## 1. What changes, and why

The site graph was always a stand-in for terrain. Nodes and edges gave us chokepoints, fog
anchors and pathing for free, at the cost of a board the player has to *learn* rather than
*read*. Real geometry does the same work and reads instantly: you can see that the river is
a wall and the gap in the cliffs is where the fight will be.

The deeper change is the **anti-stall model**.

- **Was:** Chaos escalation was the clock. Turtle long enough and the fiends kill you.
- **Now:** the *economy* is the clock. Turtling inside your starting ground loses because the
  rival claims more essence than you can, and buys an army you cannot answer. Map control is
  the win condition behind both win conditions.

That single change is what justifies the larger map. On a site graph there are ~6 places worth
holding, so the eco race resolves in two minutes. On an open map with scattered nodes, "how
much ground do I hold" is a continuous, contestable quantity — which is exactly the pressure
that makes turtling lose on its own, without a PvE timer forcing it.

**The Pattern remains the absolute clock.** If neither player attacks, someone walks and wins.
No match can draw. This was always pillar 3; it is now load-bearing rather than decorative.

**Match length moves to 15–30 minutes.** Free placement, a claim race and piecewise walls are
an attention budget that a 6–12 minute match cannot spend. Everything below is tuned for the
longer match: slower openings, more upgrade steps, a real mid-game.

## 2. Chaos, repurposed

Chaos is no longer a doomsday timer. It becomes **the price of the best ground**.

The black road still runs down the spine of the map, and the richest essence sits along it.
Rifts tear open near the road on a steady (not escalating) cadence, so central nodes need
garrisons, walls and towers to hold, while the poor nodes behind your city are safe and free.

That turns the eco race into a risk curve instead of a land-grab: expanding *is* exposure. It
also keeps Chaos as spectacle and as a neutral third army without making it the referee.

- Rift cadence: steady, tied to *position* (near-road) rather than to match time.
- A late "surge" may stay as a flavour beat, but must not be able to decide a match on its own.
- Fiends attack whatever is nearest, both players alike. Unchanged.

**Open question for playtest:** whether central nodes should also be individually richer, or
merely more numerous. Start with richer — it makes the choice sharper.

## 3. The map

- Continuous world, no nodes, no edges. Target ~2–3× the current area.
- **Terrain grid** (~8–12 world units per cell) carrying passability and build-legality:
  open ground, forest (passable, blocks building, slows), rock/cliff (blocks both), water
  (blocks both), road (fast, corrupt), city ground.
- **Generation is corridor-driven.** Obstacles are placed so ~3 routes connect the two cities:
  the black road down the centre plus two flanking approaches, with pinch points where the
  fighting naturally lands. Mirrored through the centre for fairness, jittered per seed —
  the same fairness rule the site template uses today.
- Terrain **does not block vision.** Fog stays radius-based. Line-of-sight on a phone screen
  is expensive to compute and hard to read; the payoff does not justify either cost.
- The generator names its own chokepoints internally. The AI reasons over those anchors, and
  they are what keeps `sim.js` meaningful through the transition (see §8).

## 4. Territory and building

Free placement, but not anywhere.

- Every player has a **claim area**: the union of radii around the Seat and each owned outpost
  or claimed node. Building is legal only on unobstructed, unclaimed-by-the-enemy ground
  inside your claim.
- Expanding the claim *is* the map game: to build forward, you must first hold forward.
- Claims stop the degenerate case (a barracks next to the rival's Seat) and, just as
  importantly, bound the AI's placement search to a tractable region.
- The 8-slot city ring disappears. Buildings are `{bt, level, x, y, hp}` placed anywhere legal.
- Overlap rules: each building has a footprint; no overlaps, small spacing margin so units can
  path between structures rather than getting boxed in.

**Command grammar changes:** `{c:'build',slot,bt}` → `{c:'build',x,y,bt}`, and every
slot-indexed command (`up`, `rally`) keys off a building id instead.

## 5. Essence

Fixed **essence nodes** scattered over the map — rich near the black road, poor near the
cities. A node produces for whoever has a harvesting structure within range of it.

- **No haulers.** A structure in range yields a continuous drip. Carrying loads back to the
  city is a second unit economy, a pathing-traffic problem, and continuous input — all three
  fight the "minimal input" pillar.
- Nodes may deplete slowly, to keep pushing players outward over a 25-minute match. Start
  without depletion; add it only if playtests stall in a two-camp split.
- Harvesting structures are destructible and largely undefended by themselves. Holding
  economy is the reason armies exist.

## 6. Walls — SHIPPED (the Curtain Wall)

Shipped as **one work with a length**, not a chain of segments. The plan called for a run of
individually-destructible pieces and id-keyed netcode deltas; a single record carrying a
second end does everything that was actually wanted and costs the wire nothing — a wall rides
the ordinary building list with `x2`/`y2` beside `x`/`y`. Segments would have bought
partial breaches at the price of a second netcode path, and that trade was not worth making
until somebody misses them in play.

- **Two taps.** Tap the card, tap the far end. The run is previewed on the ground between
  them with its length and whether the masons will take it — `span` is 110–300.
- **It bars the ground to everyone but its owner.** Finished walls are rasterised into every
  other heir's nav mask (Chaos included), so a rival column routes around or breaks through.
  Marching is not collision-checked, so anyone standing in another heir's stone is put back
  on the side they came from.
- **It stops shots crossing it.** Line of fire is a segment-crossing test against the standing
  walls. Men behind a curtain are safe.
- **Except from the men ON it.** Come within `WALL.man` of your OWN wall and you are on the
  parapet: you throw `WALL.over` (further than any soldier reaches on the ground), and the
  wall stops covering you — the field can shoot back. **This clause is the whole balance of
  the thing.** A wall alone kills nobody; a wall that kills is a wall whose defenders are
  exposed.
- **Stone is a last-resort target.** A curtain is always the nearest thing to a man standing
  at it, so weighing it by distance like any other work had assaults hacking masonry while
  the parapet shot down at them untouched. Walls are considered only when nothing alive is
  in reach.
- **A tower shoots over stone.** Towers are taller than curtains: a wall is worth having
  behind a tower, and is no answer to one.
- Legal only inside your writ, and never across a Seat's own ground or another work.
- Not yet done, and deliberately: towers do not structurally join a curtain, and a breach is
  the whole run rather than a hole in it.

## 7. Defence and siege trees

### 7.1 Watchtower fork (shipping first — no map change required)

Level 1 is the shared Watchtower. The level-2 upgrade **forks**, and the choice is permanent:

| Branch | Identity | Strong against | Weak against |
|---|---|---|---|
| **Ballista** (giant crossbow) | slow, long range, heavy single bolt | champions, fiends, anything with a big health pool | massed cheap infantry — one bolt per cycle cannot stop six soldiers |
| **Cannon** | slow, shorter range, splash | swarms, tight marching columns | single elite targets; overkills nothing when alone |

Cannon is also the branch that will matter most once walls exist, and it is deeply on-theme:
gunpowder does not work in Amber, and Corwin wins his war by hauling in a shadow's jeweler's
rouge that does. The cannon branch is *Corwin's trick*, and should be named and flavoured that
way.

### 7.2 Siege line (with walls, stage 5)

If piecewise walls prove too strong — and they will, that is what walls do — the answer is an
offensive counter, not weaker walls. A **Siege Works** building musters slow, fragile siege
engines that out-range towers and do heavy structural damage but are nearly useless against
troops. This gives the attacker a real "break the line" investment and gives the defender a
reason to sortie rather than sit.

Balance is a sim question, not a design one: walls are correctly tuned when a wall investment
and the siege investment that answers it cost roughly the same, and neither wins unanswered.

## 8. The AI — the hard part

`ai.js` today reasons in desired *counts* ("I want two Shadow Gates") and one banner target.
On an open map every heir must also choose *positions*: where a wall runs, where a tower
covers, which node to claim next. This is the single largest risk in the change, because if
the AI cannot play the open game competently, `node sim.js` stops being a referee — and we
would be changing the entire simulation with no instrument to tell us what broke.

Approach:

- Keep the generator's chokepoints and nodes as **named anchors**. Heirs reason over anchors
  ("claim the near-road node", "wall the west pinch"), not over raw pixels — this preserves
  the existing mission/priority structure almost intact.
- Placement within an anchor is a small scored search: an **influence map** (friendly value,
  enemy threat, distance to claim edge) scores a handful of candidate cells; take the best.
- Wall runs are chosen by connecting two terrain obstacles across a chokepoint — the shortest
  legal line that closes a gap.
- Personalities keep their identity as anchor priorities plus a tower-branch preference.

## 9. Netcode

Host-authoritative and fog-filtered as today. What changes:

- Buildings are id-keyed with positions instead of slot-indexed.
- Walls ship as deltas, not as full state (§6).
- Terrain is generated from the seed on both sides and never transmitted.
- Fog rule changes shape: with no slots, "occupancy public, type veiled" dies. Replacement is
  the standard and cleaner rule — **structures are visible only within vision, and remembered
  as last-seen ghosts once explored.** Pattern-walk revelation is unchanged.

## 10. Staging

Every stage ends with `node sim.js` green against the targets in `DESIGN_PRINCIPLES.md`. No
stage begins before the previous one is green. A big-bang rewrite would change the sim and the
AI simultaneously, leaving nothing trustworthy to measure against.

1. **Watchtower fork** — ballista / cannon branches. No map change. *(shipping now)*
2. ~~**Continuous movement**~~ — DONE (`js/nav.js`). Cost grid + per-(goal, owner) Dijkstra
   flow fields. The site web is baked in as corridors so behaviour matched the old march;
   stage 3 swaps the synthetic cost for terrain and nothing above the nav layer changes.
   Two fairness bugs fell out of the mirror check: the self-mirroring `mid` site was jittered
   (pre-existing seat bias), and the grid cell must divide the map or it is half a cell out of
   step with the board's mirror. **Any future grid must keep both properties.**
3. ~~**Terrain**~~ — DONE. Real ground on the nav grid: ROAD (cost 1), OPEN (2), FOREST (4),
   ROCK and WATER impassable. Distance to the nearest path curve or site decides the
   character of the ground — roads and their shoulders open, the near country wood, the far
   country closed — so corridors are not authored, they are what is left between the wilds
   (~3 routes across a typical row, measured). Generated for one half and point-mirrored, and
   `NAV.audit` asserts at world creation that no site is stranded.
   *Deviation from the plan:* edges stay authored rather than derived from reachability.
   They are now the corridor skeleton terrain is generated *from*, so deriving them back out
   would be circular. Path bends moved onto the map (`map.curves`) as world truth, mirrored
   with the opposite hand, so terrain, nav and both renderers sample one curve.
   Wood, rock and water are also what the renderers draw — there is no decorative forest any
   more; what you see is what blocks you.
4. ~~**Free placement**~~ — DONE, with the balance caveat below. Works carry ids and
   positions; `OUTPOSTS` merged into `BUILDINGS` (free placement left the distinction with
   nothing to mean). Claim = Seat ∪ every Gate; a Gate may be raised outside it only on a
   free spring your troops hold. Springs carry the economy and a Gate elsewhere trickles —
   without that, five home gates replace map control and the whole anti-stall model dies.
   Fog swapped to see-it-or-remember-it.
   **The field polarised and stage 6 must repair it** (Brand at 12 wins, median match ~8 min
   against the 15–30 target). Recorded rather than papered over — the sim is the referee,
   and this is what it said.
5. **Walls and siege** — the Siege Works line shipped, then the Curtain Wall (§6) as one
   work with a length rather than drag-a-line segments. Towers joining curtains and the
   Chaos repurposing of §2 are still open.
6. **Retune** — match length to 15–30 min, Chaos cadence, heir rebalance, ablation runs.

## 11. Known risks

- **AI positional competence** (§8). Mitigated by anchors; still the thing most likely to
  cost real time.
- **Phone input.** Drag-a-line walls and free placement on a map you also drag to scroll needs
  a clean modal grammar. The flag tray (v0.6.6) already established arm-then-act; placement
  should reuse it rather than invent a second idiom.
- **Snapshot size** with many structures and segments. Deltas planned from the start.
- **Turtling might still win** if walls plus a compact claim out-value expansion. The eco
  model is the counter; the siege line is the backstop; the sim is how we find out.
- **Scope.** `world.js` is largely rewritten and `ai.js` substantially so across stages 2–5.
  This is a version-defining change, not a patch.
