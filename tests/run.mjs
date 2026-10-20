// Checks every Forza and F1 combination for valid, in-range output.
// Run with: npm test
import assert from 'node:assert/strict';
import { FORZA_TRACKS, FORZA_CLASSES, F1_TRACKS, F1_RANGES } from '../js/data.js';
import { forzaTune, forzaFix, compareValue, FORZA_ISSUES, DRIVETRAINS } from '../js/forza.js';
import { f1Setup, f1Fix, F1_ISSUES, F1_ROWS, F1_STYLES } from '../js/f1.js';
import { classFromPi, normalizeCar, upsertCar, diffCar, hasPart, PARTS } from '../js/garage.js';

let n = 0;
const bad = (s) => /NaN|undefined|null|Infinity/.test(s);

for (const t of FORZA_TRACKS) for (const c of FORZA_CLASSES) for (const d of DRIVETRAINS)
  for (const weather of ['dry', 'wet']) for (const time of ['day', 'night']) for (const temp of ['cool', 'mild', 'hot'])
    for (const length of ['sprint', 'medium', 'long']) for (const tyreWear of [true, false]) for (const aero of [true, false]) {
      const r = forzaTune({ track: t.id, cls: c.id, drivetrain: d.id, weather, time, temp, length, tyreWear, aero, fuel: true });
      assert.equal(r.track.id, t.id);
      for (const s of r.sections) for (const row of s.rows) {
        assert.ok(row.value && !bad(row.value), `Forza ${t.id} ${c.id} ${s.title}/${row.label}: ${row.value}`);
        const num = parseFloat(row.value);
        if (/pressure \(cold\)/.test(row.label)) assert.ok(num >= 24 && num <= 34, `pressure ${num}`);
        if (s.title === 'Anti-roll bars') assert.ok(num >= 1 && num <= 65, `arb ${num}`);
        if (/camber/.test(row.label)) assert.ok(num >= -3 && num <= 0, `camber ${num}`);
        if (row.cmp) {
          assert.ok(row.key, `row ${row.label} has cmp but no key`);
          const c = compareValue(row.cmp, '10');
          assert.ok(c && !bad(c.text), `compare ${s.title}/${row.label}: ${c && c.text}`);
        }
      }
      const keys = r.sections.flatMap((s) => s.rows.map((x) => x.key)).filter(Boolean);
      assert.equal(new Set(keys).size, keys.length, 'duplicate row keys');
      assert.equal(r.sections.some((s) => s.title === 'Aero'), aero);
      n++;
    }

for (const d of DRIVETRAINS) for (const i of FORZA_ISSUES) assert.ok(forzaFix(i.id, d.id).length >= 2, `fix ${i.id} ${d.id}`);

for (const era of [2025, 2026]) for (const t of F1_TRACKS) for (const session of ['quali', 'race'])
  for (const weather of ['dry', 'wet']) for (const style of F1_STYLES) {
    const r = f1Setup({ era, track: t.id, session, weather, style: style.id });
    for (const g of F1_ROWS) for (const [k] of g.items) {
      const v = r.v[k], [lo, hi] = F1_RANGES[k];
      assert.ok(Number.isFinite(v), `F1 ${t.id} ${k} not a number`);
      assert.ok(v >= lo && v <= hi, `F1 ${era} ${t.id} ${session} ${weather} ${style.id} ${k}=${v} outside ${lo}..${hi}`);
    }
    n++;
  }

for (const i of F1_ISSUES) assert.ok(f1Fix(i.id).length >= 2, `F1 fix ${i.id}`);

// Spot checks that the logic points the right way.
const dry = f1Setup({ era: 2025, track: 'monaco', session: 'race', weather: 'dry', style: 'balanced' });
const monza = f1Setup({ era: 2025, track: 'italy', session: 'race', weather: 'dry', style: 'balanced' });
assert.ok(dry.v.frontWing > monza.v.frontWing, 'Monaco should run more wing than Monza');
const wet = f1Setup({ era: 2025, track: 'monaco', session: 'race', weather: 'wet', style: 'balanced' });
assert.ok(wet.v.diffOn < dry.v.diffOn, 'Wet should lower on-throttle diff');
const fuj = forzaTune({ track: 'fujimi', cls: 'A', drivetrain: 'fwd', weather: 'dry', time: 'night', temp: 'mild', length: 'long', tyreWear: true, aero: true });
const arbs = fuj.sections.find((s) => s.title === 'Anti-roll bars').rows.map((r) => Number(r.value));
assert.ok(arbs[1] > arbs[0], 'FWD rear ARB should be stiffer than front');

// ---------------- Current-value comparisons ----------------
assert.equal(compareValue({ type: 'abs', target: 30, dp: 0 }, '30').text, 'Already set');
assert.equal(compareValue({ type: 'abs', target: 30, dp: 0 }, '22').text, 'Change to 30 (+8)');
assert.equal(compareValue({ type: 'abs', target: -2.0, dp: 1, unit: '°' }, '-1.5').text, 'Change to -2.0° (-0.5)');
assert.equal(compareValue({ type: 'abs', target: 28.5, dp: 1, unit: ' psi' }, '2.0').text, 'Change to 1.97 bar (-0.03)');
assert.equal(compareValue({ type: 'pct', pct: -5 }, '800').text, 'Change to 760');
assert.equal(compareValue({ type: 'gear', clicks: [-4, -2] }, '3.50').text, 'Change to about 3.46–3.48');
assert.equal(compareValue({ type: 'clicks', n: 0 }, '0').ok, true);
assert.equal(compareValue({ type: 'abs', target: 1, dp: 0 }, ''), null);
assert.equal(compareValue({ type: 'abs', target: 1, dp: 0 }, 'abc'), null);
const geo = forzaTune({ track: 'fujimi', cls: 'A', drivetrain: 'fwd', weather: 'wet', time: 'day', temp: 'mild', length: 'medium' });
assert.ok(geo.sections.some((s) => s.title === 'Suspension geometry'));

// ---------------- Garage ----------------
assert.equal(classFromPi(300), 'E'); assert.equal(classFromPi(301), 'D'); assert.equal(classFromPi(600), 'B');
assert.equal(classFromPi(601), 'A'); assert.equal(classFromPi(998), 'P'); assert.equal(classFromPi(999), 'X');
assert.equal(classFromPi(''), null); assert.equal(classFromPi(1200), null);

const junk = normalizeCar({ name: '  ', pi: 'abc', drivetrain: 'xwd', stats: { speed: 14, handling: '6.27' }, frontPct: 99, tyre: 'nope' });
assert.equal(junk.name, 'Unnamed car'); assert.equal(junk.pi, null); assert.equal(junk.drivetrain, 'rwd');
assert.equal(junk.stats.speed, 10); assert.equal(junk.stats.handling, 6.3); assert.equal(junk.frontPct, 80); assert.equal(junk.tyre, 'stock');

let g = upsertCar([], { id: 'c1', name: 'Civic', pi: 652, drivetrain: 'fwd' }, '2026-10-01T00:00:00Z');
assert.equal(g[0].history[0].changes[0], 'Added to garage');
g = upsertCar(g, { ...g[0], pi: 705, hp: 340, parts: { ...g[0].parts, diff: true } }, '2026-10-02T00:00:00Z');
assert.equal(g.length, 1);
assert.equal(g[0].history.length, 2);
assert.ok(g[0].history[0].changes.some((c) => c.includes('PI 652 to 705') && c.includes('S class')), JSON.stringify(g[0].history[0]));
assert.ok(g[0].history[0].changes.includes('Fitted race differential'));
const same = upsertCar(g, { ...g[0] });
assert.equal(same[0].history.length, 2, 'Saving with no changes should not log history');
assert.equal(diffCar(g[0], normalizeCar(g[0])).length, 0);

// Race cars unlock everything but aero; car overrides class/drivetrain in the tune.
const race = normalizeCar({ name: 'TCR', drivetrain: 'fwd', raceCar: true });
assert.ok(PARTS.filter(([k]) => k !== 'aero').every(([k]) => hasPart(race, k)));
assert.equal(hasPart(race, 'aero'), false);
const road = normalizeCar({ name: 'Road car', pi: 520, drivetrain: 'rwd', frontPct: 58 });
const t = forzaTune({ track: 'sebring', cls: 'X', drivetrain: 'awd', weather: 'dry', time: 'day', temp: 'mild', length: 'medium', car: road });
assert.equal(t.cls.id, 'B'); assert.equal(t.drivetrain, 'rwd');
assert.ok(t.sections.find((s) => s.title === 'Differential').locked, 'Diff should be locked without a race diff');
assert.ok(!t.sections.find((s) => s.title === 'Tyres').locked);
const t2 = forzaTune({ track: 'sebring', cls: 'X', drivetrain: 'awd', weather: 'dry', time: 'day', temp: 'mild', length: 'medium', car: race });
assert.ok(t2.sections.every((s) => !s.locked));
assert.ok(t2.notes.some((n) => n.includes('Add a PI')));

console.log(`OK: ${n} combinations checked, garage checks passed`);
