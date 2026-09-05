/* net.js — Amber's words on the LAN table: HOST-AUTHORITATIVE state sync (NOT Perils'
 * lockstep — competitive play needs fog of war and must not trust cross-browser determinism).
 *
 * THE TABLE IS THE LIBRARY'S; THE WORDS ON IT ARE AMBER'S. Pairing — the link codes, the QR
 * carrier, the wake lock, the diagnostics, the star of up to three guests — is
 * `js/vendor/lanlink.js`, shared with Perils and whatever comes next, and `Net` IS that table
 * (`LanLink.create`), so every field a rig sets (`isHost`, `peers`, `send`...) is the table's
 * own. What this file adds is the protocol: which messages exist (`handle`), and what a guest
 * is allowed to see (`Net.snapFor`).
 *
 * In play: the guest sends commands; the host simulates everything and streams each seat a
 * fog-filtered snapshot ~10 Hz (Net.snapFor). Host = seat 0; a guest may hold any other. */
(function (global) {
  'use strict';

  const Net = global.LanLink.create({ maxPeers: global.CONST.MAX_PLAYERS - 1 });
  Net.onStart = null;   // guest: the host has dealt the table (seed, seats, your seat)
  Net.onCmd = null;    // host: guest command arrived
  Net.onSnap = null;   // guest: snapshot arrived
  /* THE REMATCH IS A LOBBY AFFAIR, and the lobby is still host-authoritative. A guest calls
   * for another ({t:'again'}, which carries nothing — the seat it arrived on is the whole
   * message) and the host answers with the ordinary start message, the same one the lobby
   * sends. It cannot answer with a world, because only the host holds one. {t:'nomore'} is
   * the refusal: the table cannot be dealt again, which only the host can know. */
  Net.onAgain = null;  // host: a guest has called for another match
  Net.onNoMore = null; // guest: the host cannot deal one
  /* A CHANNEL CLOSING SAYS NOTHING ABOUT WHY. An heir walking out and a phone going into a
   * tunnel arrive as the same `onclose` — and where there is no close at all (a killed app,
   * a flat battery) they arrive as nothing whatever. So leaving says so on the way out:
   * {t:'bye'} is the word, sent to every peer before the link is torn down, and it is the
   * only difference between "the table is ended" and "the link is lost". */
  Net.onBye = null;    // the seat named in it has left the table deliberately
  /* THE RECORD IS THE HOST'S, BECAUSE ONLY THE HOST HAS ONE. A guest samples its own
   * fog-filtered snapshots, where a rival's essence never crosses the wire and a rival's
   * works and men are only the ones it can see — so its end screen drew a different match
   * from the host's, which is what "the stats are completely different" means. The match is
   * OVER by then and there is nothing left to hide, so the host sends the true table and
   * every seat reads the same match. {t:'chron'} carries it. */
  Net.onChron = null;  // guest: the host's true record of the match just played

  function handle(m, from) {
    /* `as` is the LORD the guest wants this order carried out by — himself, or one sworn to
     * him. The SEAT it arrived on is still the only thing that identifies the sender, and the
     * host vets the pair; `as` is a request, never an identity. */
    if (m.t === 'cmd') { if (Net.onCmd) Net.onCmd(m.c, from, m.as); }
    else if (m.t === 'snap') { if (Net.onSnap) Net.onSnap(m.s); }
    else if (m.t === 'start') { if (Net.onStart) Net.onStart(m); }
    else if (m.t === 'again') { if (Net.onAgain) Net.onAgain(from); }
    else if (m.t === 'nomore') { if (Net.onNoMore) Net.onNoMore(); }
    /* `from` is the seat it arrived on, which is the only unforgeable thing about it — a
     * guest saying goodbye names itself and cannot name anybody else */
    else if (m.t === 'bye') { if (Net.onBye) Net.onBye(from); }
    else if (m.t === 'chron') { if (Net.onChron) Net.onChron(m.rows); }
  }

  Net.onMessage = handle;

  /* ---------------- fog-filtered snapshots (host → each viewer) ----------------
   * TRUE fog of war. Units/storms only where the viewer has vision; enemy essence, powers
   * and banner never sent. Works follow the open-world rule: your own always, a rival's
   * only while you can SEE it — otherwise the ghost you last saw, at the place it stood.
   * A started Pattern walk reveals that shrine + progress. */
  /* `watching`: this seat has LOST and spectates (game.js `spectatorTick`) — the positional
   * fog is lifted for him and the snapshot says so (`allSeen`), so his screen draws no veil.
   * The private fields (a rival's essence, branch, income) stay behind the ownership checks
   * below, which never consult the fog: watching is not auditing. */
  Net.snapFor = function (world, viewer, events, watching) {
    const World = global.World, C = global.CONST;
    const see = watching ? () => true : (x, y) => World.canSee(world, viewer, x, y);
    const players = world.players.map((pl, pi) => {
      /* "MINE" IS THE BANNER'S, NOT THE SEAT'S. A guest plays a realm: the lords sworn to him
       * are his to command, so their purses, their branches, their companies and their halls
       * are his to read exactly as his own are. It is the chain of command, not a truce — a
       * pact partner's books stay shut, which is what `pactOn` above is for. On a board every
       * realm is one seat and this is `pi === viewer` to the byte. */
      const mine = World.realmOf(world, pi) === World.realmOf(world, viewer);
      return {
        /* WHOSE BANNER. Public, and it must be: a guest that could not tell an ally's column
         * from an enemy's would draw the wrong war, and `World.foe` is computed on both ends
         * off exactly these fields. */
        realm: pl.realm != null ? pl.realm : pi,
        /* HIS SEAT'S HIT POINTS. A city is a thing with an owner now (`world.cities`), so this
         * is derived rather than stored — the seat he rules from. Castle HP has always been
         * public; the whole list rides on the root as `cities` beside it. */
        castleHp: Math.round(((World.seatOf(world, pi) || {}).hp) || 0),
        essence: mine ? pl.essence : null,
        incomeRate: mine ? pl.incomeRate : null,
        drainRate: mine ? pl.drainRate : null,
        pattern: mine || pl.revealed ? pl.pattern : 0,
        walking: mine || pl.revealed ? pl.walking : false,
        revealed: pl.revealed,
        powers: mine ? { storm: pl.powers.storm, trump: pl.powers.trump } : null,
        banner: mine ? pl.banner : null,   // the banner is a strategic secret
        musterPaused: mine ? pl.musterPaused : false,
        /* TERMS: A SEALED PACT IS PUBLIC, AN OFFER IS NOT. You cannot play against a diplomacy
         * you cannot see — who is at peace with whom decides where every army on the board is
         * safe to stand — so a standing pact rides to everyone. An offer nobody has answered is
         * seen only by the two seats it concerns: mine, because it is mine, and the seat it was
         * made to, because that is the only way it can be answered. Sent as the OFFERS rather
         * than as the pacts so a guest computes `World.pactOn` off the same fields the host
         * does, and there is no second spelling of the rule to drift. */
        offers: world.players.map((q, j) => (((pl.offers || [])[j]) &&
          (mine || j === viewer || World.pactOn(world, pi, j))) ? 1 : 0),
        /* your own companies and where their standards stand; a rival's are a secret */
        /* the Trump's own standard is flagged, so a guest's tray can draw it as what it is */
        /* the BEARER rides with the company and is the owner's alone, like the rest of it —
         * which company a rival's men belong to has never crossed the wire, and a flag is the
         * plainest possible statement of it */
        /* a FORCED order rides with the company for its owner alone, like everything else
         * about it — the renderer draws the standard differently for one, and a guest's screen
         * has to be able to tell a march-through from an ordinary rally */
        /* Spelled with `Object.assign` and a NULL source for every field that may be absent —
         * it skips null, so this is the conditional spread `...(x ? { k } : {})` in the ES2017
         * the whole game keeps to (see index.html): an iPad on an old Safari refused the spread
         * at parse time, and a page whose scripts do not parse is a menu that does nothing. */
        companies: mine ? pl.companies.map((co) => Object.assign({ id: co.id, rally: co.rally },
                                                     co.hard ? { hard: co.hard } : null,
                                                     co.mark ? { mark: co.mark } : null,
                                                     /* the city a company is born to — the reach
                                                      * ring and every order it frames need it */
                                                     co.city != null ? { city: co.city } : null,
                                                     co.bearer ? { bearer: co.bearer } : null,
                                                     co.paused ? { paused: 1 } : null,
                                                     co.trump ? { trump: 1 } : null)) : [],
        /* A CURTAIN IS LONGER THAN ITS MIDDLE — World.workSeen is the one place that rule
         * is written, shared with the host's own screen so the two cannot drift — and the
         * row carries the far end, since a line drawn to one point is not a line. */
        buildings: pl.buildings.filter((b) => mine || World.workSeen(see, b)).map((b) => Object.assign({
          id: b.id, bt: b.bt, level: b.level, x: Math.round(b.x), y: Math.round(b.y),
          x2: b.x2 == null ? undefined : Math.round(b.x2),
          y2: b.y2 == null ? undefined : Math.round(b.y2),
          hp: Math.round(b.hp), maxHp: b.maxHp, node: b.node,
          /* an unfinished work reads as a shell to BOTH sides — it is plainly scaffolding */
          raise: b.raise > 0 ? Math.round(b.raise * 10) / 10 : 0, raiseFor: b.raiseFor || 0,
          /* the masons in the yard are as visible as the scaffolding on a new work: a hall
           * that has gone quiet must LOOK like one to a guest too */
          work: b.work > 0 ? Math.round(b.work * 10) / 10 : 0, workFor: b.workFor || 0 },
          /* a breach is public: it is a hole in the world that everyone can walk up to */
          b.breach ? { breach: 1 } : null,
          /* a tower in the wall stands ON the wall — a guest must draw it up there too */
          b.onWall ? { onWall: b.onWall } : null,
          /* a long curtain occupies several crews — the yard readout has to know — and it is
           * `units` of stone, which is what its mend costs. A short run has NO gateway, so the
           * guest must not draw one or walk its columns at one that is not there. */
          b.crews > 1 ? { crews: b.crews } : null,
          b.units != null ? { units: Math.round(b.units * 1000) / 1000 } : null,
          b.gated ? { gated: 1 } : null,
          /* WHICH FACE OF THE RUN SHELTERS. It rides for everyone, not only its owner: the men
           * standing behind a rival's curtain are on the board where they are on the board, and
           * a guest whose renderer turned that line the other way would draw a rival's parapet
           * facing its own reserve. It gives nothing away that watching the men would not. */
          b.flip ? { flip: 1 } : null,
          /* ...and WHICH face that is, which is the curtain's answer and not this run's. It is
           * chained run to run in `noteWalls` so a curving wall cannot turn its sheltered side
           * over halfway along, and the guest's renderer cannot re-derive it: it holds the runs
           * it can SEE, and the chain is a property of the whole curtain including the stone
           * beyond the veil. Same reasoning as `flip`, and it rides for the same everyone. */
          b.face ? { face: b.face } : null,
          /* the tower branch is yours to know and the rival's to guess */
          { br: mine ? (b.br || null) : null,
            co: mine ? b.co : 0 }        // which company a hall musters into is yours to know
        )),
        /* what the viewer remembers of works they can no longer see — one projection,
         * shared with the host's screen, so a field added to a ghost reaches both */
        ghosts: mine ? [] : World.ghostsFor(world, viewer, pi, see)
      };
    });
    /* sites through the viewer's fog: live truth if visible, memory if explored, else absent */
    const mem = world.players[viewer].explored;
    const sites = world.map.sites.map((s) => {
      if (see(s.x, s.y)) return { id: s.id, live: true, holder: World.nodeHolder(world, s) };
      return mem[s.id] ? { id: s.id, live: false, holder: -1 } : null;
    });
    const snap = {
      t: world.t, winner: world.winner, winReason: world.winReason,
      /* the rules of this match, so a guest's `World.foe` answers what the host's answers.
       * Without them a guest reads every heir as a foe and draws a war nobody is fighting. */
      rules: world.rules,
      /* WHICH BANNERS CONTEND. The renderer gives each one a colour of its own and everyone
       * else the neutral; without the list a guest would paint a country in one crimson. */
      heirs: world.heirs,
      /* THE SIDES AS DEALT, so a guest's end screen judges "won" by the side he was dealt and
       * not by the banner conquest left his court under (see `endMatch`). Nothing else reads it. */
      sides: world.sides,
      /* the cities of the world, and every one of them public: a Seat's hit points always
       * were, and in a country the question "whose is that" is the map. Where the court
       * STANDS is a different question, and `seatSeen` still answers it. */
      cities: world.cities.map((c) => Object.assign({ id: c.id, site: c.site, x: Math.round(c.x), y: Math.round(c.y),
                                        owner: c.owner, hp: Math.round(c.hp), maxHp: c.maxHp,
                                        level: c.level, name: c.name },
                                        /* the reach is public geometry — it is derivable from
                                         * the seed, and a guest that could not see the border
                                         * could not understand its own refusals */
                                        c.reach ? { reach: Math.round(c.reach) } : null,
                                        /* a yielded court and how far along somebody is in taking
                                         * it are public: a city changing hands is the loudest
                                         * thing that can happen on a war map, and a seat that
                                         * could not see it could not answer it */
                                        c.yield != null ? { yield: c.yield } : null,
                                        c.razed ? { razed: 1 } : null,
                                        c.hold ? { hold: { pi: c.hold.pi, since: c.hold.since } } : null)),
      players, sites,
      /* your own men always, and your sworn lords' men with them — a liege who could not see
       * a vassal's column except through his own scouts could not command one */
      units: world.units.filter((u) => (u.owner >= 0 &&
                                        World.realmOf(world, u.owner) === World.realmOf(world, viewer)) ||
                                       see(u.x, u.y))
        .map((u) => Object.assign({ id: u.id, owner: u.owner, kind: u.kind, x: Math.round(u.x), y: Math.round(u.y), hp: Math.round(u.hp), maxHp: Math.round(u.maxHp) },
                       /* which wall he is standing on, and which tower he is up in, so a guest
                        * draws him on the stone too — both change where he IS, not only what
                        * he looks like, so neither is a secret worth keeping */
                       u.man ? { man: u.man } : null,
                       /* `tow` alone — there is no `towSlot` any more: the slot only ever fed
                        * the old ring-around-the-crown geometry, and since "the rim is the
                        * door" (v0.9.11) a man inside is not drawn at all, so the field was a
                        * dead byte on every garrisoned man in every snapshot */
                       u.tow ? { tow: u.tow } : null,
                      /* through the door or still walking to it — a guest draws the walk and
                       * hides the room exactly as the host does */
                      u.in ? { in: u.in } : null,
                       /* rank changes what he LOOKS like, so it is not a secret worth keeping */
                       u.tier > 1 ? { tier: u.tier } : null,
                       /* CHAINED, and until when. A binding slows him and makes every blow on
                        * him land harder — it changes what he DOES, not only what he looks
                        * like, so a guest that did not know would draw a column marching at a
                        * speed it is not marching at. Absolute, against the snapshot's own `t`.
                        * The mend cap's `_mendT`/`_mendGot` deliberately do NOT ride: those are
                        * per-tick scratch belonging to the host's loop, not state. */
                       u.hexed > world.t ? { hexed: Math.round(u.hexed * 10) / 10 } : null,
                       /* WHICH WALL HE IS POSTED TO — the owner's alone, like his company.
                        * The renderer needs it to keep a curtain's own gateway SHUT while its
                        * garrison stands at the foot of it: the door swings for a man going
                        * through, and the company whose post this wall is held it open for the
                        * whole match. Without it on the wire a guest's gates hang open. */
                       u.owner === viewer && u.post ? { post: u.post } : null,
                       u.owner === viewer ? { co: u.co } : null)),
      /* the halt is the table's, not a seat's — every guest must see it and who called it */
      paused: world.paused ? { by: world.paused.by } : null,
      storms: world.storms.filter((s) => see(s.x, s.y))
        .map((s) => ({ owner: s.owner, x: s.x, y: s.y, delay: s.delay, tLeft: s.tLeft })),
      /* events: own always; global always; positional only where seen; rival city news never */
      events: (events || []).filter((ev) => {
        if (ev.pi === viewer) return true;
        if (ev.e === 'build' || ev.e === 'up' || ev.e === 'shot' || ev.e === 'banner' || ev.e === 'rally' || ev.e === 'muster') return false;
        /* an OFFER is between two seats; a sealed or broken PACT is the whole table's business
         * and falls through to the rule below, which lets anything without a position pass */
        if (ev.e === 'offer') return ev.p === viewer;
        if (ev.x != null) return see(ev.x, ev.y);
        return true;   // walk/pattern/surge/win/trump — power echoes through Shadow
      })
    };
    /* the seat watches: no veil, no controls — see game.js */
    if (watching) snap.allSeen = 1;
    return snap;
  };

  global.Net = Net;
  if (typeof module !== 'undefined' && module.exports) module.exports = Net;
})(typeof window !== 'undefined' ? window : globalThis);