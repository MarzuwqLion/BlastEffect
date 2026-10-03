import * as THREE from 'three';
import { CONFIG } from '../config';
import { LevelBuilder, type Door, type LightAnchor, type Pickup, type Trigger } from '../level/LevelBuilder';
import { NavGrid } from '../level/nav';
import type { SectionDef, EncounterDef, NpcDef } from '../level/sections/types';
import type { LoopId } from '../audio/manifest';
import { dock } from '../level/sections/dock';
import { strip } from '../level/sections/strip';
import { club } from '../level/sections/club';
import { terrace } from '../level/sections/terrace';
import { basin } from '../level/sections/basin';
import type { Game } from './Game';
import type { Enemy } from '../enemies/Enemy';
import type { Flag, DialogueEvent } from '../dialogue/types';
import { BARKS, BOSS_BARKS, ENEMY_NAMES, NAMES, OBJECTIVES, UI } from '../strings';
import { Npc } from '../character/Npc';
import type { WeaponId } from '../character/types';

export const SECTIONS: SectionDef[] = [dock, strip, club, terrace, basin];

interface EncounterRuntime {
  def: EncounterDef;
  section: number;
  state: 'idle' | 'active' | 'cleared';
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
  weapons: { smg: [number, number]; rifle: [number, number]; current: WeaponId };
  flags: Flag[];
  doors: Record<string, boolean>;
  cleared: string[];
  pickupsUsed: boolean[];
}

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
          def: e, section: def.index, state: 'idle', wave: 0, waveDelay: 0, enemies: [],
          trigger: { id: e.id, min: new THREE.Vector3(Math.min(t[0], t[3]), Math.min(t[1], t[4]), Math.min(t[2], t[5])), max: new THREE.Vector3(Math.max(t[0], t[3]), Math.max(t[1], t[4]), Math.max(t[2], t[5])) },
        });
      }
      for (const n of def.npcs ?? []) this.npcs.push(new Npc(this.game, n));
    }
    this.game.enemies.onEnemyDeath((e) => this.onEnemyDeath(e));
    // Scene queries only see colliders after a step; nav building raycasts.
    this.game.physics.step(1 / 60);
  }

  get nav(): NavGrid | null {
    return this.sections[this.current - 1]?.nav ?? null;
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

  private enterSection(index: number, silent = false): void {
    this.current = index;
    const s = this.section(index);
    this.ensureNav(index);
    // Pre-build the next section's nav in the background.
    if (index < SECTIONS.length) setTimeout(() => this.ensureNav(index + 1), 300);
    s.def.onEnter?.(this);
    this.setMusic(s.def.music === 'combat' ? 'explore' : s.def.music);
    if (!silent) {
      this.saveCheckpoint();
      this.game.hud.toast(`${UI.checkpoint}: ${s.def.name}`);
      this.game.audio.play('checkpoint');
    }
    this.game.events.emit('sectionStart', index);
    if (index === 1 && !this.flags.size) this.setObjective(OBJECTIVES.dockTalk, 'odette');
  }

  /** First control prompts once the player actually takes control. */
  onGameStart(): void {
    if (this.current === 1) this.hint('move', 'shoulder');
  }

  saveCheckpoint(): void {
    const doors: Record<string, boolean> = {};
    for (const [id, d] of this.allDoors) doors[id] = d.open;
    this.checkpoint = {
      section: this.current,
      weapons: this.game.player.weapons.snapshot(),
      flags: [...this.flags],
      doors,
      cleared: this.encounters.filter((e) => e.state === 'cleared').map((e) => e.def.id),
      pickupsUsed: this.allPickups.map((p) => p.used),
    };
  }

  /** Death → restart from the last checkpoint. */
  respawnFromCheckpoint(): void {
    const cp = this.checkpoint;
    if (!cp) return;
    this.game.enemies.clear();
    this.game.bolts.clear();
    this.game.fx.clear();
    this.game.cover.clearClaims();
    this.game.boss?.reset();
    this.bossStarted = false;
    this.flags.clear();
    cp.flags.forEach((f) => this.flags.add(f));
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
    this.game.player.spawn(this.tmp.set(def.checkpoint.x, def.checkpoint.y, def.checkpoint.z), def.checkpoint.yaw);
    this.game.rig.snap(this.game.player.position, def.checkpoint.yaw);
    this.game.player.combatActive = false;
    def.onEnter?.(this);
    this.setMusic(def.music === 'combat' ? 'explore' : def.music);
    for (const n of this.npcs) n.reset();
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
    const t = this.game.time.now;

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
      if (enc.state === 'idle' && enc.section === this.current && p.alive && inBox(p.position, enc.trigger)) {
        this.startEncounter(enc);
      }
      if (enc.state !== 'active') continue;
      combat = true;
      this.updateEncounter(enc, dt);
    }
    if (this.bossStarted && !this.bossDone) combat = true;
    p.combatActive = combat;
    if (combat && this.musicCue !== 'combat' && this.musicCue !== 'boss') this.setMusic('combat');
    if (!combat && this.musicCue === 'combat') this.setMusic('explore');

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

    // Only the current section and its neighbours are drawn (fog hides the rest).
    for (const s of this.sections) s.group.visible = Math.abs(s.def.index - this.current) <= 1;

    // Section animations (holograms, lights).
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

  private startEncounter(enc: EncounterRuntime): void {
    enc.state = 'active';
    enc.wave = 0;
    enc.waveDelay = 0;
    enc.enemies.length = 0;
    this.spawnWave(enc);
    enc.def.onStart?.(this);
    this.game.events.emit('encounterStart', enc.def.id);
    // The club's sound system dies the moment the shooting starts.
    this.setMusic(this.current === 5 ? 'boss' : 'combat', { cut: this.musicCue === 'club' });
  }

  private spawnWave(enc: EncounterRuntime): void {
    const w = enc.def.waves[enc.wave];
    if (!w) return;
    for (const s of w.spawns) {
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
      this.setMusic('explore');
    }
  }

  private onEnemyDeath(e: Enemy): void {
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
        this.setObjective(OBJECTIVES.boss, 'boss');
        break;
      case 'endLevel':
        this.bossDone = true;
        this.setMusic('victory');
        this.game.showEnd();
        break;
    }
  }

  private readonly loopLevels = new Map<LoopId, number>();

  /** Ambient beds: the dome hum for the current section plus nearby sound spots. */
  private updateSoundscape(dt: number): void {
    const levels = this.loopLevels;
    for (const k of levels.keys()) levels.set(k, 0);
    const def = this.section(this.current).def;
    levels.set('dome', def.dome ?? 0.6);
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

  /** The Crocodile is down: the fight is over, the outro follows. */
  onBossDowned(): void {
    this.bossDone = true;
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

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
