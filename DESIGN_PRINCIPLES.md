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

A LEVEL AND A BRANCH ARE DIFFERENT AXES, and for a long time the halls only had one. A level
buys the same man better armed; a **fork** at level 2 rebuilds the hall around one soldiery and
cannot be taken back. Without it an army was decided by how much you had spent and never by what
you chose — which is a bet against the treasury, not against the other heir.

### 2a. Shooters hold walls; melee and siege break stone
The one hard division in the army, and the two rules that make it:

- **A shooter has no target among works at all** — not a reduced blow, no target. So no host of
  archers, sorcerers, wardens and binders can take a Seat however large it grows, and a shooting
  company has to be escorted by a Shieldwall, a Ram or a Bombard.
  **Except a Shrine, and pillar 3 is why** — see below. What a shooter aims at there is not the
  stone, it is the walker standing in the lines. Without the exception a walking player was
  unattackable by half of every army: measured, the Pattern took 92% of contested matches and
  matchups ran to the twenty-minute cap because nobody could reach the man.
- **Only a shooter may man stone.** A swordsman on a parapet was a man in the open with further
  to fall, holding a berth an archer needed. A curtain is a shooting platform you must muster
  *for*, and a wall defended by a soldier company kills nothing.

Both are content-free rules with large consequences, so they are the first suspects whenever the
match-length band or the by-force half of the two roads moves. And REACH IS THE EXPENSIVE THING:
a shooter who out-throws melee by 87 for three essence more is not making a trade, he is simply
better — the archer at 19 made julian the strongest heir on the ladder and simultaneously unable
to finish a match. Price a shooter against the sorcerer, never against the line.

### 3. The walk forces the fight
Pattern progress is revealed. A walking player must be attackable and a stalling player must
lose to Chaos. There is no passive path to victory.

### 4. The economy is the anti-stall
Turtling inside your starting ground loses on its own: the rival claims more essence, buys a
bigger army, and comes for you. Map control is the pressure behind both win conditions.
Chaos is *the price of the best ground* — the richest nodes sit on the corrupt road, so
expanding is exposure — not a doomsday timer. Convergence is guaranteed by the Pattern walk,
never by PvE. Target: **most matchups under 20 min, and none of them past 30**.

### 5. Readable chaos
Color language is law: **gold = you**, **crimson = rival**, **sickly green = Chaos**,
**blue-white = the Pattern/Order**. Telegraphs before damage (storm gathers before it strikes,
rifts tear before they spawn).

**And in a war, colour answers WHOSE SIDE, not which seat.** A country seats sixteen and nobody
holds sixteen colours in their head — so a lord's colour is his BANNER'S (`World.realmOf`): gold
is yours however many lords have sworn to you, each contending heir keeps one of his own for the
whole war, every lord sworn to nobody shares one dull neutral, and Chaos is still green. The rule
this enforces is that **a court that changes hands must change colour on the same tick**, on the
board and on the minimap alike: the growth of a realm is the only thing a glance at a war map is
really asking about, and for one version it was the one thing that never moved.

### 6. AI plays fair — and everyone plays the same game
Same fog, same prices, same cooldowns, **same economy** as a human — never map hacks, never a
discount the player cannot have, and never a surcharge on the heir either. The designer's
rule (2026-08-17): every seat at the table, bot or human, contender or minor lord, earns by
the same economy and lives under the same rules. **Difficulty is decision quality.** A lesser
heir is one who decides worse; an easier footing never touches his purse.

The rungs are therefore made of LAPSES (`CONST.DIFFICULTY[..].lapses`) — named flaws at the
decision points where a beginner actually goes wrong: he overlooks expansion (`gates`),
forgets to level or fork his halls (`up`), sends the army somewhere known and wrong (`aim`),
attacks in dribs instead of massing (`trickle`), marches on stone with nothing that breaks it
(`siege`), and hoards essence he could have spent (`hoard`) — plus `hold`, the hour before he
marches on your Seat, which is a promise about your opening minutes rather than a flaw. PRINCE
carries no lapses at all: it is the doctrine played straight, the same heir `node sim.js`
referees. A minor lord in a war is the footing's heir under `CONST.MINOR`'s lapses on top,
composed by the worse of the two per flaw.

The history is why the lapses have to be real behaviour and not decoration. Difficulty was
once "better policy + faster reactions + less noise"; measured, `slow` and `noise` alone left
an heir at a 42–50% mirror, because its decisions are "spend the essence on the next thing in
the plan" and the essence is still there a few seconds later. An income fraction (`eco`) was
then the one knob that bit — and it was retired on principle, since a poorer heir is not a
worse player, and it made a lord who lost his Gates unable ever to rebuild one. Two things are
held by test: an heir made with no footing plays byte-identical to before this code existed
(twelve seeded duels, both ways), and each lapse moves the thing it claims to move. The ladder
is checked the way any other number here is, with `test/headless.js` "the solo ladder"
holding the shape.

## Validation: the simulator is the referee

`node sim.js` plays headless bot-vs-bot matches (same `update()` as the browser, seeded RNG).
Every balance question is answered with data:

- **Mirror symmetry** — identical bots must win ≈50/50. Skew = board/spawn bias bug.
- **The gradient was trimmed to a tripwire, and the player's openings replaced it**
  (the designer, 2026-08-20). Four chronicles in two days beat the "hardest" heir easily while
  every gradient number read green: the gradient measures bot-vs-bot competence, and its bot
  opponents never apply what a human does. So: benedict-vs-random is GONE (it read 90-100
  always — a test that never fails carries no information, and its one great catch, the ghost
  out-scouting the heirs, is a dedicated headless suite now); greedy-vs-random is smoke tier
  (six games — "expansion pays" was foundational, answered, frozen); **benedict over greedy
  stays at full weight as THE TRIPWIRE** (target >65%) — the one automated check that judgment
  beats macro, and it fired a true positive the week it earned the name (a Jewel fallback
  leaking into the baseline read 55%: the ruler bent, not the heirs weakened).
- **The player's openings** — scripted exploits from the designer's own chronicles, one rig per
  heir, with FLOORS, not races: a standing raid party of six kept alive on the heir's forward
  Gates from minute two to minute eight, and the heir must keep most of his Gates (≤6 lost),
  keep earning (income ≥10), spend the Jewel on the raiders (unless the raid never bit), and
  still field an army (≥15). A floor a doctrine fails is the next piece of AI work BY NAME —
  the first run failed julian and benedict on exactly the chronicle's numbers — never a target
  to tune the probe around. A new exploit found in play should become a new probe.
- **The heirs are NOT balanced against each other, on purpose.** They were, and the
  round-robin that policed it cost three hundred of this runner's four hundred and seventy
  matches — spent proving something the game does not want. Five heirs tuned to 50% are five
  identical opponents in different coats. What their strengths are FOR is the order of the
  campaign ladder: you face the weakest first. So the round-robin stays, at a sixth of the
  games, and its output is `LADDER = [...]` rather than a pass or a fail. Six games a matchup
  cannot tell 45% from 55% and does not need to — it needs to tell bleys from brand.
  What a strong heir must still be is a DIFFERENT heir: if two of them win the same way, one
  of them is decoration, and that is the question to ask of the field, not the spread.
- **Mechanic ablation** — ban one building/power for one bot; if win rates don't move, the
  mechanic is decoration: cut or redesign.
- **Convergence** — passive-vs-passive must still end (someone completes the Pattern) inside
  the match-length ceiling. No two policies may draw forever.
- **Two roads to the throne, and both must be real.** A game with a second win condition
  nobody takes has one win condition and a decoration. Across SKILLED play — the baselines are
  not evidence about what a good player would choose — the Pattern must decide between 25% and
  75% of matches, and force the rest. `node sim.js` prints two lines for this, and **only the
  second is the target**:
  - `the two roads` — the share across every skilled match. This is WEATHER. It averages over a
    field of heirs that are deliberately not alike: bleys never walks, benedict hardly does,
    brand always does. Measured per heir over twelve matches each: brand walked in 12/12 and
    got 62% round on average; julian 7/12 at 38%; corwin 6/12 at 19%; bleys 0/12. So the field
    share is mostly a count of how many doctrines currently fancy the walk, and dragging it to
    25% by cheapening the Pattern would buy the number by making the walk tempting to heirs
    whose whole point is that they want something else. Read it, do not tune it.
  - `contested` — the share among matches where somebody actually got **half way round**. That
    is "two skilled players, both roads open", which is what the band was always about: past
    halfway a walk is a commitment rather than a probe he thought better of. **This** is the
    target, and the design's words for it are: *someone who sets out on the walk should get there
    about half the time.* So aim at **50%** and read 25–75 as the width of the tolerance, not as
    the goal — pinned at either edge the walk is a formality or a trap, and only the middle makes
    the choice between the roads a real one. It read 55% once (12 committed walks finished, 10
    stopped). **It reads 81% since 2026-08-19** (10 by force, 43 by the Pattern), on the
    designer's call: the strongest heir was walking broke and unfortified and losing to a human
    for it, so a walker now fortifies first and counts only four fifths of his income before
    stepping on — and a walker who does not starve is one the heirs' ANSWER rarely stops. Every
    answer we could teach was tried and measured (the answer at the walk's first tick, a smaller
    army starving the walker's Gates, the walker's army held at home — 87-97%, none inside the
    band): when the walker is the bigger army, nothing an equal one aims at stops him inside the
    old five minutes. **So the WALK IS LONGER since 2026-08-20** (shrine `rate` 0.32 → 0.16, 5.2
    → 10.4 minutes, the designer's call — "to reach 50% chance of stopping the walk"): the
    lever that measured back inside the band is the clock itself. The curve was shallow
    (0.32→92%, 0.26→88, 0.20→81, 0.16→65) because conditioning on "reached halfway" selects
    for the fortified walks; 65% is the closest length alone gets to 50, and the price is on
    the same table — the field attempts the walk in 30% of matches (was ~48) and medians run
    to 15-19 minutes. If 50% exactly is wanted, the next lever is WHERE A SHRINE MAY STAND
    (today it hides behind the throne inside the court's guns), which is a design change, not
    a number. `AMBER_WALKRATE` is the referee's override.
    Measured and rejected on the way: the walker's army held at home (97%), an earlier and
    smaller answer (`WALK_ANSWER` 5, `WALK_ARMY` 5: 81%, unchanged).
  Why the distinction was worth writing down: the field share sat at 18% and three separate
  content numbers were swept looking for it — shrine `rate` to 0.40, `drain` to 16,
  `CASTLE_HP` to 3600 — and each moved it four points or less, because the matches were not
  being lost by walkers, they were not being started by non-walkers. Walks began in 95% of
  skilled matches and stalled at 50% on average: interrupted, not outpaced.
  Note what the mirrors cannot tell you here: a heir whose doctrine never walks will never end
  its own mirror by walking, so the round-robin is the measure and a 0% mirror is not a fault.
- **Nothing but an heir may end a match.** Chaos is the weather, not the opponent. When the
  black road was uncapped it was taking Seats outright, and a "castle" win in this table was
  as often Chaos finishing someone as a rival doing it — so the runner read healthy while the
  game had quietly become about who survives the weather longest. Capping it exposed what was
  underneath, which is the real question this section now asks: can an army beat a defended
  Seat at all?
- **Match length** — the MAJORITY of the matchup table under 20 min, and a tail that may reach
  30 but not pass it. It was a flat 5–20 band; a long game between two heirs who both know what
  they are doing is a good game, and the band was calling it a failure. What has NOT been
  relaxed is the thing the band was really protecting: a matchup that runs to the CAP is a
  matchup where neither army can crack the other's Seat, and that is a broken rule wearing a
  long median as a disguise. Read the bracket, not just the median — `timeout:n` at the cap is
  a stalemate; `med 25m [castle:6]` is six matches that were decided.
  **`--quick` caps at twenty minutes**, which turns "long" and "unfinished" into the same
  number, so a run being used to judge length wants `--cap=30`.
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
