// Reel stills and review captures, with headless Chrome over the DevTools protocol (no puppeteer).
// The clock is stopped at 8:10 PM IST on Fri 13 Nov 2026 so the demo reads "13 h 20 min left"
// (DBMS at 9:30 AM, 4 of 5 units left). Only the screenshots use the fake clock; the app uses the real one.
//
//   node tools/shoot.mjs [baseUrl] [outDir] [--review]
//   default baseUrl: http://127.0.0.1:8803/   default outDir: screenshots/
//   --review also captures edge states and a desktop view into .impeccable/review/

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const REVIEW = args.includes('--review');
const [BASE = 'http://127.0.0.1:8803/', OUT = 'screenshots'] = args.filter((a) => !a.startsWith('--'));
const REVIEW_DIR = '.impeccable/review';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FROZEN = Date.UTC(2026, 10, 13, 14, 40); // 20:10 IST
const KEY = 'panic-planner:v1';

mkdirSync(OUT, { recursive: true });
if (REVIEW) mkdirSync(REVIEW_DIR, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'panic-shoot-'));
const port = 9300 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-color-profile=srgb', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(path) {
  for (let i = 0; i < 50; i++) {
    try { return await (await fetch(`http://127.0.0.1:${port}${path}`)).json(); } catch { await sleep(200); }
  }
  throw new Error('chrome did not start');
}
const page = (await json('/json/list')).find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id;
  pending.set(n, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});
const run = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  return r.result.value;
};
async function shot(file, { full = false } = {}) {
  const params = { format: 'png', captureBeyondViewport: full };
  if (full) {
    const { cssContentSize } = await send('Page.getLayoutMetrics');
    params.clip = { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 };
  }
  const { data } = await send('Page.captureScreenshot', params);
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log('saved', file);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Kolkata' });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    const Real = Date;
    class Frozen extends Real { constructor(...a) { a.length ? super(...a) : super(${FROZEN}); } static now() { return ${FROZEN}; } }
    window.Date = Frozen;
  })();`,
});

async function phone() {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });
}
async function desktop() {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
}
async function load(url) {
  await send('Page.navigate', { url });
  await sleep(1200);
  await run('document.fonts.ready.then(() => true)');
}
const fits = () => run('[innerHeight, document.querySelector(".console").getBoundingClientRect().bottom]');

try {
  await phone();
  await load(`${BASE}?demo`);
  await sleep(2400); // let the PULL UP flash finish so the strip is steady
  console.log('setup fits (viewport, console bottom):', await fits());
  await shot(join(OUT, '1-setup.png'));

  await run(`document.querySelector('#setup button[type=submit]').click()`);
  await sleep(3200);
  console.log('truth:', await run(`document.querySelector('#readouts').innerText.replace(/\\n/g,' | ')`));
  console.log('truth fits:', await fits());
  await shot(join(OUT, '2-truth.png'));

  await run(`location.hash = '#/plan'`);
  await sleep(900);
  console.log('plan:', await run(`document.querySelector('#timeline').innerText.replace(/\\n/g,' | ')`));
  console.log('plan fits:', await fits());
  await shot(join(OUT, '3-plan.png'));

  // the user chooses which unit to skip, and why
  await run(`document.querySelector('[data-skip="5"]').click()`);
  await sleep(300);
  await run(`(() => { const i = document.querySelector('.skip-form input'); i.value = 'never understood it'; return true; })()`);
  await shot(join(OUT, '4-plan-skip-why.png'));
  await run(`document.querySelector('.skip-form').requestSubmit()`);
  await sleep(900);
  console.log('skip fits:', await fits());
  await shot(join(OUT, '5-plan-skipped.png'));

  await run(`document.querySelector('#timer-btn').click()`);
  await sleep(1500);
  console.log('timer:', await run(`document.querySelector('#readout').innerText.replace(/\\n/g,' | ')`));
  await shot(join(OUT, '6-plan-timer.png'));

  if (REVIEW) {
    // edge states, written into a real (non-demo) saved state
    const day = (h, m, plus = 0) => { const d = new Date(Date.UTC(2026, 10, 13 + plus, h, m) - 330 * 60000); return d; };
    const local = (d) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 16);
    const base = { v: 1, exam: 'Maths', units: [{ name: '', done: false }, { name: '', done: false }, { name: '', done: true }], sleep: true, skip: null, planAt: null, planSig: null, timer: false };
    const cases = {
      'edge-passed': { ...base, examAt: local(day(18, 0)) },
      'edge-under-hour': { ...base, examAt: local(day(20, 50)) },
      'edge-no-time': { ...base, examAt: local(day(21, 25)) },
      'edge-zero-units': { ...base, units: base.units.map((u) => ({ ...u, done: true })), examAt: local(day(9, 30, 1)) },
    };
    for (const [name, st] of Object.entries(cases)) {
      await load(BASE);
      await run(`localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(st))}); location.hash = '#/truth'; location.reload(); true`);
      await sleep(3000);
      await shot(join(REVIEW_DIR, `${name}-truth.png`));
      await run(`location.hash = '#/plan'`);
      await sleep(700);
      await shot(join(REVIEW_DIR, `${name}-plan.png`));
    }
    await run(`localStorage.clear(); true`);

    await load(`${BASE}?demo`);
    await run(`document.querySelector('#names-toggle').click()`);
    await sleep(400);
    await shot(join(REVIEW_DIR, 'mobile-names-full.png'), { full: true });
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await load(`${BASE}?demo`);
    await sleep(2400);
    await shot(join(REVIEW_DIR, 'mobile.png'));
    await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 700, deviceScaleFactor: 1, mobile: true });
    await load(`${BASE}?demo`);
    await sleep(2400);
    await shot(join(REVIEW_DIR, 'mobile-360x700.png'));
    await desktop();
    await load(`${BASE}?demo`);
    await sleep(2400);
    await shot(join(REVIEW_DIR, 'desktop.png'));
  }
} finally {
  ws.close();
  chrome.kill();
}
