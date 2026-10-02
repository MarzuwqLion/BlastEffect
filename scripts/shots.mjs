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

async function open(query, size = { width: 1280, height: 720 }) {
  const page = await browser.newPage({ viewport: size });
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

const run = {
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
