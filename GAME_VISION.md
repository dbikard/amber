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
3. **Shared, escalating Chaos.** PvE pressure on both players is the anti-stall clock and the
   third army on the board. Matches converge in ~6–12 minutes, never drag.
4. **The walk is a declaration.** Starting the Pattern walk is *revealed to the rival* —
   the ultimate greed play. It forces the defender to attack.
5. **The AI heirs are the content.** Each rival sibling is a distinct strategy personality;
   the single-player campaign is the succession ladder through the family.

## The Board (portrait phone, one screen)

```
┌──────────────────────────┐
│  RIVAL CITY (veiled)     │  ← their slots shrouded in Shadow; castle + HP visible
│  ═══ their castle ═══    │
│                          │
│      THE BLACK ROAD      │  ← units march & fight here; Chaos rifts open here
│   (rifts, fiends, war)   │
│                          │
│  ═══ your castle ═══     │
│  YOUR CITY (3×3 slots)   │  ← tap a slot to build; tap a building to upgrade
│ [essence] [⚡powers] [⏱]  │  ← HUD
└──────────────────────────┘
```

## Buildings (tap an empty slot)

| Building | Lore | Role |
|---|---|---|
| **Shadow Gate** | a stabilized path into Shadow | +Essence/sec (economy) |
| **Barracks** | shadow-drawn soldiery | spawns Soldiers (melee) on a timer |
| **Sorcery Spire** | Fiona's arts | spawns Sorcerers (ranged) on a timer |
| **Watchtower** | Julian's vigil | shoots attackers near your castle |
| **Pattern Shrine** | a reflection of the Pattern (one only) | channel Essence → Pattern progress; 100% = throne |

All buildings upgrade to level 3. Castle (Seat of Power) is pre-placed with HP.

## Royal Powers (cooldown buttons — the real-time agency)

- **Jewel of Judgment** — tap a point on the road; a storm gathers and lightning ravages the
  area. The screen-clear / siege-break.
- **Trump of Benedict** — summon the family's peerless champion at your gate (one at a time).

## Units (autonomous)

Soldier (melee line), Sorcerer (ranged, fragile), Champion (Trump hero), Chaos Fiend (PvE,
attacks everyone, scales with time). Kills pay a small Essence bounty.

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

~6–12 minutes. Chaos escalation guarantees convergence (surges after minute 10).

## Later (post-MVP)

3–4 player LAN (host-as-hub star, per Perils `COOP_4P_PLAN.md`), more heirs and Trumps
(hero variety), Rebma/Tir-na Nog'th expansion sites, Jewel weather control mini-game,
audio, PWA install.
