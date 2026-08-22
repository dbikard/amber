# Amber — The Ledger

**What this file is.** The EVIDENCE behind the rules in `CLAUDE.md`: every measurement, every
report from play, every rejected alternative and why it was rejected, and the war stories of how
a bug was found. It was split out of `CLAUDE.md` on 2026-08-17 so that the rules stay in every
session's context and the numbers do not have to. It is organised under the SAME section and
bullet headings as `CLAUDE.md`, in the same order, so a `(→ LEDGER: heading)` pointer there is
findable by search here. **Consult it before re-deciding anything a rule says was measured** —
the point of keeping it is that the evidence is not lost or softened. Add to it whenever a rule
in `CLAUDE.md` is backed by a number, a photograph or a rejected alternative.

## Development Practices

### There is ONE renderer

A second, Pixi-based renderer was kept for years as a "fallback for devices without WebGL";
Pixi has been WebGL-only since v7, so it was never a fallback and died on a black screen when it
was called on. WebGL became a stated requirement, said plainly at boot.

### THE VEIL IS SAMPLED IN THE MATERIALS

The 2D pass drew a WORLD-space field as SCREEN-space polygons and every veil defect of 2026
lived in that gap; sampling the mask in the materials means there is no projection to disagree
about. The three ways to lose the veil, each of which actually happened:
(1) a new mesh created without `fogPatch` — the writ was an unpatched `LineBasicMaterial` and
read as the writ and the sight disagreeing about where the ground was;
(2) `material.clone()` — `onBeforeCompile` is a PROTOTYPE method and an assigned one is not in
the whitelist `Material.copy()` walks, so a clone falls back to the no-op. Ghosts, scaffolding
and a toppling tower all clone, and all three escaped;
(3) a second arm of the patch without a `customProgramCacheKey` — Three keys a patched program
on `onBeforeCompile.toString()`, identical for both arms when the difference is a closed-over
variable, so every patched material shared one program.

### THE GROUND YOU STAND ON IS THE GROUND YOU SEE

For years `R.groundH` sampled the raw elevation field while the ground mesh is a
`PlaneGeometry` capped at 180 segments; measured by raycasting the real geometry, up to 8.75
units of disagreement on a board and 21.5 on a country. A board hid it because nothing stands
between the eye and the ground there. A country has the detail tiles — the same field sampled
FINER, so they rose off the base by exactly that error and were lifted 3.0 units clear to stop
it poking through, which then swallowed every spring's pool (water sits 1.5 up), every site ring
and the feet of the props. `groundH` now interpolates the drawn mesh's own lattice with its own
triangulation (Three splits each quad on the diagonal from `(ix, iz+1)` to `(ix+1, iz)` —
verified by raycast, 0.0002 error against 2.35 for the bilinear it used to do), so a tile lands
exactly ON the base. The lesson is the general one: a second code path for the big case is where
the two grounds diverged, and the fix was to make them one surface rather than to tune the gap.
Three browser tests hold it — the raycast, a tile's vertices, and a country's spring having its
pool.

### THE CAMERA CANNOT BE AIMED AT A WORLD THE RENDERER HAS NOT BEEN GIVEN

`clampCam` holds the view inside `mapW`/`mapH`, learned in `buildWorld` on the first FRAME,
after game.js has already called `homeCamera()` — so every opening aim was clamped into the
extents of the PREVIOUS world. Board to board that is invisible (same rectangle); walking into a
country it strands you, and it stranded the HOST too: measured, a court at (7670, 9030) on
8000×9600 opened looking at (1950, 2446) — the middle of a 2000×2400 board, 7,330 units from the
host's court and 8,721 from a guest's.

### A MEMORY OF THE LAND IS CUT TO THE LAND

`World.newSeenMask()` with no dimensions is a BOARD — right for a duel, and the guest's war mask
asked for exactly that. On a country the grid covered its top-left sixteenth, `markSeen` OR-ed a
country-sized live mask into it index for index across two different strides (silently dropping
the overflow off the end of a typed array), and the veil's own view window — clamped to that
grid — could not reach the ground the camera was over, so every cell in sight stayed SHROUD.
That is the black world a LAN guest at a war table was photographed looking at. Same shape as
the ground and camera notes: a second code path for the big case, silently sized for the small
one.

### WATER IS ONE BODY, AND ITS DEPTH IS ITS WIDTH

The bake painted a radial gradient PER WATER CELL onto the finished land, so the alphas
compounded where discs overlapped and a one-cell river came out as a chain of beads with a
bright core in every cell — and the pass ran AFTER the blur that softens everything else, so a
hard saturated cutout sat on a painterly landscape. Reported from play as "that river looks very
weird". Measured down a channel's centreline: the step between neighbouring cell centres was
14.9 of 255 and is 1.0.

### `node test/run.js` runs the two suites AT ONCE

The two suites contend for nothing (pure Node vs Chromium on its own ephemeral port), so the
wall clock was simply the sum of them. Two traps were found doing this and both are general.
`browser.js` skipped with "no Chromium" on a box with a perfectly good one, because Playwright
resolves a headless launch to `chromium_headless_shell-<rev>` pinned to the library's revision,
so the whole browser half reported green by reporting nothing. And both suites ended with
`process.exit(report(...))`, which was harmless while they wrote to a terminal and silently ate
the tally the moment the runner captured them — `process.exit` truncates a piped stdout.

## Orders and building

### A CITY CIRCLE IS NOT A SPECIAL CASE, AND A STANDARD GOES WHERE YOU POINT

`hitSite` judged a FLAG tap against `CITY.r + 20` and everything else against the site's own
ground — a circle 2.7× the radius, so an order planted anywhere inside a city circle silently
relocated itself to the middle of the court. Reported from play as tapping in a city circle
behaving differently. The naming it bought fed a banner that no longer exists (a rally is
silent).

### SAY IT TWICE AND IT IS MEANT LITERALLY

Measured on one world with only the bit changed: an ordinary order stalls at the enemy line
having dealt 1,071 damage and lands nobody; the forced one reaches 440 further, four of eight
arrive, and it deals 27. `acquire` is 94% of a busy tick, which is why `hardOn` counts the live
hard orders so the whole question is one integer test in every match that never gives one.

### A WORK UNDER THE FINGER ALWAYS WINS

Men were asked first once, so a company standing on a hall made that hall unopenable; then the
NEARER of the two answered, which is better and still not right — a work is a fixed point the
size of a fingertip, and men are many, they move, and they gather exactly where the works are,
so a hall with its own company mustered round it had a ring of men nearer to almost every part
of it than its own centre was. Reported from play as buildings being very hard to select.
`hitBuilding` was the one place in the renderer that asked the viewer for something belonging to
the hand, so while driving a sworn lord every tap on his works returned an id his liege did not
own and fell through to bare ground — a conquered court whose halls could not be opened at all.

### A COMPANY'S COLOURS ARE CARRIED BY A MAN

The company was the one thing missing from the work group's cache key, so `{c:'assign'}` moved
a hall and its flag went on flying the old colours until something else rebuilt the group.

### AND THE PACING IS ASKED LOCALLY

A place at the back is not enough: the column steers at the ORDER, so a 50-speed archer walked
straight through a 44-speed shieldwall and the company met the enemy shooters-first. The
obvious cure — hold every shooter behind his company's average — is wrong in a game where a
hall NEVER STOPS MUSTERING: ten recruits who left the yard a minute after the column is ten men
a thousand units back dragging that average with them, and the archers already at the front
stop dead waiting for men they will not meet. The standoff must be the formation's depth and not
a berth, or the shooters park on the ground the line still has to cross and the march ends with
the fighting men shoving through their own archers.

### AND TERMS SPEAK ONLY WHEN THEY ARE YOURS

A duel has one rival, so "somebody came to terms" could only ever be about the player. A war
seats sixteen and they treat with each other constantly: reported from play with a photograph
of the whole stack — three lines about one lord treating with three others, none of them the
player, every one shoving out something that was. A third party's terms fail the third banner
test — would he act differently for knowing? — and the council's roster already names every
banner and the terms it is under, live, for as long as it is true.

### A BANNER IS FOR A REFUSAL OR A SURPRISE, NEVER FOR AN ECHO

An order confirmed passes none of the three tests — the armed ring, the lit BUILD button, the
company chip and the essence rate each say their own thing for as long as it is true. The
Recall made the case on its own: it clears every company's rally, so a four-company realm
emitted four identical banners for one tap and the stack held nothing else.

## The fork

### A MAN ENGAGES WHAT HE CAN ACTUALLY HIT

The Bombard is sold on out-ranging every tower ever raised (365 reach against 240 aggro) and
could not use a foot of it — held in the back line by design, which parks it precisely in the
band where it can see the throne and will not fire. Measured: a bombard 260 from a rival court,
well inside its own reach, dealt ZERO in twenty seconds; the only way it ever fired on a Seat
was to walk inside the Seat gun's range and die there. Reported from play as cannons staying
idle instead of attacking the city tower. `node sim.js` before and after: mirrors and the skill
gradient unchanged, the contested Pattern share 58% → 55% (target 50), the two roads 59/38 →
61/36 by force, and julian — the one heir whose doctrine always forks to `bombard` — went 10
wins to 12.

## The campaign

### A BANNER MUST SAY WHERE

The `hurtcity` alert fired for ANY work of yours being scratched and cried "the enemy is inside
your city!" about all of them — so a Gate four hundred out, gnawed by one fiend, read exactly
like a column at the throne.

## The Reach War

### THE COUNTRY IS ONE WORLD

A flow field FENCED by the owning city's disc costs what a field costs on today's board however
large the land grows: measured, 5.5ms fenced vs 70ms open over a country.

### A CONQUEST TAKES AN OATH, NOT A DEED

"`players[i]` is the lord of `cities[i]`" was always half-true — a country builds one player per
city, each with its own purse, Gates, halls, crews and companies — and conquest DISSOLVED it:
`city.owner` moved to the taker, the beaten lord kept a treasury he could no longer spend, and
his works stood inert in the taker's new court forever, refusing the taker's own masons the
ground. What a conquest won was a name on a map with no economy under it.

### A realm SHARES ITS SIGHT and nothing else

`refreshVision` casts ONE mask per realm and shares the object; sixteen boards of cells cast
four times over for four identical answers was the alternative.

### WHAT YOU BREAK AND HOLD, YOU KEEP

There was a lord brake — one city by right and one more per LORD, a lord won only from a
contender — so a court you had broken, stood in and held for its full twenty seconds could
refuse you outright. Gone on the designer's call.

### EVERY COURT IS NAMED, AND A LORD IS NOT HIS CITY

A country drew court names from a bag without replacement and the bag held twelve against
sixteen cities, so three came out as "a City of Shadow" — not a name but the absence of one,
which read as duplicated rows on the council's roster and made every banner quoting one
ambiguous. And every seat was named after its court, so the two rivals who can actually win the
war were indistinguishable from the thirteen lords who cannot.

### AND A MINOR LORD HOLDS GROUND; HE DOES NOT CONQUER

Every seat runs an heir's doctrine and an heir's whole game is to find the nearest rival court
and take it — which on the two contenders is the war, and on the other thirteen was fifteen
little empires trying to eat each other. Measured over six simulated minutes of a sixteen-seat
country: 276 war bodies aimed at a rival court, every one turned. Beware the obvious metric —
"men standing inside a rival court's radius" does NOT measure this, because a rival's own writ
spring sits inside that radius and taking it is exactly what the lord is supposed to do instead.

### A HOSTILE IS SOMEBODY I MAY STRIKE, AND `World.foe` IS THE ONE SPELLING

`AI.view`'s `visHostiles` asked `owner !== me`, which is a different question and gets two
answers wrong in a war. A PACT PARTNER's men counted as hostiles, so an heir at terms with the
player read his army as a threat, came home against it, drew a Trump against it and called the
JEWEL down on it — reported from play in exactly those words. The damage was always refused at
`hurt`'s door, so it did nothing but spend the Jewel and put a storm over the player's men,
which from his chair is an ally attacking him. And a SWORN LORD's men are `owner !== me` too, so
a liege read his own vassal's army as an enemy massing on his border. Proven a no-op for the
referee rather than assumed: `RULES.truce` is 0 in a skirmish, so `foe` is always true there,
and twelve seeded duels play out identical to the essence.

### EVERYONE AT THE TABLE EARNS BY THE SAME ECONOMY

The rule was forced by a report from play — a hand-played inner lord with a negative economy who
could never afford a Gate, whose number named the cause exactly: `2.5 (BASE_INCOME) x 0.52
(SQUIRE) x 0.62 (MINOR) = 0.806`, the "+0.8/s" on his screen — and by the death spiral the same
arithmetic made permanent for every bot: a lord whose Gates the black road ate could not afford
another at 0.8/s and sat idle for the rest of the war. Measured gone: strip every Gate off a
MINOR lord and he has one back in 68s and five by minute six, where the same lord on the old 0.3
purse had one after 119s.

### AND A LORD WHO CANNOT AFFORD HIS PLANS STOPS BUYING MEN

The muster valve was a player-only control — no doctrine had ever issued `{c:'muster'}` — so a
lord whose halls drank everything he earned never saved the 400 for the Gate that would have
paid for them. Diagnosed by the player himself. It answers a country, where a lord's income is
a fraction of a duel's and a hall costs the same. Measured over six simulated minutes, before
and after: purse under 50 in 38% of samples then 19%, median purse 31 then 80, Gates 19 then 21
at SQUIRE; 40% then 29% and Gates 33 then 40 at HEIR. At PRINCE, where lords were least starved,
it is a wash (41 Gates then 37) — written down rather than hidden. Written against the live
`drainRate` it flapped — thirteen toggles in thirty seconds — because a shut muster drains
nothing, so the same lord read as solvent on the next think, opened, drained, and shut again.
The rig that holds it asserts the lord is actually in the red, because at its first setting he
was a tenth in the black and the suite sat red through a whole handoff.

### A COURT THAT HAS FALLEN IS OUT OF THE FIGHT UNTIL IT SWEARS

Reported from play: a Seat yields, the claimant stands his twenty seconds in the court, and his
men spend them knocking down the halls and Gates he is about to inherit — a conquest that pays
for itself in the spoils it destroys. Measured: 2,781 stone and three works of six, gone in
eighteen seconds. The sim already half-said this (a broken court's halls muster nobody —
`occupied` — because a city with no throne pays no muster); `World.fallen` finishes the
sentence. Without "its towers do not fire" the claimant would be forbidden to strike the stone
while the stone went on striking him, which is not a mercy but a one-sided fight.

### AND AN ORDER BIASES THE CREW, NOT ONLY THE COLUMN

An heir told to go and get gates marched — and his mason, who had never heard the order, went on
wanting whatever his personality wanted. Reported from play as an inner lord sending troops to
springs and never building on them, with a hundred men parked on one. The cause is `wantGates`:
it picks from `nodes.own` (the 3 springs nearest his seat) and `nodes.mid` (4-7), capped at one
or two, and filtered to springs NOBODY holds — so for an inner lord in a developed country every
one of those is already gated, every gate mission returns null, and he wants no Gate anywhere
however many his army is standing on. A fixed `slice(0, 2)` cannot say "the next free one";
recomputing every think can. Measured on a country where every bucket spring was already gated:
1 Gate → 2 with both free reach springs untouched, and 1 → 4 with the order heard.

### AND EVERY ONE OF THE FIVE WORDS HAS TO MEAN SOMETHING

`gates` fell in with `hold` in a branch whose whole body was `home()`, so it was accepted,
written into the helm and printed back in the council row as "ordered to gates" while changing
nothing — the dead-button failure the end screen already taught once, and worse here because
the row asserts the order stands. Reported from play as *"the bot doesn't even explore to look
for gates"*: he was not failing to look, nothing ever sent him. `walls` was never dead — it has
a works arm (towers on the court's rim, faced at the nearest rival court) and coming home is
the right march for a defensive order.

### AND A SPRING A RIVAL HOLDS IS STILL A SPRING TO TAKE

`gates` marched — at ground *nobody* held, and nothing else — and returned `'home'` when it
found none, which under the reach law strikes every standard. So the same order was dead a
second time, in the case that matters most: a reach is fully spoken for far more often than it
sounds — an INNER lord's is ringed by courts that have been gating their own ground since
genesis, and every lord's is by the second half of a war. Measured: ten springs inside one
lord's reach, six of them a rival's — the exact ground the order is about — and not one rally in
forty thinks. Reported from play as *"my inner lord when asked to build gates never sent troops
to explore and find springs"*. Free ground is preferred because walk-on-and-build beats
break-then-build.

### AND HIS DEFAULT — no order at all — HAD THE SAME THREE HOLES

The march asked only "is a court of another banner on my own border", so an interior lord did
nothing whatever: conquer a cluster and every lord inside it is ringed by his own banner, finds
no target, and stands at home for the rest of the war while his halls muster (measured: 14 men
in his company, ZERO commands in eighty thinks). "Trouble at home" was hostiles within 500 of
his SEAT, so Chaos could gnaw an outlying Gate — the thing his economy rests on — while he stood
in his yard. And he never marched to a spring, so he could never build on one, because
`placementError` wants men standing on it.

### EVERY SEAT IN A WAR IS AN HEIR, AND A MINOR LORD IS A WEAKER ONE

A country used to run one 181-line baseline (`BASELINES.lord`) on all sixteen seats, whose whole
vocabulary was rally/build/walk — no upgrade, no fork, no power, no mend, and only ever
`companies[0]` — while five heirs with years of doctrine sat unused. The cause was ONE WORD: an
heir moves its army with `{c:'banner'}`, and under the reach law there is no one banner an army
answers, so an heir in a country was MUTE rather than wrong. Translating the word at one seam
(`warOrders`) rather than rewriting the doctrine is what let five heirs' worth of doctrine play
a country.

**The footing did not scale the country.** The picker says "how hard the heirs play" and a war
did not read it: a contender got `{}` — no handicap at all, which is harder than PRINCE — and
every other lord a fixed `CONST.MINOR`, so SQUIRE and PRINCE dealt the same opposition. Worse,
`startRealm` stamped the chosen footing into the CHRONICLE, so a war's record named a setting
nothing in it had read — the dead-control failure landing on the one instrument used to
diagnose reports from play. The footing carried an income fraction (`eco`) once, dealt onto
`players[].eco` by a `warPurses` pass wherever a seat gained a driver; the designer retired it
— see "EVERYONE AT THE TABLE EARNS BY THE SAME ECONOMY".

**Lapses are spells.** A flaw rolled fresh every think was measured to be almost no flaw,
because missions and errands are sticky, so `gates`/`up`/`siege` hold `SPELL` seconds and the
entry chance is derived so the table's number is the long-run FRACTION of the match spent
lapsed. An heir made with no footing plays byte-identical to before: held by a suite that plays
twelve seeded duels both ways and hashes the traces.

**`hold` gated to one banner.** Ungated, an easy footing stopped the whole country making war on
itself for thirteen minutes, which is a duller war rather than an easier one. Measured at SQUIRE
with the gate: lord-in-a-rival-court samples 3 → 20 → 5 over the first six minutes and two or
three thrones under the hammer, all of which would be zero without it. The promise to the
player is kept in the only sense the sim can keep it — `CASTLE_ZONE` makes any man within 46 of
a throne strike it.

**Lords against heirs**, measured over six simulated minutes on two seeds: Gates standing 16/17
→ 44/55 (sixteen is exactly the opening one apiece — the lords expanded ZERO), springs held
16/17 → 44/55, works 51/48 → 144/189, men 236/187 → 697/802. Cost 0.96 → 2.3ms a frame for the
whole country, well inside the budget.

**The `lord` baseline was deleted** (2026-08-17) because the five words had two implementations
and drifted once ("a spring a rival holds" had to be fixed in both); its default was ported into
`warOrders` and its five suites now drive an heir, which is what the game seats.

### A COUNTRY PAYS FOR ITS OWN PATHFINDING

A country's measured working set is 74 flow fields, which sat just above the duel ceiling
(`NAV.cacheMax` 48): the cache filled, dropped EVERYTHING and rebuilt it, over and over.
Measured over twenty simulated seconds, 1,098 field requests DEFERRED and 41 rebuilt — the
ration (`NAV.perTick` 1) saturated on essentially every tick, and a deferred field is a man
steering straight at his goal instead of down a field, all over the country. That is what the
lag was. Given room (`world.navCache` 96, `world.navRation` 4): 0 deferred, 15 builds, and the
sim got FASTER, 3.05 → 2.29ms a frame, because it stopped rebuilding what it had just thrown
away. The reads were never the problem: 92,793 reads against 15 builds in that window, 6,186 to
one. Builds are per distinct GOAL — essentially one per company (74 fields, 41 ordered
companies); one doorway per wall run took 29 thrashing fields to 3. What IS wasted is size: a
bounded field is fenced to a city's disc but allocates the whole grid — 750KB, of which the disc
is 21%. Sparse-to-the-bound is a 4.7x memory cut with no behaviour change, written down rather
than done.

### AND THE STONE NEAR A MAN IS BINNED TOO

`stand` (via `project`) and `steerClear` each walked every building of every player, per man,
per tick. Invisible on a board (two seats, thirty works); profiled sixteen minutes into a
country it was 27% of the tick between them, with the whole sim at 40.45ms against a 33ms frame
at 1111 men — superlinear, because both terms grow (men x5.7 → cost x14.7). That is the reported
lag. With `world.wbins` and `worksNear`: 20.13ms at the same point, halved everywhere.
Three things the fix turns on, each found by measuring rather than reasoning:
(1) the ORDER is part of the answer — `stand` mutates the man as it projects him off each work
in turn, so `_ord` records the position the full walk gave each work;
(2) the query must cover where he ENDS — `pad * 3` is three times the measured worst case (at
most ONE work ever projects a man in a pass; largest displacement 24.16 units over four
sim-minutes) and free, because at `WBIN` 96 it is the same 3x3 of cells `pad` alone would look
at;
(3) a work thrown down MID-tick was the ONLY real difference between the two passes; it first
showed at t=120.2s as one soldier 1.45 units adrift, and nothing but a lockstep comparison
(`World.slowWorks`, the suite playing the same seeded country both ways) would ever have found
it.
What is left on top is `acquire` and its call site (~40% together); the unit `BIN` is 280,
which scans 7x the area an aggro radius needs.

### A DECIDED WAR IS REMEMBERED AS DECIDED, WHOEVER DECIDED IT

Two links in one chain, both reported from play as the previous game's end screen appearing
instead of a new war. `done` was written only where `run.tick` answers — but a war ends through
the SIM as often as through its run (a throne down, `holdCities` finding one banner left), and
neither asks `tick`. And `done` was never written to the RECORD nor read back out of one, so
`REALM.load` always returned a war that looked undecided and the menu's "a decided war is not
resumed" check could not fire once in the game's life.

### A LAN TABLE HAS TWO BEGINNINGS, and the button says which

One BEGIN used to mean a plain board or the whole table dealt into the host's war depending on
whether a war happened to be saved — the same button, two games, nothing on screen saying
which. And one channel throwing inside the deal used to take the whole handler down, which
looks exactly like a BEGIN that is not wired up.

### A GUEST IS IN THE WAR TOO, and `game.war` is the CLIENT'S word for it

`game.war` was set inside the HOST arm of `startMP` only, so on a guest every reader answered
"an ordinary match": no ⚑ chip, no council, and therefore — on 8000×9600, where a court cannot
be found by dragging — no way to reach anything he owned.

### THE COUNCIL ASKS THE VIEW, NEVER THE WORLD

The council read `players[viewer].explored` — a field of the world that never crosses the wire
— so a guest's council knew of no court he had found and offered terms to nobody, while a
host's listed them all.

### WHEN THE TABLE BREAKS UP

An heir walking out and a phone in a tunnel arrived as the same `onclose`; a killed app, a flat
battery or a dropped Wi-Fi arrived as *nothing*, because `dc.onclose` never fires for those.
There was no staleness check anywhere — `snapAt` was read only for the interpolation alpha — so
a guest went on drawing the last snapshot forever, men sliding to the ends of their velocities,
taps going into a channel nobody was listening on. Host migration was considered and ruled out:
only the host holds a world, and handing the match on would mean shipping a whole world over a
link that has just proved unreliable; dropping a guest at a menu offering a brand new war reads
as the whole evening being gone, which is why `endTable` says the country is the host's save.
The host used to play on against a statue when a guest left: the departed heir's cities kept
earning and his men held whatever ground they were last ordered to, forever (`adoptSeat`).

### A WAR'S STATE IS A PLACE YOU GO, NOT A CORNER OF THE MAP

A duel's HUD held nine things and a war added more: the two-line war line was left-anchored to
`min(58vw, 300px)` and the terms tray was right-anchored and as wide as its text, so on a
420-wide phone they collided by ~60px — and a fourth banner would have run the chips into the
minimap (measured: chips ended 6px above it). Reported from play with a screenshot. Three chips
permanently reading "at war — tap to offer" were an ECHO. Take-command was effectively
unreachable before the council, because on 8000×9600 you cannot find a court by dragging.

### A COURT IS PUBLIC, AND THE COUNCIL MAY NOT INVENT A FOG THE SIM DOES NOT HAVE

The council hid every row behind having laid eyes on the site. On a board that is invisible; on
8000x9600 it was the whole feature: measured two minutes into a war, fifteen standing banners
all holding ground and terms offered to NONE of them, because the heir had seen one court of
sixteen and might never see another. Reported from play as the council showing no enemies. The
fifteen-identical-rows noise it was meant to prevent is a presentation problem, answered by the
sort order.

### ONE ROSTER, AND TERMS ARE AN ACTION UNDER A COURT

THE COURTS and TERMS were two lists about the same banners — a rival named once with its
holdings and its state, then again by every court it holds. Reported from play as redundant.
Grouping the courts under banner header rows was tried first and measured: it reads better and
does not CONDENSE — sixteen headers plus sixteen courts is 32 rows against the 31 it replaced,
because at genesis every banner holds exactly one court. The strip carries `data-pi` because
its LABEL may repeat: a country names courts from its seed and several fell back to "a City of
Shadow", which a test comparing labels read as a duplicate that was not there. And a rival
court's sub-line used to say its own name back at you (a lord is NAMED for his city, so the row
read "KASHFA — KASHFA's").

### THE COUNTRY IS DRAWN, because a roster is a list and a war is a SHAPE

Sixteen courts on 8000x9600 cannot be found by dragging or held in the head from a column of
names. The reach disc is drawn because the reach law decides where an army may be sent at all,
which makes it the war's real geometry. Ownership is live because a remembered one would put
the map and the row beside it at odds over the same court. The ground is `Render.groundImage()`, handed over rather than baked again: a country's base is
2237x2684 and a second one is twenty-odd megabytes on a phone for a picture that already exists.
Sixteen labels on the minimap would destroy "where am I, where is the fighting" at a glance,
which is why the council map is not the minimap. A tap on a mark used to jump the camera and
close the whole panel — the one thing you did not want if you were reading the map, since you
lost the map to find out what you had tapped; hence the card over the council.

### "MINE" IS ASKED EVERY FRAME, AND IT IS THE BANNER'S

`g.own` was `pi === viewer`, decided once in `buildCity` and never revisited. So every work in a
conquered court stayed dressed as an enemy's for the rest of the war: the dark foe pad, no
selection highlight, and — reported from play — no company standard at all, because the pennant
hangs behind that test. The halls went on mustering into the company they were assigned and the
men came out under its colours while the hall over them flew nothing.

### A THRONE LEFT ALONE MENDS ITSELF

The Seat never self-mended, for the same reason it needed a gunnery pass of its own — it is the
CITY record, not one of `pl.buildings`, so every loop that mends stone walked past it, and
nothing in the game could raise its hit points at all. One early raid nobody could answer halved
a heir's last line permanently. The RATE is the Seat's own (`maxHp / CITY.mend`, a whole throne
in five minutes) because 2 hp/s would take twenty-one minutes on a ten-minute median. Measured
before and after with `node sim.js`: every score and both road targets unchanged, castle-decided
matches a little longer (6.7→7.0m, 9.4→10.2m), which is the change doing what it says.

### THE MAP SAYS WHOSE — colours

Four seat colours answer a table of four. A war seats sixteen, so from the fifth lord on every
banner came out the same crimson — an ally at terms, an unaligned neutral and the army marching
on you were one colour, and a court that swore looked no different the tick after. The castle
bar used to hang over the born city while drawing the hp of the seat its heir currently ruled
FROM, two different cities.

## The Curtain Wall

### THE PARAPET IS CAPPED AND THE FOOT IS NOT

The ranks behind used to wrap at `WALL.rows`, which meant a curtain held `berths * 4` men and
dealt every one after that a place somebody was already standing in (measured: 21 overlapping
pairs of 60 men on one run); they are unbounded now. A man's final approach judged on "near the
RUN" is wrong for a reserve whose rank is a hundred and thirty behind it, who otherwise
beelines away from the wall, stops being "at" it, is handed back to the field, is steered at
the doorstep beside it and comes back (173 transits became 1,418, by 31 men). A swordsman on a
parapet was only ever a man in the open holding a berth an archer needed.

### AND A BERTH IS AN ERRAND UNTIL HE IS STANDING IN IT

Being NAMED to a berth used to be the whole of manning: measured on the old rule, thirteen of
twenty-four men were on the stone one second after the order, still 279 units away from it.
Reported from play as men teleporting to a wall. Four things had to be true before a man could
walk there at all, each measured: (1) a flow field is cached by its goal CELL and the cache
evicts by dropping every field it holds, so a berth per man mints a goal cell per berth: 29
fields held and thrashing, against 3 with one door per run — the tower has always steered at
its door; (2) the last stretch is `stand` alone, never `project` — which is why a man can walk
into a bastion standing inside a curtain's 19-unit slab; (3) `PARAPET` = `thick + 8` against
`shove`'s pin at `thick + 6`, or an arrived man is re-projected every tick; (4) a man dealt a
berth 200 along his own wall gained one unit in eight seconds against a 50/s stride until
cohesion was lifted for the final approach.

### AND A GARRISON DOES NOT GIVE CHASE

An archer sees 150 and throws 105, so a foe just out of range dragged him off his own wall to
close the difference — six men pinned dead at a junction, their walk cancelled tick for tick by
a chase after a man they could not have hit.

### A CURTAIN GATHERS TO THE FIGHTING, AND SPLITS FOR TWO

One alarm would answer a feint perfectly — hit one end, watch the wall run to it, walk in at
the other — which is why there is more than one. Measured on a three-run curtain with twelve
men: at rest 4/4/4, one assault 12 of 12, two assaults 6 and 6.

### AND THE PARAPET IS HALF A SHIELD

Without cover a berth bought reach and nothing else, and holding a curtain was strictly worse
for the man than standing in the field beside it. The geometry around a run is NOT a controlled
comparison — a berthed archer beside one in the open took exactly half with the cover switched
OFF, because one of his two attackers could not land a shot. The suite plays the same seeded
world twice and varies only the constant.

### AND CONTIGUOUS RUNS ARE ONE CURTAIN

Dealing one run out before starting the next is what packed forty men into the first two
hundred feet of a board-long wall and left every tower past them empty. Reported from play with
a picture.

### A CURTAIN HAS ONE SHELTERED FACE, AND IT IS THE POLYLINE'S

`station` used to face each run at the owner's Seat independently, which is invisible on a
straight wall and wrong on every other: past a right angle of bend the direction home swings
across the run's own perpendicular and the sheltered side flips halfway along the stone.
Chaining by "agree with your neighbour's NORMAL" is the obvious rule and is wrong for a zigzag,
where neighbours differ by more than a right angle — it was measured making things worse. Aimed
at the gateway itself (a hole in his own nav layer) the field cheerfully routes a garrison out
one gate and back in the next, because on a dogleg that is the short way — hence the DOORSTEP.

### AND THE DOOR DECIDES WHO PASSES

Keyed on reachability rather than the side he is standing on, a man falls back to the open
layer, strides, and is turned round, and a doorway fills with men jittering — measured worse
than leaving the gates open, twice. Without the shut layer a garrison reshuffling on a zigzag
went out one gateway and in the next — 4,222 transits in a hundred seconds, against 173 now.

### A breach is a ruin, but a SHELL is not

`fix` for half the stone would have been cheaper than finishing a shell that never stood, which
is why a shell is razed rather than breached. `acquire` aiming at a rising run's midpoint put
most of a long shell out of reach; setting hp from the card on completion would have forgiven
damage done to a shell.

## Common Tasks

### The Muster Roll is a GRID

`Render.rollStart` used to turn eighteen men at once, on a phone; the figure belongs to one
open card, so it is handed one berth or none.

## The heirs' doctrine — refereed changes (2026-08-17)

### The recall for one fiend, and the assault's hysteresis

`homeThreat` was `threats >= 3 || atGate > 0`: a single hostile inside 116 of the throne,
Chaos included, recalled the whole army — measured earlier, benedict's banner sat on its own
Seat 51% of samples. It is `threats >= 3 || atGate >= 3 || rivalsAtGate > 0` now: a fiend at the
gate is the Seat gun's business (the hardest gun on the board, and a throne mends itself), a
rival's man there is a column's first man. And `ready` remembers: an assault sets out at the
COMMIT floor and goes on down to two thirds of it, so a column that took losses on the road
finishes the road instead of turning round at one man under the floor and back at the next
recruit. Bundled with the Trump's champion appearing on the Seat's side that faces the middle
of the board rather than "toward the other end of the lane".

`node sim.js` before → after, same seed: mirrors benedict 10-8 → 7-12, bleys 15-4 → 11-7 (n=20;
both within noise of even, and bleys moved toward it); gradient benedict/random 20-0 → 18-0 with
2 timeouts (n=40 on both trees: 37-1 with 2 timeouts against 37-2 with 1 — seed noise, not a
stall), benedict/greedy 18-2 → 19-1, greedy/random 18-2 → 20-0; contested Pattern share 55% →
67% (target 50, tolerate 25-75 — nearer the lip than before, and the thing to re-read on the
next full run); greedy mirror median 25.3m → 14.3m; the ladder re-pasted as
`corwin, julian, bleys, brand, benedict`.

### ONE DISC, FACED — THE SHOOTERS ARE THE REAR CRESCENT (2026-08-22)

From the same war, with a screenshot of two separate blobs on a road: "range units are
standing too far behind contact units. too far from battle in many cases and in that case
too far to heal the front troops." The arithmetic condemned the two-disc layout on its own:
a body of n at berth b is a disc of radius ~b·√(n/π), so fifty fighting men are an 86-radius
disc, forty shooters a 76 one, and the back line's offset (the depth of BOTH plus a berth)
parks every shooter 108-260 behind the flag - the sorcerer reaches 130, the Warden mends at
110, and even the 170 acquire aggro cannot see the melee from there, so the rear half of
every big company simply watched. No cap on the offset can fix it: keeping the whole second
disc inside a sorcerer's reach of the front EDGE (front disc radius + offset + back disc
radius ≤ 130) has no solution past about thirty men a side.

What shipped: ONE spiral, faced. The same `bodyPlace` places for the whole body, sorted by
their projection along the remembered facing; fighting men are dealt the forward places in
rank order, shooters the rear crescent, and the deal is rebuilt every tick so growth and
losses re-sort themselves. Measured on 50+30+10 at rest: the shooters' front rank at 8
BEHIND the fighting line (was 108), the worst shooter 198 from the front edge (was ~346),
and all ten wardens in mend range of a fighting man (was none). A body of one kind builds
no deal and keeps its exact old spiral to the byte. `g.want` - the march standoff the local
pacing reads, the number that once had to equal the two-disc depth or the line pushed
through its own arriving archers - is now the single body's radius, which is smaller than
the old offset was for every mixed body that exists.

### A COMPANY ORDERED HOME MANS THE HOME STONE (2026-08-22)

From a played war: "I don't see sorcerers going on walls and in towers." The mechanism, not
a doctrine gap: manning is posted by the ORDER (`postWalls` band 48, `postTowers` band 76),
and a company with no rally is ordered at its city's COURT CENTRE - which is every struck
standard in a war (`hold`/`walls` strike the standards by design). The court-clearance rule
then pushed every run past `CITY.r`, so no wall could ever again fall inside the band of a
home order, and the court's own towers at 76-150 were already outside `TOWER.man`. Home
garrisons had quietly stopped being possible for anyone not micro-rallying a standard onto
the stone. The fix widens ELIGIBILITY, not the bands: an order EXACTLY at the
company's home court (within 32 of `homeOf`) reads as "keep this city", and every own run
and tower within the court's claim becomes eligible; the nearest is taken, the roster's
dealing (shooters first, berth caps, alarms) unchanged. The first cut read "near the court"
(`CITY.r`) and the cover suite caught it the same hour: a reserve deliberately rallied a
hundred from the throne was marched onto the parapet - an order to stand SOMEWHERE is not
an order to keep the city, and 32 is the width of "exactly". Rig on a war country: eight sorcerers under a struck
standard climb the parapet and twenty-eight men post to the curtain within ninety seconds;
the tower half fills even without the wall. The rig's own lesson, twice in one file: a
hand-zeroed `raise` skips the completion path, so the run never entered `world.walls` and
the first read said "nobody posts" about a wall the sim had never been told stood.

### THE EIGHTH CHRONICLE — the watch, and the curtain pushed off the court (2026-08-21)

Seed 3816632737, brand at PRINCE at 0.10.55, lost by castle at 14:11 — better (income
peaked 34, adaptive towers up at his gates, the walk attempted), and the designer's list
survived contact: the towers stood EMPTY (the player razed three of them at gated springs),
sorcerers never entered stone, and the walk began at 10:47 with the war already lost.

- **THE WATCH**: a garrison is posted by its company's ORDER (`postTowers`), and no standard
  ever stayed at a forward spring - the errand moves on with the errand. One shooters hall
  (never the last) is assigned to a fresh standard and rallied at the forward gated tower
  nearest the enemy. Rig (brand, seed 42, one gate razed at 4:00): a sorcerer company forms,
  and by +180s TWENTY men sit inside the forward towers. The first cut was gated on
  `!v.walking` and the rig's brand walks at five minutes - the guard was exactly backwards
  (a walker's outlying Gates fund the walk; the first chronicle of this arc), and the rig
  read "posts 6, watch 0" until it came out.
- **THE CURTAIN OFF THE COURT**: the sim refused a run only through the throne's own
  footprint, so both the AI's `spanFor` rings (120-222) and a player's tight walls hugged
  the court - the designer: too close for the building ground, too short to man. `wallError`
  refuses inside `CITY.r` now with its own word ('court'), and `spanFor` sweeps outside.
  One suite rig moved with it (the crews-refusal runs drawn at `c.x + 90`).
  **And the rule alone cost the stone-heirs their probes** - found by a worker-driven probe
  pair on a court-reverted copy of the tree, after three watch variants read IDENTICAL
  numbers (the watch was never the cause; the confound shipped in one batch): julian 8 -> 10
  gates lost and income 28 -> 10, benedict 9 -> 10 and 16 -> 12. The rings-around-the-throne
  doctrine, pushed out to `CITY.r + 60`, no longer shielded the HOME SPRING GATE the raids
  actually come for. `spanFor` centres on the HEART now - the gate nearest the seat, which
  lives at arm's length and mostly outside the circle already - and the probes read julian 9
  and income 21, benedict 9 and 14: the court rule's net price is about a gate, on floors
  that were failing before it (the pre-existing julian/benedict failures stand in TODO).
- **THE WATCH NEEDS FOUR HALLS**: at two or three, dedicating a shooters hall starved the
  rest of the defence; the raid-probe numbers that first condemned it turned out to be the
  court rule's (above), but the floor stays - the watch is for a developed realm, where a
  quarter of the muster buys a standing garrison. And it follows the FIRE: the post is the
  tower nearest the most recently hurt own work, the enemy's bearing only a quiet-realm
  tiebreak.

### THE SEVENTH CHRONICLE — the assault stages, and the pooling that measured wrong (2026-08-21)

The designer's report after the sixth-chronicle fixes: "better, but he made the mistake of
protecting gates only with a tower and no troops. he also lost a lot of men sending them one
by one against my wall, and attacked without siege weapons." The trickle was now a THIRD
report. The first answer built was MUSTER-SIDE POOLING (a sim rule: recruits of a far-fighting
company wait at the court and release as a batch) - it worked mechanically (waves of five
marching together, the rally body growing 12 -> 24) and the referee split on it: tripwire up
seventeen points (48 -> 65, waves fight better) and EVERY raid probe lost (bleys 3 -> 9 gates,
corwin 6 -> 9, floors of 6), because the trickle it stopped was also the DEFENCE arriving
continuously at a raided gate. The designer then named the right answer before the patch-fix
landed: "the AI should know to stop fighting and even retreat men, until a sufficient force
is assembled. troops can be grouped by planting a flag not far but out of reach of the enemy,
and when ready, starting the fight." Pooling was REVERTED whole, and the staging machine
shipped at the DOCTRINE layer - which can tell an attack from a defence, the distinction the
muster never had. (Instrument lesson from the pooling rig, kept for the file: it planted its
rally at `seat.x + 700` on a seat 310 from the map's edge; the order folded back to the bank,
the "rally" stood 200 from the throne, and the trace read "everyone walked home" until the
radii were checked against the geometry.)

**The staging machine, and the three traps its rig walked into.** Only an attack on ground
defended by standing enemy stone stages; the flag goes `back` (450) short of the target
toward home; commit at `floorF` = three quarters of the army capped by the commit floor
(always reachable - an absolute floor of 22 parked every 14-man realm, and a far-enough
entry gate skipped the nearest towered gate, 520 out, entirely); mauled is judged against
the ARRIVED wave's watermark, twice over - the plain body-count read the two-man vanguard on
the road as the survivors of a wipe and recalled the column at 7s forever, and the absolute
threshold was then held PERMANENTLY above the retreat line by the trickle itself refilling
the band. Wiped outright, the machine re-stages: the rig's towered gates (indestructible, so
the doctrine and not the fight is measured) see the banner go flag -> gate -> flag again,
and the suite holds all three legs. Against breakable defences the wave RAZES them: four
towered gates down in 150 seconds where the trickle had fed the same kill zone for ten
minutes.

**And the tripwire caught the assault arm.** With courts staged too, benedict over greedy
read 35% at n=40 against HEAD's 55: an assault already leaves home as a BODY (the commit
floor gates its departure), so staging it again only paused the better attacker 450 out
while the masser's defence grew. The machine keeps exactly the two attacks that dribble -
the raid and the walk's answer - and the assault goes straight in as it always did.

**And the war suites caught a hole the rigs could not.** A war MINOR LORD is turned away
from rival courts at the warOrders seam — but the seam reads the banner's DESTINATION, and
a staging flag 450 short of a court is bare ground it cannot recognise: the lord would
besiege-by-inches the court he is forbidden to conquer, and the ordered-gates suite read
his war body parked at a court's approach instead of on the spring his liege named. The
machine now skips `assault` staging for exactly the seats warOrders turns (`noCourts` —
not a contender, or under `obey`), and four suites restate "marches on" as "on, or staged
at" for the seats that may.

The same session shipped the WALL-BUILDING FINGER (the designer: labelled marks for what
different mason counts can build; snapping onto towers, endpoint or middle, both ways):
the sim needed nothing - `wallError` has exempted own towers since the corner-tower fix and
`noteWalls` deals `onWall` by geometry in both directions (now held by a through-tower claim
in 'a curtain turns at its bastion') - so the work was input and preview: `snapWallTo` in
game.js (one spelling for the tap and the live preview via `Render.span.snap`), endpoint
snap at 52, mid-run swing about the anchor at 36 with the endpoint band excluded, a ring on
the snapped tower, and a labelled tick at every crew-length up to the idle masons' reach.
Rig lessons, each a dead instrument first: a fresh player holds ONE crew (110) so every
180-unit test run refused 'crews'; a rising shell HOLDS a crew, so two shells left one crew
free and the wall refused again; and the browser tap must clear the court of men and disarm
the flag, or the tap arms a company / plants a standard and reads as "the sheet never
opened".

### THE SIXTH CHRONICLE — brand starves, trickles into a wall, and never lays stone (2026-08-21)

Seed 2003661296, brand at PRINCE, lost by castle at 15:07 with the player never walking. The
designer's own reading was exact on all three counts: "he didn't build / maintain enough
gates, and was sending troops one by one against my wall without siege weapons. I also never
see bots building large walls."

The table: brand's income decays 21 -> 12 by minute nine and NEVER recovers; from 8:00 his
essence sits at 0-60 to the end. The player razed the Amber Rill and Glass Rill Gates twice
each — both written off, correctly — and brand never re-expanded because every remaining
spring was the player's, and never afforded the answer because of the keystone defect:

- **`saving` guards only the upgrade scan.** The Works want fired (`v.breakers < BREAKERS`,
  army 30+), set `saving = true`... and the muster went on drinking the whole income, so the
  purse never grew and the Works, the re-gating and the stone starved together. The muster
  valve existed and answered exactly this — WAR ONLY, because the duel economy was
  referee-tuned. Extended to boards: starved = (`saving` || the mission want unaffordable)
  && income - walkDrain - musterCap <= 0. Measured on the rig (brand, seed 42, five outlying
  Gates razed at 150s, purse cut to 10): valve flips at 160s, purse saw-tooths 10-120 as he
  buys his way back, **Gates 1 -> 7 in seven minutes** and the walk resumes. A healthy solo
  game shows ZERO flips in ten minutes — the valve is for the starved case only.
- **`raidAt` picked the NEAREST rival Gate**, which was the Cold Cistern — towered, then
  walled. His thirty-man body fed that kill zone in packets for ten minutes ("Brand the
  Unmaker is at your Watchtower" x3 in the moments) while the player's naked Gates at the
  Whispering Font and Silver Tarn were touched only by Chaos. `raidAt` prefers an unguarded
  Gate now (no finished rival tower within 260, no unbreached wall within 220 — world-truth
  works gated on the spring being explored, the same standard `nodeHolder` already sets in
  that function), nearest-defended as the fallback.
- **No bot could ever build a wall from a MISSION.** The mission build path composed
  `{c:'build', x, y, bt}` — no far end — so a wall mission issued a zero-length run and was
  refused 'short' every think until the mission lapsed. Measured: twenty-four 'short'
  refusals in seventy seconds while the purse sat at 300. Only the PLAN path carried
  `x2/y2`, and only two heirs' plans ever asked for stone. A spanned work now routes through
  `spotFor` (= `spanFor`'s geometry: across the enemy approach by the court, sized to the
  purse) and the far end rides the command. With it: a raided-court wall want on `fortify`
  under the `gateLost` trigger, and `spanFor` draws up to three crews' length (was two).
  Rig: the raided brand raises a 148-unit curtain, one build, zero refusals.

**And the tripwire caught the first cut of the valve — then taught the second and third.**
The bisect, all at n=40 on the same seeds: HEAD reads **55%** (the 75/70 readings were n=20);
the wide valve (`saving` && income under the halls' thirst) read **35%** — halls out-drinking
income is the NORMAL mid-game state, so it fired through every ordinary save; narrowed to
`gateLost` alone it read **30%** — greedy's own CHARGE razes a gate on the way in, so
benedict paused his muster with the army at his door; with the threat guards
(`!homeThreat && enemyArmy < army`) it reads **55%**, HEAD to the point — the valve is free
once it fires only for the raided-and-left case it was built for; the shipping config (the
surplus-gated curtain live on top) reads **48%**, within noise of the same 55 (19/40 against
22/40), and the full run's own n=20 section reads 60. The curtain want went
through its own wringer: on `fortify` it rode the errand-mission machinery and NEVER BUILT
(the run stands AT the court; the mission slot sat behind a cross-map gate errand and the
upgrade scan's crews through 150 seconds of solvency) — it is a STANDING CITY WANT now,
surplus-gated, and the chronicle rig raises its 149-unit curtain during the recovery itself.
The first full referee run (wide valve) also put the contested-Pattern share at **53%**
(21 by force, 24 by the Pattern; target 50): the stone, the valve and the naked-Gate raids
are what an answering army needed — re-measured with the final config in the shipping run.

The remaining half of "one by one against my wall" is BATCHED REINFORCEMENTS (TODO) — the
valve makes the Works affordable and the rams follow, but new men still walk to the standard
alone as they muster.

### THE COUNTRY IS SMALLER, AND EVERY ROAD RUNS BOTH WAYS (2026-08-21)

From a played war's council map (the designer, with screenshot): "cities completely
disconnected from each other due to how far men can be sent... it might be worth making the
world a bit smaller. Amber should be in the middle." AMBER and the corners were already law;
the disconnection was real and had three causes, found in this order:

- **The one-way edge.** `nbrs[a]` says a's men may be ORDERED to b — nothing said b could
  answer. A big city covering a small one whose own disc fell short read as connected at the
  genesis gate and played as a court that could be struck and never strike back. The law is
  MUTUAL now: a neighbour counts only when each reaches the other.
- **Growth without a cap.** The first fix grew reaches until mutual-two held — and satisfied
  it with discs of 5000-8100 on a 6600-wide map, covering half the country, which repeals the
  reach law's whole point ("to strike a city two hops away you must first hold the one
  between"). The cap HOLDS now (`Math.min(reachCap, ...)` in the grow pass) and a candidate
  set that cannot reach mutual-two inside it is rerolled. Growing the lonely PAIR (the city
  and its nearest non-mutual partner) was tried against growing the suitor alone: no change
  in fails — growth speed was never the binder.
- **Max-min starves the corners.** With the cap holding, 5 of 40 seeds failed all 24 attempts
  and the mute rate was ~93% per attempt. Instrumented (`buildCountry.lastMute`): every lonely
  city was a CORNER CONTENDER, nearest fellow 3300-3600 out — past any legal reach BY
  DISTANCE, not by path. Max-min placement pushes cities as far apart as the land allows,
  the exact opposite of what the mutual gate wants; a first attempt at "prefer ground two
  anchors can reach" made it WORSE (8.89 attempts, the corners are precisely where only one
  anchor reaches). The fix is to SERVE THE STARVING ANCHOR: each round the picker asks who
  has fewest fellows inside the cap and fences the candidates to that city's disc — at
  cap−`CLAIM.seat`, not the bare cap, or the served reach covers the throne and never the
  springs (the anti-turtle raid claim in the suite would fail at nd 2850 + writ 430 > cap
  3000). Max-min against everybody still keeps the spread inside the fence.

Dims 8000×9600 → 6600×7900 (two thirds the area, same 16 cities), spacing 900 → 850.
Measured over 40 seeds, before → after: fails 5 → 0, mean attempts 8.89 → 0.07, mean build
654ms (old dims) → 891ms, worst mutual count 2 everywhere, every reach ≤ cap, raid claim
green on all 640 cities. The suite's roof claim tightened from cap×growth^passes to cap+1 —
the cap holding is now an assertion, not a hope.

**Two rigs the smaller country broke, both instrument lessons.** The reserve suite planted
its probe Gate at `seat.x + 700` — a fixed EAST bearing, which walked off the world the day
the map shrank (seed 17 seats that lord at x 6010 of 6600) and read as "the doctrine ignores
the attack" while the instrument pointed off the map; it aims toward the middle now. And the
crew suite's "free ground is taken" counted a spring free while a Gate SHELL stood on it:
measured, the ordered lord took TWO springs in his 180 seconds — one held, one stormed off a
rival and re-raising at the bell — and the claim read 3-free-before, 3-after, a sim behaving
BETTER than its test could count. A spring with a standing shell is spoken for. (A third
lesson en route: the first repro hand-rolled `manAt` without `dmg`, and fourteen men who do
no damage die to a man and read as "the march is stuck" — prove the control is alive.)

**The save is stamped.** A saved war regenerates its country from its seed, so a generator
that deals different ground orphans every record made before it — works in the sea, courts
renamed. `WG.COUNTRY_GEN` (3) rides every save; `REALM.load` AND `REALM.saved` refuse a
mismatch the way they refuse a v1 — lost, said once. A record from before the stamp reads as
generation 2. Held in 'a war fits in a pocket' beside the v1 claim, both directions: a fresh
save carries the stamp and round-trips; a stamp-stripped save loads as nothing, says so, and
does not read as a saved war (the dead-resume-button failure).

## The Reach War — sides, and what a chronicle showed (2026-08-17/18)

### From one chronicle: a minor lord walked, terms churned, the heirs took no courts

The designer's report from play (the whole chronicle pasted): AMBER's own minor lord walked the
Pattern to a hundred; "X breaks with AMBLERASH / X and AMBLERASH come to terms" once a second for
minutes; and no heir took a single court in a game where they were meant to be marching on
AMBER. Three causes, each measured with a rig on the same seed:
- **The walk.** Nothing said a minor lord may not; AMBER's holder builds the Shrine by doctrine
  whoever he is. `noWalk` on every non-contender (and every vassal), which is refused in the plan
  loop before the Shrine is wanted — brand's plan opens with one, and the rig counts zero wants.
- **The churn.** A knife-edge pact doctrine flipping every think, and every reciprocator following:
  `PACT_HOLD` = 30 s per seat — an offer made or withdrawn stands thirty seconds. Rig: a doctrine
  that flips on EVERY ask issues at most four pact commands per seat in ninety seconds.
- **No conquest.** Two holes in `warOrders`. The fan-out issued a rally per company only when the
  BANNER's aim moved, so a company whose standard was later struck (the Recall, a hall razed) was
  never re-sent while the aim stood; and the assault's target was the NEAREST rival court, which
  for an heir is very often outside his reach — the clamp marched him to the rim and no further,
  every think, forever. `view()` now sorts courts INSIDE the seat's reach first, so the court he can
  actually strike is the one that matters, and a company without its standard is re-sent. Measured
  (`where.js`, `why.js`, `why2.js` rigs): before, the heirs' war bodies parked at the reach rim;
  after, they arrive at the neighbouring court.

### A war has two sides

The default war is you against three heirs (`REALM.SIDES_DEFAULT = [[0],[1,2,3]]`); counts dealt by
geography (the ally is the contender court nearest yours). The setup screen went in with it, and
the LAN lobby's `#lan-sides`. Eighteen headless checks and the browser flow through `#ws-begin`.

### A founder broken re-founds his banner, and a player broken has lost

Found on the council browser page, which swears a lord by hand: with sides the first lord is the
heirs' FOUNDER, and the diagnostics read `offer to banner 1: err 'seat'`, `label: null` — the pact
command normalised the offer onto the founder (`realmOf(1)` = 0 by then) and refused it as your own
seat, and no terms row was built (a founder whose `realmOf` is not himself is skipped). The sim
did the same in `holdCities` all along to a contender's sworn lords. Alternatives rejected: the
vassals following the founder into the conqueror's banner (one court taken hands over a whole
side — a decapitation nobody asked for), or each going free (a 2v2's allies must stay allied).
And `run.tick`'s loss ("your banner holds no city") dated from the deed model; under the oath a
conquered player was a member of his conqueror's realm and was told he had WON when the conqueror
walked. Held by five checks in 'a war has two sides'.
The council page is nondeterministic by construction — a random seed, three heirs at SQUIRE —
and measured three different failures on three runs before the bots were silenced for the length
of the page (a heir asking you for terms in the first minute re-sorts the roster, relabels the
button ACCEPT and turns the tap into a seal).

### A seat that has lost watches, and the table ends when they all have

The designer's ask (2026-08-18): a human who lost a LAN game early watches the remaining humans'
games — full world, no shroud, no fog — and the end screen comes when every human has lost.
The sim already lifted a TOPPLED heir's veil (`out` → the all-ones mask), so a board's half
existed; a war's loser is not toppled (his court swears), and the run declared the WHOLE table
lost the moment seat 0 was — and, being sworn to his conqueror, told him he had won when the
conqueror walked. Two things found by the suite that holds it (`a seat that has lost watches`,
17 checks on a hosted war with two fake guests, courts broken by a minor lord's men pinned
through the take): the shader-fog path skipped the veil block for `allSeen` and left `uFogOn`
at 1 with the last texture — a spectator on the shader path kept the veil of the frame he fell
on, frozen (`R.debugFogOn` is the probe); and the guest command queue was drained INSIDE the
step loop, so with the world halted no guest command applied — a guest could call a halt and
never lift it, measured (`lifted: false`) before the drain moved out of the loop.
Rejected: ending the table when SEAT 0 loses (the old rule — a LAN table where the host fell
first ended for everyone); giving a war's loser the sim's all-ones mask (his court's driver
would read it and play omniscient); leaving his colours to the realm (the enemy turned gold).

## The Bombard, the walls and the standards — refereed changes (2026-08-18/19)

### NO GUN OUT-REACHES THE TOWERS

The designer's report from play: "cannons shouldn't have a longer reach than towers — it's now
too easy to take down walls and towers from afar and there is no good counter measure for
someone who defends." The Bombard was 365, sold on out-ranging every tower ever raised (Ballista
350, Watchtower 250-300, Cannon 232-252). It is 240 now — under a plain level-1 Watchtower —
with `aggro` 200 under it so `acquire`'s `max(aggro, range)` rule still has a kind to show on.
Its reach still beats the Seat gun (200), so a court without towers can be shelled from its rim.
The bombard suite reads its distances off the table now; measured while rewriting it: a gun
dropped between `range` and `range + 36` (the throne's radius) acquires the throne and CLOSES to
range before it fires (42 units at reach − 8), so a stand-off is asked for at range − 8.

### THE ARMY AT HOME STANDS ON ITS WALLS, and a hall joins a standard

Two reports in one message: bots "seem unaware they can / should place archers / sorcerers on
walls and in towers", and "they create new flags for every hall they build — fine for a bot,
but when a city is conquered having so many flags to manage is hard for a human". Both were
true. `postWalls`/`postTowers` post a man by his ORDER and the heirs' home banner was the city
site, so a heir's own curtain stood empty (rig: julian with a finished run and three enemy
soldiers at his gate — 0 posted, 0 on the stone of 9 before; banner at the run, shooters on the
parapet after). And `joinCo` gives a hall built with no company a fresh one, which every heir
did (rig: benedict, four minutes, 4 halls → 5 companies before; ≤ 2 after).

`node sim.js` before → after (same seed, both changes and the Bombard together):
mirrors benedict 8-11 (40%) → 10-10, bleys 11-8 → 13-7 (65%; n=20, noise); gradient
benedict/random 18-0 → 17-1 (2 draws each), benedict/greedy 19-1 → 17-3, greedy/random 20-0 →
20-0; contested Pattern share 69% → 72% (target 50, tolerate 25-75 — at the lip, unchanged in
kind); convergence greedy mirror `med 14.3m [castle:7 timeout:1]` → `med 24.5m [castle:6
timeout:2]` on eight games — measured apart at sixteen games and the 45-minute cap, greedy v
greedy is 8-8 med 17.9m [castle:16] both WITH the home post and with it switched off
(`AMBER_NOPOST=1`), byte-identical: greedy never plants a home post at all and the eight-game
difference is seed noise. The ladder re-pasted `corwin, julian, brand, bleys, benedict`: corwin,
the gun heir (Cannon Towers and Bombards by doctrine), fell from 7 wins to 4 — the price of the
designer's call, and he was already the first rung; bleys rose 11 → 15.

### THE BOARD IS FOUR QUARTERS (2026-08-19)

The designer's rule for a skirmish: "starting positions should be in corners with springs equally
distributed in all 4 quarters of the map (2 springs per quarter, starting springs included)".
Before: fourteen springs scattered over the landmass with a separation rule, and the Seats chosen
by scoring hundreds of candidate pairs on what each side had in reach (`maxSkew` 6) — a search
that could only narrow a skewed scatter. After: `placeCities` seats each heir in a corner
(`cornerBox` 520 from it, `inland` 300 from the edge; two heirs on a DIAGONAL or the world is
rerolled — a fallback to the adjacent pairs put two heirs 880 apart on six seeds in a hundred and
twenty, measured; three and four take corners of their own), the fairest set by the ROOM around
them; then `placeNodes` deals exactly `perQuarter` (2) springs a quarter — a Seat's own first, at
arm's length with a Gate ring, the rest at random outside every writ. Measured over 600 builds
(200 seeds × 2/3/4 heirs): 0 failures, mean extra attempts 0.2/0.3/1.6, every quarter 2 springs,
every Seat in its corner, two heirs ≥ 1803 apart, three/four ≥ 980; worldgen fell from 60-100ms
to 8-14ms because the scatter-and-score is gone. Twelve headless rigs had assumed the old
geometry (phantom crews pushed 520 PAST a corner Seat stood off the map; a flag 380 "into open
country" stood on the edge of the world; a sweep's first legal run lay beside the opening hall
or inside the Seat's own ground; a run of exactly one unit measured 150.00000002 along a new
angle and rounded to two crews — fixed in the sim with a hair of tolerance under the ceiling)
and were made to ask their questions toward the middle of the board.

`node sim.js` after (against the 758fb49 numbers before): mirrors benedict 10-10 → 8-12, bleys
13-7 → 9-10; gradient benedict/random 17-1 → 16-3 (80%, a hair under the ">85" the principles
name, with one timeout), benedict/greedy 17-3 → 17-3, greedy/random 20-0 → 19-1; contested
Pattern share 72% → 70%; convergence greedy mirror `med 24.5m [castle:6 timeout:2]` → `med 35.4m
[castle:6 timeout:2]` (the diagonal is a longer road for an army that never walks), julian mirror
14.2m → 14.3m. The LADDER turned over — `bleys, corwin, julian, benedict, brand` — the walkers
(brand 11 → 17) gained what the marchers (bleys 15 → 7) lost on a board where the Seats stand
further apart than the old pairs did; re-pasted, not adjusted.

### A WAR HAS TWO SIDES — OR AS MANY AS IT HAS HEIRS (2026-08-19)

The designer's TODO: "the reach war should also still have a free for all mode". Nothing in the
sim knew the word "team" — `World.lost`, the verdict at `endMatch`, `refound` and the coalition
against a walker all read `world.sides` as a list — so a free-for-all is `REALM.setup` accepting
any number of sides (seat 0 leads the first, a seat named twice keeps its first side, empty
sides dropped, a lone side given an enemy), `{ffa: n}` as a setup spec, a TWO SIDES / FREE FOR
ALL toggle on the setup screen and `#lan-ffa` in the lobby. Held by six headless checks and the
setup and lobby flows in the browser.

### THE EDGE OF THE WORLD IS A COAST OR A RANGE

The designer's TODO and then his correction while it was being built: "game maps should have
their edges be either oceans (with a coastline) or large mountain ranges, so that the limits feel
more natural (no black space beyond the world limit)"; then "the coastline shouldn't be a
straight line and should have cliffs or beaches, it can have estuaries with rivers going to the
oceans. don't allow panning too much past the edge so that we don't need to provide texture —
our work should only be needed for a small fraction of the screen when at a corner or edge."
The first cut held the last two cells of a sea edge under the waterline and let the old soft
rim do the rest — a straight coast; the second deals the water's depth along the edge by noise
(2-13 cells, two octaves), a beach or a cliff at the waterline in long stretches
(`cliffShore`), and estuaries where a narrow noise peak cuts `inletDeep` cells further.
Measured over 450 builds: 0 failures, every border cell water or crag, the water's run along a
coast spanning a median of 5 cells and never under 3, both beach and cliff on every world with
a coast.
The renderer's skirt went through three pictures before it was right: (1) the ground texture
with clamped UVs past 0..1 — every row of the skirt one edge texel, a barcode; (2) vertex
colours averaged along the bake's border rows — a smooth sea, but a range painted BLACK,
because the bake paints crag ground near-black (10,8,16) and it is the instanced rocks that
read as stone on the map; (3) the rock palette for a range, ridged by folded value noise and
strewn with instanced rocks where it climbs (a flat rise read as a lit shelf; a 120-unit lattice
flattened 190-unit ridges; the slope arm's strata painted the first climb near-black — all
measured on screenshots). And the camera: `overscroll` 0.42 → 0.06 was not enough, because the
scroll box is not the picture — a pitched camera on a landscape screen sees ~2.9 `viewW` across
the aim row and 40% of the screen lay past the right edge with the box flush against it — so
`clampCam` asks the real frustum's aim row where its ends fall and walks the camera back, or
centres a world narrower than the screen. A phone at the home corner shows the Seat in the
upper third with a sliver of sea beside it.
`node sim.js` on the coast/range boards (against the corner boards before): mirrors 40/45 →
60/60; gradient 80/85/95 → 100/80/80 (monotone still); contested Pattern share 70% → 77% —
TWO POINTS OVER the 25-75 tolerance (n≈62 committed walks, σ≈5): read as the lip rather than a
breach, flagged for the designer rather than tuned blind — the three content numbers the
principles name moved the share four points or less when they were swept; convergence greedy
mirror 35.4m/2 timeouts → 15.8m/1; ladder re-pasted `benedict, corwin, brand, bleys, julian`
(benedict 13 → 7, julian 12 → 16) — the order is volatile against the board's shape at six games
a matchup, which is what the principles say a ladder is.
Found by the gate on the coast boards: **benedict gave up looking for the man.** Every doctrine
gated its scouting on `unexplored > 2` (or `> 3`), written for a board of twenty-four sites where
the rival Seat was found long before the last two; on a board of four quarters (eighteen sites,
the rival in the far corner) the last two unexplored ARE the rival's Seat and the spring beside
it, and benedict — 89 men strong — stopped seeking and never laid eyes on him on three seeds of
five. `unseen(v, n)` keeps the search alive while the Seat is unfound; found at 115s on seed 1
after. Twelve more rigs were made to ask their questions on the new ground (a muster that spills
ten units further in a cramped corner court; a rim probe moved to a spec board, since no grown
rim is dry any more; the three-run curtain's home found with a finer sweep; the Squire's hold
measured without the answer to a walk, which is exempt by rule; a marker at a throne with the
rival's opening men buried first).
`node sim.js` with the search kept alive (`unseen`): mirrors 45/60; gradient 95/75/80;
contested Pattern share 74% — back inside the band; convergence greedy 15.8m/1 timeout; ladder
`corwin, benedict, brand, bleys, julian` (re-pasted).

### A WALKER FORTIFIES FIRST, AND HOLDS HIS HOME (2026-08-19)

The designer's chronicle at PRINCE (seed 3090875189, 16:34, won by castle): "this was supposed to
be the hardest but it was too easy. I think he tried to walk too early and didn't even fortify
before walking." The table says it exactly: Brand stepped on at 3:57 with 10 works, 43 men, 151
in the bank and 28 a second — the old sum (bank + income × the walk's length ≥ 1.1 × the drain)
was just met; the player razed three of his Gates by 4:56, his income fell to 14, his purse was
nought from 5:00, he mustered nobody for the rest of the walk, his army went 51 → 9 → 1 by 6:40
while assaulting the player's court, and the player walked into an empty yard and threw the
Shrine down at 52%. Three gates now: `WALK_INCOME` 0.8 on the income half of the sum (which
alone would have refused that 3:57 walk: 28 × 0.8 × secs < 1.1 × 22 × secs), `WALK_TOWERS` two
finished towers at home (a `fortify` want the crew takes up the moment the doctrine wishes to
walk; on the rig, brand stepped on with one tower before and two after), and a walker's banner
is home with `striking` off. Held by 'a walker fortifies first, and holds his home' (fails on
the old doctrine at the towers).
The third gate — the walker's banner home, his assault off — measured on the full run: contested
Pattern share 97% (2 by force of 58), mirrors 55/60, gradient 100/85/80: a fortified walker whose
army stays on his walls cannot be stopped by the heirs' answer, which is the Pattern as a
formality. REJECTED; kept behind `AMBER_WALKHOLD=1`. The two gates that stay were measured
alone next (see below).
The two gates that ship (`WALK_INCOME` 0.8, `WALK_TOWERS` 2), on the full run: mirrors 65/60,
gradient 100/80/80, contested share 81% (10 by force, 43 by the Pattern), convergence greedy
15.8m/1 timeout, ladder `corwin, benedict, bleys, brand, julian`. Isolated: towers 0, 1 and 2
read the same (83/83/81) — the share is the INCOME MARGIN's, because a walker who does not
starve is one the heirs' answer rarely stops; an earlier and smaller answer (`AMBER_WALKANS=5
AMBER_WALKARM=5`) read 81% too. The designer chose to ship it (option A, 2026-08-19) and to
read the band as a statement about the heirs' answer to a walk, which is the next job.

### The country: AMBER in the middle, the heirs in the corners, two roads out of every court

The designer, 2026-08-19, with a photograph of the LAN table: two columns for the sides; the four
heirs (bots or humans) in the four corners of the country; every city within reach of at least
two others; AMBER in the middle. Before: AMBER was the neighbour graph's centre by hops (not the
map's), the contenders the four courts furthest from it by hops, a city could have one
neighbour. Measured after over 30 seeds: 0 failures, 0 extra attempts, ~310ms a country, AMBER
within 1600 of the centre on every seed, the corner courts within ~450 of their corners, no city
under two neighbours.

### AN IDLE ARMY ANSWERS A RAIDED WORK, AND RAIDS IN KIND (2026-08-19)

The designer's second chronicle at PRINCE the same day (julian, toppled at 6:38, "way too easy"):
the player's raid company razed four of julian's Gates by 4:12, julian's income sat at 7-16 all
match, his army at 5-20, and his war body never left home nor raided back; the player held seven
springs to his two. Two clauses in `decide`, on a board as the war had them for minor lords:
`troubleAt` sends the war body to a work of his under attack (outranking an errand), and `raidAt`
sends an idle army of `RAID_MEN` (8) or more to the rival's nearest outlying Gate (not under his
throne's guns, not under the footing's hold). Rig: julian's banner went to his raided Gate inside
forty seconds and to the rival's Gate when every spring beyond his writ was the rival's.
`node sim.js`: mirrors 50/55 (bleys 3 timeouts of 20), gradient 95/80/75, contested share 81% →
87% — the drift the designer's option A already accepted, now wider: raiding armies answer walks
less, and the heirs' answer to a walk is the next job; convergence greedy 13.7m/0 timeouts; ladder
`corwin, bleys, julian, benedict, brand`.

### THE ANSWER TO A WALK (2026-08-19)

The designer: "do the answer to a walk". Traced (benedict v brand, seed 1000): brand stepped on at
7:50 with 63 men and four towers, benedict's 40 answered at the Shrine behind the throne and not
one got within 300 of it in five minutes — they died in thirties on the court's guns and were
replaced, and the walk finished at 96%. Seed 7: benedict's whole army (92 men, goal at the Shrine)
stood at HOME for ninety seconds — his own thirty-eight-unit wall stub across the muster ground,
raised short of essence, had jammed them between the hall, the Seat and the stone (the centroid
did not move; with the stub removed it marched 250 units in ten seconds). So: `spanFor` raises
no run under `WALL.gateMin + 16`; the answer goes out at the walk's first tick (`WALK_ANSWER`
10 → 1); and `answerAt` sends a smaller army for the walker's outlying Gates (starve him — the
drain comes before the muster) and a plainly bigger one for the Shrine. Referee: mirrors 65/55
(benedict 2 timeouts), gradient 95/70/75, contested share 87% → 90% — NOT inside the band and not
moved by any of it: when the walker is the bigger army nothing an equal or smaller one aims at
stops him inside five minutes. The levers left are the walk's length (`AMBER_WALKRATE` added to
`shrine.rate` for the referee; 0.26 measured next) and where a Shrine may stand.
Also from a third chronicle (brand at PRINCE, seed 1443391195, the player won by the Pattern at
17:47): brand's doctrine never attacks — "leave him alone and he simply wins" — and with his
Gates raided and every free spring taken he sat at home with a hundred men and an income of
seven for ten minutes (`armyIdle` was false for a gate errand to a spring the rival held); a
raid now goes out with twice `RAID_MEN` whatever errand stands. Traced against greedy on that
seed: raids at 8:00, a guard at 9:00, then a walk won at 14:17.
Measured with the walk a quarter longer (`AMBER_WALKRATE=0.26`, 6.4 minutes against 5.2): the
contested share came back to 71% — inside the band — with mirrors 65/50, gradient 90/70/75,
convergence clean, ladder `benedict, corwin, bleys, julian, brand`. The walk's LENGTH is the
lever the answer could not be; it is the designer's to pull, since it is the human's clock too.

### A FORWARD GATE IS DEFENDED, AND THE JEWEL ANSWERS A RAID (2026-08-19/20)

The designer's fourth chronicle (julian at PRINCE, seed 3214443246, toppled 10:04): "better but
still relatively easy", then "he could have used the jewel or trump more / better", then "watch
towers next to gates are good, but better when manned with archers or sorcerers. I've also been
wondering for a while whether we should make towers a bit stronger." The table: nine of julian's
Gates razed (Cold Cistern and Whispering Font twice each), each rebuilt naked — ~900 essence fed
to the raid — income 28 → 3, army never past 27 against 126, yet 192 of the player's dead: he
traded well and lost the economy. And the Jewel: 200 essence banked, storm off cooldown, never
cast — `stormDefend` reads `v.threats`, the THRONE's radius, and the raiders were at his Gates.
Shipped: `gateLost` (adaptive towers — towers-always measured income 17 against 66 unraided over
the same eight minutes); the errand standard planted ON a spring's tower (rig: 10 men garrisoned,
a full tower); the Jewel's works-raid fallback (rig on the chronicle's seed: every cast on the
raiders); tower hp 960 → 1150, level-1 arrow 10 → 12. TRAP FOUND BY THE REFEREE: the fallback
also gave GREEDY — `storm: () => null`, the ruler — a Jewel it had renounced, and benedict over
greedy read 55% (target >65). `neverStorms` guards it; 79% (n=24) with the guard. The Trump was
left alone: julian's clause is sound and he was broke by the time it could fire — the economy
fix is the Trump fix.
`node sim.js` with all of it (adaptive towers, garrisons, the guarded Jewel, hp 1150 / arrow 12):
mirrors 60/75 (bleys' mirror runs high and hot — all castle — across today's runs: 50-75 at n=20,
watch it), gradient 95/95/75, convergence greedy 11.8m clean, contested share 92% (the known red;
the walk-length lever is the designer's), ladder re-pasted `bleys, benedict, corwin, julian,
brand`.

### THE GRADIENT WAS TRIMMED, AND THE PLAYER'S OPENINGS REPLACED IT (2026-08-20)

The designer's challenge, verbatim: "Benedict vs. Random doesnt sound worth measuring and
Benedict vs. greedy is a sanity check more than anything. greedy vs. random might have been
helpful in early stages of game development, but doesnt sound so useful now." The evidence
agreed: four chronicles in two days beat the strongest heir easily while every gradient number
read green — the construct the gradient measures (bot-vs-bot competence) failed to predict the
thing that matters (hard for a human). benedict-vs-random read 90-100 on every run this file
records; its one catch (scouting) is a dedicated suite. Kept: benedict-over-greedy at full
weight (the tripwire — it fired a true positive that same week, the Jewel leak, 55%);
greedy-vs-random at six games. The freed third became `playProbe`: the standing-raid rig from
the chronicles, run against every heir with floors. THE FIRST RUN PAID FOR IT: julian failed at
the chronicle's own numbers (9 Gates lost, income 7 — at his natural economy the adaptive
towers are not enough), benedict failed beside him (8 lost, income 7), bleys and corwin passed
(3 and 6 lost, income 30 and 26), and brand exposed a corner (0 casts — his kept Gates never
showed him the raiders; the floor forgives an heir the raid never bit). julian's and benedict's
floors are the next AI work, by name.

### THE WALK IS LONGER (2026-08-20)

The designer: "make the walk longer as proposed to reach 50% chance of stopping the walk."
`shrine.rate` 0.32 → 0.26 (5.2 → 6.4 minutes) as the game's number; `AMBER_WALKRATE` stays the
referee's override. The contested share on the full run that shipped it is recorded below.
The new suite's first full run (rate still 0.26 then): mirrors 60/75, tripwire 85%, smoke 67%,
probes julian FAIL (9 lost, income 7) / benedict FAIL (8, 7) / bleys ok (3, 30) / brand ok /
corwin ok. The rate search that followed, full runs each: 0.26→88%, 0.20→81%, 0.16→65% — INSIDE
the band — with the price on the same table: the field walks in 30% of matches (was ~48) and
medians run 15-19 minutes. Shipped 0.16 (a 10.4-minute walk; the designer asked for 50% and 65
is the closest length alone reaches — conditioning on "reached halfway" selects for fortified
walks, so the curve flattens). The next lever if 50 exactly is wanted: where a Shrine may stand.
Ladder re-pasted `benedict, corwin, bleys, brand, julian` from the 0.16 run.

### DON'T FEED THE GRINDER, AND A SPRING LOST TWICE IS WRITTEN OFF (2026-08-20)

The fifth chronicle (julian, seed 619490457, PRINCE, won by castle at 17:25, "more interesting
but still a relatively easy win"). The table: julian DEAD EVEN at minute 3 (21 income / 13 works
/ 30 army against the player's 21 / 13 / 35), then flat while the player tripled — army never
past 38, income 21 → 3, works 15 → 9 — yet 356 of the player's 375 dead were his: he traded
superbly in packets of 10-20 for fourteen minutes and it changed nothing, because the commit
floor (22) was never alive at once after minute five, so `striking` never fired, so the player
banked 14,818 essence unpressured. And the springs: Singing Spring, Glass Rill and Salt Spring
rebuilt into the player's farm repeatedly, now at gate-AND-tower prices. Shipped: `lostAt`/`writtenOff` only —
two Gate deaths at one spring write it off (the set-diff of gated springs names which died), and
an A/B at n=24 on identical seeds shows it costs nothing against the baselines. CONSOLIDATION
WAS REJECTED BY THE TRIPWIRE, and this entry is the record: as first written (outnumbered
1.5x+4 → army home, muster pools, guard/raid/errand suspended) benedict-over-greedy read 40%;
refined (a dozen seen required, the errand running through) 46%; HEAD on the same 24 seeds 63%.
Against a MASSING bot, ceding the map to pool at a fixed floor loses more than the trickle ever
did — benedict's old behaviour was TRADING at the choke, and his trades were never the problem;
production was. Grinder rig for the record (40 campers, 200 hp): dead 217 → 191, army at ten
40 → 53 — a modest rig gain that did not survive the matchup. `AMBER_CONSOL=1` keeps it for the
rig. The honest trickle-vs-human fix is BATCHED REINFORCEMENTS — men pooling at home until a
body of eight or so forms, the STANDING army untouched — which needs the muster's own support
and is in TODO. The raid probe after this batch: benedict passes income (7 → 21); julian still
fails (9 lost, income 7 — the probe's raiders are an infinite spawner chasing his newest Gate,
deliberately adversarial) and stays the named work.
