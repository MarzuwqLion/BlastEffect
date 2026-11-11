import * as THREE from 'three';
import { CONFIG, type DifficultyConfig, type QualityLevel } from '../config';
import { MASK, Physics, makeRayHit } from '../core/Physics';
import { END_TEXT, MARI_LOGS, SECTION_NAMES, UI } from '../strings';
import { Renderer } from '../core/Renderer';
import { GameTime } from '../core/time';
import { EventBus } from '../core/events';
import { settings, type Difficulty } from '../core/settings';
import { Input } from '../input/Input';
import { CameraRig } from '../player/CameraRig';
import { Player } from '../player/Player';
import { AimAssist } from '../player/AimAssist';
import { CoverSystem } from '../level/cover';
import { createMaterials, type MatName } from '../level/matlib';
import { createProps, type Props } from '../level/kit';
import { LightPool } from '../render/LightPool';
import { Dome } from '../render/Dome';
import { Leviathan } from '../render/Leviathan';
import { globalUniforms } from '../render/materials';
import { EnemyManager } from '../enemies/EnemyManager';
import { Bolts } from '../enemies/Bolts';
import { Explosives } from '../combat/Explosives';
import { Boss } from '../enemies/Boss';
import { FX } from '../fx/FX';
import { Combat } from '../combat/Combat';
import { AudioEngine } from '../audio/Audio';
import { Director } from './Director';
import { HUD } from '../ui/HUD';
import { DialogueUI } from '../ui/Dialogue';
import { Menus } from '../ui/Menus';
import { DebugOverlay } from '../ui/DebugOverlay';
import type { Avatar } from '../character/types';
import { createAvatar } from '../character/createAvatar';
import type { Npc } from '../character/Npc';
import type { Flag, SpeakerId } from '../dialogue/types';
import { RunStats, formatTime, loadBest, saveBest, scoreRun } from './RunStats';
import { Cinematic } from './Cinematic';
import { endingShots, openingShots } from './cutscenes';
import { ARENA_CENTER, ARENA_Y } from '../level/sections/basin';

/** Things in the level that cutscenes move. */
export interface SetPieces {
  train?: THREE.Object3D;
  basin?: {
    begin(): void;
    /** 1: the Crocodile's eye burns over the lake; 0: out. */
    setEye(k: number): void;
    /** 0..1: how far the lake has come back. */
    setFlood(k: number): void;
  };
}

export type GameState = 'loading' | 'title' | 'cinematic' | 'playing' | 'dialogue' | 'paused' | 'dead' | 'end';

export interface GameParams {
  section: number;
  god: boolean;
  quality: QualityLevel | null;
  debug: boolean;
  /** Skip the title screen and start immediately (tests). */
  autostart: boolean;
  /** Mouse look without pointer lock and no pause on lock loss (automation). */
  automation: boolean;
  /** Dialogue flags set at start (debug: test payoffs without replaying). */
  flags: string[];
  /** Play the opening even with autostart (tests). */
  intro: boolean;
  /** Keep a saved game in the browser (off for debug starts and tests). */
  persist: boolean;
}

export function readParams(): GameParams {
  const q = new URLSearchParams(location.search);
  const section = Math.min(5, Math.max(1, parseInt(q.get('section') ?? '1', 10) || 1));
  const quality = q.get('quality');
  return {
    section,
    god: q.get('god') === '1',
    quality: quality === 'low' || quality === 'medium' || quality === 'high' ? quality : null,
    debug: q.get('debug') === '1',
    autostart: q.get('autostart') === '1',
    automation: q.get('automation') === '1' || navigator.webdriver === true,
    flags: (q.get('flags') ?? '').split(',').map((f) => f.trim()).filter(Boolean),
    intro: q.get('intro') === '1',
    persist: q.get('save') === '1' || (q.get('autostart') !== '1' && !q.has('section') && !q.has('flags')),
  };
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _c1 = new THREE.Color();
const _c2 = new THREE.Color();

/** Owns every system and runs the frame loop and the game state machine. */
export class Game {
  state: GameState = 'loading';
  readonly scene = new THREE.Scene();
  readonly params: GameParams;
  readonly time = new GameTime();
  readonly events = new EventBus();
  readonly scratchHit = makeRayHit();
  readonly cover = new CoverSystem();
  readonly audio = new AudioEngine();
  /** Counters for the results screen and per-fight cards. */
  readonly stats = new RunStats();
  readonly setPieces: SetPieces = {};
  cinematic!: Cinematic;
  physics!: Physics;
  renderer!: Renderer;
  rig!: CameraRig;
  input!: Input;
  mats!: Record<MatName, THREE.Material>;
  props!: Props;
  lights!: LightPool;
  dome!: Dome;
  leviathan!: Leviathan;
  player!: Player;
  avatar!: Avatar;
  aimAssist!: AimAssist;
  enemies!: EnemyManager;
  bolts!: Bolts;
  explosives!: Explosives;
  boss!: Boss;
  fx!: FX;
  combat!: Combat;
  director!: Director;
  hud!: HUD;
  dialogue!: DialogueUI;
  menus!: Menus;
  debug!: DebugOverlay;
  private sun!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  /** Soft light between the camera and Imani so she always reads. */
  private charLight!: THREE.PointLight;
  private last = 0;
  private dialogueNpc: Npc | null = null;
  private titleT = 0;
  private endT = 0;
  private deathFade = 0;
  private shotSpeaker: SpeakerId | null = null;
  /** Head of whoever is speaking: the key light sits on them. */
  private readonly dialogueFocus = new THREE.Vector3();
  /** Base haze density for the current quality (sections scale it). */
  private fogDensity = 0.017;
  debugEnabled = false;
  /** Frame counter, for tests. */
  frame = 0;
  /** Tests can step the simulation without rendering every frame. */
  skipRender = false;
  private manual = false;

  constructor(private readonly container: HTMLElement, private readonly ui: HTMLElement) {
    this.params = readParams();
    this.debugEnabled = this.params.debug;
  }

  /** Numbers for the difficulty chosen in the settings. */
  get difficulty(): DifficultyConfig {
    return CONFIG.difficulty[settings.value.difficulty];
  }

  /** Load everything; `progress` reports 0..1. */
  async init(progress: (p: number, label?: string) => void): Promise<void> {
    const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
    const quality = this.params.quality ?? settings.value.quality;
    if (this.params.quality) settings.value.quality = this.params.quality;
    document.documentElement.dataset.text = settings.value.textSize;
    const q = CONFIG.quality[quality];

    this.physics = await Physics.create();
    progress(0.1);
    this.rig = new CameraRig(this.physics);
    this.renderer = new Renderer(this.container, quality, this.scene, this.rig.camera);
    this.input = new Input(this.renderer.canvas);
    this.input.allowUnlockedLook = this.params.automation;

    // Scene look: dark teal water haze, cool dome light, warm neon below.
    this.scene.background = new THREE.Color(0x02070c);
    this.scene.fog = new THREE.FogExp2(CONFIG.look.fogColor, q.fogDensity);
    this.fogDensity = q.fogDensity;
    this.hemi = new THREE.HemisphereLight(0x3a8aa0, 0x1a1210, 0.8);
    this.scene.add(this.hemi);
    this.scene.add(new THREE.AmbientLight(0x1a2a3a, 0.25));
    this.sun = new THREE.DirectionalLight(0x9ad8ff, 0.9);
    this.sun.position.set(20, 60, 10);
    this.sun.castShadow = q.shadows;
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    const sc = this.sun.shadow.camera;
    sc.left = -32;
    sc.right = 32;
    sc.top = 32;
    sc.bottom = -32;
    sc.near = 1;
    sc.far = 140;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    this.charLight = new THREE.PointLight(0xfff0e0, 2.2, 6, 1.6);
    this.scene.add(this.charLight);
    this.scene.environment = this.buildEnvironment();
    globalUniforms.uCaustics.value = q.caustics ? 1 : 0;
    progress(0.2);
    await tick();

    this.mats = createMaterials(true);
    this.props = createProps(this.mats);
    this.lights = new LightPool(this.scene, q.maxPointLights);
    this.dome = new Dome(this.scene, q.domeLife);
    this.leviathan = new Leviathan(this.scene);
    this.fx = new FX(this, q.particleScale, q.decals);
    this.fx.setPixelRatio(this.renderer.renderer.getPixelRatio(), window.innerHeight);
    this.combat = new Combat(this);
    this.enemies = new EnemyManager(this);
    this.bolts = new Bolts(this);
    this.explosives = new Explosives(this);
    this.aimAssist = new AimAssist(this);
    progress(0.35, 'avatar');
    await tick();

    this.avatar = await createAvatar(this, quality);
    this.scene.add(this.avatar.object);
    this.player = new Player(this);
    this.player.god = this.params.god;
    progress(0.5, 'level');
    await tick();

    this.hud = new HUD(this, this.ui);
    this.dialogue = new DialogueUI(this, this.ui);
    this.cinematic = new Cinematic(this, this.ui);
    this.menus = new Menus(this, this.ui);
    this.debug = new DebugOverlay(this, this.ui);
    if (this.params.debug) this.debug.toggle(true);

    this.director = new Director(this);
    this.director.build();
    this.boss = new Boss(this);
    progress(0.75, 'crew');
    await tick();
    this.enemies.warm({ grunt: 9, trooper: 3, heavy: 2, jackal: 2, ibis: 1 });
    progress(0.85, 'shaders');
    await tick();

    const applySettings = (): void => {
      this.director.applyThreat();
      this.rig.shakeScale = settings.value.shake;
    };
    applySettings();
    settings.onChange((s) => {
      document.documentElement.dataset.text = s.textSize;
      if (s.quality !== this.renderer.quality) this.applyQuality(s.quality);
      applySettings();
    });
    window.addEventListener('resize', () => this.fx.setPixelRatio(this.renderer.renderer.getPixelRatio(), window.innerHeight));
    this.input.onPointerLockChange((locked) => {
      if (!locked && (this.state === 'playing' || this.state === 'dialogue') && !this.params.automation && this.input.device === 'kbm') this.pause();
    });
    this.renderer.canvas.addEventListener('click', () => {
      if (this.state === 'playing' || this.state === 'dialogue') this.input.requestPointerLock();
    });
    this.renderer.onContextLost(() => {
      // Step quality down so a reload doesn't hit the same wall.
      const lower: QualityLevel = settings.value.quality === 'high' ? 'medium' : 'low';
      settings.set('quality', lower);
      this.state = 'paused';
      this.input.exitPointerLock();
      this.menus.showNotice(UI.gpuLostTitle, UI.gpuLostBody.replace('{quality}', lower), UI.reload, () => location.reload());
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && (this.state === 'playing' || this.state === 'dialogue')) this.pause();
    });

    // Debug: preset dialogue flags (before the first checkpoint is saved).
    for (const f of this.params.flags) this.director.flags.add(f as Flag);
    // Compile shaders up front so the first fight doesn't hitch.
    this.director.startAt(this.params.section);
    this.rig.update(0.016, this.player.position, { aiming: false, scoped: false, sprinting: false, crouched: false });
    // compileAsync waits for the driver to finish linking (parallel shader
    // compile), so the title screen doesn't crawl for its first seconds.
    try {
      await this.renderer.renderer.compileAsync(this.scene, this.rig.camera);
    } catch {
      this.renderer.renderer.compile(this.scene, this.rig.camera);
    }
    progress(1);
    (window as unknown as { __game: Game }).__game = this;
  }

  private buildEnvironment(): THREE.Texture {
    // A small neon-lit "room" for reflections on wet streets and glass.
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x03080c);
    const geo = new THREE.PlaneGeometry(1, 1);
    const add = (color: number, intensity: number, x: number, y: number, z: number, w: number, h: number): void => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
      m.position.set(x, y, z);
      m.scale.set(w, h, 1);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    add(0x30e0ff, 1.2, -8, 2, -6, 3, 0.6);
    add(0xff3fa8, 1.2, 8, 3, -4, 4, 0.7);
    add(0xffc04a, 1.4, 0, 2, 9, 6, 0.6);
    add(0x40ff9a, 0.8, -9, 4, 6, 1.5, 2);
    add(0x1a4a5a, 0.6, 0, 12, 0, 20, 20);
    add(0xa060ff, 0.8, 9, 1, 7, 1.5, 1.5);
    const pm = new THREE.PMREMGenerator(this.renderer.renderer);
    const rt = pm.fromScene(env, 0.04);
    pm.dispose();
    return rt.texture;
  }

  private applyQuality(level: QualityLevel): void {
    const q = CONFIG.quality[level];
    this.renderer.setQuality(level);
    this.sun.castShadow = q.shadows;
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    this.fogDensity = q.fogDensity;
    globalUniforms.uCaustics.value = q.caustics ? 1 : 0;
    this.lights.setCount(q.maxPointLights);
    this.fx.add.scale = q.particleScale;
    this.fx.setPixelRatio(this.renderer.renderer.getPixelRatio(), window.innerHeight);
    (this.avatar as Avatar & { setQuality?: (l: QualityLevel) => void }).setQuality?.(level);
  }

  // ---- State machine ----

  begin(): void {
    const finish = (): void => {
      if (this.params.autostart) this.startGame();
      else this.toTitle();
    };
    if (this.params.autostart) {
      finish();
      return;
    }
    this.hud.setVisible(false);
    this.hud.clearPrompts();
    this.menus.waitForAnyKey(() => {
      void this.audio.unlock();
      finish();
    });
    this.state = 'title';
  }

  toTitle(): void {
    this.state = 'title';
    this.hud.setVisible(false);
    this.audio.setMusic('title');
    const save = this.params.persist ? this.director.peekSave() : null;
    const diffName: Record<Difficulty, string> = { story: UI.diffStory, standard: UI.diffStandard, veteran: UI.diffVeteran };
    this.menus.showTitle({
      continueLabel: save
        ? UI.continueFrom.replace('{place}', SECTION_NAMES[save.section]).replace('{time}', formatTime(save.time)).replace('{difficulty}', diffName[save.difficulty])
        : null,
      onContinue: () => {
        if (this.director.loadSave()) this.startGame();
        else this.startGame({ intro: true });
      },
      onNew: (difficulty) => {
        settings.set('difficulty', difficulty);
        this.director.clearSave();
        this.startGame({ intro: true });
      },
    });
  }

  /** Into the game: through the opening for a new run, straight in otherwise. */
  startGame(opts: { intro?: boolean } = {}): void {
    void this.audio.unlock();
    this.menus.hide();
    if ((opts.intro || this.params.intro) && this.director.current === 1) {
      this.state = 'cinematic';
      this.hud.setVisible(false);
      // Take the mouse now, while the click that started the game still counts as a gesture.
      this.input.requestPointerLock();
      this.director.setMusic(this.director.section(1).def.music);
      this.cinematic.play(openingShots(this), () => this.beginPlay());
      return;
    }
    this.beginPlay();
  }

  private beginPlay(): void {
    this.hud.setVisible(true);
    this.state = 'playing';
    // Cut straight to the gameplay camera behind her.
    this.rig.endDialogue();
    this.rig.endCine();
    this.rig.snap(this.player.position, this.player.yaw);
    this.input.requestPointerLock();
    this.director.setMusic(this.director.ambientMusic());
    this.director.onGameStart();
  }

  /** The Crocodile is dealt with: watch the Basin fill, then the epilogue and the results. */
  playEnding(): void {
    this.state = 'cinematic';
    this.hud.setVisible(false);
    this.hud.clearPrompts();
    this.input.exitPointerLock();
    this.cinematic.play(endingShots(this), () => this.showEnd());
  }

  pause(): void {
    if (this.state !== 'playing' && this.state !== 'dialogue') return;
    const prev = this.state;
    this.state = 'paused';
    this.audio.setPaused(true);
    this.input.exitPointerLock();
    this.menus.showPause(
      () => this.resume(prev),
      () => {
        this.resume('playing');
        this.director.respawnFromCheckpoint();
      },
      () => location.reload(),
    );
  }

  resume(to: GameState = 'playing'): void {
    this.menus.hide();
    this.audio.setPaused(false);
    this.state = to === 'dialogue' && this.dialogue.active ? 'dialogue' : 'playing';
    this.input.requestPointerLock();
    this.input.reset();
  }

  showDeath(): void {
    this.state = 'dead';
    this.input.exitPointerLock();
    this.director.deathsHere++;
    const retry = (): void => {
      this.menus.hide();
      this.director.respawnFromCheckpoint();
      this.state = 'playing';
      this.input.requestPointerLock();
    };
    // Stuck on the same stretch: offer the next setting down (it can be changed back in Settings).
    const d = settings.value.difficulty;
    const lower: Difficulty | null = this.director.deathsHere >= 3 ? (d === 'veteran' ? 'standard' : d === 'standard' ? 'story' : null) : null;
    this.menus.showDeath(
      retry,
      () => location.reload(),
      lower
        ? {
            label: UI.retryEasier.replace('{difficulty}', lower === 'story' ? UI.diffStory : UI.diffStandard),
            action: () => {
              settings.set('difficulty', lower);
              retry();
            },
          }
        : null,
    );
  }

  showEnd(): void {
    this.state = 'end';
    this.endT = 0;
    this.hud.setVisible(false);
    this.input.exitPointerLock();
    this.audio.setMusic('victory');
    this.setPieces.basin?.setEye(0);
    this.setPieces.basin?.setFlood(1);
    const d = this.director;
    const flags = d.flags as Set<string>;
    const paras = END_TEXT.filter((p) => (!p.flag || flags.has(p.flag)) && (!p.not || !flags.has(p.not))).map((p) => p.text);
    const difficulty = settings.value.difficulty;
    const zonesTotal = d.sections.reduce((n, s) => n + (s.def.zones?.length ?? 0), 0);
    const found = { logs: d.logsFound.size, logsTotal: MARI_LOGS.length, zones: d.discovered.size, zonesTotal };
    const totals = this.stats.totals;
    const result = scoreRun(totals, found, difficulty);
    const before = loadBest()[difficulty];
    const improved = this.params.persist ? saveBest(difficulty, totals.time, result) : { bestTime: false, bestScore: false };
    const again = (): void => {
      const u = new URL(location.href);
      u.searchParams.delete('section');
      location.href = u.toString();
    };
    this.menus.showEpilogue(paras, () => this.menus.showResults({ totals, result, found, difficulty, best: before ?? null, improved }, again));
  }

  startDialogue(id: string, npc: Npc | null): void {
    this.dialogueNpc = npc;
    this.state = 'dialogue';
    this.player.inputLocked = true;
    this.player.exitCover();
    this.hud.setVisible(false);
    this.hud.clearPrompts();
    this.hud.contextPrompt(null);
    const partner = this.dialoguePartnerHead(_v);
    // Face the partner.
    this.player.yaw = Math.atan2(-(partner.x - this.player.position.x), -(partner.z - this.player.position.z));
    npc?.lookAt(this.avatar.headWorld(_v2));
    this.avatar.lookAt(partner);
    this.dialogue.start(id, () => this.endDialogue());
  }

  private endDialogue(): void {
    this.dialogueNpc?.setTalking(false);
    this.dialogueNpc?.lookAt(null);
    this.dialogueNpc?.markTalked();
    this.dialogueNpc = null;
    this.avatar.lookAt(null);
    this.avatar.setTalking(false);
    this.player.inputLocked = false;
    this.rig.endDialogue();
    this.rig.yaw = this.player.yaw;
    this.events.emit('dialogueEnd');
    if (this.state === 'dialogue') {
      this.state = 'playing';
      this.hud.setVisible(true);
    }
  }

  private dialoguePartnerHead(out: THREE.Vector3): THREE.Vector3 {
    if (this.dialogueNpc) return this.dialogueNpc.headWorld(out);
    if (this.boss.enemy) return this.boss.headWorld(out);
    return out.copy(this.player.position).add(new THREE.Vector3(0, 1.6, -2));
  }

  /** Camera framing for each line: a close-up of the speaker from the listener's side. */
  onDialogueLine(speaker: SpeakerId): void {
    const imani = this.avatar.headWorld(_v);
    const partner = this.dialoguePartnerHead(_v2);
    const speakerIsImani = speaker === 'imani';
    const a = speakerIsImani ? imani : partner;
    const b = speakerIsImani ? partner : imani;
    const dir = _v3.copy(b).sub(a);
    const len = dir.length();
    dir.normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    const dist = speaker === 'croc' ? 5.4 : Math.min(1.45, Math.max(0.9, len * 0.65));
    const croc = speaker === 'croc';
    // The Crocodile is shot from below, a little off axis: he is big.
    const pos = a.clone().addScaledVector(dir, dist).addScaledVector(side, (croc ? 1.1 : 0.42) * (speakerIsImani ? -1 : 1)).add(new THREE.Vector3(0, croc ? -1.3 : 0.04, 0));
    const look = a.clone().add(new THREE.Vector3(0, croc ? -0.35 : -0.04, 0));
    // Keep the shot out of walls: pull it in toward the speaker if something is in the way.
    const toCam = _v3.copy(pos).sub(a);
    const camDist = toCam.length();
    toCam.divideScalar(camDist);
    const free = this.physics.sphereCast(a, toCam, 0.18, camDist, MASK.world);
    if (free < camDist) pos.copy(a).addScaledVector(toCam, Math.max(0.35, free - 0.1));
    // Shot/reverse-shot: cut when the speaker changes, hold when they carry on.
    const cut = this.rig.mode !== 'dialogue' || speaker !== this.shotSpeaker;
    this.shotSpeaker = speaker;
    if (cut) this.rig.frame(pos, look, true);
    this.dialogueFocus.copy(a);
    this.avatar.setTalking(speakerIsImani);
    this.dialogueNpc?.setTalking(!speakerIsImani);
    this.boss.setTalking(!speakerIsImani);
  }

  /** Continuous sounds that follow the player's state. */
  private updateLoops(): void {
    const p = this.player;
    const live = this.state === 'playing' && p.alive;
    this.audio.setLoop('hoverJets', live && p.hovering ? 1 : 0);
    const low = CONFIG.player.healthMax * CONFIG.feel.lowHealthFraction;
    this.audio.setLoop('heartbeat', live && p.health < low ? 0.55 + 0.45 * (1 - p.health / low) : 0);
  }

  // ---- Frame loop ----

  run(): void {
    this.manual = new URLSearchParams(location.search).get('manual') === '1';
    if (this.manual) {
      this.step(1 / 60);
      return;
    }
    this.last = performance.now();
    const loop = (now: number): void => {
      const realDt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      this.step(realDt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /** One frame. Public so tests can drive the simulation deterministically. */
  step(realDt: number): void {
    this.frame++;
    const input = this.input;
    input.update(realDt);
    if (input.pressed('debug')) this.debug.toggle();
    let dt = 0;

    switch (this.state) {
      case 'title':
        this.menus.pollAnyKey();
        this.menus.update();
        // Start may have been chosen just now; the title shot must not run
        // again or it leaves the camera parked on the title view.
        if (this.state === 'title') this.titleCamera(realDt);
        break;
      case 'playing': {
        if (input.pressed('pause')) {
          this.pause();
          break;
        }
        dt = this.time.tick(realDt);
        this.stats.totals.time += realDt;
        this.director.preUpdate();
        this.player.update(dt);
        this.enemies.update(dt);
        this.boss.update(dt);
        this.bolts.update(dt);
        this.explosives.update(dt);
        this.physics.step(dt);
        this.director.update(dt);
        break;
      }
      case 'dialogue':
        if (input.pressed('pause')) {
          this.pause();
          break;
        }
        dt = this.time.tick(realDt);
        this.dialogue.update(realDt);
        this.director.update(dt);
        this.boss.update(dt);
        this.physics.step(dt);
        break;
      case 'cinematic':
        // The world keeps living under a cutscene; nobody fights.
        dt = this.time.tick(realDt);
        this.cinematic.update(realDt);
        this.director.animateWorld(dt);
        this.physics.step(dt);
        break;
      case 'paused':
      case 'dead':
        this.menus.update();
        break;
      case 'end':
        this.menus.update();
        dt = this.time.tick(realDt);
        this.director.animateWorld(dt);
        this.endCamera(realDt);
        break;
    }

    // Hover jets and the low-health heartbeat stop with play (conversations, cutscenes, the end).
    if (this.state !== 'paused') this.updateLoops();

    // Visuals.
    const p = this.player;
    const simDt = this.state === 'paused' ? 0 : dt || (this.state === 'title' ? realDt : 0);
    this.avatar.object.position.copy(p.position);
    this.avatar.update(simDt, p.anim);
    this.avatar.object.updateMatrixWorld(true);
    if (this.state !== 'title') {
      this.rig.update(this.state === 'paused' ? 0 : realDt, p.position, {
        aiming: p.aiming,
        scoped: p.scoped,
        sprinting: p.sprinting,
        crouched: p.crouched,
      });
    }
    // Fade the avatar if the camera is jammed into her.
    this.avatar.setOpacity(this.rig.mode === 'gameplay' ? THREE.MathUtils.clamp((this.rig.distanceNow - 0.35) / 0.5, 0.15, 1) : 1);
    this.fx.update(simDt);
    this.lights.update(realDt);
    globalUniforms.uTime.value += simDt || realDt * 0.3;
    this.dome.setIndoors(this.director.current === 3 && this.player.position.z < -152);
    this.dome.update(realDt, this.rig.camera.position);
    if (this.state !== 'paused') this.leviathan.update(realDt, this.director.zoneId === 'glass');
    // Ambient and haze follow the section (indoors vs out).
    const sdef = this.director.section(this.director.current).def;
    const amb = sdef.ambient;
    const k = Math.min(1, realDt * 1.5);
    if (amb) {
      _c1.setHex(amb[0]);
      _c2.setHex(amb[1]);
      this.hemi.color.lerp(_c1, k);
      this.hemi.groundColor.lerp(_c2, k);
      this.hemi.intensity += (amb[2] - this.hemi.intensity) * k;
    }
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.lerp(_c1.setHex(sdef.fog?.[0] ?? CONFIG.look.fogColor), k);
    fog.density += (this.fogDensity * (sdef.fog?.[1] ?? 1) - fog.density) * k;
    // Fill light: between the camera and her chest, a little above. In a
    // conversation it becomes the key light on whoever is speaking.
    const closeUp = this.state === 'cinematic' && this.avatar.headWorld(_v3).distanceTo(this.rig.camera.position) < 4.5;
    if (closeUp) this.dialogueFocus.copy(_v3);
    if ((this.state === 'dialogue' && this.rig.mode === 'dialogue') || closeUp) {
      const cam = this.rig.camera.position;
      this.charLight.position.copy(cam).lerp(this.dialogueFocus, 0.4);
      // Off to the camera's left and above: a three-quarter key.
      _v3.copy(this.dialogueFocus).sub(cam).setY(0).normalize();
      this.charLight.position.x += -_v3.z * -0.7;
      this.charLight.position.z += _v3.x * -0.7;
      this.charLight.position.y += 0.55;
      this.charLight.intensity += (3.6 - this.charLight.intensity) * Math.min(1, realDt * 6);
    } else {
      this.avatar.chestWorld(_v3);
      this.charLight.position.copy(this.rig.camera.position).lerp(_v3, 0.45);
      this.charLight.position.y += 0.9;
      this.charLight.intensity += (2.2 - this.charLight.intensity) * Math.min(1, realDt * 6);
    }
    // Shadow camera follows the player.
    this.sun.position.set(p.position.x + 18, p.position.y + 50, p.position.z + 12);
    this.sun.target.position.copy(p.position);
    // Finishing pass: fringing swells with impacts, the picture drains when she is down.
    this.deathFade += ((p.alive ? 0 : 1) - this.deathFade) * Math.min(1, realDt * (p.alive ? 6 : 1.2));
    this.renderer.setPostFrame(globalUniforms.uTime.value, this.rig.shakeLevel, this.deathFade);
    this.audio.setListener(this.rig.camera.position, this.rig.right);
    if (this.state === 'playing' || this.state === 'dialogue') this.hud.update(realDt);
    if (!this.skipRender) this.renderer.render();
    this.debug.update(realDt);
    input.endFrame();
  }

  /** Debug/tests: point the camera at a world position. */
  debugAimAt(x: number, y: number, z: number): void {
    // Aim from the camera's current origin; iterate twice since the origin depends on the aim.
    for (let i = 0; i < 3; i++) {
      const o = this.rig.aimOrigin;
      const dx = x - o.x;
      const dy = y - o.y;
      const dz = z - o.z;
      this.rig.yaw = Math.atan2(-dx, -dz);
      this.rig.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      this.rig.recoilPitch = 0;
      this.rig.recoilYaw = 0;
      this.rig.update(0, this.player.position, { aiming: this.player.aiming, scoped: this.player.scoped, sprinting: false, crouched: this.player.crouched });
    }
  }

  /** Debug: renderables in the camera frustum grouped by kind/material (draw-call hunting). */
  inspectDrawables(): Record<string, number> {
    const cam = this.rig.camera;
    cam.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const out: Record<string, number> = {};
    this.scene.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (!(m.isMesh || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite)) return;
      if (m.frustumCulled !== false && m.geometry) {
        if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
        const s = m.geometry.boundingSphere!.clone().applyMatrix4(m.matrixWorld);
        if (!frustum.intersectsSphere(s)) return;
      }
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      const key = `${o.type}:${mat?.name || mat?.type}${m.castShadow ? ':shadow' : ''}`;
      out[key] = (out[key] ?? 0) + 1;
    });
    return out;
  }

  /** Advance the game by `seconds` in fixed steps, rendering only the last frame. */
  simulate(seconds: number, dt = 1 / 60): void {
    const n = Math.max(1, Math.round(seconds / dt));
    const keep = this.skipRender;
    for (let i = 0; i < n; i++) {
      this.skipRender = keep || i < n - 1;
      this.step(dt);
    }
    this.skipRender = keep;
  }

  /** Behind the end screens: a slow turn around the lake, now full. */
  private endCamera(dt: number): void {
    this.endT += dt;
    const a = this.endT * 0.045 + 0.9;
    const c = ARENA_CENTER;
    _v.set(c.x + Math.sin(a) * 17, ARENA_Y + 6.5 + Math.sin(this.endT * 0.11) * 0.8, c.z + Math.cos(a) * 17);
    _v2.set(c.x, ARENA_Y + 1.2, c.z);
    this.rig.cine(_v, _v2, 44);
  }

  private titleCamera(dt: number): void {
    this.titleT += dt;
    const t = this.titleT * 0.05 + 1.2;
    const center = _v.set(1, 3.2, -22);
    const pos = _v2.set(center.x + Math.cos(t) * 7, 3.6 + Math.sin(t * 0.7) * 0.6, center.z + Math.sin(t) * 9);
    this.rig.frame(pos, center, this.titleT < 0.1);
    this.rig.update(dt, this.player.position, { aiming: false, scoped: false, sprinting: false, crouched: false });
  }
}
