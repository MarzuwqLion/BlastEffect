# Neo Atlantis: Hathor's Reach — design review

Written from a full audit of the build at commit `b23ddcf`: a recorded
start-to-finish run (one frame every 7 seconds), close-ups of every
character type, every menu, a second run with an aim-bot that never takes
cover and is not invulnerable, and a read of the tuning, combat, AI,
director, HUD and story text.

The point of view is a developer deciding what to fix before this goes in
front of players. Grades are against "a short commercial-quality browser
shooter", not against a hobby project.

## Grades (before this pass)

| Area | Grade | One line |
| --- | --- | --- |
| Mechanics | B- | A good kit that the game never forces you to use. |
| Graphics | C+ | Strong setting, but you cannot read the fight. |
| Story | B- | Writing is the best thing in the game; the delivery is the weakest. |
| Polish | B- | Solid plumbing, visible seams. |
| **Overall** | **B-** | A promising vertical slice with a soft middle. |

## Mechanics: B-

What works: movement has range (jump-jet, hover, dash) and responds well;
cover without a button is a smart call; two guns with clear jobs (SMG for
shields, rifle for armour); the snare-then-detonate combo is a real hook;
the boss has three distinct phases; grenades and ka cells add movement.

What holds it back, in order of damage:

1. **There is no threat.** An aim-bot that stands in the open and never
   takes cover finishes the whole game without dying. It took 839 damage
   in six minutes against a 100-point shield that refills in two seconds.
   If cover, dash and powers are optional, they are decoration. There is
   also no difficulty setting to fix this for players who want it.
2. **Every fight is the same fight.** Walk into a box, enemies appear out
   of thin air already shooting, kill them all. Four fights, 24 enemies,
   three enemy types, and all three stand at range and shoot. Nothing
   runs at you, nothing punishes peeking from 60 metres, and you never
   get to start a fight on your own terms.
3. **Skill earns nothing.** A combo, a headshot kill and a sloppy body
   shot kill all pay the same: the enemy is dead. No shield back, no
   cooldown back, no score, no rank, no best time. There is no reason to
   play well and none to play again.
4. **The signature move is rationed.** Power cooldowns are 7 to 10
   seconds and a Snare that hits a shield costs the full cooldown for
   nothing. The combo fires about ten times in a full run.
5. **Checkpoints are only at section starts.** Dying in the second strip
   fight replays the first one.
6. **The first fight teaches by paragraph.** Three text boxes appear in
   the middle of the screen while you are being shot at.

## Graphics: C+

What works: the setting is original and consistent (Egyptian deco under a
glass dome, neon, caustics on the dome); Imani is a characterful hero
model; the club floor, the Glass and the signs are good moments.

What holds it back:

1. **Enemies are black.** Six metres from the camera the three crew types
   render as dark silhouettes with a small orange visor. Their armour
   colours are invisible because the palette is near-black and nothing
   lights them. Imani only reads because a hidden light follows her. In a
   shooter the targets must be the easiest thing on screen to see.
2. **No depth.** Fog is darker than the scene, so distance turns to
   black instead of haze. Interiors (the club, the stairs out of it) fall
   to pure black a few metres from any lamp.
3. **Hits wash targets out.** The hit flash plus bloom turns enemies and
   the boss into white blobs exactly when you most need to see them.
4. **No finishing pass.** No anti-aliasing at the default quality, no
   grade, no vignette, no grain.
5. **The boss reads small.** He is 2.9 m tall in a 50 m arena and spends
   the fight 20 to 30 m away, under a HUD marker.
6. Characters are flat-shaded primitives. That is a style, but enemies
   carry very little detail, and animation is procedural and stiff.

## Story: B- (writing B+, delivery C)

What works: the dialogue is sharp and economical and every character has a
voice ("You don't stop a tide by standing in it"). Choices have gameplay
consequences. The Crocodile is a good villain. The epilogue changes with
what you did.

What holds it back:

1. **No opening.** Title, Start, and you are standing on a platform with
   "Talk to Odette". Nothing sets the place, the hour or the stakes.
2. **Mari is never seen.** The whole story is about finding her and she
   exists only as text in a side panel.
3. **The ending is a wall of text.** With the optional content it now
   overflows the screen: the title and the Play Again button are cut off.
4. **Conversations are filmed badly.** The camera slides between the two
   speakers through walls and pillars instead of cutting, and nobody is
   lit for their close-up.
5. No voices of any kind, so long conversations are silent reading.

## Polish: B-

What works: prompts follow the device, the settings and quality fallbacks
are careful, the UI style is consistent, and the project has real
automated checks.

What holds it back:

1. The end screen overflow above is a shipped bug.
2. Enemy call-outs draw on top of tutorial prompts.
3. No save. Closing the tab at the boss means starting over.
4. No difficulty, no screen-shake option, no stats, no results.
5. A static objective diamond sits on the boss for the whole fight.

## What this pass changes

In priority order. Each item answers a finding above.

**See the fight (graphics 1-5)**
- Rim light and brighter palettes on every enemy type, colour-coded.
- Lighter depth haze so distance silhouettes instead of blacking out;
  fill light in the dark interiors.
- A finishing pass: anti-aliasing, vignette, grain, a light grade.
- Hit flash that tints the edge of the target instead of whiting it out.
- A bigger Crocodile.

**Make the kit matter (mechanics 1, 3, 4)**
- Three difficulty levels. Standard asks for cover; Story is gentler than
  the game was; Veteran is for a second run. The first two fights run
  easier than the setting on all three, and the death screen offers the
  next setting down after three deaths on one stretch.
- Combos refund Snare and restore shield; headshot kills restore shield;
  a blocked Snare refunds half. Shorter cooldowns.
- Run stats, a rank, and best times.

**Vary the fights (mechanics 2, 5, 6)**
- Enemies that have not seen you: start the strip, club and terrace
  fights on your terms, with double damage on the opening shot.
- Two new enemy types: a blade-carrying rusher that flushes you out of
  cover and a sniper with a laser sight on the terraces.
- A checkpoint after every fight, with a slow-motion beat and a result
  card when the last enemy drops.
- Tutorial prompts shortened and moved out of the middle of the screen.

**Tell the story on screen (story 1-5)**
- An opening sequence: the last train in, the city, Imani.
- Mari appears as a hologram at each recording.
- Conversations cut between lit close-ups.
- A voice for every speaker (synthesised speech blips, per character).
- An ending you watch: the Basin fills, then the epilogue one beat at a
  time, then your results.

**Close the seams (polish 1-5)**
- Save and Continue. Fixed end screen. Call-outs moved off the prompts.
  No marker on the boss. Screen-shake and difficulty in settings.

The grades after the pass, and what did not make it, are at the end of
this file.

## Grades (after this pass)

These are my own grades of my own changes, made from scripted runs and
screenshots under a software renderer. Nobody has played this build with
their hands yet. Treat them as a claim to check, not a result.

| Area | Before | After | What moved it | What still holds it back |
| --- | --- | --- | --- | --- |
| Mechanics | B- | B+ | Real threat with a setting for it; fights you can open yourself; two enemies that change how you move; skill pays back; a rank | Still four fights and a boss; one opener per fight rather than real stealth; no weapon or power progression |
| Graphics | C+ | B- | Targets read at any range; haze gives depth; finishing pass; a boss that fills the frame; water, holograms, framed cutscenes | Characters are still code-built primitives with procedural animation; no ambient occlusion or baked light; boxy architecture |
| Story | B- | B+ | An opening; Mari on screen; cut, lit close-ups; a voice per speaker; an ending you watch | The voices are synthesised vowel blips, not acting; faces barely move; cutscenes are camera moves over the level |
| Polish | B- | B | Save and Continue; difficulty and shake options; results; end screens that fit; skip; a way down after repeated deaths | Balance comes from bots, not people; the audio mix has not been heard by anyone; untested on real GPUs and phones in this pass |
| **Overall** | **B-** | **B** | | |

### Evidence

**Is there threat now?** Bots that aim at the nearest enemy and never
take cover, one run each (the numbers move from run to run):

| Player model | Setting | Result |
| --- | --- | --- |
| Perfect aim (the audit's bot) | before this pass | No deaths; 839 damage taken in six minutes |
| Perfect aim | Standard | No deaths, finishing on 9 health |
| Perfect aim | Veteran | 6 deaths: 2 in the club, 4 on the terraces |
| Good aim (about 75% hits, 0.45 s to react) | Standard | Between 0 and 4 deaths (club, terraces, boss) |
| Good aim | Story | 1 death, at the boss |
| Poor aim (20-45% hits), stands in grenade rings | Story | 5 deaths before the ramp below, 1 after |
| Poor aim, stands in grenade rings | Standard | Does not clear the first street in 8 lives |

The last row is why the first two fights now run easier than the chosen
setting (0.7x damage and one fewer shooter on the strip, 0.88x in the
club), and why the death screen offers the next setting down after three
deaths on one stretch. That bot is harsher than a person: it never uses
cover and never leaves a grenade's ring. A person who does neither on
Standard will be offered Story on the third death.

**Does it hold together?** 70 unit tests. Scripted runs, all free of
console errors: a keyboard run and a gamepad run from the title screen
through the opening to the results screen; a real-time boot; new game,
play, reload, Continue, compare; posted crews (noticing, alert spread,
ambush damage) and the Jackal and Ibis against a still and a moving
target; the boss fight; draw calls and triangles per section (139-345
and 269-515k against budgets of 500 and 1.5M).

### What did not make it

- **Voice acting.** Every line is still read, not heard. Adding it means
  one audio file per dialogue line, played from `src/ui/Dialogue.ts` at
  the point where the synthesised blips play now.
- **Authored characters.** The single biggest lift left in graphics is
  modelled, rigged, animated characters in place of the code-built ones.
  That is an asset job more than a code job.
- **More game.** One more arena with a different shape (vertical, or a
  moving one), a mid-boss, and something to spend on (weapon or ka-amp
  upgrades beyond Kwame's one choice) would do more for the mechanics
  grade than further tuning.
- **Stealth as a system.** Crews notice and react, and the opener pays,
  but there are no patrol routes, takedowns or ways to get past unseen.
- **A person's hands.** Difficulty, the Jackal's timing, the Ibis's lock
  window and the rank thresholds were set from bot runs and arithmetic.
  They want an afternoon of real play and adjustment (all of them are
  single numbers in `src/config.ts` and `src/game/RunStats.ts`).
- **Ears.** The new sounds (voices, the train, the alert sting) were
  checked by waveform and spectrum, not by listening.
