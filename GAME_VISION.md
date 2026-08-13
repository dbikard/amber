# Amber — The Succession · Game Vision

## The Concept

**A competitive, real-time, open-world city-builder for the phone**, inspired by Roger
Zelazny's *The Chronicles of Amber*. Single-player against AI rival heirs; two to four over
LAN (serverless WebRTC, QR pairing).

Oberon is gone. Rival heirs raise their cities in Shadow — a land made new each match — draw
**Essence** from the springs their Shadow Gates stand on, raise troops that march and fight
on their own, and race to either **overrun a rival's Seat of Power** or be first to
**walk the Pattern** and claim the throne. Meanwhile Chaos festers in the country between:
**rifts** tear open at the springs and the high places and spew fiends at everyone, so the
best ground always has a price — and turtling loses to whoever goes out and pays it.

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

> **The open world has landed.** The site graph this document once described is gone: free
> movement over real terrain, free placement inside the writ, springs worth fighting for, and
> walls have all shipped, stage by stage. **`OPEN_WORLD_PLAN.md`** is the plan they shipped
> from, and now reads as the record of why each was done the way it was.
>
> **Walls have shipped, and not as pieces.** The Curtain Wall is one work with a length: two
> taps lay a run of stone that bars the ground to every heir but its owner and stops shots
> crossing it — except from the men standing ON it, who throw further than anyone on the
> ground and are shot at in return. A wall alone kills nobody. See `OPEN_WORLD_PLAN.md` §6.

## The Board — a world made new each match

A continuous land (`CONST.MAP`, 2000×2400) you drag on both axes — no lanes, no template, no
mirror. Elevation and moisture are noise and seven terrains are read off them — water, marsh,
plain, meadow, forest, hill, crag. Water and crag refuse everyone; the rest is passable at
rising cost, climbing is charged on top, and the handful of corridors any given match has are
wherever the mountains and the water happened to leave them. Units march the land freely;
fights happen where armies meet.

- **Fairness is chosen, not mirrored.** A point-mirrored map tells you exactly where your
  rival stands, and a hidden Seat cannot survive that. Hundreds of candidate Seat pairs are
  scored on what each side actually has in reach — springs, buildable ground — and the least
  skewed pair wins. The rival's Seat stays hidden until somebody lays eyes on it.
- **Sites**: **springs of Shadow** (a Shadow Gate stands on one, and only there — the income,
  and the reason to fight) and **high places** (named hilltops). Chaos rifts tear open at
  both: the ground worth holding is the ground that costs something to hold.
- **The writ**: your Seat's country plus every Shadow Gate's. Works are placed freely inside
  it; a Gate may be raised beyond it only on a free spring your troops are standing on —
  which is the only way a claim grows.
- **Fog of war**: you see around your Seat, works and men. Explored ground is remembered
  (dimmed, last-known state); a rival's work is seen while any part of it is in sight and
  survives as a ghost after; enemy armies move unseen otherwise.
- **The standards**: the royal War Banner and one pennant per company — plant one on any
  point of the world and its men march there. Defend home, seize a spring, assault their
  gate — one tap, zero micro.
- **Walls**: the Curtain Wall is a run of stone with a length — two taps, priced by the foot,
  barred to everyone but its owner, manned by shooters (see `OPEN_WORLD_PLAN.md` §6).
- Essence always has somewhere to go: works, upgrades, walls, the walk — and whoever holds
  the springs out-scales the other. Map control breaks stalemates by design.

## Buildings (choose, then place)

| Building | Lore | Role |
|---|---|---|
| **Shadow Gate** | a stabilized path into Shadow | +Essence/sec (economy) |
| **Barracks** | shadow-drawn soldiery | spawns Soldiers (melee) on a timer |
| **Sorcery Spire** | Fiona's arts | spawns Sorcerers (ranged) on a timer |
| **Siege Works** | the timber yard | spawns Engines — made for stone, useless against men |
| **Curtain Wall** | a run of stone with a length | bars the ground; shooters man its parapet |
| **Watchtower** | Julian's vigil | shoots whatever comes in reach; **shelters ten shooters inside**, untouchable until the tower falls |
| **Pattern Shrine** | a reflection of the Pattern (one only) | channel Essence → Pattern progress; 100% = throne |

Works upgrade to level 3 — except the Shrine, which does not upgrade at all: there is one
Pattern and one way to walk it. The Castle (Seat of Power) is pre-placed with HP.

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

## The Long War — a country of cities

**A fourth mode, and a war you can put down.** Where the campaign is a story in chapters and a
skirmish is one board, the Long War is a COUNTRY: a graph of a dozen or two regions, each of
them a board of the size the game has always used, with a city in every one.

- **A region IS today's board.** The country is large because there are many regions, never
  because a grid got bigger — measured: a flow field is a Dijkstra over every cell and dead
  linear in area (6.3ms today, 59ms at 3×, 4.8MB at 10×), and the ground texture self-caps, so
  a board three times as wide is simply three times blurrier. Same `CONST.MAP`, same nav, same
  fog, same everything.
- **The map, and the marches.** Every region is a tile: its ground, whose city stands in it,
  where you are, and which borders are roads. A border is either a narrow crossing or no way
  through at all — a shore, a wall of crag. Committing a column to a border costs real time,
  which is what makes it a decision.
- **Biomes.** The Downs, the Fens, the Deep Wood, the High Country, the Spine, the Long Shore —
  three terrain thresholds each and nothing else, so a biome cannot make a board the rest of the
  game has never seen.
- **A Seat YIELDS rather than falling.** At nought its gates open and it belongs to nobody until
  somebody stands in the court, uncontested, and takes it — the same verb a spring is taken with.
  So breaking a place and holding it are different problems: a bombard train does the first from
  beyond anyone's reach, and only a surviving army does the second. It comes back hurt. Or you
  throw it down for good, and nobody ever has it.
- **Lords are the brake.** One city by right and one more for every lord — past that a court
  simply will not swear to you. A lord is WON: taking a city from an HEIR brings his over, taking
  one from a minor holding wins ground and nothing else. A war cannot be won by eating the weak.
- **Losing your last city is dispossession, not death.** You keep your army and may take one
  back, because a war played over many evenings has to survive a bad one.
- **ONE PATTERN, IN ONE CITY.** There is one Shrine site in the whole country and everyone knows
  where. Holding AMBER is not winning — it is being *allowed to walk*. The map has a centre
  nobody declared and the endgame is a convergence rather than fifteen sieges.
- **TERMS.** Heirs may treat with each other: a pact is two standing offers, sealed while both
  stand and broken the instant either is withdrawn, with no notice and no grace. Being surprised
  is the price of having trusted somebody. Each heir has a doctrine — the Warden keeps his word,
  the Flame takes terms and betrays them, the Master of Arms makes terms against whoever is
  ahead — and above all of them one rule none may break: nobody keeps terms with a man on the
  lines.
- **Put it down, pick it up.** A region compacts to about 730 bytes, so a whole country lives in
  `localStorage`. Out of a region is back to the *country*, not to the title screen.
- **A LAN table may fight over one.** The country is never sent: it is generated from its seed on
  every machine, exactly as a board is.

The plan, its measurements and what is still open are in `REALM_PLAN.md`.

## Multiplayer (LAN, serverless)

- Pairing layer **ported from Perils**: WebRTC DataChannel, QR-code signaling (host offer QR →
  guest reply QR → host scans back), compressed SDP, wake-lock, on-screen diagnostics.
  No server ever — GitHub Pages static hosting.
- Netcode model: **host-authoritative state sync** (not Perils' lockstep — competitive play
  needs fog of war and must not depend on cross-browser determinism). Guests send commands;
  the host simulates and streams each player a fog-filtered snapshot ~10 Hz.
- A star, two to four heirs: the host holds one peer per guest, each paired by the same QR
  dance, and hands out seed, player count and seat at start. Host = seat 0; a guest may hold
  any other. You always see yourself in gold.

## Fog of War

The rival's realm is **veiled in Shadow**: a work of theirs exists for you only while seen,
and is remembered as a ghost after — their Seat itself is hidden until somebody lays eyes on
it. Units and storms are seen or absent; castle HP is public. Starting a Pattern walk
**reveals the shrine and its progress** — power like that resonates through Shadow.

**A REALM SEES WITH ONE PAIR OF EYES.** In the Reach War a conquest takes an oath rather than a
deed: the beaten lord keeps his city, his purse, his halls and his men and flies your banner, and
the one thing sworn lords genuinely SHARE is the map. A liege who could not see what his own
marches can see would have to ride to every border himself to find out what is happening, which
is the opposite of the point of swearing a lord. Everything else stays the city's — his treasury
pays for his own halls, his crews raise his own stone, his companies answer his own reach — so a
realm is a chain of command and not a merger. A truce shares nothing at all: two heirs at terms
still see nothing of each other's country, because peace is not alliance.

## Art Direction

**Painterly Amber fantasy**, rendered procedurally: the golden city glow against the void,
cold crimson rival skyline, black-green Chaos boiling out of the rifts. The ground is baked
painterly at boot (`js/terrain.js`) and draped over a real 3D land; buildings and units are
procedural low-poly models under a pitched camera (`js/render3d.js`, Three.js) — a solo-dev
sustainable pipeline, richer than Perils' neon vectors. The renderer stays isolated.

## Match Targets

**Most matches under 20 minutes, none past 30.** Free placement, the claim race and walls are
an attention budget a very short match cannot spend — but an heir now opens with a Gate already
drawing on his one spring, so the early economy no longer has to be found before it can be
spent. A long game between two heirs who both know what they are doing is a good game, so the
ceiling is a tail rather than a wall; what is not allowed is a match that cannot END, which is
a broken rule wearing a long clock as a disguise. Convergence is guaranteed by the Pattern walk
(an uncontested player always wins eventually) and driven by the essence race, not by a PvE
timer.

## Later (post-MVP)

More heirs and Trumps (hero variety), Rebma/Tir-na Nog'th expansion sites, Jewel weather
control mini-game, audio.
