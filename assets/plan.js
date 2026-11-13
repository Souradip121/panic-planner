// Panic Planner: the maths. Pure functions, no DOM, so `node --test` can check them.
// Every number the app shows comes from truth() or plan() below. The README walks
// through the same rules with the demo numbers.

export const RULES = Object.freeze({
  bufferMin: 90,      // travel and the morning (get up, get ready, get there), right before the exam
  revisionMin: 30,    // one quick revision of everything, just before the buffer
  sleepShare: 1 / 3,  // sleep gets a third of what's left: the share a normal day gives it
  sleepCapMin: 480,   // ...but never more than 8 h
  sleepStepMin: 15,   // sleep is rounded down to 15 min
  calmMin: 360,       // 6 h or more per unit  = 0% panic
  doomMin: 30,        // 30 min or less per unit = 100% panic
  stressAt: 50,       // HIGH STRESS lamp from 50%
  pullUpAt: 70,       // PULL UP strip from 70%
  snapMin: 5,         // study blocks start on 5-minute marks
});

const MIN = 60_000;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const floorTo = (x, step) => Math.floor(x / step) * step;

/** Panic % for a given time per unit, in minutes. A straight line:
 *  calmMin or more → 0, doomMin or less → 100. */
export function panicFrom(perUnitMin, r = RULES) {
  const p = (100 * (r.calmMin - perUnitMin)) / (r.calmMin - r.doomMin);
  return Math.round(clamp(p, 0, 100));
}

/** Whole minutes from `now` to `examAt` (floored). Negative when the exam has passed. */
export function minutesLeft(now, examAt) {
  return Math.floor((toMs(examAt) - toMs(now)) / MIN);
}

/**
 * The truth, if you start now.
 * kind: 'passed' | 'under-hour' | 'no-units' | 'no-time' | 'ok'
 */
export function truth({ now, examAt, units, sleep = true }, r = RULES) {
  const leftMin = minutesLeft(now, examAt);
  const u = Math.max(0, Math.floor(units || 0));
  const base = { leftMin: Math.max(0, leftMin), units: u, sleep: !!sleep, bufferMin: 0, revisionMin: 0,
    sleepMin: 0, sleepAvailMin: 0, studyMin: 0, freeMin: 0, perUnitMin: null, panic: null, stress: false, pullUp: false };

  if (leftMin <= 0) return { ...base, kind: 'passed' };
  if (leftMin < 60) {
    return { ...base, kind: 'under-hour', bufferMin: leftMin, perUnitMin: u ? 0 : null, panic: 100, stress: true, pullUp: true };
  }

  const bufferMin = Math.min(r.bufferMin, leftMin);
  const usable = leftMin - bufferMin;
  const revisionMin = Math.min(r.revisionMin, usable);
  const afterRev = usable - revisionMin;

  if (u === 0) {
    // Nothing left to study: everything after revision can be sleep (up to the cap); the rest is free.
    const sleepAvailMin = Math.min(r.sleepCapMin, floorTo(afterRev, r.sleepStepMin));
    const sleepMin = sleep ? sleepAvailMin : 0;
    return { ...base, kind: 'no-units', bufferMin, revisionMin, sleepAvailMin, sleepMin,
      freeMin: afterRev - sleepMin, panic: 0 };
  }

  const sleepAvailMin = Math.min(r.sleepCapMin, floorTo(afterRev * r.sleepShare, r.sleepStepMin));
  const sleepMin = sleep ? sleepAvailMin : 0;
  const studyMin = afterRev - sleepMin;
  const perUnitMin = studyMin / u;
  const panic = studyMin <= 0 ? 100 : panicFrom(perUnitMin, r);
  return { ...base, kind: studyMin <= 0 ? 'no-time' : 'ok', bufferMin, revisionMin, sleepAvailMin, sleepMin,
    studyMin, perUnitMin, panic, stress: panic >= r.stressAt, pullUp: panic >= r.pullUpAt };
}

/**
 * A timed plan from `start` to the exam, built backwards from the exam:
 *   [study unit, study unit, ...] [sleep] [revision] [go: travel and the morning] → exam
 * `units` is the list of units you will study, in order: [{ n, name }].
 * Blocks are contiguous: each block's end is the next block's start, and the last ends at the exam.
 */
export function plan({ start, examAt, units = [], sleep = true }, r = RULES) {
  const s = floorTo(toMs(start), MIN);
  const e = toMs(examAt);
  const t = truth({ now: s, examAt: e, units: units.length, sleep }, r);
  const blocks = [];
  if (t.kind === 'passed') return { truth: t, start: s, examAt: e, blocks };
  if (t.kind === 'under-hour') {
    blocks.push({ kind: 'go', start: s, end: e });
    return { truth: t, start: s, examAt: e, blocks };
  }

  const goStart = e - t.bufferMin * MIN;
  const revStart = goStart - t.revisionMin * MIN;
  const sleepStart = revStart - t.sleepMin * MIN;

  if (units.length && t.studyMin > 0) {
    const per = (sleepStart - s) / units.length;
    const snap = per >= 20 * MIN; // don't snap tiny blocks out of existence
    let from = s;
    units.forEach((unit, i) => {
      let to = i === units.length - 1 ? sleepStart : s + per * (i + 1);
      if (snap && i < units.length - 1) to = Math.round(to / (r.snapMin * MIN)) * r.snapMin * MIN;
      to = clamp(to, from, sleepStart);
      blocks.push({ kind: 'study', start: from, end: to, unit });
      from = to;
    });
  } else if (sleepStart > s) {
    blocks.push({ kind: 'free', start: s, end: sleepStart });
  }
  if (t.sleepMin > 0) blocks.push({ kind: 'sleep', start: sleepStart, end: revStart });
  if (t.revisionMin > 0) blocks.push({ kind: 'revision', start: revStart, end: goStart });
  blocks.push({ kind: 'go', start: goStart, end: e });
  return { truth: t, start: s, examAt: e, blocks: blocks.filter(b => b.end > b.start) };
}

/** The block running at `now`, with what's left of it. null before the plan or after the exam. */
export function currentBlock(blocks, now) {
  const n = toMs(now);
  const index = blocks.findIndex(b => b.start <= n && n < b.end);
  if (index < 0) return null;
  const block = blocks[index];
  return { index, block, remainingMs: block.end - n, elapsedMs: n - block.start, next: blocks[index + 1] || null };
}

/** "13 h 20 min", "45 min", "2 h", "0 min". Minutes are floored. */
export function fmtDur(min) {
  const m = Math.max(0, Math.floor(min ?? 0));
  const h = Math.floor(m / 60), r = m % 60;
  if (!h) return `${r} min`;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** "1:52:07" / "4:05" countdown text from milliseconds (ceil to the second, so it never shows 0:00 early). */
export function fmtCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0'), ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function toMs(x) {
  return x instanceof Date ? x.getTime() : Number(x);
}
