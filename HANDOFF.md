# Where things stand

Written at the end of a long session, to be picked up on another machine.
Branch `claude/reach-of-war-city-control-ljcm6a`, also pushed to `main`. Last shipped
version **v0.10.26** (`509b9a4`).

---

## 1. FIRST THING TO DO

```
node test/run.js
```

**The headless suite has not been run since a one-line fix to a test rig** (`test/headless.js`,
suite `a lord who cannot afford his plans stops buying men` — the rig asked for seat 3 on a
two-seat board and crashed the file). Everything parses and the browser half was green at
562/562 before that fix. Run the suite and expect green; if it is not, that suite is where to
look first.

---

## 2. UNCOMMITTED WORK IN THE TREE

Four files are modified and **not committed**: `js/ai.js`, `js/game.js`, `test/headless.js`,
`CLAUDE.md`. Three changes, all measured, all with tests written:

### a. A hostile is somebody I may strike (`js/ai.js`, `AI.view`)
Reported: *"a lord with whom I'm at terms still unleashes the jewel storm on me."*

`visHostiles` asked `owner !== me` instead of `World.foe`. So a **pact partner's** men counted
as hostiles — an heir at terms read the player's army as a threat, came home against it, drew a
Trump and called the Jewel down on it. The damage was always refused at `hurt`'s door, so it did
nothing except spend the Jewel and put a storm over the player's men, which from his chair is an
ally attacking him. A **sworn lord's** men were `owner !== me` too, so a liege read his own
vassal's army as an enemy massing on his border.

Measured: pact sealed → 1 storm + 1 Trump on the old code, 0 and 0 on the new; no pact → 1 and 1
on both.

**Proven a no-op for the referee rather than assumed**: `RULES.truce` is 0 in a skirmish, so
`foe` is always true there. Twelve seeded duels (4 matchups × 3 seeds, 5-minute cap) play out
**identical to the essence** on both versions. No `node sim.js` run is needed for this one.

### b. A court under your own hand plays at full strength (`js/game.js`, `warPurses`)
Reported: a hand-played inner lord with a negative economy who could never afford a Gate.

The footing handicap is meant to make a **bot** weaker, and a court the player had taken command
of was keeping it. The number named the cause exactly:
`2.5 (BASE_INCOME) × 0.52 (SQUIRE) × 0.62 (MINOR) = 0.806` — the "+0.8/s" on his screen with the
muster stopped. `warPurses` now skips the hand and is re-dealt whenever the hand moves.

**This is superseded in spirit by the pending decision below** (§3). If the handicap purse goes
away entirely, this becomes a no-op — harmless, but the comment explaining it should then be
rewritten or deleted rather than left claiming a rule that no longer exists.

### c. A lord who cannot afford his plans stops buying men (`js/ai.js`, `decide`)
The muster valve (`{c:'muster'}`) was a **player-only control** — no doctrine had ever issued it
— so a lord whose halls drank everything he earned never saved the 400 for the Gate that would
have paid for them. Diagnosed by the player.

Gated to **war only** (`rules.reach`), like `warOrders`, so the tuned duel economy is untouched
and no referee run was needed. It asks for a STATE and only when that state differs; the test is
the WANT, not the wallet — it shuts only with something he means to build and cannot afford, and
opens the moment he can pay.

Measured over six simulated minutes of a country, before → after:

| footing | purse < 50 | median purse | Gates | works |
|---|---|---|---|---|
| SQUIRE | 38% → 19% | 31 → 80 | 19 → 21 | 53 → 54 |
| HEIR   | 40% → 29% | 75 → 118 | 33 → 40 | 81 → 90 |
| PRINCE | 28% → 24% | 48 → 87 | 41 → **37** | 117 → **114** |

PRINCE is a wash or slightly worse — those lords were the least starved, so the valve does least
there. Written down rather than hidden; one seed, so it may be noise.

---

## 3. THE PENDING DECISION — read this before touching anything else

The designer's call, given near the end of the session and **not yet implemented**:

> *"everyone in the game, bots and players should have the same economy and generally the same
> game rules. lower difficulty levels should just make poor decisions."*

and

> *"my take is that everyone should have the same economy but lesser AI should just make poorer
> decisions."*

This **supersedes part of what shipped earlier today**. `cb86a1d` ("The footing scales the whole
country") made the difficulty footing multiply a seat's income — a contender at the player's
`eco`, a minor lord at that times `CONST.MINOR.eco`. The new principle says the economy must not
be a difficulty lever at all.

### What that means concretely

- **Drop `eco` from `CONST.DIFFICULTY` (all three entries) and from `CONST.MINOR`.** Difficulty
  then rides on `slow` (thinks less often), `noise` (skips a think) and `hold` (delays the march)
  — decision quality, not resources.
- `players[].eco` can stay as a sim field (`js/world.js` `income *= pl.eco`), but nothing should
  deal it a value below 1. Check the two writers: `warPurses` (`js/game.js`) and `startSP`'s
  `game.world.players[1].eco = (opts && opts.eco) || 1`. Chapters may pass `opts.eco`; decide
  whether a scripted chapter is allowed to, or whether that goes too.
- Once economies are equal, §2b above is moot — see the note there.

### This one DOES need the referee

Unlike §2a, removing the income handicap changes every duel at every footing. Run the full
`node sim.js` before and after and keep the targets in `DESIGN_PRINCIPLES.md` green. The
established method this session: copy the tree to a scratch dir, restore the pre-change file
there with `git show HEAD:js/const.js > …`, run `node sim.js` in both, and diff the tallies.
A full run is roughly 20 minutes on this 4-core box, so budget ~40 for the pair.

**Expect SQUIRE and HEIR to get harder**, since they currently earn 0.52× and 0.70×. If the
gradient collapses, the honest fix is to make `slow`/`noise` do more work rather than to sneak
the economy back in. Note that `noise` today means "skip this think entirely", which is crude —
if it needs to carry more weight, consider whether a genuinely *poor decision* (pick a worse
target, build the wrong thing) is wanted instead, which is a bigger design change.

### The report that motivated it

> *"I also saw enemy lords in the same situation, all gates broken and sitting idle."*

That is a **death spiral** worth confirming as fixed once economies are equal: lose your Gates →
income falls to `BASE_INCOME × eco` → cannot afford to rebuild one → idle for the rest of the
war. At eco 1 that floor is 2.5/s, so a 400-essence Gate is ~160 seconds away, and the muster
valve in §2c gets him there. At SQUIRE's 0.806/s it was ~500 seconds with a hall still draining,
which is never. Worth an explicit measurement: take every Gate off a lord mid-war and see whether
he recovers.

---

## 4. THE REST OF THE SESSION, ALREADY SHIPPED

In order, newest last — all with tests, all green when pushed:

- `23c217a` **A spring a rival holds is still a spring to take.** `gates` looked only for
  unheld springs and returned `'home'` when it found none, which strikes every standard. An
  inner lord's reach is fully spoken for almost from the start.
- `e47d61f` **The stone near a man is binned.** `stand`/`steerClear` walked every building of
  every player, per man, per tick — 27% of the tick, sim at 40.45ms against a 33ms frame at 1111
  men. Now 20.13ms. `World.slowWorks` is the control and the suite plays the same country both
  ways, man for man.
- `81d826f` **A man engages what he can actually hit.** `acquire`'s radius lacked `def.range`;
  the Bombard (365 reach, 240 aggro) could never use its stand-off. Referee: contested Pattern
  share 58% → 55%, julian 10 → 12 wins.
- `cb86a1d` **The footing scales the whole country.** *Partly superseded — see §3.*
- `6ceb274` **Terms speak only when they are yours**, and a court on the council map opens a
  card over the panel.
- `509b9a4` **An order biases the crew, not only the column** (the `gates` order now moves the
  mason, not just the column); **a fallen court is out of the fight until it swears** (no more
  razing the spoils during the 20-second claim); **every court is named** and a contender is
  named for himself while a minor lord keeps his city's name; **a minor lord does not conquer**.

## 5. STILL OPEN IN `TODO.md`

- Delete the `lord` baseline, or give it a job — the five words are implemented twice.
- The unit `BIN` is 280, and `acquire` + its call site is ~40% of the tick. A smaller bin is
  likely most of another halving, but it reorders `forNear` and therefore `acquire`'s tie-breaks
  — a referee change, not a free one. A no-reorder alternative is noted there.
- Make a fenced flow field sparse to its bound (4.7× memory, no behaviour change).
- Resumed-war ground texture loss — reported once, never reproduced across three flows.
- The LAN reach war reported as dealing a small standard map — my two-page probe showed the deal
  correct; still waiting on the HUD title and `GAME_VERSION` from both phones.
