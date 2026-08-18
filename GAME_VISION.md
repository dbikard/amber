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
   conditions. Chaos is the *price of the best ground*, not a doomsday timer. The Pattern is
   the absolute clock: if nobody attacks, someone walks and wins, so no match can draw.
4. **The walk is a declaration you must keep making.** Starting the Pattern walk is
   *revealed to the rival* — the ultimate greed play. It forces the defender to attack, and
   attacking has to be worth it: the lines **fade** whenever nobody is channelling, and
   throwing the Shrine down tears the walker off the Pattern and costs them ground they had
   already paid for. A walk is a thing you hold under fire, never a balance you bank.
5. **The AI heirs are the content.** Each rival sibling is a distinct strategy personality;
   the single-player campaign is the succession ladder through the family.

> **The open world has landed.** The site graph this document once described is gone: free
> movement over real terrain, free placement inside the writ, springs worth fighting for, and
> walls have all shipped, stage by stage. `OPEN_WORLD_PLAN.md` is the RECORD of that plan and
> of why each stage was done the way it was.
>
> **Walls have shipped, and not as pieces.** The Curtain Wall is one work with a length: two
> taps lay a run of stone that bars the ground to every heir but its owner and stops shots
> crossing it — except from the men standing ON it, who throw further than anyone on the
> ground and are shot at in return. A wall alone kills nobody. See CLAUDE.md, the wall note.

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
- **The standards**: one pennant per company — plant one on any point of the world and its
  men march there; say it twice and it is meant literally (a forced march). Defend home, seize
  a spring, assault their gate — one tap, zero micro. The Recall strikes every standard.
- **Walls**: the Curtain Wall is a run of stone with a length — two taps, priced by the foot,
  barred to everyone but its owner, manned by shooters (see CLAUDE.md, the wall note).
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

The campaign is seven CHAPTERS (`js/campaign.js`), each with its own board, briefing and
objective, facing Julian, Bleys, Benedict, Brand, Bleys, Bleys and Benedict in turn; progress
is in localStorage. In skirmish, any heir — including a shadow-Corwin — can be the rival.
AI plays fair: same information rules AND the same economy as a human (no map hacks, no
resource cheats, no resource handicaps either); a footing is a quality of mind, not a purse
(DESIGN_PRINCIPLES §6).

## The Reach War — a country of cities

**A fourth mode, and a war you can put down.** Where the campaign is a story in chapters and a
skirmish is one board, the Reach War is a COUNTRY: one continuous land four times a board's
width, sixteen cities on it, rivers, roads and bridges, and the Pattern in one city at the
centre. Every city owns a **reach** — the disc its companies may be ordered inside — and to
strike a city two hops away you must first hold the one between: the affordability rule *is*
the strategic rule. Orders are bounded; violence is not.

- **A Seat yields rather than falling**, and the ground must be taken by standing in the court.
  A conquest takes an **oath**, not a deed: the beaten lord keeps his purse, halls and men and
  runs his own city under your banner, and you give him one of five standing orders — hold,
  gates, walls, attack, support — or take his court under your own hand.
- **Terms.** Banners may treat with each other; a pact is two standing offers, broken the
  instant either is withdrawn. Nobody keeps terms with a man on the lines.
- **One Pattern, in one city.** Holding AMBER is not winning — it is being *allowed to walk*,
  and the walk is slower on a country so it can be answered.
- **Two sides, two to four heirs.** You against three heirs by default — each contending for
  AMBER and the walk — or an ally at your side against two, or two against two: the setup
  screen offers every shape, and at a LAN table humans replace the heirs, each placed on a side.
  A side is one banner and one victory. The other lords run the same doctrines with more
  lapses, and expand rather than conquer.
- **Put it down, pick it up.** The country regenerates from its seed; the save writes down only
  what was done. A LAN table is dealt into the host's war; guests regenerate the ground.

The rules, the measurements and what is still open are in `CLAUDE.md` ("The Reach War") and
`TODO.md`. `REALM_PLAN.md` is the record of the mode's first life as a graph of boards.

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
Every court has a LIVERY — a pattern in a second colour, worn on one cloth part of its men and
flown large on its Seat's tower — so the banner tint says whose side and the cloth says which
court, and a tap on another lord's men says it in words (`CONST.LIVERY`, by seat).

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
