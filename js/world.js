/* world.js — the headless simulation core. No DOM, no Canvas, no Date.
 * createWorld(seed) → state; applyCommand(world, player, cmd) validates player intents;
 * update(world, dt) advances one fixed step. The browser and sim.js run the SAME code.
 * world.events is write-only here — a queue the renderer/UI drains; the sim never reads it. */
(function (global) {
  'use strict';

  const C = global.CONST || (typeof require !== 'undefined' ? require('./const.js') : null);
  const RNG = global.RNG || (typeof require !== 'undefined' ? require('./rng.js') : null);

  function emit(world, ev) {
    world.events.push(ev);
    if (world.events.length > C.EVENT_CAP) world.events.splice(0, world.events.length - C.EVENT_CAP);
  }

  function createWorld(seed) {
    const world = {
      seed: seed >>> 0,
      rng: RNG.make(seed >>> 0),
      t: 0, tick: 0,
      winner: null, winReason: null,
      players: [0, 1].map(() => ({
        essence: C.START_ESSENCE,
        castleHp: C.CASTLE_HP,
        pattern: 0, walking: false, revealed: false, alertIdx: 0,
        slots: new Array(C.SLOTS).fill(null),
        powers: { storm: 0, trump: 0 },
        championId: 0
      })),
      units: [],
      storms: [],
      events: [],
      nextId: 1,
      chaosNext: C.CHAOS.firstAt,
      chaosParity: 0,
      surged: false
    };
    return world;
  }

  /* ---------------- commands ---------------- */

  function upgradeCost(bt, level) { return C.BUILDINGS[bt].up[level - 1]; }

  function applyCommand(world, pi, cmd) {
    if (world.winner !== null) return { ok: false, err: 'over' };
    const pl = world.players[pi];
    if (!pl) return { ok: false, err: 'player' };

    if (cmd.c === 'build') {
      const def = C.BUILDINGS[cmd.bt];
      if (!def) return { ok: false, err: 'type' };
      if (cmd.slot < 0 || cmd.slot >= C.SLOTS || pl.slots[cmd.slot]) return { ok: false, err: 'slot' };
      if (def.unique && pl.slots.some((s) => s && s.bt === cmd.bt)) return { ok: false, err: 'unique' };
      if (pl.essence < def.cost) return { ok: false, err: 'essence' };
      pl.essence -= def.cost;
      pl.slots[cmd.slot] = { bt: cmd.bt, level: 1, cd: def.period ? def.period[0] * 0.5 : (def.atk || 0) };
      emit(world, { e: 'build', pi, slot: cmd.slot, bt: cmd.bt });
      return { ok: true };
    }

    if (cmd.c === 'up') {
      const s = pl.slots[cmd.slot];
      if (!s) return { ok: false, err: 'slot' };
      if (s.level >= C.MAX_LEVEL) return { ok: false, err: 'max' };
      const cost = upgradeCost(s.bt, s.level);
      if (pl.essence < cost) return { ok: false, err: 'essence' };
      pl.essence -= cost;
      s.level++;
      emit(world, { e: 'up', pi, slot: cmd.slot, level: s.level });
      return { ok: true };
    }

    if (cmd.c === 'walk') {
      if (!pl.slots.some((s) => s && s.bt === 'shrine')) return { ok: false, err: 'shrine' };
      pl.walking = !!cmd.on;
      if (pl.walking && !pl.revealed) {
        pl.revealed = true;   // power like that resonates through Shadow
        emit(world, { e: 'walk', pi });
      }
      return { ok: true };
    }

    if (cmd.c === 'power') {
      const def = C.POWERS[cmd.k];
      if (!def) return { ok: false, err: 'power' };
      if (pl.powers[cmd.k] > 0) return { ok: false, err: 'cd' };
      if (cmd.k === 'storm') {
        const p = Math.max(60, Math.min(C.LANE - 60, +cmd.p || 0));
        world.storms.push({ owner: pi, p, delay: def.delay, tLeft: def.dur });
        pl.powers.storm = def.cd;
        emit(world, { e: 'storm', pi, p });
        return { ok: true };
      }
      if (cmd.k === 'trump') {
        const champ = world.units.find((u) => u.id === pl.championId);
        if (champ) return { ok: false, err: 'alive' };
        pl.championId = spawnUnit(world, pi, 'champion');
        pl.powers.trump = def.cd;
        emit(world, { e: 'trump', pi });
        return { ok: true };
      }
    }
    return { ok: false, err: 'cmd' };
  }

  /* ---------------- units ---------------- */

  function spawnUnit(world, owner, kind, atP, tgt) {
    if (world.units.length > 220) return 0;   // perf/readability safety cap
    const def = C.UNITS[kind];
    const scale = owner === 2 ? C.CHAOS.hpScale(world.t) : 1;
    const u = {
      id: world.nextId++, owner, kind,
      p: atP != null ? atP : (owner === 0 ? 24 : C.LANE - 24),
      x: world.rng.range(-52, 52),
      hp: def.hp * scale, maxHp: def.hp * scale,
      dmg: def.dmg * (owner === 2 ? C.CHAOS.dmgScale(world.t) : 1),
      cd: 0,
      tgt: tgt != null ? tgt : (owner === 0 ? 1 : 0)   // which castle it marches on
    };
    world.units.push(u);
    return u.id;
  }

  function hostile(a, b) { return a.owner !== b.owner; }

  function nearestHostile(world, u, radius) {
    let best = null, bestD = radius;
    for (let i = 0; i < world.units.length; i++) {
      const v = world.units[i];
      if (v.hp <= 0 || !hostile(u, v)) continue;
      const dp = v.p - u.p, dx = v.x - u.x;
      const d = Math.sqrt(dp * dp + dx * dx);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  function hurt(world, victim, dmg, byOwner) {
    victim.hp -= dmg;
    if (victim.hp <= 0 && !victim.dead) {
      victim.dead = true;
      if (byOwner === 0 || byOwner === 1) world.players[byOwner].essence += C.UNITS[victim.kind].bounty;
      emit(world, { e: 'die', p: victim.p, x: victim.x, kind: victim.kind, owner: victim.owner });
    }
  }

  /* ---------------- update ---------------- */

  function update(world, dt) {
    if (world.winner !== null) return;
    world.t += dt; world.tick++;
    const t = world.t;

    /* income + power cooldowns + buildings */
    for (let pi = 0; pi < 2; pi++) {
      const pl = world.players[pi];
      let income = C.BASE_INCOME;
      for (let s = 0; s < C.SLOTS; s++) {
        const b = pl.slots[s];
        if (!b) continue;
        const def = C.BUILDINGS[b.bt];
        if (b.bt === 'gate') income += def.income[b.level - 1];
        else if (def.spawns) {
          b.cd -= dt;
          if (b.cd <= 0) { spawnUnit(world, pi, def.spawns); b.cd += def.period[b.level - 1]; }
        } else if (b.bt === 'tower') {
          b.cd -= dt;
          if (b.cd <= 0) {
            const range = def.range[b.level - 1];
            let best = null, bestD = Infinity;
            for (let i = 0; i < world.units.length; i++) {
              const u = world.units[i];
              if (u.hp <= 0 || u.owner === pi) continue;
              const fromCastle = pi === 0 ? u.p : C.LANE - u.p;
              if (fromCastle <= range && fromCastle < bestD) { bestD = fromCastle; best = u; }
            }
            if (best) {
              hurt(world, best, def.dmg[b.level - 1], pi);
              emit(world, { e: 'shot', pi, slot: s, to: { p: best.p, x: best.x } });
              b.cd = def.atk;
            } else b.cd = 0.15;   // re-scan soon
          }
        }
      }
      pl.essence += income * dt;
      if (pl.powers.storm > 0) pl.powers.storm -= dt;
      if (pl.powers.trump > 0) pl.powers.trump -= dt;

      /* the Pattern walk */
      if (pl.walking) {
        const shrine = pl.slots.find((s) => s && s.bt === 'shrine');
        if (!shrine) pl.walking = false;
        else {
          const def = C.BUILDINGS.shrine;
          const drain = def.drain[shrine.level - 1] * dt;
          if (pl.essence >= drain) {
            pl.essence -= drain;
            pl.pattern += def.rate[shrine.level - 1] * dt;
            const alerts = C.PATTERN_ALERTS;
            while (pl.alertIdx < alerts.length && pl.pattern >= alerts[pl.alertIdx].at) {
              emit(world, { e: 'pattern', pi, idx: pl.alertIdx });
              pl.alertIdx++;
            }
            if (pl.pattern >= 100) { win(world, pi, 'pattern'); return; }
          }
        }
      }
    }

    /* chaos director */
    if (t >= world.chaosNext) {
      const p = world.rng.range(C.CHAOS.span[0], C.CHAOS.span[1]);
      const n = C.CHAOS.count(t);
      emit(world, { e: 'rift', p });
      for (let i = 0; i < n; i++) {
        spawnUnit(world, 2, 'fiend', p + world.rng.range(-24, 24), world.chaosParity++ % 2);
      }
      world.chaosNext = t + C.CHAOS.interval(t);
    }
    if (!world.surged && t > 600) { world.surged = true; emit(world, { e: 'surge' }); }

    /* storms */
    for (let i = world.storms.length - 1; i >= 0; i--) {
      const s = world.storms[i];
      if (s.delay > 0) { s.delay -= dt; continue; }
      s.tLeft -= dt;
      const def = C.POWERS.storm;
      for (let j = 0; j < world.units.length; j++) {
        const u = world.units[j];
        if (u.hp <= 0 || u.owner === s.owner) continue;
        const dp = u.p - s.p;
        if (Math.abs(dp) < def.radius && Math.sqrt(dp * dp + u.x * u.x) < def.radius)
          hurt(world, u, def.dps * dt, s.owner);
      }
      if (s.tLeft <= 0) world.storms.splice(i, 1);
    }

    /* units: acquire → fight or march.
     * Alternate iteration direction per tick: damage is immediate, so a fixed order gives
     * earlier-indexed units (player 0 spawns first) a systematic first-strike advantage —
     * a real seat bias that would favor the MP host. */
    const n = world.units.length, fwd = world.tick % 2 === 0;
    for (let ii = 0; ii < n; ii++) {
      const u = world.units[fwd ? ii : n - 1 - ii];
      if (u.hp <= 0) continue;
      const def = C.UNITS[u.kind];
      u.cd -= dt;
      const foe = nearestHostile(world, u, def.aggro);
      if (foe) {
        const dp = foe.p - u.p, dx = foe.x - u.x;
        const d = Math.sqrt(dp * dp + dx * dx);
        if (d <= def.range + C.UNITS[foe.kind].size) {
          if (u.cd <= 0) {
            hurt(world, foe, u.dmg, u.owner);
            u.cd = def.atk;
            if (def.range > 40) emit(world, { e: 'bolt', from: { p: u.p, x: u.x, owner: u.owner }, to: { p: foe.p, x: foe.x } });
          }
        } else {
          const mv = def.speed * dt / (d || 1);
          u.p += dp * mv; u.x += dx * mv;
        }
      } else {
        /* march on the target castle */
        const goal = u.tgt === 1 ? C.LANE : 0;
        const dist = Math.abs(goal - u.p);
        if (dist <= C.CASTLE_ZONE) {
          if (u.cd <= 0) {
            const target = world.players[u.tgt];
            target.castleHp -= u.dmg;
            u.cd = def.atk;
            emit(world, { e: 'siege', pi: u.tgt, p: u.p, x: u.x });
            if (target.castleHp <= 0) {
              /* a player breaching wins; Chaos breaching hands the throne to the survivor */
              win(world, u.owner === 2 ? 1 - u.tgt : u.owner, 'castle');
              return;
            }
          }
        } else {
          u.p += Math.sign(goal - u.p) * def.speed * dt;
          u.x += world.rng.range(-6, 6) * dt;               // slight painterly wander
          u.x = Math.max(-56, Math.min(56, u.x));
        }
      }
    }

    /* bury the dead */
    for (let i = world.units.length - 1; i >= 0; i--) {
      if (world.units[i].hp <= 0) {
        const u = world.units[i];
        if (u.kind === 'champion') { const pl = world.players[u.owner]; if (pl && pl.championId === u.id) pl.championId = 0; }
        world.units.splice(i, 1);
      }
    }
  }

  function win(world, winner, reason) {
    world.winner = winner;
    world.winReason = reason;
    emit(world, { e: 'win', winner, reason });
  }

  global.World = { createWorld, applyCommand, update, upgradeCost };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.World;
})(typeof window !== 'undefined' ? window : globalThis);
