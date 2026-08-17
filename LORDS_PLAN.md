# Amber — The Lords (design review and proposal, 2026-08-17)

> **STATUS: A PROPOSAL, NOT A RECORD.** Written from a review of `js/ai.js`, `js/game.js`
> (warFooting / warBot / the council) and `js/world.js` (the pact command). §1 states how the
> bots work today, exactly; §2 lists what the review found (two defects were fixed on the
> spot, in `e91852f`); §3 is the proposal the designer asked for — named STANCES for sworn
> lords in place of the five words, every sworn lord at HEIR, and mutual aid. Nothing in §3 is
> built.

## 1. How the bots work today

**One brain.** `AI.make(kind, opts)` — `kind` a personality (`julian`, `bleys`, `brand`,
`corwin`, `benedict`) or a referee baseline (`marcher`, `random`, `greedy`); `opts` the
FOOTING (`slow`, `noise`, `hold`, `lapses`). `decide()` runs every `interval × slow` seconds
and always in this order: terms (`P.pact`, war only, founder only) → powers → the walk →
the CITY (standing wants: a spring under his feet, a breach to mend, one more hall while the
ground out-earns the muster, a Works when he cannot break stone; then `P.plan`) → the errand
missions (`P.missions`) → the BANNER (home under threat > the assault > the search > the
errand > `P.banner`) → the answer to a walk → the errand COMPANY (a spare standard sent to
take springs) → upgrades and forks (`P.upPref`, `P.branch`). Personalities differ in the
plan, the missions, the banner doctrine, the pact doctrine, the branch choices and the tempo.
The referee (`node sim.js`) seats heirs with NO footing; the lapses are the ladder.

**In a war** (`rules.reach`), `warBot(world, pi)` seats one per city: personality by seat
(`warKind`: `kinds[pi % 5]`), footing = the player's footing for a CONTENDER (`world.heirs`),
that footing made worse by `CONST.MINOR` for everyone else. `warOrders` wraps `issue` and is
the ONE seam where a country differs from a board:
- a banner becomes a rally per company, clamped into that company's city's reach;
- a MINOR lord's war body is turned away from a rival court onto the nearest spring worth
  taking (`springTo`) — he expands, he does not conquer;
- the liege's standing order rewrites the war body's destination: `attack` → the court,
  `support` → the court if pressed else home, `gates` → the spring to take (and `ordered()`
  prepends the Gate want for the crew), `hold`/`walls` → the standards struck (`walls` also
  wants a tower on the court's vantages);
- with NO order: trouble at a work of his own → the work (a minor lord always, a contender
  only when his doctrine had him at home); a pressed or exposed neighbour of his banner →
  that court, when the doctrine would keep him in the yard (`reserveAt`).

**The council** offers, per SWORN lord: COMMAND (the hand — the player drives that court, and
its bot is skipped) or one of five words — HOLD, GATES, WALL UP, ⚔ <court>, SUPPORT <court> —
persisted in `realm.helm.orders[lord]`. A guest gets COMMAND but no standing order (doctrines
step on the host).

## 2. What the review found

Fixed in `e91852f`:
- **A vassal made his liege's terms.** `{c:'pact'}` normalises to the banner's founder, so a
  sworn lord's `P.pact` doctrine wrote the PLAYER's offers — and, reading his own never-written
  `offers` back, re-issued them every think: 429 pact commands in forty seconds, thirteen
  standing offers the player never made. Only the founder treats now; held by a suite.
- **The hold covered the throne's site, not the writ.** A lord's errand company sat on a free
  spring 278 from the player's throne for five minutes at SQUIRE. `heldGround` covers the
  claim now — want, missions and errand alike.

Open — the design gaps the proposal answers:
1. **The player's own vassals play with the enemy's handicap.** `warFooting` composes the
   player's footing with `CONST.MINOR` for every non-contender, sworn or not. At SQUIRE the
   lords you have won hoard, forget their halls and dribble men — the flaws meant to make
   OPPONENTS beatable, applied to your officers. (The same shape as the hand-played court that
   kept the purse handicap.)
2. **Personality is fixed by seat** (`kinds[pi % 5]`), so a frontier court is a Brand or a
   Julian by accident of index and the player cannot choose a style for it.
3. **Five words, three behaviours.** `hold` and `walls` are both "strike the standards"
   (`walls` adds a tower want); `support` on an unpressed court is `hold`. And every word is a
   claim on WHERE THE WAR BODY GOES — none of them says how the lord should PLAY (economy,
   stone, army), which is what a style is.
4. **Aid is passive and local.** `reserveAt` fires only when the doctrine's aim is home;
   `support` must be given per lord per court; nothing sends a vassal to the PLAYER's court
   when it is pressed, and nothing lets the player raise the whole banner at once.
5. **The reach law bounds aid by construction** — a company may only be ordered inside its
   city's disc — so a lord two hops from a besieged ally cannot help. That is the design
   (affordability IS strategy) and should be said on the council rather than discovered.
6. **A minor lord's default is spring-taking**, which in a developed country means the
   `springTo` chain (free → a rival's) — an unsworn lord's errand can walk into your writ
   under a hold (fixed) and, sworn, into an ally's spring for no gain (a sworn lord's Gate on
   the liege's spring is legal and pointless).

## 3. The proposal

### 3.1 Stances — named doctrines for a sworn lord

Replace HOLD / GATES / WALL UP with four STANCES, in the game's voice, each a way of PLAYING
rather than a destination. A stance biases the same brain at the same seam (`warOrders` +
`ordered()`): the war body's destination, the crew's wants, and a few knobs of the doctrine.

| Stance | In one line | War body | Crew and purse | Never |
|---|---|---|---|---|
| **WARDEN** | Hold the court and fortify it. | Standards struck; the body stands at the court, and on the frontier face of it. | Towers on the court's vantages faced at the nearest rival court, a curtain across the approach when pressed (`spanFor`), archers once stone stands, mends every breach. | Marches on a rival court or takes ground beyond his writ. |
| **STEWARD** | Grow the country. | The errand company takes springs inside reach (free first, a rival's after — `springTo`); the body defends his works (`troubleAt`) and otherwise holds. | Gates on every spring held, halls levelled and forked, a Works only if breakers are wanted; the muster valve keeps the purse for stone. | Attacks a court. |
| **MARSHAL** | Field an army for the banner. | Follows the BANNER's war: to the liege's armed company or war body when it fights, to any court of the banner that is pressed (the liege's first), else home mustering. | Halls first, forked to fighting men; a Works when the liege's target has stone. | Expands beyond his writ (that is a Steward's job). |
| **MARCHER** | Push the frontier. | The nearest rival court on his border, when his column is a column (the contender's own assault clause, `strike`, un-turned); a rival's springs on the way. | Halls and a Works; walls only when pressed. | Sits idle while a rival court is on his border. |

The two TARGETED orders stay, layered over a stance: **⚔ <court>** (march there, whatever the
stance) and **SUPPORT <court>** (stand there while it is pressed). "How he plays" and "where he
goes now" are two questions; the old five words conflated them.

**A default stance chosen by geography, shown on the council** so it can be overruled: a court
with a rival court on its border is a WARDEN; an interior court is a STEWARD; when the banner
is at war (the liege's court or army under attack) interior courts within reach of the fight
act as MARSHALS until it is over. That replaces "no order" — the council row would read
"Warden (by default)" rather than "no standing order", which is what the ⚑ dot nags about.

### 3.2 Every sworn lord plays at HEIR — SHIPPED (2026-08-17, with the seat-0 driver)

`warFooting`: a lord of the player's BANNER (`realmOf(pi) === realmOf(viewer)`, seat 0
included while the hand is elsewhere) gets `C.DIFFICULTY.heir` — slow 1.2, noise 0.15, HEIR's
lapses — whatever the player's footing, and never `CONST.MINOR`; re-dealt on the oath.
Contenders keep the player's footing; unsworn minor lords keep the footing plus MINOR (they are
the opposition, and the ladder measured them). A lord of the player's banner also gets `noTerms`
and `noWalk`: terms and the Pattern are the human's decisions — a walk from a court a vassal
holds means taking COMMAND of it, which the council should say when AMBER is the banner's.
Two caveats still to decide:
- HEIR's table has `aim: 0.2` and `trickle: 0.5` — a vassal who wanders 20% of the time and
  attacks in dribs is a poor officer. Recommendation: a sworn lord takes HEIR's `slow`, `noise`,
  `gates`, `up` and `hoard`, but `aim` and `trickle` OFF — an officer under orders keeps his
  column together and goes where he is sent; the flaws that make an enemy beatable are not the
  flaws you want in your own men. This is a designer's call.
- Re-dealt on the oath and on the hand moving (`warBot`/`warFooting` are called where a seat
  gains a driver; the oath happens in `holdCities` — game.js must re-make the bot when a court
  swears, or the lord keeps MINOR until the war is put down and picked up).

### 3.3 Mutual aid

- **A pressed court of the banner is answered by every lord of the banner whose reach covers
  it** — not only when he is idle (today's `reserveAt`), but outranking his stance's own
  business unless his OWN court is pressed. "Pressed" is today's test: rival men within 650 of
  the court. The liege's court is a court of the banner, so the player is helped first
  (order: the liege's court, then the nearest pressed court).
- **The reach law still bounds it**, and the council says so: a lord's row shows which
  courts of the banner he CAN reach, so "why did nobody come" has an answer on screen.
- **TO ARMS**, one button on the council: every sworn lord within reach of the player's court
  (or of the player's armed company) is set to SUPPORT it for two minutes, then returns to his
  stance. It is the banner-wide order the five words never had.
- **The lords help each other the same way** — a pressed vassal draws his neighbours of the
  banner. Nothing else changes for the player, except that his ⚑ dot already says "a court of
  yours is hurt" and can now add "— two lords are marching to it".

### 3.4 Where it lands in the code

- `js/ai.js` `warOrders`: `mode` gains `warden|steward|marshal|marcher` (the old five map onto
  them for a saved helm: hold/walls → warden, gates → steward; attack/support stay as targets);
  the no-order default becomes the geographic default; the aid clause moves out of "when idle".
  `ordered()` returns the stance's wants (Steward: gates + a hall; Warden: `wantWatch` + a wall
  when pressed; Marshal: a hall; Marcher: a Works). The doctrine's own `plan` runs underneath.
- `js/game.js`: `warFooting(world, pi)` gains the sworn-lord branch; `ORDERS` becomes the
  stances; `onSteward` accepts the new modes; re-make the bot on the oath.
- `js/ui.js`: the council row and the court card show the stance (chosen or default), the
  targeted orders beneath, TO ARMS at the top of the roster.
- `js/realm.js`: `helm.orders[lord]` carries `{mode, target, until?}` — TO ARMS is a timed order.
- Tests: one suite per stance on a seeded country (the rig in "an order biases the crew" is the
  shape): a Warden raises towers and never leaves; a Steward's Gates grow; a Marshal reaches a
  pressed liege's court inside N seconds; a Marcher takes the rival court on his border; a
  sworn lord is dealt HEIR whatever the footing; a pressed court draws its neighbours.

### 3.5 What to measure before shipping

On one seeded country with the player's banner holding a cluster of four courts: Gates,
works and men per stance at six minutes; time from "the liege's court is pressed" to the
first vassal company arriving (and how many never can, by reach); how often a Marcher takes
the border court in ten minutes; and — the referee — `node sim.js` unchanged, since none of
this runs without `rules.reach`.

## 4. Open questions for the designer

1. HEIR's `aim`/`trickle` on vassals — off, or on as the footing says?
2. Should an UNSWORN minor lord get a stance of his own by geography (a frontier lord as a
   Warden, an interior one as a Steward), or keep today's "expand, do not conquer"?
3. TO ARMS: two minutes, or until the threat clears?
4. Does a Marcher take COURTS on the player's behalf (a conquest is an oath to the player's
   banner), or only springs? The former makes the war winnable by proxy — which the reach law
   already allows for the player himself.
