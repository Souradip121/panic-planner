// node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, truth, plan, panicFrom, minutesLeft, currentBlock, fmtDur, fmtCountdown } from '../assets/plan.js';

const MIN = 60_000;
// The reel demo: 8:10 PM on 13 Nov, DBMS at 9:30 AM next morning = 13 h 20 min.
const NOW = new Date(2026, 10, 13, 20, 10).getTime();
const EXAM = new Date(2026, 10, 14, 9, 30).getTime();
const at = (min) => NOW + min * MIN;
const units = (...names) => names.map((name, i) => ({ n: i + 2, name }));
const four = units('SQL', 'Normalisation', 'Transactions', 'Indexing');

test('panic is a straight line from 6 h per unit (0%) to 30 min per unit (100%)', () => {
  assert.equal(panicFrom(360), 0);
  assert.equal(panicFrom(600), 0, 'more than 6 h is still 0');
  assert.equal(panicFrom(30), 100);
  assert.equal(panicFrom(5), 100, 'less than 30 min is still 100');
  assert.equal(panicFrom(195), 50, 'halfway: 3 h 15 min per unit');
  assert.equal(panicFrom(113.75), 75);
  assert.equal(panicFrom(170), 58);
});

test('demo: 13 h 20 min left, 4 units, sleeping', () => {
  const t = truth({ now: NOW, examAt: EXAM, units: 4, sleep: true });
  assert.equal(t.kind, 'ok');
  assert.equal(t.leftMin, 800);
  assert.equal(t.bufferMin, 90);
  assert.equal(t.revisionMin, 30);
  // 800 − 90 − 30 = 680; a third is 226.7, rounded down to 15 min = 225 (3 h 45 min)
  assert.equal(t.sleepAvailMin, 225);
  assert.equal(t.sleepMin, 225);
  assert.equal(t.studyMin, 455);
  assert.equal(t.perUnitMin, 113.75);
  assert.equal(fmtDur(t.perUnitMin), '1 h 53 min');
  assert.equal(t.panic, 75);
  assert.equal(t.pullUp, true);
  assert.equal(t.stress, true);
});

test('demo without sleep: the whole 680 min goes to the units', () => {
  const t = truth({ now: NOW, examAt: EXAM, units: 4, sleep: false });
  assert.equal(t.sleepMin, 0);
  assert.equal(t.sleepAvailMin, 225, 'still says what sleep you could have had');
  assert.equal(t.studyMin, 680);
  assert.equal(t.perUnitMin, 170);
  assert.equal(t.panic, 58);
  assert.equal(t.pullUp, false);
});

test('the parts always add back up to the time left', () => {
  for (const left of [61, 95, 119, 120, 121, 300, 800, 1439, 3000]) {
    for (const u of [0, 1, 3, 7]) {
      for (const sleep of [true, false]) {
        const t = truth({ now: NOW, examAt: at(left), units: u, sleep });
        assert.equal(t.bufferMin + t.revisionMin + t.sleepMin + t.studyMin + t.freeMin, left, `${left} min, ${u} units, sleep ${sleep}`);
        assert.ok(t.sleepMin <= RULES.sleepCapMin && t.sleepMin % 15 === 0);
      }
    }
  }
});

test('sleep never goes above 8 h', () => {
  const t = truth({ now: NOW, examAt: at(30 * 60), units: 2, sleep: true });
  assert.equal(t.sleepMin, 480);
  assert.equal(t.studyMin, 30 * 60 - 90 - 30 - 480);
  assert.equal(t.panic, 0);
});

test('edge: exam already passed', () => {
  for (const examAt of [NOW, at(-1), at(-600)]) {
    const t = truth({ now: NOW, examAt, units: 4 });
    assert.equal(t.kind, 'passed');
    assert.equal(t.leftMin, 0);
    assert.equal(t.panic, null);
    assert.deepEqual(plan({ start: NOW, examAt, units: four }).blocks, []);
  }
});

test('edge: less than an hour left', () => {
  const t = truth({ now: NOW, examAt: at(59), units: 4 });
  assert.equal(t.kind, 'under-hour');
  assert.equal(t.panic, 100);
  assert.equal(t.pullUp, true);
  assert.equal(t.studyMin, 0);
  const p = plan({ start: NOW, examAt: at(59), units: four });
  assert.deepEqual(p.blocks.map(b => b.kind), ['go']);
  assert.equal(p.blocks[0].start, NOW);
  assert.equal(p.blocks[0].end, at(59));
});

test('edge: an hour or more, but the buffer eats it', () => {
  const t = truth({ now: NOW, examAt: at(75), units: 2 });
  assert.equal(t.kind, 'no-time');
  assert.equal(t.bufferMin, 75, 'the buffer is cut to what is left');
  assert.equal(t.panic, 100);
  const p = plan({ start: NOW, examAt: at(100), units: four });
  assert.equal(p.truth.kind, 'no-time');
  assert.deepEqual(p.blocks.map(b => [b.kind, (b.end - b.start) / MIN]), [['revision', 10], ['go', 90]]);
});

test('edge: zero units left', () => {
  const t = truth({ now: NOW, examAt: EXAM, units: 0, sleep: true });
  assert.equal(t.kind, 'no-units');
  assert.equal(t.panic, 0);
  assert.equal(t.perUnitMin, null);
  assert.equal(t.sleepMin, 480);
  assert.equal(t.freeMin, 680 - 480);
  const p = plan({ start: NOW, examAt: EXAM, units: [], sleep: true });
  assert.deepEqual(p.blocks.map(b => b.kind), ['free', 'sleep', 'revision', 'go']);
  const awake = plan({ start: NOW, examAt: EXAM, units: [], sleep: false });
  assert.deepEqual(awake.blocks.map(b => b.kind), ['free', 'revision', 'go']);
});

test('the demo plan, block by block', () => {
  const p = plan({ start: NOW, examAt: EXAM, units: four, sleep: true });
  const hm = (ms) => { const d = new Date(ms); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
  assert.deepEqual(p.blocks.map(b => [b.kind, b.unit?.name ?? '', hm(b.start), hm(b.end)]), [
    ['study', 'SQL', '20:10', '22:05'],
    ['study', 'Normalisation', '22:05', '0:00'],
    ['study', 'Transactions', '0:00', '1:50'],
    ['study', 'Indexing', '1:50', '3:45'],
    ['sleep', '', '3:45', '7:30'],
    ['revision', '', '7:30', '8:00'],
    ['go', '', '8:00', '9:30'],
  ]);
});

test('plans are contiguous, end at the exam, and give the units exactly the study time', () => {
  for (const left of [65, 130, 333, 800, 1500]) {
    for (const n of [1, 2, 4, 6]) {
      for (const sleep of [true, false]) {
        const start = NOW + 37_000; // mid-minute start gets floored
        const p = plan({ start, examAt: at(left), units: four.concat(four).slice(0, n), sleep });
        const b = p.blocks;
        assert.equal(b[0].start, NOW);
        assert.equal(b.at(-1).end, at(left));
        for (let i = 1; i < b.length; i++) assert.equal(b[i].start, b[i - 1].end);
        for (const x of b) assert.ok(x.end > x.start, 'no empty blocks');
        const study = b.filter(x => x.kind === 'study').reduce((s, x) => s + (x.end - x.start), 0);
        assert.equal(study / MIN, p.truth.studyMin);
      }
    }
  }
});

test('skipping a unit gives its time to the others', () => {
  const all = plan({ start: NOW, examAt: EXAM, units: four, sleep: true });
  const skipped = plan({ start: NOW, examAt: EXAM, units: four.slice(0, 3), sleep: true });
  assert.equal(skipped.blocks.filter(b => b.kind === 'study').length, 3);
  assert.ok(skipped.truth.perUnitMin > all.truth.perUnitMin);
  assert.ok(skipped.truth.panic < all.truth.panic);
});

test('current block and countdown', () => {
  const p = plan({ start: NOW, examAt: EXAM, units: four, sleep: true });
  const c = currentBlock(p.blocks, at(1));
  assert.equal(c.index, 0);
  assert.equal(c.remainingMs, 114 * MIN);
  assert.equal(c.next.unit.name, 'Normalisation');
  assert.equal(currentBlock(p.blocks, at(-1)), null);
  assert.equal(currentBlock(p.blocks, EXAM), null);
  assert.equal(currentBlock(p.blocks, EXAM - 1).block.kind, 'go');
  assert.equal(fmtCountdown(114 * MIN), '1:54:00');
  assert.equal(fmtCountdown(4 * MIN + 5000), '4:05');
  assert.equal(fmtCountdown(1), '0:01');
  assert.equal(fmtCountdown(-5), '0:00');
});

test('durations read the way people say them', () => {
  assert.equal(fmtDur(800), '13 h 20 min');
  assert.equal(fmtDur(45), '45 min');
  assert.equal(fmtDur(120), '2 h');
  assert.equal(fmtDur(0), '0 min');
  assert.equal(fmtDur(-3), '0 min');
  assert.equal(minutesLeft(NOW, EXAM), 800);
  assert.equal(minutesLeft(NOW + 59_000, EXAM), 799);
});
