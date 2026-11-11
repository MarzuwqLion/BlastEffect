import * as THREE from 'three';
import { CONFIG } from '../config';
import { LevelBuilder, type Door, type HoloLog, type LightAnchor, type Pickup, type Trigger } from '../level/LevelBuilder';
import { NavGrid } from '../level/nav';
import type { SectionDef, EncounterDef, NpcDef, ZoneDef } from '../level/sections/types';
import { Civilian } from '../character/Civilian';
import type { LoopId } from '../audio/manifest';
import { dock } from '../level/sections/dock';
import { strip } from '../level/sections/strip';
import { club } from '../level/sections/club';
import { terrace } from '../level/sections/terrace';
import { basin } from '../level/sections/basin';
import type { Game } from './Game';
import type { Enemy } from '../enemies/Enemy';
import type { Flag, DialogueEvent } from '../dialogue/types';
import { BARKS, BOSS_BARKS, ENEMY_NAMES, MARI_LETTER, MARI_LOGS, NAMES, OBJECTIVES, UI } from '../strings';
import { Npc } from '../character/Npc';
import type { WeaponId } from '../character/types';
import { formatTime, type RunTotals } from './RunStats';
import { settings, type Difficulty } from '../core/settings';

export const SECTIONS: SectionDef[] = [dock, strip, club, terrace, basin];

interface EncounterRuntime {
  def: EncounterDef;
  section: number;
  /** staged: its first wave is standing at its posts, not yet aware of her. */
  state: 'idle' | 'staged' | 'active' | 'cleared';
  /** Staged: the player has been close enough to hear them talk. */
  heard: boolean;
  wave: number;
  waveDelay: number;
  enemies: Enemy[];
  trigger: Trigger;
}

interface SectionRuntime {
  def: SectionDef;
  group: THREE.Group;
  doors: Door[];
  pickups: Pickup[];
  lights: LightAnchor[];
  anims: ((t: number, dt: number) => void)[];
  nav: NavGrid | null;
  enter: Trigger;
}

interface Checkpoint {
  section: number;
  /** Where to put her back (a fight's end, or the section's start). */
  pos: [number, number, number];
  yaw: number;
  weapons: { smg: [number, number]; rifle: [number, number]; current: WeaponId };
  flags: Flag[];
  doors: Record<string, boolean>;
  cleared: string[];
  pickupsUsed: boolean[];
  /** What she was told to do, so a retry mid-section doesn't point back at the start. */
  objective: { text: string; marker: [number, number, number] | null; secondary: string };
}

/** A game in progress, kept in the browser so the player can come back to it. */
interface SaveFile {
  v: 1;
  checkpoint: Checkpoint;
  logs: string[];
  zones: string[];
  hints: string[];
  talked: string[];
  /** Dialogue choices that outlive a death also outlive closing the tab. */
  sticky: Flag[];
  bossIntroSeen: boolean;
  stats: RunTotals;
  difficulty: Difficulty;
}

const SAVE_KEY = 'neo-atlantis.save.v1';

/**
 * Runs the level: builds sections, tracks the current one, starts and
 * clears encounters wave by wave, opens doors, handles pickups, NPC talk,
 * checkpoints and respawn, objectives and tutorial hints.
 */
export class Director {
  readonly sections: SectionRuntime[] = [];
  readonly encounters: EncounterRuntime[] = [];
  readonly flags = new Set<Flag>();
  readonly npcs: Npc[] = [];
  current = 1;
  private checkpoint: Checkpoint | null = null;
  private readonly allPickups: Pickup[] = [];
  private readonly allDoors = new Map<string, Door>();
  private readonly shownHints = new Set<string>();
  objective = '';
  objectiveMarker: THREE.Vector3 | null = null;
  secondaryObjective = '';
  private respawnT = -1;
  private interactNpc: Npc | null = null;
  bossStarted = false;
  bossDone = false;
  /** The intro plays once; retries after a death skip it. */
  bossIntroSeen = false;
  private lightTimer = 0;
  readonly allLogs: HoloLog[] = [];
  /** Mari's recordings found (kept through deaths). */
  readonly logsFound = new Set<string>();
  readonly civilians: Civilian[] = [];
  private zone: ZoneDef | null = null;
  readonly discovered = new Set<string>();
  private letterPending = false;
  /** A fight or a conversation just ended: save as soon as she is standing somewhere safe. */
  private checkpointPending = false;
  /** That save needs no announcement (after a conversation). */
  private checkpointQuiet = false;
  /** Dialogue choices that stick even when a death rolls the flags back. */
  private static readonly STICKY: Flag[] = ['tuned_ka', 'tuned_shield', 'heard_grandmother', 'asked_bas_mari', 'mari_letter', 'all_logs', 'met_bas', 'met_nef', 'met_kwame', 'met_merit', 'intel_shifts'];
  private readonly tmp = new THREE.Vector3();
  musicCue: string = 'dock';

  constructor(private readonly game: Game) {}

  /** Build every section's geometry, physics and props. */
  build(): void {
    for (const def of SECTIONS) {
      const b = new LevelBuilder(this.game, def.index);
      def.build(b, this.game);
      const group = b.finalize();
      this.game.scene.add(group);
      const enter = b.trigger(`enter${def.index}`, ...def.enter);
      const rt: SectionRuntime = { def, group, doors: b.doors, pickups: b.pickups, lights: b.lights, anims: b.anims, nav: null, enter };
      this.sections.push(rt);
      for (const d of b.doors) this.allDoors.set(d.id, d);
      this.allPickups.push(...b.pickups);
      this.game.lights.addAnchors(b.lights);
      for (const e of def.encounters) {
        const t = e.trigger;
        this.encounters.push({
          def: e, section: def.index, state: 'idle', heard: false, wave: 0, waveDelay: 0, enemies: [],
          trigger: { id: e.id, min: new THREE.Vector3(Math.min(t[0], t[3]), Math.min(t[1], t[4]), Math.min(t[2], t[5])), max: new THREE.Vector3(Math.max(t[0], t[3]), Math.max(t[1], t[4]), Math.max(t[2], t[5])) },
        });
      }
      for (const n of def.npcs ?? []) this.npcs.push(new Npc(this.game, n));
      this.allLogs.push(...b.logs);
      for (const c of def.crowds ?? []) {
        for (let i = 0; i < c.count; i++) this.civilians.push(new Civilian(this.game, c, def.index, i, group));
      }
    }
    this.game.enemies.onEnemyDeath((e) => this.onEnemyDeath(e));
    // A conversation changes the world (flags, doors, who will talk again), so it ends in a checkpoint:
    // dying or closing the tab afterwards must not undo half of it. Not around the boss.
    this.game.events.on('dialogueEnd', () => {
      if (this.bossStarted || this.bossDone) return;
      this.checkpointPending = true;
      this.checkpointQuiet = true;
    });
    // What she has found is kept as it happens.
    this.game.events.on('logFound', () => this.writeSave());
    // Scene queries only see colliders after a step; nav building raycasts.
    this.game.physics.step(1 / 60);
  }

  get nav(): NavGrid | null {
    return this.sections[this.current - 1]?.nav ?? null;
  }

  /** How hard this section hits relative to the difficulty's numbers (the first fights go easier). */
  get damageScale(): number {
    return this.sections[this.current - 1]?.def.ease?.damage ?? 1;
  }

  /** How many enemies may shoot at once, here, on this difficulty. */
  applyThreat(): void {
    const ease = this.sections[this.current - 1]?.def.ease;
    this.game.enemies.tokens.max = Math.max(1, this.game.difficulty.tokens - (ease?.tokens ?? 0));
  }

  /** Deaths since the last checkpoint was taken (the death screen offers an easier setting after a few). */
  deathsHere = 0;

  /** A section's own nav grid (enemies posted ahead of her use theirs). */
  navOf(section: number): NavGrid | null {
    return this.sections[section - 1]?.nav ?? null;
  }

  section(i: number): SectionRuntime {
    return this.sections[i - 1];
  }

  ensureNav(i: number): NavGrid {
    const s = this.section(i);
    if (!s.nav) {
      const t0 = performance.now();
      s.nav = new NavGrid(s.def.nav, CONFIG.ai.navCell);
      s.nav.build(this.game.physics, 0.42, 1.8);
      if (this.game.debugEnabled) console.info(`nav ${i}: ${s.nav.nodeCount} nodes in ${(performance.now() - t0).toFixed(0)} ms`);
    }
    return s.nav;
  }

  // ---- Flow ----

  /** Start (or jump to) a section: player at its checkpoint. */
  startAt(index: number): void {
    this.current = index;
    // Skipping ahead: earlier sections count as done.
    for (const enc of this.encounters) {
      if (enc.section < index) enc.state = 'cleared';
    }
    if (index > 1) this.openDoor('dockGate', true);
    if (index > 2) this.openDoor('clubDoor', true);
    if (index > 2) this.openDoor('soukShutter', true);
    if (index > 3) this.openDoor('clubExit', true);
    if (index > 4) this.openDoor('basinGate', true);
    this.openDoor('basinSeal', true);
    this.ensureNav(index);
    this.enterSection(index, true);
    const cp = this.section(index).def.checkpoint;
    this.game.player.spawn(this.tmp.set(cp.x, cp.y, cp.z), cp.yaw);
    this.game.rig.snap(this.game.player.position, cp.yaw);
    this.saveCheckpoint();
  }

  /** Put the crews of this section and the next at their posts (far enough off to be unseen). */
  private stageAround(index: number): void {
    for (const enc of this.encounters) {
      if (!enc.def.staged || enc.state !== 'idle') continue;
      if (enc.section !== index && enc.section !== index + 1) continue;
      enc.state = 'staged';
      enc.heard = false;
      enc.wave = 0;
      enc.waveDelay = 0;
      enc.enemies.length = 0;
      const w = enc.def.waves[0];
      for (const s of w.spawns) {
        const e = this.game.enemies.spawn(s.kind, this.tmp.set(s.x, s.y, s.z), s.yaw ?? Math.PI, enc.section, { alerted: false, instant: true });
        enc.enemies.push(e);
      }
      enc.wave = 1;
    }
  }

  private enterSection(index: number, silent = false): void {
    this.current = index;
    const s = this.section(index);
    this.applyThreat();
    this.ensureNav(index);
    // Pre-build the next section's nav in the background.
    if (index < SECTIONS.length) setTimeout(() => this.ensureNav(index + 1), 300);
    s.def.onEnter?.(this);
    this.zone = null;
    this.setMusic(this.ambientMusic());
    this.stageAround(index);
    if (!silent) {
      this.saveCheckpoint();
      this.game.hud.toast(`${UI.checkpoint}: ${s.def.name}`);
      this.game.audio.play('checkpoint');
    }
    this.game.events.emit('sectionStart', index);
    if (index === 1 && !this.flags.size) this.setObjective(OBJECTIVES.dockTalk, 'odette');
  }

  /** First control prompts once the player actually takes control; from here on, checkpoints are saved. */
  onGameStart(): void {
    this.saving = true;
    this.writeSave();
    if (this.current === 1) this.hint('move', 'shoulder');
  }

  /** Off until play begins: building the level takes a checkpoint too, and that is not a game to continue. */
  private saving = false;

  /** Save progress. `here` keeps her current position (after a fight); otherwise the section's start. */
  saveCheckpoint(here = false): void {
    const doors: Record<string, boolean> = {};
    for (const [id, d] of this.allDoors) doors[id] = d.open;
    const def = this.section(this.current).def.checkpoint;
    const p = this.game.player;
    this.checkpoint = {
      section: this.current,
      pos: here ? [p.position.x, p.position.y, p.position.z] : [def.x, def.y, def.z],
      yaw: here ? this.game.rig.yaw : def.yaw,
      weapons: this.game.player.weapons.snapshot(),
      flags: [...this.flags],
      doors,
      cleared: this.encounters.filter((e) => e.state === 'cleared').map((e) => e.def.id),
      pickupsUsed: this.allPickups.map((p) => p.used),
      objective: { text: this.objective, marker: this.objectiveMarker ? [this.objectiveMarker.x, this.objectiveMarker.y, this.objectiveMarker.z] : null, secondary: this.secondaryObjective },
    };
    this.deathsHere = 0;
    this.writeSave();
  }

  // ---- Saved game ----

  /** Every checkpoint is also written to the browser, so closing the tab loses nothing past it. */
  private writeSave(): void {
    if (!this.saving || !this.game.params.persist || !this.checkpoint || this.bossDone) return;
    const save: SaveFile = {
      v: 1,
      checkpoint: this.checkpoint,
      logs: [...this.logsFound],
      zones: [...this.discovered],
      hints: [...this.shownHints],
      talked: this.npcs.filter((n) => n.hasTalked).map((n) => n.def.id),
      sticky: Director.STICKY.filter((f) => this.flags.has(f)),
      bossIntroSeen: this.bossIntroSeen,
      stats: { ...this.game.stats.totals },
      difficulty: settings.value.difficulty,
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    } catch {
      // Storage unavailable: the run still works, it just can't be resumed.
    }
  }

  private readSave(): SaveFile | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      const s = raw ? (JSON.parse(raw) as SaveFile) : null;
      if (!s || s.v !== 1 || !s.checkpoint || !this.sections[s.checkpoint.section - 1] || !Array.isArray(s.checkpoint.pos)) return null;
      return s;
    } catch {
      return null;
    }
  }

  /** What the title screen shows for Continue (null: nothing to continue). */
  peekSave(): { section: number; time: number; difficulty: Difficulty } | null {
    const s = this.readSave();
    return s ? { section: s.checkpoint.section, time: s.stats?.time ?? 0, difficulty: s.difficulty ?? 'standard' } : null;
  }

  clearSave(): void {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      // ignore
    }
  }

  /** Put the world back as the saved checkpoint left it. False if there is nothing usable. */
  loadSave(): boolean {
    const s = this.readSave();
    if (!s) return false;
    try {
      this.checkpoint = s.checkpoint;
      this.logsFound.clear();
      for (const id of s.logs ?? []) this.logsFound.add(id);
      for (const log of this.allLogs) {
        if (!this.logsFound.has(log.id)) continue;
        log.found = true;
        log.figure.hide();
      }
      this.discovered.clear();
      for (const z of s.zones ?? []) this.discovered.add(z);
      for (const h of s.hints ?? []) this.shownHints.add(h);
      this.bossIntroSeen = !!s.bossIntroSeen;
      this.game.stats.totals = { ...this.game.stats.totals, ...s.stats };
      if (s.difficulty && s.difficulty !== settings.value.difficulty) settings.set('difficulty', s.difficulty);
      this.flags.clear();
      this.respawnFromCheckpoint();
      for (const f of s.sticky ?? []) this.flags.add(f);
      this.applyTuning();
      for (const n of this.npcs) {
        if (s.talked?.includes(n.def.id)) n.markTalked();
        if (n.def.id === 'yaw' && this.flags.has('yaw_left')) n.vanish();
      }
      return true;
    } catch (err) {
      console.warn('Saved game could not be loaded; starting fresh.', err);
      this.clearSave();
      return false;
    }
  }

  /** Death → restart from the last checkpoint. */
  respawnFromCheckpoint(): void {
    const cp = this.checkpoint;
    if (!cp) return;
    this.game.enemies.clear();
    this.game.bolts.clear();
    this.game.explosives.reset(cp.section);
    this.game.fx.clear();
    this.game.cover.clearClaims();
    this.game.boss?.reset();
    this.bossStarted = false;
    const sticky = Director.STICKY.filter((f) => this.flags.has(f));
    this.flags.clear();
    cp.flags.forEach((f) => this.flags.add(f));
    sticky.forEach((f) => this.flags.add(f));
    this.applyTuning();
    this.checkpointPending = false;
    // People come back where no fight has been finished since the save.
    const fought = new Set(this.encounters.filter((e) => cp.cleared.includes(e.def.id)).map((e) => e.section));
    for (const c of this.civilians) if (c.section >= cp.section && !fought.has(c.section)) c.reset();
    for (const enc of this.encounters) {
      enc.state = cp.cleared.includes(enc.def.id) ? 'cleared' : 'idle';
      enc.wave = 0;
      enc.enemies.length = 0;
    }
    for (const [id, d] of this.allDoors) this.setDoor(d, cp.doors[id] ?? false, true);
    this.allPickups.forEach((p, i) => {
      p.used = cp.pickupsUsed[i] ?? false;
      p.cooldown = 0;
      p.mesh.visible = !p.used;
    });
    this.game.player.weapons.restore(cp.weapons);
    const def = this.section(cp.section).def;
    this.current = cp.section;
    this.applyThreat();
    this.ensureNav(cp.section);
    // The crew posted in the next section needs its grid too (a saved game starts here without having walked in).
    if (cp.section < SECTIONS.length) setTimeout(() => this.ensureNav(cp.section + 1), 300);
    this.game.player.spawn(this.tmp.set(cp.pos[0], cp.pos[1], cp.pos[2]), cp.yaw);
    this.game.rig.snap(this.game.player.position, cp.yaw);
    this.game.player.combatActive = false;
    this.game.time.reset();
    def.onEnter?.(this);
    // Back to what she was doing when the checkpoint was taken.
    this.objective = cp.objective.text;
    this.objectiveMarker = cp.objective.marker ? new THREE.Vector3(...cp.objective.marker) : null;
    this.game.hud.setObjective(cp.objective.text);
    this.setSecondaryObjective(cp.objective.secondary);
    this.zone = null;
    this.setMusic(this.ambientMusic());
    for (const n of this.npcs) n.reset();
    this.stageAround(cp.section);
  }

  // ---- Per frame ----

  /** Before the player update: interaction (so X can talk instead of reload). */
  preUpdate(): void {
    const p = this.game.player;
    this.interactNpc = null;
    if (!p.alive || this.game.state !== 'playing') return;
    for (const n of this.npcs) {
      if (!n.canTalk(this)) continue;
      if (n.position.distanceTo(p.position) < 2.8) {
        this.interactNpc = n;
        break;
      }
    }
    if (this.interactNpc) {
      this.game.hud.contextPrompt('talk');
      if (this.game.input.pressed('interact')) {
        this.game.input.consume('interact');
        this.game.input.consume('reload');
        this.game.startDialogue(this.interactNpc.def.dialogue, this.interactNpc);
      }
    } else {
      this.game.hud.contextPrompt(null);
    }
  }

  update(dt: number): void {
    const p = this.game.player;

    // Section entry.
    for (const s of this.sections) {
      if (s.def.index > this.current && inBox(p.position, s.enter)) {
        this.enterSection(s.def.index);
        break;
      }
    }

    // Encounters.
    let combat = false;
    for (const enc of this.encounters) {
      if (enc.state === 'idle' && !enc.def.staged && enc.section === this.current && p.alive && inBox(p.position, enc.trigger)) {
        this.startEncounter(enc);
      }
      if (enc.state === 'staged') this.updateStaged(enc);
      if (enc.state !== 'active') continue;
      combat = true;
      this.updateEncounter(enc, dt);
    }
    if (this.bossStarted && !this.bossDone) combat = true;
    p.combatActive = combat;
    if (combat && this.musicCue !== 'combat' && this.musicCue !== 'boss') this.setMusic('combat');
    if (!combat && this.musicCue === 'combat') this.setMusic(this.ambientMusic());

    // Doors.
    for (const d of this.allDoors.values()) {
      const target = d.open ? 1 : 0;
      if (d.t !== target) {
        d.t += Math.sign(target - d.t) * dt * 0.8;
        d.t = Math.min(1, Math.max(0, d.t));
        d.mesh.position.y = d.closedY - d.travel * easeInOut(d.t);
        d.mesh.visible = d.t < 0.999;
      }
    }

    // Pickups.
    for (const pk of this.allPickups) {
      if (pk.used) continue;
      if (pk.flag && !this.flags.has(pk.flag as Flag)) {
        pk.mesh.visible = false;
        continue;
      }
      pk.mesh.visible = pk.cooldown <= 0;
      pk.mesh.rotation.y += dt * 0.5;
      if (pk.cooldown > 0) {
        pk.cooldown -= dt;
        continue;
      }
      if (!p.alive || p.position.distanceTo(pk.pos) > CONFIG.player.pickupRadius) continue;
      if (pk.kind === 'ammo' && p.weapons.needsAmmo()) {
        p.weapons.refill();
        pk.cooldown = CONFIG.pickups.ammoCrateCooldown;
        this.game.audio.play('pickupAmmo');
        this.game.hud.toast(UI.ammoRefilled);
        this.game.fx.sparkle(pk.pos.clone().setY(pk.pos.y + 0.6), 0xffc04a);
      } else if (pk.kind === 'health' && p.health < CONFIG.player.healthMax) {
        p.heal(CONFIG.pickups.healthAmount);
        pk.used = true;
        pk.mesh.visible = false;
        this.game.audio.play('pickupHealth');
        this.game.hud.toast(UI.healthRestored);
        this.game.fx.sparkle(pk.pos.clone().setY(pk.pos.y + 0.5), 0xff6060);
      }
    }

    this.animateWorld(dt);
    this.updateZones();
    this.updateLogs();
    if (this.letterPending && this.game.state === 'playing') {
      this.letterPending = false;
      this.game.hud.showLog(MARI_LETTER.title, MARI_LETTER.text);
    }
    this.updateSoundscape(dt);

    // Boss arena flow.
    if (this.current === 5 && !this.bossStarted && !this.bossDone && p.position.z < -289 && p.alive && this.game.state === 'playing') {
      this.bossStarted = true;
      this.game.boss.prepare();
      if (this.bossIntroSeen) {
        // Retry after a death: no speech, straight to it.
        this.game.hud.bark(NAMES.boss, BOSS_BARKS.retry);
        this.onDialogueEvent('startBoss');
      } else {
        this.bossIntroSeen = true;
        this.game.startDialogue('bossIntro', null);
      }
    }

    // After a fight: checkpoint where she stands, once she is on the ground and nothing is shooting.
    if (this.checkpointPending && p.alive && p.grounded && !combat && this.game.state === 'playing') {
      this.checkpointPending = false;
      this.saveCheckpoint(true);
      if (!this.checkpointQuiet) this.game.hud.toast(UI.checkpoint);
      this.checkpointQuiet = false;
    }

    if (!p.alive) {
      if (this.respawnT < 0) this.respawnT = CONFIG.checkpoints.respawnDelay;
      this.respawnT -= dt;
      if (this.respawnT <= 0 && this.game.state === 'playing') {
        this.respawnT = -1;
        this.game.showDeath();
      }
    } else {
      this.respawnT = -1;
    }
  }

  /** Everything that moves on its own: set dressing, people, lights. Runs in cutscenes and on the end screens too. */
  animateWorld(dt: number): void {
    const t = this.game.time.now;
    // Only the current section and its neighbours are drawn (fog hides the rest).
    for (const s of this.sections) s.group.visible = Math.abs(s.def.index - this.current) <= 1;
    for (const s of this.sections) {
      if (Math.abs(s.def.index - this.current) > 1) continue;
      for (const a of s.anims) a(t, dt);
    }
    for (const n of this.npcs) n.update(dt);
    this.lightTimer -= dt;
    if (this.lightTimer <= 0) {
      this.lightTimer = 0.2;
      this.game.lights.assign(this.game.rig.camera.position);
    }
    const cam = this.game.rig.camera.position;
    for (const c of this.civilians) {
      if (Math.abs(c.section - this.current) <= 1) c.update(dt, cam);
    }
  }

  private startEncounter(enc: EncounterRuntime): void {
    enc.state = 'active';
    enc.wave = 0;
    enc.waveDelay = 0;
    enc.enemies.length = 0;
    this.spawnWave(enc);
    this.beginFight(enc);
  }

  private beginFight(enc: EncounterRuntime): void {
    enc.def.onStart?.(this);
    this.game.stats.markFight();
    this.game.events.emit('encounterStart', enc.def.id);
    this.alarm(enc.section, true);
    // The club's sound system dies the moment the shooting starts.
    this.setMusic(this.current === 5 ? 'boss' : 'combat', { cut: this.musicCue === 'club' });
  }

  /** A crew at its posts: let her overhear them, and point out the opening. */
  private updateStaged(enc: EncounterRuntime): void {
    if (enc.heard) return;
    const p = this.game.player.position;
    for (const e of enc.enemies) {
      if (!e.alive) continue;
      const d = e.position.distanceTo(p);
      if (d < 36) this.hint('ambush');
      if (d < 26 && !this.game.physics.blocked(this.game.rig.camera.position, e.chestPoint(this.tmp))) {
        enc.heard = true;
        this.bark(e.kind, 'idle');
        return;
      }
    }
  }

  /** An enemy noticed her (seen, shot, grabbed). A posted crew starts its fight; the rest hear it. */
  onEnemyAlerted(e: Enemy): void {
    for (const enc of this.encounters) {
      if (enc.state !== 'staged' || !enc.enemies.includes(e)) continue;
      enc.state = 'active';
      enc.waveDelay = 0;
      const N = CONFIG.notice;
      for (const o of enc.enemies) if (o !== e) o.hear(N.reactMin + Math.random() * (N.reactMax - N.reactMin));
      if (e.alive) this.bark(e.kind, 'spotted');
      this.game.audio.play('alert');
      this.beginFight(enc);
      return;
    }
  }

  /** A loud noise (gunfire, a blast): unaware enemies in earshot turn toward it. */
  noise(at: THREE.Vector3, range: number = CONFIG.notice.hearRange): void {
    const N = CONFIG.notice;
    for (const e of this.game.enemies.active) {
      if (!e.unaware) continue;
      const d = e.position.distanceTo(at);
      if (d > range) continue;
      // Walls and shut doors keep the noise out of the next section.
      if (e.section !== this.current && this.game.physics.blocked(at, e.chestPoint(this.tmp))) continue;
      e.hear(N.reactMin + (N.reactMax - N.reactMin) * Math.random() + d * 0.012);
    }
  }

  private spawnWave(enc: EncounterRuntime): void {
    const w = enc.def.waves[enc.wave];
    if (!w) return;
    const drop = w.fewerWith && this.flags.has(w.fewerWith.flag as Flag) ? w.fewerWith.drop : 0;
    for (const s of w.spawns.slice(0, w.spawns.length - drop)) {
      const pp = this.game.player.position;
      const yaw = s.yaw ?? Math.atan2(-(pp.x - s.x), -(pp.z - s.z));
      const e = this.game.enemies.spawn(s.kind, this.tmp.set(s.x, s.y, s.z), yaw, enc.section, { alerted: true, delay: s.delay });
      enc.enemies.push(e);
      this.game.fx.spawnIn(this.tmp, e.height);
    }
    if (w.hint) this.hint(w.hint);
    if (w.spawns.some((sp) => sp.kind === 'heavy')) this.bark('heavy', 'heavy');
    else if (enc.wave === 0 && w.spawns.length) this.bark(w.spawns[0].kind, 'spotted');
    enc.wave++;
  }

  private updateEncounter(enc: EncounterRuntime, dt: number): void {
    let alive = 0;
    for (const e of enc.enemies) if (e.alive) alive++;
    const next = enc.def.waves[enc.wave];
    if (next) {
      if (alive <= (next.whenAliveAtMost ?? 0)) {
        enc.waveDelay += dt;
        if (enc.waveDelay >= (next.delay ?? 0)) {
          enc.waveDelay = 0;
          this.spawnWave(enc);
        }
      }
      return;
    }
    if (alive === 0) {
      enc.state = 'cleared';
      enc.def.onClear?.(this);
      this.game.events.emit('encounterClear', enc.def.id);
      this.game.audio.play('objective');
      this.alarm(enc.section, false);
      this.setMusic(this.ambientMusic());
      this.clearBeat();
    }
  }

  /** The last enemy of a fight just dropped: slow motion, a result card, a checkpoint. */
  private clearBeat(): void {
    const B = CONFIG.clearBeat;
    this.game.time.slowMo(B.slowTime, B.slowScale);
    const r = this.game.stats.sinceMark();
    this.checkpointQuiet = false;
    this.game.hud.showResult(UI.areaClear, [
      [UI.resultTime, formatTime(r.time)],
      [UI.resultAccuracy, `${Math.round(r.accuracy * 100)}%`],
      [UI.resultDamage, String(Math.round(r.damageTaken))],
      [UI.resultCombos, String(r.combos)],
    ]);
    this.checkpointPending = true;
  }

  private onEnemyDeath(e: Enemy): void {
    this.game.stats.totals.kills++;
    this.game.events.emit('enemyKilled', e);
    if (e.kind !== 'boss') {
      for (const o of this.game.enemies.active) {
        if (o !== e && o.alive && o.kind !== 'boss' && o.section === e.section) {
          this.bark(o.kind, 'allyDown', 0.35);
          break;
        }
      }
    }
  }

  private barkCooldownUntil = 0;

  /** An enemy calls out (subtitle). One bark at a time, a few seconds apart. */
  bark(kind: Enemy['kind'], key: keyof typeof BARKS, chance = 1): void {
    const now = this.game.time.now;
    if (now < this.barkCooldownUntil || Math.random() > chance) return;
    const lines = BARKS[key];
    this.barkCooldownUntil = now + 4.5;
    this.game.hud.bark(ENEMY_NAMES[kind], lines[Math.floor(Math.random() * lines.length)]);
  }

  isCleared(id: string): boolean {
    return this.encounters.some((e) => e.def.id === id && e.state === 'cleared');
  }

  /** Living enemies count for debug. */
  get activeEnemies(): number {
    return this.game.enemies.aliveCount();
  }

  // ---- API for sections and dialogue ----

  /** A short message in the toast line. */
  note(text: string): void {
    this.game.hud.toast(text);
  }

  openDoor(id: string, instant = false): void {
    const d = this.allDoors.get(id);
    if (d) this.setDoor(d, true, instant);
  }

  closeDoor(id: string, instant = false): void {
    const d = this.allDoors.get(id);
    if (d) this.setDoor(d, false, instant);
  }

  private setDoor(d: Door, open: boolean, instant: boolean): void {
    const was = d.open;
    d.open = open;
    for (const c of d.colliders) c.setEnabled(!open);
    if (d.lamp) d.lamp.material = open ? this.game.mats.neonGreen : this.game.mats.neonRed;
    if (instant) {
      d.t = open ? 1 : 0;
      d.mesh.position.y = d.closedY - d.travel * d.t;
      d.mesh.visible = d.t < 0.999;
    } else if (was !== open) {
      this.game.audio.play('doorOpen', { at: d.mesh.position });
    }
  }

  setObjective(text: string, marker?: string): void {
    this.objective = text;
    const s = this.section(this.current);
    let m = marker ? s.def.markers?.[marker] : undefined;
    if (!m && marker) {
      for (const sec of this.sections) if (sec.def.markers?.[marker]) m = sec.def.markers[marker];
    }
    this.objectiveMarker = m ? new THREE.Vector3(...m) : null;
    this.game.hud.setObjective(text);
  }

  setSecondaryObjective(text: string): void {
    this.secondaryObjective = text;
    this.game.hud.setSecondary(text);
  }

  /** Show tutorial hints once each. */
  hint(...keys: string[]): void {
    for (const k of keys) {
      if (this.shownHints.has(k)) continue;
      this.shownHints.add(k);
      this.game.hud.prompt(k, 7);
    }
  }

  setMusic(cue: string, opts: { cut?: boolean } = {}): void {
    this.musicCue = cue;
    this.game.audio.setMusic(cue as never, opts);
  }

  /** Dialogue events land here. */
  onDialogueEvent(ev: DialogueEvent): void {
    switch (ev) {
      case 'openStripGate':
        this.openDoor('dockGate');
        this.setObjective(OBJECTIVES.dockGate, 'gate');
        this.hint('sprint', 'jump', 'dash');
        break;
      case 'openSideRoute':
        this.openDoor('serviceDoor');
        this.game.hud.toast(UI.intelRoute);
        break;
      case 'intelWeakpoint':
        this.game.hud.toast(UI.intelWeakpoint);
        break;
      case 'yawLeaves':
        for (const n of this.npcs) if (n.def.id === 'yaw') n.leave();
        break;
      case 'startBoss':
        this.closeDoor('basinSeal');
        this.game.boss.start();
        this.setMusic('boss');
        // No marker: he is the biggest thing in the room, and he moves.
        this.setObjective(OBJECTIVES.boss);
        break;
      case 'leviathanPass':
        this.game.leviathan.pass();
        break;
      case 'nefMeal':
        this.game.player.heal(CONFIG.player.healthMax);
        this.game.player.shield = this.game.player.shieldMax;
        this.game.hud.toast(UI.nefMeal);
        this.game.audio.play('pickupHealth');
        break;
      case 'tuneKa':
      case 'tuneShield':
        // The flag was set with the choice; apply it.
        this.applyTuning();
        this.game.hud.toast(ev === 'tuneKa' ? UI.tunedKa : UI.tunedShield);
        this.game.audio.play('castCharge', { volume: 0.6 });
        break;
      case 'basAdvice':
        this.game.hud.toast(UI.basAdvice);
        break;
      case 'giveLetter':
        this.letterPending = true;
        break;
      case 'endLevel':
        this.bossDone = true;
        this.setMusic('victory');
        // The run is over: nothing left to continue.
        this.clearSave();
        this.game.playEnding();
        break;
    }
  }

  private readonly loopLevels = new Map<LoopId, number>();

  /** Ambient beds: the dome hum for the current section plus nearby sound spots. */
  private updateSoundscape(dt: number): void {
    const levels = this.loopLevels;
    for (const k of levels.keys()) levels.set(k, 0);
    const def = this.section(this.current).def;
    levels.set('dome', this.zone?.dome ?? def.dome ?? 0.6);
    const p = this.game.player.position;
    const fighting = this.game.player.combatActive;
    for (const s of this.sections) {
      if (Math.abs(s.def.index - this.current) > 1) continue;
      for (const spot of s.def.soundscape ?? []) {
        if (spot.quietInCombat && fighting) continue;
        const d = Math.hypot(p.x - spot.at[0], (p.y - spot.at[1]) * 2, p.z - spot.at[2]);
        const k = d <= spot.inner ? 1 : Math.max(0, 1 - (d - spot.inner) / (spot.radius - spot.inner));
        levels.set(spot.loop, Math.max(levels.get(spot.loop) ?? 0, k * spot.level));
      }
    }
    void dt;
    for (const [id, v] of levels) this.game.audio.setLoop(id, this.game.state === 'end' ? 0 : v);
  }

  get zoneId(): string | null {
    return this.zone?.id ?? null;
  }

  /** What should play when nothing is being fought: the zone's music, the section's, or after its fight. */
  ambientMusic(): string {
    if (this.zone?.music) return this.zone.music;
    const def = this.section(this.current).def;
    // A crew standing at its posts has not started anything: the club is still playing its music.
    const started = this.encounters.some((e) => e.section === def.index && (e.state === 'active' || e.state === 'cleared'));
    return started ? (def.musicAfter ?? 'explore') : def.music;
  }

  private updateZones(): void {
    const p = this.game.player.position;
    let found: ZoneDef | null = null;
    for (const s of this.sections) {
      if (Math.abs(s.def.index - this.current) > 1) continue;
      for (const z of s.def.zones ?? []) {
        if (z.nudge && !this.discovered.has(z.id) && !this.shownHints.has(`zone:${z.id}`) && this.game.state === 'playing' && !this.game.player.combatActive && inRange(p, z.nudge.box)) {
          this.shownHints.add(`zone:${z.id}`);
          this.note(z.nudge.text);
        }
        if (inRange(p, z.box)) found = z;
      }
    }
    if (found === this.zone) return;
    this.zone = found;
    if (found && !this.discovered.has(found.id)) {
      this.discovered.add(found.id);
      this.writeSave();
      this.game.hud.toast(UI.discovered.replace('{zone}', found.name));
      this.game.audio.play('objective', { volume: 0.7 });
    }
    if (!this.game.player.combatActive && this.musicCue !== 'boss' && this.musicCue !== 'victory') this.setMusic(this.ambientMusic());
  }

  private updateLogs(): void {
    const p = this.game.player;
    if (!p.alive || this.game.state !== 'playing') return;
    for (const log of this.allLogs) {
      if (log.found || Math.abs(log.section - this.current) > 1) continue;
      if (p.position.distanceTo(log.pos) > log.radius) continue;
      log.found = true;
      this.logsFound.add(log.id);
      const entry = MARI_LOGS.find((l) => l.id === log.id);
      // She talks for as long as the recording is on screen, then switches off.
      log.figure.speak(entry ? 1.5 + entry.text.length / 34 : 3);
      this.game.audio.play('holoLog');
      if (entry) this.game.hud.showLog(entry.title, entry.text, UI.logsCount.replace('{n}', String(this.logsFound.size)).replace('{total}', String(MARI_LOGS.length)));
      if (this.logsFound.size >= MARI_LOGS.length) this.flags.add('all_logs');
      this.game.events.emit('logFound', log.id);
    }
  }

  /** People in a section react to a fight starting or ending there. */
  private alarm(section: number, on: boolean): void {
    for (const c of this.civilians) if (c.section === section) c.alarm(on);
  }

  /** Kwame's tuning, re-applied from the flags. */
  applyTuning(): void {
    const p = this.game.player;
    p.powers.cooldownScale = this.flags.has('tuned_ka') ? CONFIG.tuning.kaCooldownScale : 1;
    p.shieldMax = CONFIG.player.shieldMax + (this.flags.has('tuned_shield') ? CONFIG.tuning.shieldBonus : 0);
    p.shield = Math.min(p.shield, p.shieldMax);
  }

  /** The Crocodile is down: the fight is over, the outro follows. */
  onBossDowned(): void {
    this.bossDone = true;
    this.game.time.slowMo(1.5, 0.2);
    this.setMusic('victory');
    this.setObjective(OBJECTIVES.ledger, 'ledger');
    this.game.events.emit('bossDefeated');
  }

  get interactTarget(): Npc | null {
    return this.interactNpc;
  }

  npcDef(id: NpcDef['id']): Npc | undefined {
    return this.npcs.find((n) => n.def.id === id);
  }
}

function inBox(p: THREE.Vector3, t: Trigger): boolean {
  return p.x >= t.min.x && p.x <= t.max.x && p.y >= t.min.y && p.y <= t.max.y && p.z >= t.min.z && p.z <= t.max.z;
}

/** Point in an [x0,y0,z0,x1,y1,z1] box (corners in any order). */
function inRange(p: THREE.Vector3, b: readonly number[]): boolean {
  return p.x >= Math.min(b[0], b[3]) && p.x <= Math.max(b[0], b[3]) && p.y >= Math.min(b[1], b[4]) && p.y <= Math.max(b[1], b[4]) && p.z >= Math.min(b[2], b[5]) && p.z <= Math.max(b[2], b[5]);
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
