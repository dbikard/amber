# Amber — Design Principles

Adapted from Perils' pillars for a *competitive* build-and-defend game.

## Pillars

### 1. Minimal input, maximal spectacle
Units are autonomous. Player agency = build choices, upgrade timing, two powers, the walk
decision. Never require unit micro on a phone.

### 2. Every build is a bet
Economy vs. military vs. defense vs. the Pattern. If one opening is always right, it's not a
choice. Rock-paper-scissors must hold at the strategy level: rush beats greed, turtle beats
rush, greed beats turtle (roughly).

### 3. The walk forces the fight
Pattern progress is revealed. A walking player must be attackable and a stalling player must
lose to Chaos. There is no passive path to victory.

### 4. The economy is the anti-stall
Turtling inside your starting ground loses on its own: the rival claims more essence, buys a
bigger army, and comes for you. Map control is the pressure behind both win conditions.
Chaos is *the price of the best ground* — the richest nodes sit on the corrupt road, so
expanding is exposure — not a doomsday timer. Convergence is guaranteed by the Pattern walk,
never by PvE. Target: 15–30 min.

### 5. Readable chaos
Color language is law: **gold = you**, **crimson = rival**, **sickly green = Chaos**,
**blue-white = the Pattern/Order**. Telegraphs before damage (storm gathers before it strikes,
rifts tear before they spawn).

### 6. AI plays fair
Same fog, same prices, same cooldowns as a human — never map hacks, never a discount the
player cannot have. An easier footing takes things AWAY from the heir; it never gives it
less than the truth about the board.

Difficulty was once described as "better policy + faster reactions + less noise". Measured,
that was wrong: an heir polled at half the rate, or skipping 45% of its turns outright, still
won its mirror 42–50% of the time, because its decisions are "spend the essence on the next
thing in the plan" and the essence is still there a few seconds later. The two knobs that
actually bite are **what it draws from the ground** (`eco`) and **the hour it will march on
your Seat** (`hold`) — and both are needed, because cutting income ALONE brings the assault
sooner: a poorer heir builds less realm and comes for you earlier. The ladder is checked the
way any other number here is, with `test/headless.js` "the solo ladder" holding the shape.

## Validation: the simulator is the referee

`node sim.js` plays headless bot-vs-bot matches (same `update()` as the browser, seeded RNG).
Every balance question is answered with data:

- **Mirror symmetry** — identical bots must win ≈50/50. Skew = board/spawn bias bug.
- **Skill gradient** — Random < Greedy < Skilled with clear separation (Skilled beats Random
  >85%, beats Greedy >65%). Proves decisions matter.
- **No dominant strategy** — round-robin the personalities; every strategy that beats the
  field must have a counter with >60% against it. Uncounterable = balance bug.
- **Mechanic ablation** — ban one building/power for one bot; if win rates don't move, the
  mechanic is decoration: cut or redesign.
- **Convergence** — passive-vs-passive must still end (someone completes the Pattern) inside
  the match-length ceiling. No two policies may draw forever.
- **Match length** — median 15–30 min across the matchup table.
- **Expansion pays** — a bot that claims map must beat an otherwise-identical bot that does
  not, decisively. If turtling is competitive, the anti-stall model is broken at the root.

## Anti-patterns

- Unit micro or continuous input on mobile. (Walls are built by *dragging a line*, not by
  tapping each stone; economy is a drip from structures in range, never haulers.)
- A "correct" first building. (Ablate; tune.)
- Hidden information the AI secretly uses.
- Stalemates: any two policies that can draw forever.
- Snowball without brakes: bounties small; defender's towers are cost-efficient.
- UI that hides the road: the battle is the spectacle — HUD stays out of the middle.
