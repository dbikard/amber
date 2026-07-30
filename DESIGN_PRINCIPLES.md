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

### 4. Shared threat escalates
Chaos pressure ramps so that matches converge (~6–12 min target). Threat slightly outpaces a
passive player's power curve — you must *build well*, not just build.

### 5. Readable chaos
Color language is law: **gold = you**, **crimson = rival**, **sickly green = Chaos**,
**blue-white = the Pattern/Order**. Telegraphs before damage (storm gathers before it strikes,
rifts tear before they spawn).

### 6. AI plays fair
Same fog, same prices, same cooldowns as a human. Difficulty = better policy + faster
reactions + less noise, never map hacks or discounts.

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
- **Convergence** — passive-vs-passive must still end (Chaos kills someone) well under 20 min.
- **Match length** — median 6–12 min across the matchup table.

## Anti-patterns

- Unit micro or continuous input on mobile.
- A "correct" first building. (Ablate; tune.)
- Hidden information the AI secretly uses.
- Stalemates: any two policies that can draw forever.
- Snowball without brakes: bounties small; defender's towers are cost-efficient.
- UI that hides the road: the battle is the spectacle — HUD stays out of the middle.
