// Headless screenshots and scripted checks. Usage:
//   node scripts/shots.mjs [scenario ...]
// Scenarios: sections, boot, playthrough (PAD=1 for the gamepad), save, crew, high, boss, and the older
// per-milestone checks (tour, dialogue, title, anims, closeup, fight, combat, gamepad, movement, camera, cover).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from './serve.mjs';

const OUT = path.resolve('docs/screenshots');
fs.mkdirSync(OUT, { recursive: true });
const scenarios = process.argv.slice(2);
if (!scenarios.length) scenarios.push('sections');

// The sandbox image ships Chromium at a fixed path; elsewhere Playwright finds its own.
const exe = ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));
const server = await serve(path.resolve('dist'));
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];

async function open(query, size = { width: 1280, height: 720 }, init) {
  const page = await browser.newPage({ viewport: size });
  if (init) await page.addInitScript(init);
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${query}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${query}] ${e.message}`));
  // Fonts come from Google; the sandbox proxy isn't trusted by this browser, so serve empty CSS.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.goto(`http://localhost:4173/BlastEffect/?${query}`);
  await page.waitForFunction(() => window.__game && window.__game.state !== 'loading', null, { timeout: 120000 });
  return page;
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('shot', name);
}

// A fake standard-mapping gamepad the page can drive through window.__pad.
const FAKE_PAD = () => {
  const pad = {
    id: 'Fake Xbox Controller', index: 0, connected: true, mapping: 'standard', timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    vibrationActuator: { playEffect: () => Promise.resolve('complete') },
  };
  window.__pad = {
    pad,
    press(i, v = 1) { pad.buttons[i] = { pressed: v > 0.5, touched: v > 0, value: v }; },
    release(i) { pad.buttons[i] = { pressed: false, touched: false, value: 0 }; },
    axis(i, v) { pad.axes[i] = v; },
  };
  navigator.getGamepads = () => [pad, null, null, null];
};

// Page-side playthrough bot (see the playthrough scenario).
const BOT = (usePad) => {
  const g = window.__game;
  const p = g.player;
  const d = g.director;
  const V = p.position.constructor;
  const dt = 1 / 60;
  const tmp = new V();
  const tmp2 = new V();
  const path = Array.from({ length: 24 }, () => new V());
  const PADB = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, UP: 12, DOWN: 13 };
  const bot = {
    t: 0, sectionT: 0, section: d.current, pathN: 0, pathI: 0, repath: 0, topups: 0, combos0: 0,
    stuckT: 0, lastPos: new V().copy(p.position), blockedT: 0, talked: new Set(), held: {}, tapNext: {},
    dialogT: 0, stuck: false, log: [], pushT: 0, noProgressT: 0, lastHp: 0, chaseT: 0,
  };
  // ---- Input layer: keyboard/mouse actions or the fake pad. ----
  const hold = (a, on) => { bot.held[a] = on; };
  const tap = (a) => { bot.tapNext[a] = true; };
  const padButton = { fire: PADB.RT, aim: PADB.LT, jump: PADB.A, interact: PADB.X, swapWeapon: PADB.Y, power1: PADB.LB, power2: PADB.RB, uiConfirm: PADB.A, uiDown: PADB.DOWN, dash: PADB.B };
  let prevTaps = {};
  const apply = (mx, my) => {
    if (usePad) {
      const P = window.__pad;
      P.axis(0, mx);
      P.axis(1, -my);
      const down = {};
      for (const a in bot.held) if (bot.held[a]) down[padButton[a]] = true;
      // A tap is a press this frame, released next frame (needs an edge).
      for (const a in bot.tapNext) if (bot.tapNext[a] && !prevTaps[a]) down[padButton[a]] = true;
      for (let i = 0; i < 17; i++) { if (down[i]) P.press(i, 1); else P.release(i); }
    } else {
      g.input.injectMove(mx, my);
      // Let go of anything held last frame and not this one.
      for (const a in bot.prevHeld) if (!bot.held[a]) g.input.inject(a, false);
      bot.prevHeld = bot.held;
      for (const a in bot.held) g.input.inject(a, !!bot.held[a]);
      for (const a in bot.tapNext) if (bot.tapNext[a] && !prevTaps[a]) g.input.inject(a, true);
    }
  };
  const release = () => {
    if (!usePad) for (const a in bot.tapNext) if (bot.tapNext[a]) g.input.inject(a, !!bot.held[a]);
    prevTaps = bot.tapNext;
    bot.tapNext = {};
  };
  // ---- Helpers ----
  // Heading from the player (not the camera, which trails behind her).
  const faceTo = (x, z) => {
    g.rig.yaw = Math.atan2(-(x - p.position.x), -(z - p.position.z));
    g.rig.pitch = 0;
  };
  // Fights whoever has noticed her; a crew still at its posts only once it is close and in view.
  const enemies = () => g.enemies.active.filter((e) => {
    if (!e.alive || e.state === 'spawning') return false;
    const dist = e.position.distanceTo(p.position);
    if (dist > 48) return false;
    if (e.alerted) return true;
    return dist < 30 && e.section === d.current && !g.physics.blocked(g.rig.aimOrigin, e.chestPoint(tmp2));
  });
  const pickTarget = () => {
    let best = null; let bestScore = 1e9;
    for (const e of enemies()) {
      e.chestPoint(tmp);
      const vis = !g.physics.blocked(g.rig.aimOrigin, tmp);
      const s = e.position.distanceTo(p.position) + (vis ? 0 : 25) + (e.kind === 'boss' ? 15 : 0);
      if (s < bestScore) { bestScore = s; best = e; }
    }
    return best;
  };
  const steerTo = (goal) => {
    const nav = d.nav;
    bot.repath -= dt;
    if (bot.repath <= 0) {
      bot.repath = 1.5;
      bot.pathN = nav ? nav.findPath(p.position, goal, path) : 0;
      bot.pathI = 0;
      // The first waypoint can sit just behind her (nearest grid node): skip it.
      while (bot.pathI < bot.pathN - 1 && Math.hypot(path[bot.pathI].x - p.position.x, path[bot.pathI].z - p.position.z) < 1.0) bot.pathI++;
    }
    let wp = goal;
    while (bot.pathI < bot.pathN) {
      const w = path[bot.pathI];
      if (Math.hypot(w.x - p.position.x, w.z - p.position.z) < 0.8 && bot.pathI < bot.pathN - 1) bot.pathI++;
      else { wp = w; break; }
    }
    faceTo(wp.x, wp.z);
    return Math.hypot(goal.x - p.position.x, goal.z - p.position.z);
  };
  // ---- One frame ----
  const frame = () => {
    bot.held = {};
    let mx = 0; let my = 0;
    const st = g.state;
    if (st === 'dialogue') {
      bot.dialogT += dt;
      if (bot.dialogT > 0.35) {
        bot.dialogT = 0;
        tap('uiConfirm'); // skips typing, then takes the focused (first) choice
      }
    } else if (st === 'playing') {
      if (d.current !== bot.section) { bot.section = d.current; bot.sectionT = 0; }
      bot.sectionT += dt;
      if (p.weapons.smg.reserve < 80) { p.weapons.smg.reserve += 200; bot.topups++; }
      if (p.weapons.rifle.reserve < 10) { p.weapons.rifle.reserve += 24; bot.topups++; }
      const target = pickTarget();
      const boss = g.boss.croc;
      if (target) {
        const e = target;
        const weak = e.kind === 'boss' && e.defenses.shield <= 0 && e.defenses.armor > 0;
        if (weak) e.model.weakWorld(tmp); else e.chestPoint(tmp);
        g.debugAimAt(tmp.x, tmp.y, tmp.z);
        const blocked = g.physics.blocked(g.rig.aimOrigin, tmp);
        bot.blockedT = blocked ? bot.blockedT + dt : 0;
        const wantRifle = (e.defenses.shield <= 0 && e.defenses.armor > 0);
        const cur = p.weapons.current;
        if ((wantRifle && cur !== 'rifle') || (!wantRifle && cur !== 'smg')) { if (!p.weapons.isSwapping && !p.weapons.isReloading) tap('swapWeapon'); }
        hold('aim', true);
        if (!blocked) {
          if (p.weapons.current === 'rifle') { if (g.frame % 36 === 0) tap('fire'); }
          else hold('fire', true);
        }
        // Powers: snare anything stripped, then detonate with a lance.
        if (!blocked && e.canBePrimed && !e.primed && p.powers.cooldown.pull <= 0) tap('power1');
        else if (!blocked && e.primed && p.powers.cooldown.throw <= 0) tap('power2');
        const dist = e.position.distanceTo(p.position);
        // No damage landing for a while (target tucked in cover): close in.
        let hp = 0;
        for (const x of enemies()) hp += x.defenses.shield + x.defenses.armor + x.defenses.health;
        if (hp < bot.lastHp - 0.5) bot.noProgressT = 0; else bot.noProgressT += dt;
        bot.lastHp = hp;
        if (bot.noProgressT > 6 && e.kind !== 'boss') { bot.chaseT = 4; bot.noProgressT = 0; }
        if (bot.chaseT > 0) bot.chaseT -= dt;
        if ((bot.blockedT > 1.5 || bot.chaseT > 0) && dist > 4) {
          // Go get them: walk the nav path (camera follows the path).
          hold('aim', false);
          steerTo(e.position);
          my = 1;
          if (bot.lastPos.distanceTo(p.position) < 0.02) bot.stuckT += dt; else bot.stuckT = 0;
          if (bot.stuckT > 1.2) { tap('jump'); mx = Math.sin(bot.t * 3); }
        } else {
          mx = Math.sin(bot.t * 0.8) * 0.7;
          my = e.kind === 'boss' && dist < 8 ? -1 : 0;
        }
        if (boss.ringActive) {
          const rd = Math.hypot(p.position.x - boss.ringCenter.x, p.position.z - boss.ringCenter.z);
          if (Math.abs(rd - boss.ringR) < 3 && p.grounded) tap('jump');
        }
      } else {
        // Optional NPC: Yaw in the club once the floor is clear.
        const yaw = d.npcDef('yaw');
        let goal = d.objectiveMarker;
        let talkTo = null;
        if (d.current === 3 && yaw && !bot.talked.has('yaw') && yaw.canTalk(d)) {
          goal = tmp2.copy(yaw.root.position);
          talkTo = 'yaw';
        }
        const odette = d.npcDef('odette');
        if (d.current === 1 && odette && !bot.talked.has('odette')) { talkTo = 'odette'; }
        if (d.interactTarget && talkTo) {
          bot.talked.add(talkTo);
          tap('interact');
        } else if (goal) {
          const gp = tmp2.copy(goal);
          if (d.nav && !d.nav.walkable(gp.x, gp.y, gp.z)) {
            // Markers float above the floor (and doors sit past the grid's
            // edge): path to the nearest walkable floor under/near them.
            let found = false;
            for (let r = 0; r <= 3 && !found; r += 0.5) {
              for (let a = 0; a < 8 && !found; a++) {
                const x = goal.x + Math.sin(a * Math.PI / 4) * r;
                const z = goal.z + Math.cos(a * Math.PI / 4) * r;
                for (let y = goal.y + 0.5; y > goal.y - 4; y -= 0.25) {
                  if (d.nav.walkable(x, y, z)) { gp.set(x, y, z); found = true; break; }
                }
                if (r === 0) break;
              }
            }
          }
          if (bot.pushT > 0) {
            // Reached a door marker: keep going forward (-z) into the next section.
            bot.pushT -= dt;
            g.rig.yaw = 0;
            my = 1;
          } else {
            const dist = steerTo(gp);
            my = 1;
            if (dist < 1.2 && !talkTo) bot.pushT = 3;
          }
        }
        // Stuck: hop and wiggle.
        if (bot.lastPos.distanceTo(p.position) < 0.02 && my !== 0) bot.stuckT += dt; else bot.stuckT = 0;
        if (bot.stuckT > 1.2) { tap('jump'); mx = Math.sin(bot.t * 3); }
      }
      bot.lastPos.copy(p.position);
    } else if (st === 'dead') {
      // Retry. Spaced taps: the screen ignores input for a moment, and a tap needs a fresh press.
      if (g.frame % 30 === 0) tap('uiConfirm');
    }
    apply(mx, my);
    g.step(dt);
    release();
    bot.t += dt;
  };
  bot.run = (frames) => {
    g.skipRender = true;
    for (let i = 0; i < frames && g.state !== 'end'; i++) frame();
    if (bot.sectionT > 420) bot.stuck = true;
    return {
      t: +bot.t.toFixed(1), state: g.state, section: d.current, objective: d.objective, pos: [p.position.x, p.position.y, p.position.z].map((v) => +v.toFixed(1)),
      alive: g.enemies.aliveCount(), kills: g.enemies.kills, combos: g.combat.combos, topups: bot.topups, stuck: bot.stuck,
      boss: g.boss.enemy ? { mode: g.boss.croc.mode, phase: g.boss.croc.phase } : null,
      enemies: bot.stuck ? g.enemies.active.filter((e) => e.alive).map((e) => `${e.kind}@${e.position.x.toFixed(1)},${e.position.y.toFixed(1)},${e.position.z.toFixed(1)}:${e.state}`) : undefined,
    };
  };
  window.__bot = bot;
};

if (process.env.DUMP_BOT) fs.writeFileSync(process.env.DUMP_BOT, `window.__installBot = ${BOT.toString()};`);

const TOUR = {
  1: [[-5, 0, -3, 0, -0.05], [3, 0, -30, Math.PI, -0.05], [-2, 0, -35, 0.1, 0.05], [9, 0, -16, Math.PI / 2, -0.05]],
  2: [[0, 0, -46, 0, -0.02], [0, 0, -92, 0.2, 0.0], [5, 0, -122, 0.3, -0.02], [0, 0, -146, Math.PI, 0.05]],
  3: [[0, 0, -156, 0, 0.05], [-6, 0, -176, Math.PI / 2, 0.0], [19.5, 4.2, -192, Math.PI / 2 - 0.4, -0.15], [-14, 0, -166, -0.6, 0.05]],
  4: [[0, 4.2, -204, 0, 0.08], [0, 6.6, -240, 0, 0.05], [0, 9, -276, Math.PI, -0.15], [13, 4.2, -222, 0.5, 0.0]],
  5: [[0, 9, -286, 0, 0.05], [15.5, 12, -292, 2.3, -0.2], [0, 9, -318, Math.PI, 0.0], [-20, 9, -300, -1.0, 0.0]],
};

const run = {
  async tour() {
    const only = process.env.SECTION ? [Number(process.env.SECTION)] : [1, 2, 3, 4, 5];
    for (const sec of only) {
      const page = await open(`section=${sec}&autostart=1&manual=1&god=1&quality=${process.env.QUALITY ?? 'medium'}`);
      const files = [];
      const labels = [];
      for (const [i, v] of TOUR[sec].entries()) {
        const st = await page.evaluate((v) => {
          const g = window.__game;
          g.hud.setVisible(false);
          g.player.teleport({ x: v[0], y: v[1], z: v[2] });
          g.player.yaw = v[3];
          g.rig.yaw = v[3];
          g.rig.pitch = v[4];
          g.simulate(0.6);
          return { ...g.renderer.frameStats };
        }, v);
        const f = path.join(OUT, `tour-${sec}-${i}.png`);
        await page.screenshot({ path: f });
        files.push(f);
        labels.push(`${sec}.${i}  calls ${st.calls}  tris ${Math.round(st.triangles / 1000)}k`);
        console.log(`section ${sec} view ${i}: calls ${st.calls}, tris ${st.triangles}`);
      }
      const { execFileSync } = await import('node:child_process');
      execFileSync('montage', [...files.map((f, i) => ['-label', labels[i], f]).flat(), '-tile', '2x2', '-geometry', '640x360+2+2', '-background', '#222', '-fill', 'white', path.join(OUT, `m7-section${sec}.png`)]);
      for (const f of files) fs.unlinkSync(f);
      await page.close();
    }
  },

  async dialogue() {
    const page = await open('section=1&autostart=1&manual=1');
    const info = await page.evaluate(() => {
      const g = window.__game;
      const p = g.player;
      p.teleport({ x: 3.0, y: 0, z: -10.6 });
      p.yaw = -Math.PI / 2;
      g.rig.yaw = -Math.PI / 2;
      g.simulate(0.5);
      const near = !!g.director.interactTarget;
      g.input.inject('interact', true);
      g.step(1 / 60);
      g.input.inject('interact', false);
      g.simulate(1.5);
      return { near, state: g.state, node: g.dialogue.nodeId };
    });
    console.log('dialogue start', JSON.stringify(info));
    await shot(page, 'm6-dialogue-odette');
    // Advance: first choice, then a line Imani speaks.
    const steps = await page.evaluate(() => {
      const g = window.__game;
      const seen = [];
      for (let i = 0; i < 4 && g.state === 'dialogue'; i++) {
        g.dialogue.autoAdvance(i === 0 ? 0 : 0);
        g.simulate(1.2);
        seen.push(g.dialogue.nodeId);
        if (g.dialogue.currentSpeaker === 'imani') break;
      }
      return seen;
    });
    console.log('dialogue path', JSON.stringify(steps));
    await shot(page, 'm6-dialogue-imani');
    const end = await page.evaluate(() => {
      const g = window.__game;
      // Choose the schematic (second option at the favour node) and finish.
      let guard = 0;
      while (g.state === 'dialogue' && guard++ < 40) {
        const id = g.dialogue.nodeId;
        g.dialogue.autoAdvance(id === 'favor' ? 1 : 0);
        g.simulate(0.2);
      }
      g.simulate(2);
      return { state: g.state, flags: [...g.director.flags], gateOpen: g.director.objective, history: g.dialogue.history };
    });
    console.log('dialogue end', JSON.stringify(end));
    await shot(page, 'm6-after-dialogue');
    await page.close();
  },

  async title() {
    const page = await open('section=1&manual=1');
    await page.evaluate(() => window.__game.simulate(0.5));
    await shot(page, 'm9-press-any');
    await page.keyboard.press('Enter');
    await page.evaluate(() => window.__game.simulate(1.5));
    await shot(page, 'm9-title');
    await page.close();
  },

  async anims() {
    const page = await open('section=1&autostart=1&manual=1&god=1', { width: 640, height: 720 });
    await page.evaluate(() => {
      const g = window.__game;
      g.hud.setVisible(false);
      window.__frame = (angleDeg = 35, dist = 3.2, h = 1.0) => {
        const p = g.player.position;
        const V = p.constructor;
        // Body forward is (-sin yaw, -cos yaw); orbit around it.
        const a = g.player.yaw + (angleDeg * Math.PI) / 180;
        const pos = new V(p.x - Math.sin(a) * dist, p.y + h + 0.3, p.z - Math.cos(a) * dist);
        g.rig.frame(pos, new V(p.x, p.y + h, p.z), true);
      };
      window.__reset = (x = -5, z = -6, yaw = 0) => {
        const p = g.player;
        g.input.clearInjectedMove();
        for (const a of ['aim', 'fire', 'sprint', 'jump', 'dash', 'melee', 'reload']) g.input.inject(a, false);
        p.teleport({ x, y: 0, z });
        p.yaw = yaw;
        g.rig.yaw = yaw;
        p.combatActive = true;
        p.powers.reset();
        g.simulate(0.5);
      };
    });
    const poses = [
      ['idle', `__reset(); window.__frame(35, 3.0, 0.95); g.simulate(0.4);`],
      ['run', `__reset(-5, 2); g.input.injectMove(0, 1); g.simulate(0.73);`],
      ['sprint', `__reset(-5, 2); g.input.injectMove(0, 1); g.input.inject('sprint', true); g.simulate(0.81);`],
      ['aim', `__reset(); g.input.inject('aim', true); g.simulate(0.5);`],
      ['coverLow', `__reset(4.0, -11.5, -Math.PI / 2); g.input.injectMove(0, 1); g.simulate(0.6); g.input.injectMove(0, 0); g.simulate(0.5);`],
      ['coverHigh', `__reset(6.9, -6, -Math.PI / 2); g.input.injectMove(0, 1); g.simulate(0.6); g.input.injectMove(0, 0); g.simulate(0.5);`],
      ['jump', `__reset(); g.input.inject('jump', true); g.step(1 / 60); g.input.inject('jump', false); g.simulate(0.28);`],
      ['hover', `__reset(); g.input.inject('jump', true); g.step(1 / 60); g.input.inject('jump', false); g.simulate(0.45); g.input.inject('aim', true); g.simulate(0.5);`],
      ['dash', `__reset(); g.simulate(1.6); g.input.injectMove(-1, 0); g.step(1 / 60); g.input.inject('dash', true); g.step(1 / 60); g.input.inject('dash', false); g.simulate(0.1);`],
      ['castPull', `__reset(); g.avatar.trigger({ type: 'cast', power: 'pull' }); g.simulate(0.3);`],
      ['castThrow', `__reset(); g.avatar.trigger({ type: 'cast', power: 'throw' }); g.simulate(0.26);`],
      ['castCharge', `__reset(); g.avatar.trigger({ type: 'cast', power: 'charge' }); g.simulate(0.2);`],
      ['melee', `__reset(); g.avatar.trigger({ type: 'melee' }); g.simulate(0.22);`],
      ['reload', `__reset(); g.player.weapons.smg.mag = 10; g.player.weapons.startReload(); g.simulate(0.75);`],
      ['rifleAim', `__reset(); g.player.weapons.swap(); g.simulate(0.8); g.input.inject('aim', true); g.simulate(0.6);`],
      ['death', `__reset(); g.player.die(); g.simulate(1.6);`],
    ];
    const files = [];
    for (const [name, code] of poses) {
      await page.evaluate((code) => {
        const g = window.__game;
        // eslint-disable-next-line no-eval
        eval(code);
        window.__frame(35, 3.0, 0.95);
        g.step(1 / 60);
      }, code);
      const f = path.join(OUT, `pose-${name}.png`);
      await page.screenshot({ path: f });
      files.push(f);
      if (name === 'death') await page.evaluate(() => window.__game.player.spawn(window.__game.player.position.clone(), 0));
    }
    const { execFileSync } = await import('node:child_process');
    execFileSync('montage', [...files.map((f, i) => ['-label', poses[i][0], f]).flat(), '-tile', '8x2', '-geometry', '320x360+2+2', '-background', '#222', '-fill', 'white', path.join(OUT, 'm5-poses.png')]);
    for (const f of files) fs.unlinkSync(f);
    console.log('shot m5-poses');
    await page.close();
  },

  async closeup() {
    const page = await open('section=1&autostart=1&manual=1&god=1');
    const views = [
      ['m5-front', [0, 1.05, -3.1], [0, 0.98, 0]],
      ['m5-face', [0.12, 1.66, -0.62], [0, 1.62, 0]],
      ['m5-back', [0.9, 1.6, 3.0], [0, 1.15, 0]],
      ['m5-side', [3.0, 1.2, -0.4], [0, 1.0, 0]],
      ['m5-threequarter', [-1.9, 1.35, -2.3], [0, 1.05, 0]],
      ['m5-hands', [-0.75, 1.25, -1.0], [0, 1.0, 0]],
    ];
    await page.evaluate(() => {
      const g = window.__game;
      g.hud.setVisible(false);
      g.player.teleport({ x: -5, y: 0, z: -3 });
      g.player.yaw = 0;
      g.rig.yaw = 0;
      g.simulate(1.5);
    });
    for (const [name, off, look] of views) {
      await page.evaluate(({ off, look }) => {
        const g = window.__game;
        const p = g.player.position;
        const V = p.constructor;
        // Player faces -Z: "front" is at -Z from her.
        g.rig.frame(new V(p.x + off[0], p.y + off[1], p.z + off[2]), new V(p.x + look[0], p.y + look[1], p.z + look[2]), true);
        g.simulate(0.6);
      }, { off, look });
      await shot(page, name);
    }
    // Gameplay camera: idle, aiming, running.
    await page.evaluate(() => {
      const g = window.__game;
      g.rig.endDialogue();
      g.hud.setVisible(true);
      g.player.combatActive = true;
      g.simulate(0.8);
    });
    await shot(page, 'm5-gameplay-idle');
    await page.evaluate(() => {
      const g = window.__game;
      g.input.inject('aim', true);
      g.simulate(0.6);
    });
    await shot(page, 'm5-gameplay-aim');
    await page.evaluate(() => {
      const g = window.__game;
      g.input.inject('aim', false);
      g.input.injectMove(0, 1);
      g.simulate(0.53);
    });
    await shot(page, 'm5-gameplay-run');
    await page.close();
  },

  async fight() {
    const page = await open('section=2&autostart=1&manual=1&debug=1&god=1');
    // Walk up to the crew posted on the strip until they notice, and watch the AI for a while.
    const log = await page.evaluate(() => {
      const g = window.__game;
      const p = g.player;
      g.skipRender = true;
      p.teleport({ x: 0.5, y: 0, z: -72 });
      g.rig.yaw = 0;
      const out = [];
      let hits = 0;
      const shield0 = () => p.shield + p.health;
      for (let i = 0; i < 8 * 60; i++) {
        const before = shield0();
        g.step(1 / 60);
        if (shield0() < before) hits++;
        if (i % 60 === 59) {
          out.push(`t=${((i + 1) / 60).toFixed(0)}s ` + g.enemies.active.map((e) => `${e.kind}:${e.state}@${e.position.x.toFixed(0)},${e.position.z.toFixed(0)}${e.coverPoint ? '(cov)' : ''}`).join(' ') + ` tokens=${g.enemies.tokens.inUse} bolts=${g.bolts.activeCount}`);
        }
      }
      out.push(`frames with damage taken: ${hits}`);
      out.push(`fight started: ${g.director.encounters.find((e) => e.def.id === 'stripA').state === 'active'}`);
      g.skipRender = false;
      return out;
    });
    console.log(log.join('\n'));
    if (!log.includes('fight started: true')) errors.push('[fight] the posted crew never noticed her');
    await page.evaluate(() => window.__game.simulate(0.1));
    await shot(page, 'm2-fight-overview');
    // Shoot the nearest enemy until a hit marker shows.
    await page.evaluate(() => {
      const g = window.__game;
      const p = g.player;
      g.skipRender = true;
      g.input.inject('aim', true);
      for (let i = 0; i < 40; i++) {
        const e = g.enemies.active.filter((x) => x.alive).sort((a, b) => a.position.distanceTo(p.position) - b.position.distanceTo(p.position))[0];
        if (!e) break;
        const c = e.chestPoint(e.position.clone());
        g.debugAimAt(c.x, c.y, c.z);
        g.input.inject('fire', true);
        g.step(1 / 60);
      }
      g.skipRender = false;
      g.step(1 / 60);
    });
    await shot(page, 'm2-firing');
    await page.evaluate(() => {
      const g = window.__game;
      g.input.inject('fire', false);
      g.input.inject('aim', false);
    });
    // Snare + Lance combo on the nearest grunt.
    await page.evaluate(() => {
      const g = window.__game;
      const p = g.player;
      g.skipRender = true;
      p.powers.reset();
      const e = g.enemies.active.filter((x) => x.alive && x.kind === 'grunt')[0];
      if (!e) return;
      e.frozen = true;
      e.position.set(1.5, 0, -66);
      for (const o of g.enemies.active) if (o !== e && o.alive) { o.frozen = true; o.position.set(o === e ? 0 : (Math.random() - 0.5) * 3 + 2, 0, -68 - Math.random() * 2); }
      g.player.teleport({ x: 0.5, y: 0, z: -60 });
      g.simulate(0.3);
      const c = () => e.chestPoint(e.position.clone());
      let v = c();
      g.debugAimAt(v.x, v.y, v.z);
      g.input.inject('power1', true);
      g.step(1 / 60);
      g.input.inject('power1', false);
      for (let i = 0; i < 70; i++) { v = c(); g.debugAimAt(v.x, v.y, v.z); g.step(1 / 60); }
      g.input.inject('power2', true);
      g.step(1 / 60);
      g.input.inject('power2', false);
      const before = g.combat.combos;
      for (let i = 0; i < 90 && g.combat.combos === before; i++) { v = c(); g.debugAimAt(v.x, v.y, v.z); g.step(1 / 60); }
      for (let i = 0; i < 5; i++) g.step(1 / 60);
      g.skipRender = false;
      g.step(1 / 60);
    });
    await shot(page, 'm4-combo');
    await page.evaluate(() => window.__game.simulate(0.25));
    await shot(page, 'm4-combo-after');
    await page.close();
  },

  async combat() {
    const page = await open('section=1&autostart=1&manual=1&debug=1&god=1');
    const r = await page.evaluate(() => {
      const g = window.__game;
      const p = g.player;
      const out = {};
      const dt = 1 / 60;
      g.skipRender = true;
      const setup = (kind, dist) => {
        g.enemies.clear();
        p.teleport({ x: 3, y: 0, z: -4 });
        p.weapons.smg.reserve = 300;
        p.weapons.rifle.reserve = 50;
        p.weapons.smg.mag = 40;
        p.weapons.rifle.mag = 8;
        p.powers.reset();
        const e = g.enemies.spawn(kind, { x: 3, y: 0, z: -4 - dist }, 0, 1, { alerted: true });
        e.frozen = true;
        g.simulate(0.8);
        return e;
      };
      const aim = (e, zone) => {
        const t = { x: 0, y: 0, z: 0 };
        if (zone === 'weak') {
          const w = e.model.weakWorld(new e.position.constructor());
          t.x = w.x; t.y = w.y; t.z = w.z;
        } else {
          const c = e.chestPoint(new e.position.constructor());
          t.x = c.x; t.y = c.y; t.z = c.z;
        }
        g.debugAimAt(t.x, t.y, t.z);
      };
      // Sustained fire time-to-kill; the rifle taps fire every interval.
      const ttk = (kind, weapon, zone = 'body', dist = 12) => {
        const e = setup(kind, dist);
        if (p.weapons.current !== weapon) {
          p.weapons.swap();
          g.simulate(0.6);
        }
        g.input.inject('aim', true);
        g.simulate(0.4);
        let t = 0;
        while (e.alive && t < 30) {
          if (zone === 'weak') e.yaw = Math.PI; // face away so the pack shows
          aim(e, zone);
          g.input.inject('fire', weapon === 'smg' ? true : (Math.floor(t / dt) % 6 === 0));
          g.step(dt);
          if (weapon === 'rifle') g.input.inject('fire', false);
          t += dt;
        }
        g.input.inject('fire', false);
        g.input.inject('aim', false);
        return +t.toFixed(2);
      };
      out.gruntSmg = ttk('grunt', 'smg');
      out.trooperSmg = ttk('trooper', 'smg');
      out.heavySmg = ttk('heavy', 'smg');
      out.heavyRifle = ttk('heavy', 'rifle');
      out.heavyRifleWeak = ttk('heavy', 'rifle', 'weak');
      if (p.weapons.current !== 'smg') { p.weapons.swap(); g.simulate(0.6); }

      // Combos on every type once its defenses are stripped.
      const combo = (kind, detonator) => {
        const e = setup(kind, 9);
        e.defenses.shield = 0;
        e.defenses.armor = 0;
        if (e.shieldBubble) e.shieldBubble.visible = false;
        const before = g.combat.combos;
        aim(e);
        g.input.inject('power1', true);
        g.step(dt);
        g.input.inject('power1', false);
        let t = 0;
        while (!e.primed && t < 2) { aim(e); g.step(dt); t += dt; }
        const primed = e.primed;
        const lifted = e.state === 'lifted';
        g.simulate(0.5);
        aim(e);
        const act = detonator === 'throw' ? 'power2' : 'power3';
        g.input.inject(act, true);
        g.step(dt);
        g.input.inject(act, false);
        t = 0;
        while (g.combat.combos === before && t < 3) { aim(e); g.step(dt); t += dt; }
        return { primed, lifted, combo: g.combat.combos > before, killedOrHurt: !e.alive || e.defenses.health < e.defenses.healthMax, state: e.state, hp: Math.round(e.defenses.health), cd: +p.powers.cooldown.pull.toFixed(1), casts: p.powers.casts };
      };
      out.comboGrunt = combo('grunt', 'throw');
      out.comboTrooper = combo('trooper', 'throw');
      out.comboHeavy = combo('heavy', 'charge');
      // Pull is blocked while shields are up.
      const t = setup('trooper', 9);
      aim(t);
      g.input.inject('power1', true);
      g.step(dt);
      g.input.inject('power1', false);
      g.simulate(1);
      out.pullBlockedByShield = !t.primed && t.state !== 'lifted';
      g.skipRender = false;
      return out;
    });
    console.log('combat', JSON.stringify(r));
    await page.close();
  },

  async gamepad() {
    const page = await open('section=2&autostart=1&manual=1&debug=1&god=1', undefined, FAKE_PAD);
    const r = await page.evaluate(() => {
      const g = window.__game;
      const p = g.player;
      const pad = window.__pad;
      const out = {};
      p.teleport({ x: -11, y: 0.15, z: -46 });
      g.rig.yaw = 0;
      g.simulate(0.2);
      const z0 = p.position.z;
      pad.axis(1, -1);
      g.simulate(1);
      pad.axis(1, 0);
      out.device = g.input.device;
      out.moved = +(z0 - p.position.z).toFixed(2);
      // A jumps.
      pad.press(0);
      g.step(1 / 60);
      pad.release(0);
      g.simulate(0.3);
      out.jumped = !p.grounded;
      g.simulate(1.2);
      // Right stick turns the camera.
      const yaw0 = g.rig.yaw;
      pad.axis(2, 1);
      g.simulate(0.5);
      pad.axis(2, 0);
      out.turned = +(yaw0 - g.rig.yaw).toFixed(2);
      // LB alone = power1 (Snare), after the chord window.
      let cast = null;
      const off = g.events.on('powerCast', (id) => (cast = cast ?? id));
      pad.press(4);
      g.simulate(0.2);
      pad.release(4);
      g.simulate(0.1);
      out.lb = cast;
      cast = null;
      g.player.powers.reset();
      // LB+RB together = power3 (Surge needs a target, so it is denied; check the chord resolved).
      let denied = null;
      const origDenied = g.hud.powerDenied.bind(g.hud);
      g.hud.powerDenied = (id, reason) => { denied = id; origDenied(id, reason); };
      pad.press(4);
      pad.press(5);
      g.simulate(0.2);
      pad.release(4);
      pad.release(5);
      g.simulate(0.1);
      out.lbrb = cast ?? denied;
      off();
      // Y swaps weapon.
      const w0 = p.weapons.current;
      pad.press(3);
      g.step(1 / 60);
      pad.release(3);
      g.simulate(0.1);
      out.swapped = `${w0}->${p.weapons.current}`;
      return out;
    });
    console.log('gamepad', JSON.stringify(r));
    await page.close();
  },

  async movement() {
    const page = await open('section=1&autostart=1&manual=1&debug=1&god=1');
    const r = await page.evaluate(() => {
      const g = window.__game;
      const p = g.player;
      const out = {};
      g.rig.yaw = 0;
      const reset = (x = 3, z = -2) => {
        p.teleport({ x, y: 0, z, clone() { return this; } });
        p.velocity.set(0, 0, 0);
        g.simulate(0.3);
      };
      // Run speed.
      reset();
      g.input.injectMove(0, 1);
      g.simulate(0.6);
      let z0 = p.position.z;
      g.simulate(1.0);
      out.runSpeed = +(z0 - p.position.z).toFixed(2);
      // Sprint speed.
      g.input.inject('sprint', true);
      g.simulate(0.6);
      z0 = p.position.z;
      g.simulate(1.0);
      out.sprintSpeed = +(z0 - p.position.z).toFixed(2);
      g.input.inject('sprint', false);
      g.input.injectMove(0, 0);
      g.simulate(0.5);
      // Jump height.
      reset();
      const y0 = p.position.y;
      g.input.inject('jump', true);
      g.step(1 / 60);
      g.input.inject('jump', false);
      let maxY = y0;
      let air = 0;
      for (let i = 0; i < 180; i++) {
        g.step(1 / 60);
        maxY = Math.max(maxY, p.position.y);
        if (!p.grounded) air += 1 / 60;
      }
      out.jumpHeight = +(maxY - y0).toFixed(2);
      out.jumpAirTime = +air.toFixed(2);
      // Hover: jump, then aim at the apex.
      reset();
      g.input.inject('jump', true);
      g.step(1 / 60);
      g.input.inject('jump', false);
      g.simulate(0.4);
      g.input.inject('aim', true);
      air = 0;
      let hoverTime = 0;
      for (let i = 0; i < 300; i++) {
        g.step(1 / 60);
        if (!p.grounded) air += 1 / 60;
        if (p.hovering) hoverTime += 1 / 60;
        if (p.grounded) break;
      }
      g.input.inject('aim', false);
      out.hoverTime = +hoverTime.toFixed(2);
      out.hoverAirTime = +(air + 0.4).toFixed(2);
      // Dash.
      reset();
      g.simulate(1.6);
      const x0 = p.position.x;
      g.input.injectMove(1, 0);
      g.step(1 / 60);
      g.input.inject('dash', true);
      g.step(1 / 60);
      g.input.inject('dash', false);
      g.input.injectMove(0, 0);
      g.simulate(0.25);
      out.dashDistance = +(p.position.x - x0).toFixed(2);
      // Dash cooldown: second dash right away should not fire.
      const x1 = p.position.x;
      g.input.inject('dash', true);
      g.step(1 / 60);
      g.input.inject('dash', false);
      g.simulate(0.25);
      out.dashDuringCooldown = +(p.position.x - x1).toFixed(2);
      return out;
    });
    console.log('movement', JSON.stringify(r));
    await page.close();
  },

  async camera() {
    const page = await open('section=2&autostart=1&manual=1&debug=1&god=1');
    // Back the player against the west facade and look at her: the camera would be inside the wall.
    const r = await page.evaluate(() => {
      const g = window.__game;
      const p = g.player;
      p.teleport({ x: -11.8, y: 0.15, z: -60 });
      g.rig.yaw = -Math.PI / 2; // look toward +x, camera behind at -x (inside the wall)
      g.rig.pitch = -0.1;
      g.simulate(0.5);
      const cam = g.rig.camera.position;
      return { camX: +cam.x.toFixed(2), wallFace: -13, dist: +g.rig.distanceNow.toFixed(2) };
    });
    console.log('camera vs wall', JSON.stringify(r));
    await shot(page, 'm1-camera-wall');
    // Aim and shoulder swap.
    await page.evaluate(() => {
      const g = window.__game;
      g.player.teleport({ x: 0, y: 0, z: -48 });
      g.rig.yaw = 0;
      g.rig.pitch = -0.05;
      g.input.inject('aim', true);
      g.simulate(0.6);
    });
    await shot(page, 'm1-aim');
    await page.evaluate(() => {
      const g = window.__game;
      g.input.inject('swapShoulder', true);
      g.step(1 / 60);
      g.input.inject('swapShoulder', false);
      g.simulate(0.6);
      g.input.inject('aim', false);
    });
    await shot(page, 'm1-aim-left');
    await page.close();
  },

  async cover() {
    const page = await open('section=2&autostart=1&manual=1&debug=1&god=1');
    const r = await page.evaluate(() => {
      const g = window.__game;
      const p = g.player;
      const out = {};
      // Planter at (0, -57.5), 4.5 x 1.2, low. Approach from the south with weapon out.
      p.combatActive = true;
      p.teleport({ x: 0.5, y: 0, z: -54 });
      g.rig.yaw = 0;
      g.simulate(0.3);
      out.outOfCombatNoCover = null;
      g.input.injectMove(0, 1);
      g.simulate(1.0);
      out.coverMode = p.coverMode;
      out.coverKind = p.inCover ? p.cover.kind : null;
      out.crouched = p.crouched;
      g.input.injectMove(0, 0);
      g.simulate(0.3);
      out.stillInCover = p.coverMode;
      // Aim pops out.
      g.input.inject('aim', true);
      g.simulate(0.5);
      out.aimCrouched = p.crouched;
      out.aimCoverOut = +p.coverOut.toFixed(2);
      g.input.inject('aim', false);
      g.simulate(0.5);
      out.backCrouched = p.crouched;
      // Slide along the face.
      const xs = p.position.x;
      g.input.injectMove(1, 0);
      g.simulate(0.4);
      out.slide = +(p.position.x - xs).toFixed(2);
      out.stillCoverAfterSlide = p.coverMode;
      // Move away releases.
      g.input.injectMove(0, -1);
      g.simulate(0.4);
      out.afterMoveAway = p.coverMode;
      g.input.injectMove(0, 0);
      return out;
    });
    console.log('cover', JSON.stringify(r));
    // No weapon out -> no cover: the dock kiosk (low cover) outside combat.
    const page1 = await open('section=1&autostart=1&manual=1&debug=1&god=1');
    const nw = await page1.evaluate(() => {
      const g = window.__game;
      const p = g.player;
      g.simulate(1);
      p.teleport({ x: 3.6, y: 0, z: -11.5 });
      g.rig.yaw = -Math.PI / 2;
      g.input.injectMove(0, 1);
      g.simulate(1);
      g.input.injectMove(0, 0);
      return { weaponOut: p.weaponOut, coverMode: p.coverMode };
    });
    console.log('cover without weapon out', JSON.stringify(nw));
    await page1.close();
    await page.evaluate(() => {
      const g = window.__game;
      const p = g.player;
      p.combatActive = true;
      p.teleport({ x: 0.5, y: 0, z: -54.5 });
      g.input.injectMove(0, 1);
      g.simulate(0.8);
      g.input.injectMove(0, 0);
      g.rig.yaw = 0.3;
      g.simulate(0.4);
    });
    await shot(page, 'm1-cover-low');
    // High cover: lotus column at (-6.2, -108).
    const h = await page.evaluate(() => {
      const g = window.__game;
      const p = g.player;
      p.teleport({ x: -6.2, y: 0, z: -105.5 });
      g.rig.yaw = 0;
      g.input.injectMove(0, 1);
      g.simulate(1);
      g.input.injectMove(0, 0);
      g.simulate(0.3);
      const out = { mode: p.coverMode, kind: p.inCover ? p.cover.kind : null, x: p.position.x };
      g.input.inject('aim', true);
      g.simulate(0.8);
      out.peekX = +p.position.x.toFixed(2);
      out.peekOut = +p.coverOut.toFixed(2);
      return out;
    });
    console.log('high cover', JSON.stringify(h));
    await shot(page, 'm1-cover-high-peek');
    await page.close();
  },

  // The whole boss fight, played by a simple bot (god mode): intro dialogue,
  // three phases with reinforcement waves, downed beat, outro, end screen.
  async boss() {
    const page = await open(`section=5&autostart=1&manual=1&debug=1&god=1${process.env.INTEL ? '&flags=intel_weakpoint' : ''}`);
    const intro = await page.evaluate(() => {
      const g = window.__game;
      const p = g.player;
      p.teleport({ x: 0, y: 9, z: -287 });
      p.yaw = 0;
      g.rig.yaw = 0;
      g.simulate(0.5);
      p.teleport({ x: 0, y: 9, z: -290 });
      g.simulate(1.5);
      return { state: g.state, node: g.dialogue.nodeId, boss: g.boss.croc.mode };
    });
    console.log('boss intro', JSON.stringify(intro));
    await shot(page, 'm8-boss-intro');
    const started = await page.evaluate(() => {
      const g = window.__game;
      let guard = 0;
      while (g.state === 'dialogue' && guard++ < 40) {
        g.dialogue.autoAdvance(0);
        g.simulate(0.3);
      }
      g.simulate(0.5);
      return { state: g.state, mode: g.boss.croc.mode, invulnerable: g.boss.croc.invulnerable, hud: g.hud.boss === g.boss.croc };
    });
    console.log('boss start', JSON.stringify(started));
    await shot(page, 'm8-boss-start');

    // Fight loop, in chunks so screenshots can be taken along the way.
    const wanted = new Set(['volley', 'slam', 'lunge', 'drag', 'orbs', 'channel', 'phase3']);
    const log = [];
    for (let chunk = 0; chunk < 400; chunk++) {
      const r = await page.evaluate(() => {
        const g = window.__game;
        const p = g.player;
        const b = g.boss.croc;
        const dt = 1 / 60;
        g.skipRender = true;
        const V = p.position.constructor;
        const tmp = new V();
        let snap = null;
        for (let i = 0; i < 30; i++) {
          if (g.state !== 'playing') break;
          p.weapons.smg.reserve = 400;
          p.weapons.rifle.reserve = 60;
          // Target: reinforcements first, then the boss.
          let target = null;
          let best = 1e9;
          for (const e of g.enemies.active) {
            if (!e.alive || e === b || e.state === 'spawning') continue;
            const d = e.position.distanceTo(p.position);
            if (d < best) { best = d; target = e; }
          }
          const onBoss = !target;
          if (onBoss) target = b.alive ? b : null;
          if (!target) { g.step(dt); continue; }
          const wantRifle = onBoss && b.defenses.shield <= 0 && b.defenses.armor > 0;
          const cur = p.weapons.current;
          if ((wantRifle && cur !== 'rifle') || (!wantRifle && cur !== 'smg')) {
            if (!p.weapons.isSwapping) p.weapons.swap();
          }
          if (onBoss && b.defenses.shield <= 0 && b.defenses.armor > 0) b.model.weakWorld(tmp);
          else target.chestPoint(tmp);
          g.debugAimAt(tmp.x, tmp.y, tmp.z);
          g.input.inject('aim', true);
          // Walk toward targets hiding behind something; back off a boss in your face.
          const blocked = g.physics.blocked(g.rig.aimOrigin, tmp);
          const dist = Math.hypot(tmp.x - p.position.x, tmp.z - p.position.z);
          g.input.injectMove(Math.sin(g.frame / 90) * 0.6, blocked ? 1 : onBoss && dist < 7 ? -1 : 0);
          const rifle = p.weapons.current === 'rifle';
          g.input.inject('fire', rifle ? (g.frame % 36 === 0) : true);
          // Combos on the boss in phase 3 (and on stripped adds).
          if (onBoss && b.phase === 3 && b.alive && !b.invulnerable) {
            if (p.powers.cooldown.pull <= 0 && !b.primed) g.input.inject('power1', true);
            else if (b.primed && p.powers.cooldown.throw <= 0) g.input.inject('power2', true);
          }
          // Jump over slam rings.
          if (b.ringActive) {
            const d = Math.hypot(p.position.x - b.ringCenter.x, p.position.z - b.ringCenter.z);
            if (Math.abs(d - b.ringR) < 3 && p.grounded) g.input.inject('jump', true);
          }
          g.step(dt);
          g.input.inject('fire', false);
          g.input.inject('power1', false);
          g.input.inject('power2', false);
          g.input.inject('jump', false);
          if (!snap) {
            if (b.mode === 'attack' && b.current && b.atkT > b.atkTele * 0.8 && !b.fired) snap = b.current;
            if (b.mode === 'channel' && b.modeT > 2.5) snap = 'channel';
            if (b.phase === 3 && b.mode === 'fight') snap = 'phase3';
          }
        }
        g.input.inject('aim', false);
        g.input.injectMove(0, 0);
        return {
          snap, t: +g.boss.fightTime.toFixed(1), state: g.state, mode: b.mode, phase: b.phase,
          def: [Math.round(b.defenses.shield), Math.round(b.defenses.armor), Math.round(b.defenses.health)],
          adds: g.enemies.aliveCount() - (b.alive ? 1 : 0), stats: b.stats, combos: g.combat.combos,
        };
      });
      if (chunk % 20 === 0 || r.state !== 'playing') log.push(r);
      if (r.snap && wanted.has(r.snap)) {
        wanted.delete(r.snap);
        await page.evaluate(() => { window.__game.skipRender = false; window.__game.step(1 / 60); });
        await shot(page, `m8-boss-${r.snap}`);
      }
      if (r.state !== 'playing') break;
    }
    for (const l of log) console.log('boss', JSON.stringify(l));
    await page.evaluate(() => { window.__game.skipRender = false; window.__game.simulate(0.2); });
    await shot(page, 'm8-boss-outro');
    const end = await page.evaluate(() => {
      const g = window.__game;
      let guard = 0;
      while (g.state === 'dialogue' && guard++ < 60) {
        g.dialogue.autoAdvance(g.dialogue.nodeId === 'choice' ? 1 : 0);
        g.simulate(0.3);
      }
      g.simulate(1);
      return { state: g.state, flags: [...g.director.flags], fightTime: +g.boss.fightTime.toFixed(1) };
    });
    console.log('boss end', JSON.stringify(end));
    await shot(page, 'm8-boss-end');
    await page.close();
  },

  // Start to finish: title -> dock -> strip -> club (+Yaw) -> terraces -> boss -> end.
  // A bot follows the objective marker along the nav grid, talks, fights and
  // uses combos. PAD=1 drives everything through a fake gamepad instead of
  // keyboard/mouse actions. God mode: this checks flow, not difficulty.
  async playthrough() {
    const pad = !!process.env.PAD;
    const tag = pad ? 'pad' : 'kbm';
    const page = await open(`manual=1&god=1&debug=1`, undefined, pad ? FAKE_PAD : undefined);
    // Title: press any key, New game, Standard.
    await page.evaluate(() => window.__game.simulate(0.5));
    const confirm = async () => {
      if (pad) await page.evaluate(() => { window.__pad.press(0); window.__game.simulate(0.1); window.__pad.release(0); window.__game.simulate(0.6); });
      else {
        await page.keyboard.down('Enter');
        await page.evaluate(() => window.__game.simulate(0.1));
        await page.keyboard.up('Enter');
        await page.evaluate(() => window.__game.simulate(0.6));
      }
      await page.waitForTimeout(350); // menus ignore input for 250 ms of real time after opening
    };
    for (let i = 0; i < 3; i++) await confirm();
    const opening = await page.evaluate(() => ({ state: window.__game.state, mode: window.__game.rig.mode, bars: document.querySelector('.cine')?.classList.contains('show') }));
    console.log(`[${tag}] after New game:`, JSON.stringify(opening));
    if (opening.state !== 'cinematic' || !opening.bars) errors.push(`[${tag}] the opening did not start: ${JSON.stringify(opening)}`);
    if (pad) {
      // Hold A to skip.
      await page.evaluate(() => { window.__pad.press(0); window.__game.simulate(1.6); window.__pad.release(0); window.__game.simulate(0.5); });
    } else {
      // Watch it through, with a frame from each shot.
      for (const [t, name] of [[3.5, 'title'], [6, 'train'], [5, 'imani'], [6, 'platform']]) {
        await page.evaluate((t) => window.__game.simulate(t), t);
        await shot(page, `m10-opening-${name}`);
      }
      await page.evaluate(() => window.__game.simulate(5));
    }
    const startState = await page.evaluate(() => window.__game.state);
    console.log(`[${tag}] after the opening:`, startState);
    if (startState !== 'playing') errors.push(`[${tag}] not playing after the opening: ${startState}`);
    const camMode = await page.evaluate(() => window.__game.rig.mode);
    if (camMode !== 'gameplay') errors.push(`[${tag}] camera still in ${camMode} mode after the opening`);
    const trainZ = await page.evaluate(() => window.__game.setPieces.train.position.z);
    if (Math.abs(trainZ + 16) > 0.01) errors.push(`[${tag}] the train is not at the platform after the opening: z=${trainZ}`);
    await page.evaluate(BOT, pad);
    const seen = new Set();
    let last = null;
    for (let chunk = 0; chunk < 2000; chunk++) {
      const r = await page.evaluate(() => window.__bot.run(240));
      last = r;
      const key = `${r.section}-${r.state}`;
      if (!seen.has(key) && (r.state === 'playing' || r.state === 'dialogue' || r.state === 'cinematic' || r.state === 'end')) {
        seen.add(key);
        console.log(`[${tag}]`, JSON.stringify(r));
        await page.evaluate(() => { window.__game.skipRender = false; window.__game.step(1 / 60); });
        await shot(page, `m9-${tag}-s${r.section}-${r.state}`);
      }
      if (r.state === 'end' || r.stuck) break;
    }
    console.log(`[${tag}] final`, JSON.stringify(last));
    if (last.state !== 'end') errors.push(`[${tag}] the run did not reach the end: ${JSON.stringify(last)}`);
    // The end: epilogue pages, then the results.
    const screenText = () => page.evaluate(() => { const m = document.querySelector('.screen.show .menu'); return m ? { title: m.querySelector('h2')?.textContent, text: m.textContent.slice(0, 260), fits: m.getBoundingClientRect().bottom <= window.innerHeight && m.getBoundingClientRect().top >= 0, rank: m.querySelector('.rank')?.textContent ?? null } : null; });
    await page.evaluate(() => { window.__game.skipRender = false; window.__game.simulate(1); });
    let screen = await screenText();
    console.log(`[${tag}] epilogue`, JSON.stringify(screen));
    await shot(page, `m9-${tag}-end`);
    if (!screen || !screen.fits) errors.push(`[${tag}] the epilogue is missing or off screen: ${JSON.stringify(screen)}`);
    for (let i = 0; i < 6 && screen && !screen.rank; i++) {
      await confirm();
      screen = await screenText();
    }
    console.log(`[${tag}] results`, JSON.stringify(screen));
    await page.evaluate(() => window.__game.simulate(0.3));
    await shot(page, `m10-${tag}-results`);
    if (!screen || !screen.rank || !screen.fits) errors.push(`[${tag}] the results screen is missing or off screen: ${JSON.stringify(screen)}`);
    const end = await page.evaluate(() => { const g = window.__game; return { flags: [...g.director.flags], device: g.input.device, totals: g.stats.totals, logs: g.director.logsFound.size, saveLeft: !!localStorage.getItem('neo-atlantis.save.v1'), best: localStorage.getItem('neo-atlantis.best.v1') }; });
    console.log(`[${tag}] end`, JSON.stringify(end));
    if (end.saveLeft) errors.push(`[${tag}] a finished run left a saved game behind`);
    await page.close();
  },

  // Boot like a player: real-time frame loop (no manual stepping), title ->
  // press a key -> Start -> walk. Fails if the camera isn't following her.
  async boot() {
    const page = await browser.newPage({ viewport: { width: 400, height: 240 } });
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`[boot] ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`[boot] ${e.message}`));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.goto('http://localhost:4173/BlastEffect/?quality=low');
    await page.waitForFunction(() => window.__game && window.__game.state !== 'loading', null, { timeout: 120000 });
    await page.evaluate(() => { window.__game.params.automation = false; });
    // Like a player: wait until the title is actually on screen and moving
    // (software GL can take a while to link shaders), then press a key, wait
    // for the menu, then Start.
    const fps = () => page.evaluate(async () => {
      const info = window.__game.renderer.renderer.info.render;
      const f0 = info.frame;
      await new Promise((r) => setTimeout(r, 1000));
      return info.frame - f0;
    });
    for (let i = 0; i < 30 && (await fps()) < 2; i++);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('.screen.show .menu .item').length > 0, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(600);
    // New game, then Standard on the difficulty screen.
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__game.menus.name === 'difficulty', null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(600);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__game.state === 'cinematic', null, { timeout: 30000 }).catch(() => {});
    // The opening is playing: hold Enter to skip it, as a player would.
    await page.waitForTimeout(800);
    await page.keyboard.down('Enter');
    await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 60000 }).catch(() => {});
    await page.keyboard.up('Enter');
    await page.waitForTimeout(1500);
    const start = await page.evaluate(() => ({ state: window.__game.state, z: window.__game.player.position.z }));
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(3000);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const g = window.__game;
      const p = g.player.position;
      const cam = g.rig.camera;
      const v = p.clone();
      v.y += 1.1;
      v.project(cam);
      return { state: g.state, mode: g.rig.mode, moved: 0, camDist: +cam.position.distanceTo(p).toFixed(2), onScreen: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z < 1, z: p.z };
    });
    r.moved = +(start.z - r.z).toFixed(2);
    console.log('boot', JSON.stringify({ start: start.state, ...r }));
    await shot(page, 'boot-walk');
    if (r.state !== 'playing' || r.mode !== 'gameplay' || r.camDist > 6 || !r.onScreen || r.moved < 2) errors.push(`[boot] camera/start check failed: ${JSON.stringify(r)}`);
    await page.close();
  },

  // Save and Continue: a new game, play past the first fights, come back in a new tab.
  async save() {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const load = async () => {
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`[save] ${m.text()}`); });
      page.on('pageerror', (e) => errors.push(`[save] ${e.message}`));
      await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
      await page.goto('http://localhost:4173/BlastEffect/?manual=1&quality=low');
      await page.waitForFunction(() => window.__game && window.__game.state !== 'loading', null, { timeout: 120000 });
      await page.keyboard.press('Enter');
      await page.evaluate(() => window.__game.simulate(0.3));
      return page;
    };
    const tap = async (page) => {
      await page.waitForTimeout(320);
      await page.evaluate(() => { const g = window.__game; g.input.inject('uiConfirm', true); g.step(1 / 60); g.input.inject('uiConfirm', false); g.simulate(0.2); });
    };
    const items = (page) => page.evaluate(() => [...document.querySelectorAll('.screen.show .item')].map((b) => b.textContent.trim().slice(0, 60)));
    let page = await load();
    const first = await items(page);
    console.log('save: first visit', JSON.stringify(first));
    if (first.some((t) => t.startsWith('Continue'))) errors.push('[save] Continue offered before anything was played');
    await shot(page, 'm10-title');
    await tap(page); // New game
    await shot(page, 'm10-difficulty');
    await tap(page); // Standard
    // Skip the opening.
    await page.evaluate(() => { const g = window.__game; g.simulate(1); g.input.inject('uiConfirm', true); g.simulate(1.6); g.input.inject('uiConfirm', false); g.simulate(0.5); });
    await page.evaluate(BOT, false);
    await page.evaluate(() => { window.__game.player.god = true; });
    // Talk to Odette (the gate opens), then die on the platform: the retry must not shut the gate on someone she won't talk to twice.
    const dock = await page.evaluate(() => {
      const g = window.__game; const d = g.director;
      for (let i = 0; i < 40 && !(d.flags.has('promised_odette') && g.state === 'playing'); i++) window.__bot.run(60);
      window.__bot.run(30);
      const talked = d.npcDef('odette').hasTalked;
      g.player.god = false;
      g.player.takeDamage(9999, null);
      g.skipRender = true;
      for (let i = 0; i < 600 && g.state !== 'dead'; i++) g.step(1 / 60);
      return { talked, state: g.state };
    });
    await page.waitForTimeout(320);
    const retried = await page.evaluate(() => {
      const g = window.__game; const d = g.director;
      g.input.inject('uiConfirm', true); g.step(1 / 60); g.input.inject('uiConfirm', false);
      for (let i = 0; i < 30; i++) g.step(1 / 60);
      g.player.god = true;
      return { state: g.state, gateOpen: d.allDoors.get('dockGate').open, objective: d.objective, flags: d.flags.size, odetteTalked: d.npcDef('odette').hasTalked };
    });
    console.log('save: died on the platform after talking', JSON.stringify(dock), '->', JSON.stringify(retried));
    if (!dock.talked || dock.state !== 'dead' || retried.state !== 'playing' || !retried.gateOpen || retried.flags < 1) errors.push(`[save] dying after the first conversation left the gate shut: ${JSON.stringify(retried)}`);
    let r = null;
    for (let i = 0; i < 60; i++) {
      r = await page.evaluate(() => { const b = window.__bot.run(300); const g = window.__game; return { t: b.t, state: b.state, section: b.section, cleared: g.director.encounters.filter((e) => e.state === 'cleared').map((e) => e.def.id) }; });
      if (r.cleared.includes('stripB') || r.section > 2) break;
    }
    const saved = await page.evaluate(() => { window.__bot.run(240); const s = JSON.parse(localStorage.getItem('neo-atlantis.save.v1')); return s && { section: s.checkpoint.section, pos: s.checkpoint.pos.map((v) => +v.toFixed(1)), cleared: s.checkpoint.cleared, flags: s.checkpoint.flags.length, kills: s.stats.kills, objective: s.checkpoint.objective.text }; });
    console.log('save: played', JSON.stringify(r), 'saved', JSON.stringify(saved));
    if (!saved) errors.push('[save] nothing was saved');
    await page.close();
    page = await load();
    const second = await items(page);
    console.log('save: second visit', JSON.stringify(second));
    await shot(page, 'm10-title-continue');
    if (!second[0]?.startsWith('Continue')) errors.push(`[save] no Continue on the second visit: ${JSON.stringify(second)}`);
    await tap(page); // Continue
    const back = await page.evaluate(() => { const g = window.__game; g.simulate(0.5); const d = g.director; return { state: g.state, mode: g.rig.mode, section: d.current, pos: [g.player.position.x, g.player.position.y, g.player.position.z].map((v) => +v.toFixed(1)), cleared: d.encounters.filter((e) => e.state === 'cleared').map((e) => e.def.id), flags: d.flags.size, kills: g.stats.totals.kills, objective: d.objective }; });
    console.log('save: continued', JSON.stringify(back));
    if (saved && (back.state !== 'playing' || back.mode !== 'gameplay' || back.section !== saved.section || back.cleared.join() !== saved.cleared.join() || back.flags !== saved.flags || back.kills !== saved.kills || back.objective !== saved.objective || Math.hypot(back.pos[0] - saved.pos[0], back.pos[2] - saved.pos[2]) > 0.5)) {
      errors.push(`[save] the continued game does not match the save: ${JSON.stringify(back)} vs ${JSON.stringify(saved)}`);
    }
    await page.evaluate(() => { window.__game.skipRender = false; window.__game.simulate(0.5); });
    await shot(page, 'm10-continued');
    await ctx.close();
  },

  // The crew at their posts, and the two new types: noticing, the ambush bonus, the Jackal's lunge, the Ibis's shot.
  async crew() {
    const page = await open('section=2&autostart=1&manual=1');
    const out = await page.evaluate(() => {
      const g = window.__game; const p = g.player; const d = g.director; const V = p.position.constructor;
      const res = {};
      g.skipRender = true;
      const step = () => g.step(1 / 60);
      const sim = (s) => { for (let i = 0; i < s * 60; i++) step(); };
      const enc = d.encounters.find((e) => e.def.id === 'stripA');
      res.posted = { state: enc.state, unaware: enc.enemies.filter((e) => e.unaware).length, club: d.encounters.find((e) => e.def.id === 'club').state };
      // Walk down the street until someone notices.
      let z = -56;
      for (; z >= -84 && enc.state === 'staged'; z -= 2) { p.teleport({ x: 0, y: 0, z }); sim(2); }
      res.noticedAt = { z, nearest: +Math.min(...enc.enemies.map((e) => e.position.distanceTo(p.position))).toFixed(1), music: d.musicCue };
      sim(1.5);
      res.allAlerted = enc.enemies.every((e) => e.alerted);
      // A fresh crew: one rifle shot at an unaware grunt's chest.
      d.respawnFromCheckpoint();
      const enc2 = d.encounters.find((e) => e.def.id === 'stripA');
      p.teleport({ x: 2, y: 0, z: -66 }); g.rig.yaw = 0; sim(0.5);
      if (p.weapons.current !== 'rifle') { g.input.inject('swapWeapon', true); step(); g.input.inject('swapWeapon', false); sim(1.2); }
      const tgt = enc2.enemies[2]; const tmp = new V(); const hp0 = tgt.defenses.health;
      g.input.inject('aim', true);
      for (let i = 0; i < 40; i++) { tgt.chestPoint(tmp); g.debugAimAt(tmp.x, tmp.y, tmp.z); step(); }
      const wasUnaware = tgt.unaware;
      g.input.inject('fire', true); step(); g.input.inject('fire', false); g.input.inject('aim', false);
      sim(0.2);
      res.ambush = { wasUnaware, dealt: hp0 - tgt.defenses.health, counted: g.stats.totals.ambushes, started: enc2.state };
      sim(1.2);
      res.ambush.othersAlerted = enc2.enemies.every((e) => e.alerted);
      // One enemy at a time against a player who stands still, strafes, or dashes on the tell.
      const trial = (kind, dist, act) => {
        g.enemies.clear(); g.bolts.clear();
        for (const e of d.encounters) e.state = 'cleared';
        p.teleport({ x: 0, y: 0, z: -66 }); g.rig.yaw = 0; p.health = 100; p.shield = p.shieldMax;
        sim(0.3);
        const dmg0 = g.stats.totals.damageTaken;
        const e = g.enemies.spawn(kind, new V(0, 0, -66 - dist), Math.PI, 2, { alerted: true, instant: true });
        let attacks = 0; let was = false;
        for (let t = 0; t < 9; t += 1 / 60) {
          const on = e.state === 'slash' || e.state === 'fire';
          if (on && !was) attacks++;
          was = on;
          act?.(e, t, attacks);
          step();
        }
        g.input.injectMove(0, 0); g.input.inject('dash', false);
        return { attacks, taken: Math.round(g.stats.totals.damageTaken - dmg0) };
      };
      res.jackalStill = trial('jackal', 14);
      res.jackalDash = trial('jackal', 14, (e, _t, n) => {
        if (e.state === 'slash' && e.stateT > 0.22 && e.stateT < 0.28) { g.input.injectMove(n % 2 ? 1 : -1, 0); g.input.inject('dash', true); }
        else { g.input.inject('dash', false); if (e.state !== 'slash') g.input.injectMove(0, 0); }
      });
      res.ibisStill = trial('ibis', 30);
      res.ibisStrafe = trial('ibis', 30, (_e, t) => g.input.injectMove(Math.sin(t * 1.2) > 0 ? 1 : -1, 0));
      g.skipRender = false;
      return res;
    });
    console.log('crew', JSON.stringify(out));
    if (out.posted.state !== 'staged' || out.posted.unaware !== 3) errors.push(`[crew] the strip crew is not at its posts: ${JSON.stringify(out.posted)}`);
    if (out.noticedAt.z > -60 || out.noticedAt.z < -84 || out.noticedAt.music !== 'combat') errors.push(`[crew] noticing is off: ${JSON.stringify(out.noticedAt)}`);
    if (!out.allAlerted) errors.push('[crew] the rest of the crew did not react to the first alert');
    if (!out.ambush.wasUnaware || out.ambush.dealt !== 140 || out.ambush.counted < 1 || !out.ambush.othersAlerted) errors.push(`[crew] ambush check failed: ${JSON.stringify(out.ambush)}`);
    if (out.jackalStill.attacks < 2 || out.jackalStill.taken < 40) errors.push(`[crew] a Jackal should hurt someone standing still: ${JSON.stringify(out.jackalStill)}`);
    if (out.jackalDash.taken >= out.jackalStill.taken) errors.push(`[crew] dashing on the tell should avoid Jackal damage: ${JSON.stringify(out.jackalDash)} vs ${JSON.stringify(out.jackalStill)}`);
    if (out.ibisStill.taken < 30) errors.push(`[crew] an Ibis should hit someone standing still: ${JSON.stringify(out.ibisStill)}`);
    if (out.ibisStrafe.taken >= out.ibisStill.taken) errors.push(`[crew] strafing should avoid Ibis shots: ${JSON.stringify(out.ibisStrafe)} vs ${JSON.stringify(out.ibisStill)}`);
    await page.close();
  },

  // The High preset (multisampled, high-dynamic-range picture with bloom): every pixel must be a
  // finite number in every section, after switching to it mid-game, and even when a shader misbehaves.
  async high() {
    // Page-side: count pixels that are NaN or infinite in a half-float target.
    const SCAN = () => {
      const g = window.__game; const R = g.renderer.renderer; const comp = g.renderer.composer;
      const size = R.getDrawingBufferSize(new (g.rig.camera.position.constructor)()); const w = Math.floor(size.x); const h = Math.floor(size.y);
      const bad = (rt) => { const buf = new Uint16Array(w * h * 4); R.readRenderTargetPixels(rt, 0, 0, w, h, buf); let n = 0; for (let i = 0; i < buf.length; i += 4) if ((((buf[i] >> 10) & 31) === 31) || (((buf[i + 1] >> 10) & 31) === 31) || (((buf[i + 2] >> 10) & 31) === 31)) n++; return n; };
      window.__scan = () => {
        g.simulate(0.3);
        // The scene as drawn, before anything cleans it.
        const RT = comp.renderTarget1.constructor;
        const rt = new RT(w, h, { type: comp.renderTarget1.texture.type, samples: comp.renderTarget1.samples });
        R.setRenderTarget(rt); R.clear(); R.render(g.scene, g.rig.camera); R.setRenderTarget(null);
        const scene = bad(rt); rt.dispose();
        g.simulate(0.1);
        // What reaches the screen: mean brightness of the canvas, 0..255.
        const c = document.createElement('canvas'); c.width = 160; c.height = 90; const x = c.getContext('2d'); x.drawImage(R.domElement, 0, 0, 160, 90);
        const px = x.getImageData(0, 0, 160, 90).data; let sum = 0; for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
        return { quality: g.renderer.quality, samples: comp.renderTarget1.samples, passes: comp.passes.map((p) => p.constructor.name).join('>'), scene, composer: bad(comp.renderTarget1) + bad(comp.renderTarget2), brightness: +(sum / (px.length / 4) / 3).toFixed(1) };
      };
    };
    for (const sec of [1, 2, 3, 4, 5]) {
      const page = await open(`section=${sec}&autostart=1&manual=1&god=1&quality=high`);
      await page.evaluate(SCAN);
      const r = await page.evaluate(() => window.__scan());
      console.log(`high: section ${sec}`, JSON.stringify(r));
      if (r.samples !== 4) errors.push(`[high] section ${sec} is not multisampled: ${JSON.stringify(r)}`);
      if (r.scene || r.composer) errors.push(`[high] section ${sec} has pixels that are not finite numbers: ${JSON.stringify(r)}`);
      if (r.brightness < 4) errors.push(`[high] section ${sec} renders black: ${JSON.stringify(r)}`);
      await page.close();
    }
    // Switched to in the middle of a game, as from the settings menu.
    {
      const page = await open('section=2&autostart=1&manual=1&god=1&quality=medium');
      await page.evaluate(SCAN);
      const before = await page.evaluate(() => window.__scan());
      await page.evaluate(() => window.__game.applyQuality('high'));
      await page.evaluate(SCAN);
      const after = await page.evaluate(() => window.__scan());
      console.log('high: switched from medium', JSON.stringify(before), '->', JSON.stringify(after));
      if (after.quality !== 'high' || after.samples !== 4 || after.scene || after.composer || after.brightness < before.brightness * 0.6) errors.push(`[high] switching from medium broke the picture: ${JSON.stringify(after)}`);
      await page.close();
    }
    // A shader that writes "not a number" over every neon reflection on the street: the scene has
    // bad pixels, the bloom must not spread them, and the picture must survive.
    {
      const page = await open('section=2&autostart=1&manual=1&god=1&quality=high');
      await page.evaluate(SCAN);
      const clean = await page.evaluate(() => window.__scan());
      const poisoned = await page.evaluate(() => {
        const g = window.__game; let n = 0;
        g.scene.traverse((o) => { const m = o.material; if (m && m.isShaderMaterial && m.fragmentShader.includes('gl_FragColor = vec4(uColor * a, 1.0);') && m.fragmentShader.includes('ripple')) { m.fragmentShader = m.fragmentShader.replace('gl_FragColor = vec4(uColor * a, 1.0);', 'gl_FragColor = vec4(vec3(uZero / uZero), 1.0);').replace('uniform float uTime;', 'uniform float uTime; uniform float uZero;'); m.uniforms.uZero = { value: 0 }; m.needsUpdate = true; n++; } });
        return { materials: n, ...window.__scan() };
      });
      console.log('high: poisoned', JSON.stringify(poisoned), 'clean', JSON.stringify(clean));
      if (!poisoned.materials || !poisoned.scene) errors.push(`[high] the poison test did not poison anything: ${JSON.stringify(poisoned)}`);
      if (poisoned.composer) errors.push(`[high] bad pixels got past the sanitize pass: ${JSON.stringify(poisoned)}`);
      if (poisoned.brightness < clean.brightness * 0.6) errors.push(`[high] bad pixels blacked out the picture: ${JSON.stringify(poisoned)} vs ${JSON.stringify(clean)}`);
      await page.close();
    }
  },

  async sections() {
    for (const s of [1, 2, 3, 4, 5]) {
      const page = await open(`section=${s}&autostart=1&manual=1&debug=1&god=1`);
      await page.evaluate(() => window.__game.simulate(1.0));
      await shot(page, `section${s}`);
      const stats = await page.evaluate(() => ({ ...window.__game.renderer.frameStats }));
      console.log(`section ${s}: draw calls ${stats.calls}, triangles ${stats.triangles}`);
      if (process.env.INSPECT) console.log(await page.evaluate(() => window.__game.inspectDrawables()));
      await page.close();
    }
  },
};

for (const s of scenarios) {
  if (!run[s]) {
    console.error('unknown scenario', s);
    continue;
  }
  await run[s]();
}
await browser.close();
server.close();
if (errors.length) {
  console.log('CONSOLE ERRORS:');
  for (const e of errors) console.log(' ', e);
  process.exitCode = 1;
} else {
  console.log('no console errors');
}
