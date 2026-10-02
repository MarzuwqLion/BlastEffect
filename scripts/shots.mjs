// Headless screenshots and scripted checks. Usage:
//   node scripts/shots.mjs [scenario ...]
// Scenarios: sections, combat, closeup, flow (default: sections).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from './serve.mjs';

const OUT = path.resolve('docs/screenshots');
fs.mkdirSync(OUT, { recursive: true });
const scenarios = process.argv.slice(2);
if (!scenarios.length) scenarios.push('sections');

const exe = fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined;
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
    // Walk into encounter A and watch the AI for a while.
    const log = await page.evaluate(() => {
      const g = window.__game;
      const p = g.player;
      g.skipRender = true;
      p.teleport({ x: 0.5, y: 0, z: -54 });
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
      g.skipRender = false;
      return out;
    });
    console.log(log.join('\n'));
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
