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
- [ ] **M1 Graybox movement.** Capsule stand-in, Rapier character
  controller, run/sprint/jump-jet/hover/dash, over-the-shoulder camera with
  aim zoom, shoulder swap and wall collision, automatic cover (low + wall).
  Input map for KB/M and gamepad, last-device tracking.
  *Accept:* graybox screenshots from gameplay camera; camera never inside
  walls; cover tuck triggers near a cover box with weapon out.
- [ ] **M2 Shooting + grunt.** SMG and rifle (hitscan, mags, reload,
  finite ammo, crates), hit markers, recoil, muzzle flash, tracers, melee.
  Grunt AI (state machine, cover points, nav grid, attack tokens,
  telegraphs) firing dodgeable bolts. Player shield/health.
  *Accept:* unit tests for damage math; grunt dies in ~1.5 s of SMG.
- [ ] **M3 Defense layers.** Shield/armor/health layers with icon+colour
  bars, shield trooper (push + flank), heavy (suppress, weak point).
  *Accept:* TTK feel-target tests pass for all three types.
- [ ] **M4 Powers + combos.** Pull (primer), Throw and Charge
  (detonators), combo explosion with hit-stop, shake, flash, sound.
  *Accept:* combo unit tests; combo works on every enemy type once
  defenses are stripped (scripted Playwright check).
- [ ] **M5 Protagonist.** Code-built Imani from docs/protagonist.md:
  rigid-skinned armor segments, curls, camo shader, SMG with live red
  readout, slung rifle. Core clips (idle, run, sprint, aim, fire, dash,
  jump, hover, cast, hit react, death) + procedural layers (aim offset,
  recoil, breathing, foot planting).
  *Accept:* gameplay-camera and close-up screenshots compared against
  docs/protagonist.md.
- [ ] **M6 Dialogue + dock.** Typed dialogue trees, validator test,
  typewriter UI (mouse/keyboard/gamepad), camera framing, flags/events.
  Dock scene with contact and control prompts.
  *Accept:* validator test passes; dock dialogue screenshot.
- [ ] **M7 Level art.** Strip, club, terrace: Egyptian-inspired
  architecture, neon, holograms, wet streets, fog, bloom, dome with sea
  life. Checkpoints per section, quality presets, instancing.
  *Accept:* medium preset < 500 draw calls / < 1.5M tris in every
  section (debug overlay readings in screenshots).
- [ ] **M8 Boss.** The Crocodile: 3 layers/phases, stolen ka powers,
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

## Notes for a fresh session

- Start the game at any section: `?section=1..5`; invulnerable: `?god=1`.
- Screenshots: `npm run shots` (writes to `docs/screenshots/`).
- Headless Chromium is available at `/opt/pw-browsers` (Playwright 1.56).
