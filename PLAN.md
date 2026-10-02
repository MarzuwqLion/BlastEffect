# Neo Atlantis MVP: plan

Single-player third-person shooter, one level (Hathor's Reach), browser
build deployed to GitHub Pages. Each milestone ends with: `npm test`,
`npm run build`, a headless Playwright run with screenshots
(`npm run shots`), PLAN.md updated, commit.

Status legend: `[x]` done, `[ ]` not yet, `[~]` partially done (see note).

## Milestones

- [x] **M0 Scaffold.** Vite + TS + Three + Rapier, `src/config.ts`,
  `src/strings.ts`, Vitest, Playwright screenshot script, Pages workflow.
  *Accept:* `npm run build` and `npm test` pass; blank scene renders in
  headless Chromium with no console errors.
- [x] **M1 Graybox movement.** Capsule stand-in, Rapier character
  controller, run/sprint/jump-jet/hover/dash, over-the-shoulder camera with
  aim zoom, shoulder swap and wall collision, automatic cover (low + wall).
  Input map for KB/M and gamepad, last-device tracking.
  *Accept:* graybox screenshots from gameplay camera; camera never inside
  walls; cover tuck triggers near a cover box with weapon out.
- [x] **M2 Shooting + grunt.** SMG and rifle (hitscan, mags, reload,
  finite ammo, crates), hit markers, recoil, muzzle flash, tracers, melee.
  Grunt AI (state machine, cover points, nav grid, attack tokens,
  telegraphs) firing dodgeable bolts. Player shield/health.
  *Accept:* unit tests for damage math; grunt dies in ~1.5 s of SMG.
- [x] **M3 Defense layers.** Shield/armor/health layers with icon+colour
  bars, shield trooper (push + flank), heavy (suppress, weak point).
  *Accept:* TTK feel-target tests pass for all three types.
- [x] **M4 Powers + combos.** Pull (primer), Throw and Charge
  (detonators), combo explosion with hit-stop, shake, flash, sound.
  *Accept:* combo unit tests; combo works on every enemy type once
  defenses are stripped (scripted Playwright check).
- [x] **M5 Protagonist.** Code-built Imani from docs/protagonist.md:
  rigid-skinned armor segments, curls, camo shader, SMG with live red
  readout, slung rifle. Core clips (idle, run, sprint, aim, fire, dash,
  jump, hover, cast, hit react, death) + procedural layers (aim offset,
  recoil, breathing, foot planting).
  *Accept:* gameplay-camera and close-up screenshots compared against
  docs/protagonist.md.
- [x] **M6 Dialogue + dock.** Typed dialogue trees, validator test,
  typewriter UI (mouse/keyboard/gamepad), camera framing, flags/events.
  Dock scene with contact and control prompts.
  *Accept:* validator test passes; dock dialogue screenshot.
- [x] **M7 Level art.** Strip, club, terrace: Egyptian-inspired
  architecture, neon, holograms, wet streets, fog, bloom, dome with sea
  life. Checkpoints per section, quality presets, instancing.
  *Accept:* medium preset < 500 draw calls / < 1.5M tris in every
  section (debug overlay readings in screenshots).
- [x] **M8 Boss.** The Crocodile: 3 layers/phases, stolen ka powers,
  telegraphs, reinforcements, named bar, pre/post dialogue.
  *Accept:* boss is beatable via ?section=5; length estimate 3-4 min.
- [ ] **M9 UI, audio, polish.** Title/pause/settings/death/end screens,
  synthesized SFX + music via manifest, extra animations, README,
  deploy check.
  *Accept:* full run start to finish via scripted check; no console
  errors; README complete.

## Progress log

- M0: scaffold done. Engine systems (physics, input map, camera rig, player
  controller with cover, weapons, powers, enemies + AI, bolts, FX, audio
  synth + procedural music, HUD, dialogue UI, menus, director, all five
  section layouts) are written in their final structure and build. The
  protagonist is still a capsule stand-in (`src/character/CapsuleAvatar.ts`)
  and the boss is a stub (`src/enemies/Boss.ts`).

- M1: measured in headless runs (`node scripts/shots.mjs movement camera cover gamepad`):
  run 6.0 m/s, sprint 9.0 m/s, jump apex 2.53 m, hover 1.52 s, dash 6.1 m
  with cooldown respected, camera stays out of walls (pushed in to 0.95 m),
  low cover tuck/pop/slide/release, high cover peek past the corner, no
  cover without the weapon out, fake gamepad drives move/jump/look/LB/LB+RB/Y.

- M2-M4: in-engine checks (`node scripts/shots.mjs combat fight`): live SMG
  time-to-kill grunt 1.42 s, trooper 3.52 s, heavy 9.8 s; rifle on heavy
  3.6 s, on its weak point 2.4 s. Snare is blocked by shields; Snare+Lance
  and Snare+Surge combos land on grunt, trooper and heavy once stripped.
  Grunts move cover to cover, telegraph (laser + glow, >= 0.6 s) and fire
  dodgeable bolts with at most 3 attack tokens in use. Fixes found by the
  runs: nav grid needs one physics step before building; avatar matrices
  must update even when a frame isn't rendered.

- M5: Imani lives in `src/character/protagonist/` behind the Avatar
  interface (`src/character/types.ts`). Rigid-skinned body (one draw call)
  with shader digital camo, sculpted head with lids/irises/brows, instanced
  curls (count per quality), SMG with a live 7-segment readout, rifle slung
  down her left side. Clips in `clips.ts`, blended in two layers by
  AnimationMixer; weapon stances + two-bone arm IK put the hands on the gun;
  foot planting, aim offset, recoil, breathing, blink, talk, look-at are
  procedural. Extras done early: reload (hand to mag, mag drops), melee
  strike, a cast pose per power, low/high cover poses.
  Checked with `node scripts/shots.mjs closeup anims` against
  docs/protagonist.md (front, face, back, hands, pose sheet m5-poses.png).

- M6: dialogue trees live in `src/strings.ts`, validated by
  `tests/dialogue.test.ts`; UI in `src/ui/Dialogue.ts` (typewriter, 1-4 /
  arrows / mouse / D-pad + A). Camera frames each speaker close-up
  (`Game.onDialogueLine`). Scripted run (`node scripts/shots.mjs dialogue`)
  walks to Odette, talks, picks the schematic: flags set, gate opens,
  objective advances. Title + press-any-key screens verified.

- M7: textured, lit sections (sandstone/lapis/relief walls, glyph signs,
  neon, holograms, puddled streets, stalls, facades with lit windows, dome
  creatures), per-section ambient light, pooled point lights reassigned to
  the nearest anchors, sections outside current+-1 hidden. Medium preset
  (`node scripts/shots.mjs sections`): 124-244 draw calls, 268-282k
  triangles per section. Found and fixed: stair colliders sloped the wrong
  way (enemies could not path onto raised floors; verified the player and
  nav climb every staircase now).

- M8: the Crocodile (`src/enemies/Boss.ts`, model in `BossModel.ts`).
  Shield 3000 / armor 3000 / health 2800, one phase per layer. Attacks are
  stolen ka powers, all telegraphed >= 0.8 s: volley (bolt fan), slam
  (ground ring you jump), drag (tether that yanks you out of cover; blocked
  by cover, broken by a dash), lunge (charge along a floor stripe; crashing
  into a wall or column stuns him), homing orbs. Each broken layer: roar,
  leap to the dais, invulnerable channel while reinforcements come through
  the side doors. Phase 3 is primable (Snare in place) so combos work; big
  bursts and combos stagger him. Weak point is the ka reservoir above his
  shoulders (marked, and worth more, with Yaw's intel). Pre/post dialogue
  frame him from below; retries skip the intro. Length: the model in
  `tests/boss.test.ts` estimates ~225 s; a perfect-aim bot
  (`node scripts/shots.mjs boss`) finishes in ~110 s, ending on the end
  screen with no console errors. Also fixed: dissolved enemies left disabled
  colliders that queries still hit (invisible blockers); combo damage on
  the boss now goes through his phase logic.

- M9 (in progress): full playthroughs by a bot, title screen to end screen,
  `node scripts/shots.mjs playthrough` (keyboard/mouse action paths, real
  Enter presses on the menus) and `PAD=1 ... playthrough` (everything
  through a simulated gamepad: sticks, triggers, LB/RB, A/X/Y). Both
  finish with no console errors, ~31 kills and 8-10 combos, Yaw met and
  the intel flag paying off at the boss. Found and fixed on the way: A*
  gave up on multi-level detours (expansion budget) and smoothed paths
  could skip a level; paths hugged stair sides (edge cost + edge-aware
  smoothing); the player climbed stairs at 1.6 m/s (wall-slide guard
  fired on slopes); NPCs now turn to face Imani and the dialogue camera
  stays out of walls; enemy barks are wired up. Death -> retry restores the
  checkpoint and resets the encounter. README written. Pages workflow
  split so the build job passes until Pages is enabled in the repo.

## Notes for a fresh session

- Start the game at any section: `?section=1..5`; invulnerable: `?god=1`;
  preset dialogue flags: `?flags=intel_weakpoint,yaw_met`.
- Screenshots: `npm run shots` (writes to `docs/screenshots/`).
- Headless Chromium is available at `/opt/pw-browsers` (Playwright 1.56).
