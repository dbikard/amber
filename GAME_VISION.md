# Amber — The Succession · Game Vision

## The Concept

**A competitive, real-time, lane-based city-builder for the phone**, inspired by Roger
Zelazny's *The Chronicles of Amber*. Single-player against AI rival heirs; 1v1 over LAN
(serverless WebRTC, QR pairing), later up to 4.

Oberon is gone. Two heirs raise rival cities in Shadow, contesting the **black road** — the
corrupt path the Courts of Chaos carved toward Amber. Each player **builds their city** at one
end of the road, draws **Essence** by walking in Shadow, raises troops that march and fight
on their own, and races to either **overrun the rival's Seat of Power** or be first to
**walk the Pattern** and claim the throne. Meanwhile the road itself festers: **Chaos rifts**
open along it and spew fiends at both sides, escalating until someone wins — turtling is death.

## Core Pillars

1. **Minimal input, maximal spectacle** (from Perils). Units fight themselves. You build,
   upgrade, and tap two royal powers. All depth is in *what you build and when*.
2. **Two doors to the throne.** Military (break their castle) vs. transcendence (walk the
   Pattern). Every build order leans toward one and hedges the other.
3. **The economy is the clock.** Turtling loses because the rival claims more essence than you
   can and buys an army you cannot answer — map control is the pressure behind both win
   conditions. Chaos is the *price of the best ground*, not a doomsday timer (see
   `OPEN_WORLD_PLAN.md` §2). The Pattern is the absolute clock: if nobody attacks, someone
   walks and wins, so no match can draw.
4. **The walk is a declaration you must keep making.** Starting the Pattern walk is
   *revealed to the rival* — the ultimate greed play. It forces the defender to attack, and
   attacking has to be worth it: the lines **fade** whenever nobody is channelling, and
   throwing the Shrine down tears the walker off the Pattern and costs them ground they had
   already paid for. A walk is a thing you hold under fire, never a balance you bank.
5. **The AI heirs are the content.** Each rival sibling is a distinct strategy personality;
   the single-player campaign is the succession ladder through the family.

> **Direction of travel:** the site graph below is being replaced by a continuous open world —
> free movement over real terrain, free placement inside claimed ground, essence nodes, and
> walls. See **`OPEN_WORLD_PLAN.md`**. This section describes what ships
> today; it migrates stage by stage.
>
> **Walls have shipped, and not as pieces.** The Curtain Wall is one work with a length: two
> taps lay a run of stone that bars the ground to every heir but its owner and stops shots
> crossing it — except from the men standing ON it, who throw further than anyone on the
> ground and are shot at in return. A wall alone kills nobody. See `OPEN_WORLD_PLAN.md` §6.

## The Board (v0.2 — "The Shadow March": a scrollable map of Shadow)

A portrait map ~3 screens tall you drag to explore. Cities at the ends; between them a
**web of shadow-paths** — the black road as the central spine, winding side routes through
named sites. Units march the paths; fights happen where armies meet.

```
        [RIVAL CITY]  (veiled)
         /    |    \
   (spring) (road) (spring)
       |      |      |
  (vantage)—(road)—(vantage)
       |   ⚔  |  ⚔   |
   (spring)—(road)—(spring)     ← contested middle: the eco war
       |      |      |
  (vantage)—(road)—(vantage)
       |      |      |
   (spring) (road) (spring)
         \    |    /
        [YOUR CITY]  (3×3 grid + walls)
```

- **Fog of war**: you see around your city, units, and outposts. Explored sites are
  remembered (dimmed, last-known state); enemy armies move unseen otherwise.
- **Sites**: **springs** (build a Shadow Gate → income — the reason to fight),
  **vantages** (high ground for Watchposts), **road stones** (the spine; Chaos rifts here).
- **Outposts**: claim a site by standing a unit on it, then build: Shadow Gate (eco),
  Watchpost (vision + arrows), **Rampart** (a wall across the path — enemies must break it).
- **The War Banner**: one royal banner; tap any site to plant it and your whole army
  marches there. Defend home, seize a spring, assault their gate — one tap, zero micro.
- **City walls**: a Walls building in the city grid raises a rampart ring around your
  castle — attackers chew the wall before the keep. Walls and outposts slowly self-mend.
- Essence always has somewhere to go: outposts, upgrades, walls — and whoever holds the
  springs out-scales the other. Map control breaks stalemates by design.

## Buildings (tap an empty slot)

| Building | Lore | Role |
|---|---|---|
| **Shadow Gate** | a stabilized path into Shadow | +Essence/sec (economy) |
| **Barracks** | shadow-drawn soldiery | spawns Soldiers (melee) on a timer |
| **Sorcery Spire** | Fiona's arts | spawns Sorcerers (ranged) on a timer |
| **Siege Works** | the timber yard | spawns Engines — made for stone, useless against men |
| **Curtain Wall** | a run of stone with a length | bars the ground; shooters man its parapet |
| **Watchtower** | Julian's vigil | shoots attackers near your castle; **shelters ten shooters inside**, untouchable until the tower falls |
| **Pattern Shrine** | a reflection of the Pattern (one only) | channel Essence → Pattern progress; 100% = throne |

All buildings upgrade to level 3. Castle (Seat of Power) is pre-placed with HP.

**And every hall that raises men FORKS at level 2, permanently** — a level makes the same man
better armed, a branch makes him somebody else:

| Hall | Branches |
|---|---|
| **Barracks** | Shieldwall (heavy, holds ground) · Outriders (fast, cheap) · Archers (the garrison) |
| **Sorcery Spire** | the Warden's Art (Wardens MEND — nothing else in Amber heals) · the Binding (Shadow-binders turn a beaten fiend) |
| **Siege Works** | the Ram Shed (contact, huge against stone) · the Gun Pit (Bombards out-range every tower) |
| **Watchtower** | Ballista (far, heavy, single target) · Cannon (shorter, bursts over a column) |

Two rules follow from it and shape every army: **shooters — archers and sorcerers — cannot
attack buildings at all**, so no host of them can take a Seat; and **only shooters may man a
wall or a tower**, so a curtain is a shooting platform you have to muster *for*. Melee and siege
break stone; shooters hold walls and kill men. The **Muster Roll** on the main menu lists the
whole tree with every man's numbers.

**A tower is a room, not a firing step.** Ten shooters go *inside* one, and while they are in
there nothing on the board can touch them — the tower's own hit points are all an attacker has
to spend. It is the safest and furthest-shooting place in Amber and it is also a single work
with a single bar, so a siege that concentrates on the tower gets the whole garrison at once,
and gets it standing in the middle of the assault. A tower raised *into* a curtain is part of
that curtain: order a company to hold the wall and it splits between the parapet and the
bastions on it. And since the sim can only guess which face of a run shelters — it faces your
Seat — **a wall can be turned about**, one order, no crew, no stone.

**And the Seat of Power answers for itself.** The throne carries the two Watchtower branches at
their best, added together, and it is the one gun on the board no curtain shades.

## Royal Powers (cooldown buttons — the real-time agency)

- **Jewel of Judgment** — tap a point on the road; a storm gathers and lightning ravages the
  area. The screen-clear / siege-break.
- **Trump of Benedict** — summon the family's peerless champion at your gate (one at a time).

## Units (autonomous)

Soldier (melee line), Shieldman (heavy), Outrider (fast), Archer (the garrison), Sorcerer
(ranged, fragile, longest reach on a wall), Warden (mends), Shadow-binder (turns fiends), Siege
Engine / Ram / Bombard (stone-breakers), Champion (Trump hero), Chaos Fiend (PvE, attacks
everyone, scales with time). Kills pay a small Essence bounty.

## The AI: Rival Heirs (first-class system)

One AI system, three jobs: **single-player opponent**, **headless balance harness**
(`node sim.js`), **slot-filler** for LAN later.

**You play Corwin** — the exile returned to claim the throne. The campaign ladder runs
through his siblings.

| Heir | Personality |
|---|---|
| **Julian** | turtle — towers and patience, wins late |
| **Bleys** | aggression — barracks pressure, early powers |
| **Brand** | Pattern rush — economy, then walks and dares you to stop him |
| **Benedict** | the master — adaptive, counters what you do |
| **Corwin** | (skirmish/AI) balanced aggression that walks from strength — a shadow-self to duel |

Campaign ladder: Julian → Bleys → Brand → Benedict (progress in localStorage). In skirmish,
any heir — including a shadow-Corwin — can be the rival.
AI plays fair: same information rules as a human (no map hacks, no resource cheats).

## Multiplayer (LAN, serverless)

- Pairing layer **ported from Perils**: WebRTC DataChannel, QR-code signaling (host offer QR →
  guest reply QR → host scans back), compressed SDP, wake-lock, on-screen diagnostics.
  No server ever — GitHub Pages static hosting.
- Netcode model: **host-authoritative state sync** (not Perils' lockstep — competitive play
  needs fog of war and must not depend on cross-browser determinism). Guests send commands;
  the host simulates and streams each player a fog-filtered snapshot ~10 Hz.
- Host plays **Corwin**, guest plays **Eric**. Of course.

## Fog of War (MVP form)

The rival's city is **veiled in Shadow**: you see that slots are occupied, not what they hold.
Units on the road, castle HP, and storms are public. Starting a Pattern walk **reveals the
shrine and its progress** — power like that resonates through Shadow.

## Art Direction

**Painterly Amber fantasy**, rendered procedurally: the golden city glow against the void,
cold crimson rival skyline, black-green Chaos veins in the road. Sprites are pre-painted at
boot onto offscreen canvases (layered gradients, rim light, noise speckle) — a solo-dev
sustainable pipeline, richer than Perils' neon vectors. `render.js` stays isolated.

## Match Targets

**5–20 minutes.** Free placement, the claim race and walls are an attention budget a very
short match cannot spend — but an heir now opens with a Gate already drawing on his one
spring, so the early economy no longer has to be found before it can be spent. Convergence is guaranteed by the Pattern walk (an uncontested
player always wins eventually) and driven by the essence race, not by a PvE timer.

## Later (post-MVP)

3–4 player LAN (host-as-hub star, per Perils `COOP_4P_PLAN.md`), more heirs and Trumps
(hero variety), Rebma/Tir-na Nog'th expansion sites, Jewel weather control mini-game,
audio, PWA install.
