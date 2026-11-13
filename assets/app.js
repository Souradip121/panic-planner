import { RULES, truth, plan, currentBlock, fmtDur, fmtCountdown } from './plan.js';

const $ = (s, el = document) => el.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';
const KEY = 'panic-planner:v1';
const MAX_UNITS = 12;
const MIN = 60_000;
const DEMO = new URLSearchParams(location.search).has('demo');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

/* ── state ───────────────────────────────────────────────────── */
const pad = (n) => String(n).padStart(2, '0');
const toInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const blankUnits = (n) => Array.from({ length: n }, () => ({ name: '', done: false }));

function defaultState() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return { v: 1, exam: '', examAt: toInput(d), units: blankUnits(5), sleep: true, skip: null, planAt: null, planSig: null, timer: false };
}

// The reel demo: DBMS, unit 1 done (4 of 5 left), exam about 13 hours away on the next half hour.
function demoState() {
  const half = 30 * MIN;
  const exam = new Date(Math.ceil((Date.now() + 13 * 60 * MIN) / half) * half);
  const names = ['ER model', 'SQL', 'Normalisation', 'Transactions', 'Indexing'];
  return { ...defaultState(), exam: 'DBMS', examAt: toInput(exam),
    units: names.map((name, i) => ({ name, done: i === 0 })) };
}

function clean(raw) {
  const s = defaultState();
  if (!raw || typeof raw !== 'object') return s;
  if (typeof raw.exam === 'string') s.exam = raw.exam.slice(0, 40);
  if (typeof raw.examAt === 'string' && !isNaN(new Date(raw.examAt))) s.examAt = raw.examAt.slice(0, 16);
  if (Array.isArray(raw.units) && raw.units.length) {
    s.units = raw.units.slice(0, MAX_UNITS).map((u) => ({ name: typeof u?.name === 'string' ? u.name.slice(0, 40) : '', done: !!u?.done }));
  }
  s.sleep = raw.sleep !== false;
  if (raw.skip && Number.isInteger(raw.skip.n)) s.skip = { n: raw.skip.n, why: String(raw.skip.why || '').slice(0, 60) };
  if (Number.isFinite(raw.planAt)) s.planAt = raw.planAt;
  if (typeof raw.planSig === 'string') s.planSig = raw.planSig;
  s.timer = !!raw.timer;
  fixSkip(s);
  return s;
}
function load() {
  try { return clean(JSON.parse(localStorage.getItem(KEY))); } catch { return defaultState(); }
}
function save() {
  if (DEMO) return;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode: still works for this visit */ }
}
function fixSkip(s = state) {
  const u = s.skip && s.units[s.skip.n - 1];
  if (s.skip && (!u || u.done)) s.skip = null;
}

let state = DEMO ? demoState() : load();

/* ── derived ─────────────────────────────────────────────────── */
const examDate = () => { const d = new Date(state.examAt); return isNaN(d) ? null : d; };
const examName = () => state.exam.trim();
const leftCount = () => state.units.filter((u) => !u.done).length;
const studyList = () => state.units
  .map((u, i) => ({ n: i + 1, name: u.name.trim(), done: u.done }))
  .filter((u) => !u.done && state.skip?.n !== u.n);
const unitLabel = (u) => (u.name ? `Unit ${u.n} · ${u.name}` : `Unit ${u.n}`);
const sig = () => JSON.stringify([state.examAt, state.units.map((u) => u.done), state.sleep, state.skip?.n ?? null]);
function truthNow(now = Date.now()) {
  const e = examDate();
  return e ? truth({ now, examAt: e, units: studyList().length, sleep: state.sleep }) : null;
}
function currentPlan() {
  const e = examDate();
  return e && state.planAt ? plan({ start: state.planAt, examAt: e, units: studyList(), sleep: state.sleep }) : null;
}

/* ── formatting ──────────────────────────────────────────────── */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function clock(ms) {
  const d = new Date(ms), h = d.getHours();
  return `${h % 12 || 12}:${pad(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
}
function when(d, now = new Date(), inSentence = false) {
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 864e5);
  const t = clock(d);
  const rel = (w) => `${inSentence ? w.toLowerCase() : w} ${t}`;
  if (diff === 0) return rel('Today');
  if (diff === 1) return rel('Tomorrow');
  if (diff === -1) return rel('Yesterday');
  if (diff > 1 && diff < 7) return `${DAYS[d.getDay()]} ${t}`;
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}, ${t}`;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (id, cls = 'ico') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;

/* ── svg helpers ─────────────────────────────────────────────── */
function el(name, attrs = {}, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}
const polar = (cx, cy, r, deg) => [cx + r * Math.sin((deg * Math.PI) / 180), cy - r * Math.cos((deg * Math.PI) / 180)];
function arcPath(cx, cy, r, a0, a1) {
  const [x0, y0] = polar(cx, cy, r, a0), [x1, y1] = polar(cx, cy, r, a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
function bezel(svg, id, cx, cy, r) {
  const defs = el('defs', {}, svg);
  const lg = el('linearGradient', { id: `${id}-ring`, x1: 0, y1: 0, x2: 0.3, y2: 1 }, defs);
  [['0', '#6d7177'], ['.35', '#2c2f33'], ['.7', '#191a1c'], ['1', '#4b4f55']].forEach(([o, c]) => el('stop', { offset: o, 'stop-color': c }, lg));
  const rg = el('radialGradient', { id: `${id}-face`, cx: '.5', cy: '.42', r: '.6' }, defs);
  [['0', '#1c1e21'], ['.8', '#0f1011'], ['1', '#070708']].forEach(([o, c]) => el('stop', { offset: o, 'stop-color': c }, rg));
  el('circle', { cx, cy, r: r + 1.5, fill: '#060607' }, svg);
  el('circle', { cx, cy, r, fill: `url(#${id}-ring)` }, svg);
  el('circle', { cx, cy, r: r * 0.89, fill: '#0a0b0c' }, svg);
  el('circle', { cx, cy, r: r * 0.87, fill: `url(#${id}-face)` }, svg);
  return defs;
}
function screws(svg, pts) {
  for (const [x, y, rot] of pts) {
    const g = el('g', { transform: `translate(${x} ${y}) rotate(${rot})` }, svg);
    el('circle', { r: 4.6, fill: '#0b0c0d' }, g);
    el('circle', { r: 3.9, fill: '#3b3f44' }, g);
    el('circle', { r: 3.9, fill: 'none', stroke: 'rgba(255,255,255,.12)', 'stroke-width': 0.6 }, g);
    el('path', { d: 'M-2.4 0H2.4M0 -2.4V2.4', stroke: '#141516', 'stroke-width': 1.1, 'stroke-linecap': 'round' }, g);
  }
}

/* ── instruments ─────────────────────────────────────────────── */
const attitude = $('#attitude');
const fuel = $('#fuel');
let planeEl, fuelNeedle;

function buildAttitude() {
  bezel(attitude, 'att', 60, 60, 56);
  screws(attitude, [[6, 6, 20], [114, 6, 70], [6, 114, 40], [114, 114, 5]]);
  const ticks = el('g', { stroke: '#d9dde1', 'stroke-linecap': 'round' }, attitude);
  for (let a = 0; a < 360; a += 10) {
    const major = a % 30 === 0;
    const [x0, y0] = polar(60, 60, major ? 38 : 42, a), [x1, y1] = polar(60, 60, 46, a);
    el('line', { x1: x0, y1: y0, x2: x1, y2: y1, 'stroke-width': major ? 1.8 : 0.9, opacity: major ? 1 : 0.65 }, ticks);
  }
  el('path', { d: 'M60 13.5l-3.6 -5.6h7.2z', fill: '#f5a524' }, attitude);
  const wrap = el('g', { class: 'plane-wrap' }, attitude);
  planeEl = el('g', { class: 'plane' }, wrap);
  el('path', {
    d: 'M60 28.5c1.5 0 2.4 2.3 2.4 5.6V50.5L87.5 64.6v3.4L62.4 61.2v16.9l8.9 6.5v3.1L61.3 85.4 60 90l-1.3-4.6-10 2.3v-3.1l8.9-6.5V61.2L32.5 68v-3.4L57.6 50.5V34.1c0-3.3.9-5.6 2.4-5.6z',
    fill: '#c8ccd0', stroke: '#7d848b', 'stroke-width': 0.5, 'stroke-linejoin': 'round',
  }, planeEl);
}

function buildFuel() {
  bezel(fuel, 'fuel', 60, 60, 56);
  screws(fuel, [[6, 6, 60], [114, 6, 15], [6, 114, 80], [114, 114, 35]]);
  const px = 60, py = 74;
  const ticks = el('g', { stroke: '#d9dde1', 'stroke-linecap': 'round' }, fuel);
  for (let i = 0; i <= 8; i++) {
    const a = -62 + (124 * i) / 8, major = i % 4 === 0;
    const [x0, y0] = polar(px, py, major ? 30 : 33, a), [x1, y1] = polar(px, py, 38, a);
    el('line', { x1: x0, y1: y0, x2: x1, y2: y1, 'stroke-width': major ? 2 : 1, stroke: i === 0 ? '#ff5a3c' : '#d9dde1' }, ticks);
  }
  const txt = (x, y, s, size, w = 600) => { const t = el('text', { x, y, 'text-anchor': 'middle', fill: '#e2e5e8', 'font-family': 'Barlow Cond, Barlow SC, sans-serif', 'font-weight': w, 'font-size': size, 'letter-spacing': '.06em' }, fuel); t.textContent = s; };
  txt(60, 97, 'FUEL', 10.5);
  txt(31, 70, 'E', 12, 700);
  txt(89, 70, 'F', 12, 700);
  fuelNeedle = el('g', { class: 'needle', style: `transform-origin:${px}px ${py}px` }, fuel);
  el('path', { d: `M${px - 1.6} ${py + 6}L${px - 1} ${py - 34}L${px} ${py - 37}L${px + 1} ${py - 34}L${px + 1.6} ${py + 6}z`, fill: '#ff5a3c' }, fuelNeedle);
  el('circle', { cx: px, cy: py, r: 5, fill: '#2a2d31', stroke: '#55595f', 'stroke-width': 1 }, fuel);
}

const pullup = $('#pullup');
const pullupSr = Object.assign(document.createElement('span'), { className: 'vh' });
pullup.appendChild(pullupSr);
let lastPull = null;

function renderInstruments(t = truthNow()) {
  const panic = t?.panic ?? 0;
  const bank = (panic / 100) * 38;
  planeEl.style.transform = `rotate(${bank}deg)`;
  attitude.parentElement.classList.toggle('sway', !!t?.pullUp);
  attitude.setAttribute('aria-label', t?.panic == null ? 'Attitude: level' : `Attitude: banked ${Math.round(bank)} degrees at ${panic}% panic`);

  const f = t ? Math.min(1, t.leftMin / 1440) : 0;
  fuelNeedle.style.transform = `rotate(${-62 + 124 * f}deg)`;
  fuel.setAttribute('aria-label', t ? `Fuel: ${fmtDur(t.leftMin)} left, out of a full day` : 'Fuel: no exam time set');

  $('#lamp-stress').classList.toggle('on', !!t?.stress);
  const study = $('#lamp-study');
  study.classList.toggle('on', !!state.timer);

  const on = !!t?.pullUp;
  pullup.classList.toggle('on', on);
  pullupSr.textContent = on ? `Pull up. Panic is ${panic}%.` : '';
  if (on && lastPull === false && !reduceMotion.matches) {
    pullup.classList.remove('flash');
    void pullup.offsetWidth;
    pullup.classList.add('flash');
  }
  if (lastPull === null && on && !reduceMotion.matches) pullup.classList.add('flash');
  lastPull = on;
}
pullup.addEventListener('animationend', () => pullup.classList.remove('flash'));

/* ── 1 · setup ───────────────────────────────────────────────── */
const form = $('#setup');
const examIn = $('#exam');
const whenIn = $('#when');
const track = $('#track');

function renderSetup() {
  if (document.activeElement !== examIn) examIn.value = state.exam;
  whenIn.value = state.examAt;
  const d = examDate();
  $('#when-text').textContent = d ? when(d) : 'Pick a date and time';

  const n = state.units.length, left = leftCount();
  $('#units-count').textContent = `${left} of ${n}`;
  track.style.setProperty('--dot', n <= 6 ? '34px' : n <= 8 ? '30px' : n <= 10 ? '26px' : '23px');
  track.innerHTML = state.units.map((u, i) => {
    const no = i + 1, name = u.name.trim();
    const status = u.done ? 'done' : state.skip?.n === no ? 'skipped' : 'still to study';
    return `<li class="${u.done ? 'done' : 'left'}${state.skip?.n === no ? ' skipped' : ''}">
      <button type="button" class="unit-dot" data-i="${i}" aria-pressed="${!u.done}" aria-label="Unit ${no}${name ? `, ${esc(name)}` : ''}: ${status}">${no}</button></li>`;
  }).join('');

  $('#left-dec').disabled = left === 0;
  $('#left-inc').disabled = left === n;
  $('#total-dec').disabled = n <= 1;
  $('#total-inc').disabled = n >= MAX_UNITS;

  const list = $('#names-list');
  if (!list.contains(document.activeElement)) {
    list.innerHTML = state.units.map((u, i) => `<li class="${u.done ? 'done' : 'left'}">
      <span class="num">${i + 1}</span>
      <input type="text" data-i="${i}" maxlength="40" value="${esc(u.name)}" placeholder="Unit ${i + 1} name" aria-label="Unit ${i + 1} name" enterkeyhint="next" spellcheck="false"></li>`).join('');
  }
  $('#sleep').checked = state.sleep;
}

function changed() {
  fixSkip();
  save();
  renderSetup();
  renderInstruments();
}

examIn.addEventListener('input', () => { state.exam = examIn.value.slice(0, 40); save(); });
examIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); examIn.blur(); } });
whenIn.addEventListener('click', () => { try { whenIn.showPicker(); } catch { /* the native tap still opens it */ } });
whenIn.addEventListener('input', () => {
  if (!whenIn.value || isNaN(new Date(whenIn.value))) return;
  state.examAt = whenIn.value;
  $('#setup-msg').hidden = true;
  changed();
});
track.addEventListener('click', (e) => {
  const b = e.target.closest('.unit-dot');
  if (!b) return;
  const u = state.units[+b.dataset.i];
  u.done = !u.done;
  changed();
  track.querySelector(`[data-i="${b.dataset.i}"]`)?.focus();
});
$('#left-dec').addEventListener('click', () => { const u = state.units.find((x) => !x.done); if (u) u.done = true; changed(); });
$('#left-inc').addEventListener('click', () => { const u = [...state.units].reverse().find((x) => x.done); if (u) u.done = false; changed(); });
$('#total-dec').addEventListener('click', () => { if (state.units.length > 1) state.units.pop(); changed(); });
$('#total-inc').addEventListener('click', () => { if (state.units.length < MAX_UNITS) state.units.push({ name: '', done: false }); changed(); });
$('#names-toggle').addEventListener('click', (e) => {
  const open = e.currentTarget.getAttribute('aria-expanded') !== 'true';
  e.currentTarget.setAttribute('aria-expanded', open);
  $('#names').hidden = !open;
  if (open) $('#names-list input')?.focus();
});
$('#names-list').addEventListener('input', (e) => {
  const i = e.target.dataset.i;
  if (i == null) return;
  state.units[+i].name = e.target.value.slice(0, 40);
  save();
});
$('#names-list').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const next = e.target.closest('li')?.nextElementSibling?.querySelector('input');
  next ? next.focus() : e.target.blur();
});
$('#names-list').addEventListener('focusout', () => setTimeout(renderSetup, 0));
$('#sleep').addEventListener('change', (e) => { state.sleep = e.target.checked; changed(); });

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const msg = $('#setup-msg');
  if (!examDate()) { msg.textContent = 'Pick when the exam is.'; msg.hidden = false; return; }
  msg.hidden = true;
  sweepNext = true;
  go('truth');
});

/* ── 2 · the truth: the panic gauge ──────────────────────────── */
const gauge = $('#gauge');
const G = { cx: 170, cy: 170 };
const angleOf = (v) => -135 + 2.7 * v;
let needle, valueText, needleV = 0, sweepNext = true, anim = 0;

function bandColor(v) {
  const stops = [[0, [39, 176, 74]], [28, [124, 198, 58]], [44, [233, 194, 44]], [58, [245, 165, 36]], [70, [255, 106, 43]], [80, [255, 59, 47]], [100, [232, 36, 26]]];
  for (let i = 1; i < stops.length; i++) {
    const [v1, c1] = stops[i], [v0, c0] = stops[i - 1];
    if (v <= v1) {
      const k = (v - v0) / (v1 - v0);
      return `rgb(${c0.map((c, j) => Math.round(c + (c1[j] - c) * k)).join(',')})`;
    }
  }
  return 'rgb(232,36,26)';
}

function buildGauge() {
  gauge.setAttribute('viewBox', '0 0 340 340');
  const { cx, cy } = G;
  const defs = bezel(gauge, 'gauge', cx, cy, 166);
  defs.insertAdjacentHTML('beforeend', `
    <filter id="needle-glow" x="-50%" y="-20%" width="200%" height="140%">
      <feDropShadow dx="2" dy="3" stdDeviation="2" flood-color="#000" flood-opacity=".7"/>
      <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#ff3b2f" flood-opacity=".55"/>
    </filter>
    <linearGradient id="needle-fill" x1="0" x2="1"><stop offset="0" stop-color="#ff6b4a"/><stop offset=".5" stop-color="#ff3b2f"/><stop offset="1" stop-color="#c8180e"/></linearGradient>
    <radialGradient id="hub" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="#7a7e84"/><stop offset=".5" stop-color="#34373b"/><stop offset="1" stop-color="#131416"/></radialGradient>`);

  // colour band, drawn as short arcs so it can shade from green to red
  const band = el('g', { fill: 'none', 'stroke-width': 15 }, gauge);
  for (let v = 0; v < 100; v += 2) {
    el('path', { d: arcPath(cx, cy, 134, angleOf(v), angleOf(Math.min(100, v + 2.4))), stroke: bandColor(v + 1) }, band);
  }
  el('path', { d: arcPath(cx, cy, 142, angleOf(0), angleOf(100)), fill: 'none', stroke: 'rgba(0,0,0,.45)', 'stroke-width': 1.2 }, gauge);

  const ticks = el('g', { stroke: '#eef0f2', 'stroke-linecap': 'butt' }, gauge);
  for (let v = 0; v <= 100; v += 2.5) {
    const major = v % 25 === 0, mid = v % 5 === 0;
    const [x0, y0] = polar(cx, cy, major ? 127 : mid ? 141 : 144, angleOf(v));
    const [x1, y1] = polar(cx, cy, 151, angleOf(v));
    el('line', { x1: x0, y1: y0, x2: x1, y2: y1, 'stroke-width': major ? 3.4 : mid ? 1.6 : 1, opacity: major ? 1 : mid ? 0.85 : 0.5 }, ticks);
  }
  const note = (y, s) => { const t = el('text', { x: cx, y, 'text-anchor': 'middle', class: 'note' }, gauge); t.textContent = s; };
  note(256, '0% = 6 h or more a unit');
  note(274, '100% = 30 min or less');

  // the printed face: numerals, PANIC and the reading
  for (const v of [0, 25, 50, 75, 100]) {
    const [x, y] = polar(cx, cy, 112, angleOf(v));
    const t = el('text', { x, y: y + 7, 'text-anchor': 'middle', class: 'num' }, gauge);
    t.textContent = v;
  }
  const label = el('text', { x: cx, y: 96, 'text-anchor': 'middle', class: 'label' }, gauge);
  label.textContent = 'PANIC';
  valueText = el('text', { x: cx, y: 138, 'text-anchor': 'middle', class: 'value' }, gauge);

  // the needle and hub pass over the face, as on a real dial
  needle = el('g', { filter: 'url(#needle-glow)' }, gauge);
  el('path', { d: `M${cx - 3.2} ${cy + 22}L${cx - 4} ${cy}L${cx - 1} ${cy - 120}L${cx + 1} ${cy - 120}L${cx + 4} ${cy}L${cx + 3.2} ${cy + 22}z`, fill: 'url(#needle-fill)' }, needle);
  el('circle', { cx, cy, r: 15, fill: 'url(#hub)', stroke: '#0b0c0d', 'stroke-width': 1.5 }, gauge);
  el('circle', { cx, cy, r: 3, fill: '#0e0f10' }, gauge);
  setNeedle(0);
}
function setNeedle(v) {
  needleV = v;
  needle.setAttribute('transform', `rotate(${angleOf(Math.max(-2, Math.min(102, v))).toFixed(2)} ${G.cx} ${G.cy})`);
}
function setValue(t, shown) {
  valueText.textContent = t.kind === 'passed' ? '—' : `${shown}%`;
  valueText.classList.toggle('calm', t.panic != null && t.panic < 40);
  valueText.classList.toggle('warm', t.panic != null && t.panic >= 40 && t.panic < RULES.pullUpAt);
}
// The needle is a damped spring (it overshoots and settles like a real one); the number counts up alongside.
function sweep(t, from) {
  cancelAnimationFrame(anim);
  const to = t.panic ?? 0;
  if (reduceMotion.matches) { setNeedle(to); setValue(t, to); return; }
  let x = from, vel = 0, last = performance.now();
  const t0 = last, countFrom = from;
  const step = (now) => {
    const dt = Math.min(0.032, (now - last) / 1000);
    last = now;
    const k = 90, c = 9.5;
    vel += (-k * (x - to) - c * vel) * dt;
    x += vel * dt;
    setNeedle(x);
    const p = Math.min(1, (now - t0) / 1100);
    setValue(t, Math.round(countFrom + (to - countFrom) * (1 - Math.pow(2, -10 * p))));
    if (Math.abs(x - to) > 0.05 || Math.abs(vel) > 0.05 || p < 1) anim = requestAnimationFrame(step);
    else { setNeedle(to); setValue(t, to); }
  };
  anim = requestAnimationFrame(step);
}

function renderTruth(doSweep = false) {
  const t = truthNow();
  if (!t) return;
  $('#gauge-title').textContent = t.panic == null ? 'Panic: the exam time has passed' : `Panic: ${t.panic}%`;
  if (doSweep) sweep(t, 0);
  else if (t.panic !== Math.round(needleV) || valueText.textContent === '') sweep(t, needleV);

  const skipped = state.skip ? `<span class="sub">Unit ${state.skip.n} skipped. Your call.</span>` : '';
  const sleepCould = `<span class="sub">You could still get ${fmtDur(t.sleepAvailMin)}.</span>`;
  const rows = [];
  const li = (ic, html, cls = '') => rows.push(`<li class="well ${cls}">${icon(ic)}<span>${html}</span></li>`);
  const d = examDate();

  switch (t.kind) {
    case 'passed':
      li('clock', `<b>The exam time has passed.</b><span class="sub">It was set for ${esc(when(d, new Date(), true))}.</span>`, 'alert');
      li('cal', `If that's wrong, change the date.`);
      break;
    case 'under-hour':
      li('clock', `<b>${fmtDur(t.leftMin)}</b> left`, 'alert');
      li('watch', `<b>No new topics.</b><span class="sub">Read what you already know, then go.</span>`);
      li('bed', `<b>Sleep: none.</b>`);
      break;
    case 'no-time':
      li('clock', `<b>${fmtDur(t.leftMin)}</b> left`, 'alert');
      li('watch', `<b>0 min</b> per unit<span class="sub">Getting ready and getting there take the rest.</span>`);
      li('bed', `<b>Sleep: none.</b>`);
      break;
    case 'no-units':
      li('clock', `<b>${fmtDur(t.leftMin)}</b> left`);
      li('watch', `<b>Nothing</b> left to study${skipped || '<span class="sub">One quick revision, then rest.</span>'}`);
      li('bed', state.sleep ? `<b>Sleep: ${fmtDur(t.sleepMin)},</b> if you go to bed now` : `<b>Sleep: off.</b>${sleepCould}`);
      break;
    default:
      li('clock', `<b>${fmtDur(t.leftMin)}</b> left`);
      li('watch', `<b>${fmtDur(t.perUnitMin)}</b> per unit${skipped}`);
      li('bed', state.sleep ? `<b>Sleep: ${fmtDur(t.sleepMin)},</b><span class="sub">if you start now</span>` : `<b>Sleep: off.</b>${sleepCould}`);
  }
  $('#readouts').innerHTML = rows.join('');

  const w = $('#working');
  if (t.kind === 'ok' || t.kind === 'no-time' || t.kind === 'no-units') {
    const nb = (m) => fmtDur(m).replace(/ /g, ' '); // keep "7 h 35 min" on one line
    const parts = [`<b>${nb(t.leftMin)}</b> left`, `<b>${nb(t.bufferMin)}</b> travel and morning`];
    if (t.revisionMin) parts.push(`<b>${nb(t.revisionMin)}</b> revision`);
    if (t.sleepMin) parts.push(`<b>${nb(t.sleepMin)}</b> sleep`);
    w.innerHTML = t.kind === 'no-units'
      ? `${parts.join(' − ')}`
      : `${parts.join(' − ')} = <b>${nb(t.studyMin)}</b> ÷ <b>${t.units}</b> unit${t.units === 1 ? '' : 's'}`;
    w.hidden = false;
  } else {
    w.hidden = true;
  }

  const next = $('#to-plan');
  if (t.kind === 'passed') {
    next.href = '#/';
    next.firstElementChild.textContent = 'Fix the date';
  } else {
    next.href = '#/plan';
    next.firstElementChild.textContent = t.kind === 'under-hour' || t.kind === 'no-time' ? 'What now?' : 'Make the plan';
  }
}

/* ── 3 · the plan ────────────────────────────────────────────── */
const timeline = $('#timeline');
let openSkip = null; // unit number whose skip form is open
let lastBlockIndex = null;

function ensurePlan() {
  if (!state.planAt || state.planSig !== sig()) replan(false);
}
function replan(keepTimer = true) {
  state.planAt = Math.floor(Date.now() / MIN) * MIN;
  state.planSig = sig();
  if (!keepTimer) state.timer = false;
  save();
}

const BLOCK = {
  study: { icon: null },
  sleep: { icon: 'bed', what: 'Sleep' },
  revision: { icon: 'rev', what: 'Quick revision, all units' },
  go: { icon: 'go', what: 'Get ready and go' },
  free: { icon: 'cup', what: 'Free time. Nothing left to study' },
};

function renderPlan() {
  const p = currentPlan();
  if (!p) return;
  const now = Date.now();
  const name = examName();
  $('#replan-text').textContent = 'Re-plan';
  $('#replan').setAttribute('aria-label', `Re-plan from now. This plan started at ${clock(p.start)}.`);

  const items = p.blocks.map((b, i) => {
    const meta = BLOCK[b.kind];
    const dur = fmtDur((b.end - b.start) / MIN);
    const what = b.kind === 'study' ? unitLabel(b.unit) : b.kind === 'go' && p.truth.kind === 'under-hour' ? 'Go. Read your notes on the way' : meta.what;
    const trail = b.kind === 'study'
      ? (state.skip ? '' : `<button type="button" class="key key-cap key-skip" data-skip="${b.unit.n}" aria-expanded="${openSkip === b.unit.n}" aria-label="Skip ${esc(unitLabel(b.unit))}">Skip</button>`)
      : icon(meta.icon);
    const form = b.kind === 'study' && openSkip === b.unit.n ? skipForm(b.unit) : '';
    return `<li class="blk blk-${b.kind}" data-i="${i}">
      <i class="node" aria-hidden="true"></i>
      <div class="well card"><div class="card-main"><time datetime="${new Date(b.start).toISOString()}">${clock(b.start)}</time><span class="dur">${dur}</span>
      <span class="what">${esc(what)}</span></div>${trail}</div>${form}</li>`;
  });
  items.push(`<li class="blk blk-exam">
      <i class="node" aria-hidden="true"></i>
      <div class="well card"><div class="card-main"><time datetime="${new Date(p.examAt).toISOString()}">${clock(p.examAt)}</time>
      <span class="what">${esc(name ? `${name} exam` : 'The exam')}</span></div>${icon('flag')}</div></li>`);
  timeline.innerHTML = items.join('');
  const skipped = $('#skipped');
  skipped.hidden = !state.skip;
  skipped.innerHTML = state.skip ? `<li class="blk blk-skip">
      <i class="node" aria-hidden="true"></i>
      <div class="well card"><div class="card-main"><span class="what">Unit ${state.skip.n} · SKIP${state.skip.why ? ` (${esc(state.skip.why)})` : ''}</span></div>
      <button type="button" class="key key-cap" id="unskip" aria-label="Bring back unit ${state.skip.n}">Undo</button></div></li>` : '';

  const note = $('#plan-note');
  if (p.truth.kind === 'passed') {
    note.innerHTML = 'The exam time has passed. <a href="#/">Change the date</a> if that\'s wrong.';
    note.hidden = false;
  } else {
    note.hidden = true;
  }
  const btn = $('#timer-btn');
  btn.hidden = p.truth.kind === 'passed';
  lastBlockIndex = null;
  livePlan(now, p);
  if (openSkip) timeline.querySelector('.skip-form input')?.focus();
}

function skipForm(u) {
  return `<form class="skip-form" data-n="${u.n}">
    <label>Why skip ${esc(unitLabel(u))}? Your call.
      <input type="text" name="why" maxlength="60" placeholder="Your reason" enterkeyhint="done" autocomplete="off"></label>
    <div class="row-keys"><button type="button" class="key key-cap" data-cancel>Keep it</button><button type="submit" class="key key-cap key-go">Skip it</button></div>
  </form>`;
}

timeline.addEventListener('click', (e) => {
  const sk = e.target.closest('[data-skip]');
  if (sk) { openSkip = openSkip === +sk.dataset.skip ? null : +sk.dataset.skip; renderPlan(); return; }
  if (e.target.closest('[data-cancel]')) { const n = openSkip; openSkip = null; renderPlan(); timeline.querySelector(`[data-skip="${n}"]`)?.focus(); return; }
});
$('#skipped').addEventListener('click', (e) => {
  if (!e.target.closest('#unskip')) return;
  state.skip = null;
  replan();
  renderPlan();
  renderInstruments();
  $('#plan-h').focus();
});
timeline.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target.closest('.skip-form');
  state.skip = { n: +f.dataset.n, why: f.why.value.trim().slice(0, 60) };
  openSkip = null;
  replan();
  renderPlan();
  renderInstruments();
  $('#plan-h').focus();
});
$('#replan').addEventListener('click', () => { replan(); renderPlan(); renderInstruments(); });

// The parts of the plan screen that move with the clock.
function livePlan(now = Date.now(), p = currentPlan()) {
  if (!p) return;
  const cur = currentBlock(p.blocks, now);
  timeline.querySelectorAll('.blk[data-i]').forEach((li) => {
    const b = p.blocks[+li.dataset.i];
    li.classList.toggle('blk-done', b.end <= now);
    const isNow = cur?.index === +li.dataset.i;
    li.classList.toggle('blk-now', isNow);
    if (isNow) li.style.setProperty('--p', `${((cur.elapsedMs / (b.end - b.start)) * 100).toFixed(1)}%`);
  });

  const on = state.timer && p.truth.kind !== 'passed';
  const btn = $('#timer-btn');
  btn.setAttribute('aria-pressed', on);
  btn.querySelector('use').setAttribute('href', on ? '#i-stop' : '#i-play');
  btn.querySelector('span').textContent = on ? 'Stop timer' : 'Start timer';
  $('#readout').hidden = !on;
  if (!on) { document.title = 'Panic Planner'; return; }

  if (!cur) {
    $('#readout-now').textContent = 'Exam time.';
    $('#readout-time').textContent = '0:00';
    $('#readout-bar').style.width = '100%';
    $('#readout-next').textContent = 'Good luck. Go write it.';
    document.title = 'Exam time · Panic Planner';
    return;
  }
  const b = cur.block;
  const what = b.kind === 'study' ? unitLabel(b.unit) : BLOCK[b.kind].what;
  $('#readout-now').textContent = `Now: ${what}`;
  const left = fmtCountdown(cur.remainingMs);
  $('#readout-time').textContent = left;
  $('#readout-bar').style.width = `${((cur.elapsedMs / (b.end - b.start)) * 100).toFixed(2)}%`;
  const n = cur.next;
  $('#readout-next').textContent = n
    ? `Next: ${n.kind === 'study' ? unitLabel(n.unit) : BLOCK[n.kind].what} at ${clock(n.start)}`
    : `Then: the exam at ${clock(p.examAt)}`;
  document.title = `${left} · ${what}`;
  if (lastBlockIndex !== null && lastBlockIndex !== cur.index) alarm();
  lastBlockIndex = cur.index;
}

// Timer: keeps the screen awake, beeps when a block ends.
let audio, wakeLock;
function alarm() {
  try {
    navigator.vibrate?.([220, 120, 220]);
    if (!audio || document.visibilityState !== 'visible') return;
    const t0 = audio.currentTime;
    [988, 740, 988].forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'square'; o.frequency.value = f;
      const s = t0 + i * 0.2;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.08, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.16);
      o.connect(g).connect(audio.destination);
      o.start(s); o.stop(s + 0.18);
    });
  } catch { /* sound is a nice-to-have */ }
}
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen');
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* not supported: the countdown still runs off the clock */ }
}
$('#timer-btn').addEventListener('click', () => {
  state.timer = !state.timer;
  if (state.timer) {
    try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume?.(); } catch { /* no sound */ }
  }
  save();
  keepAwake(state.timer);
  livePlan();
  renderInstruments();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.timer && current === 'plan') keepAwake(true);
});

/* ── routing ─────────────────────────────────────────────────── */
let current = null;
function go(screen) {
  const hash = screen === 'setup' ? '#/' : `#/${screen}`;
  if (location.hash === hash) route(); else location.hash = hash;
}
function route(first = false) {
  let screen = location.hash.replace(/^#\/?/, '') || 'setup';
  if (!['setup', 'truth', 'plan'].includes(screen)) screen = 'setup';
  if (screen !== 'setup' && !examDate()) screen = 'setup';
  const prev = current;
  current = screen;
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.dataset.screen !== screen;
  if (screen === 'setup') renderSetup();
  if (screen === 'truth') { renderTruth(sweepNext || prev !== 'truth'); sweepNext = false; }
  if (screen === 'plan') { openSkip = null; ensurePlan(); renderPlan(); if (state.timer) keepAwake(true); }
  else keepAwake(false);
  renderInstruments();
  if (!first) {
    window.scrollTo(0, 0);
    const h = screen === 'setup' ? examIn : $(`#${screen}-h`);
    if (screen !== 'setup') h?.focus({ preventScroll: true });
  }
}
addEventListener('hashchange', () => route());

/* ── the clock ───────────────────────────────────────────────── */
let lastMinute = null;
setInterval(() => {
  const now = Date.now();
  const minute = Math.floor(now / MIN);
  if (minute !== lastMinute) {
    lastMinute = minute;
    const t = truthNow(now);
    renderInstruments(t);
    if (current === 'truth') renderTruth(false);
    if (current === 'setup') { const d = examDate(); if (d) $('#when-text').textContent = when(d); }
  }
  if (current === 'plan') livePlan(now);
}, 1000);

// Another tab changed the saved state.
addEventListener('storage', (e) => {
  if (e.key !== KEY || DEMO) return;
  state = load();
  route(true);
});

buildAttitude();
buildFuel();
buildGauge();
route(true);
document.documentElement.classList.add('ready');
