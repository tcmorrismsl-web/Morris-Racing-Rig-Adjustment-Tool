// Checks every Forza and F1 combination for valid, in-range output.
// Run with: npm test
import assert from 'node:assert/strict';
import { FORZA_TRACKS, FORZA_CLASSES, F1_TRACKS, F1_RANGES } from '../js/data.js';
import { forzaTune, forzaFix, FORZA_ISSUES, DRIVETRAINS } from '../js/forza.js';
import { f1Setup, f1Fix, F1_ISSUES, F1_ROWS, F1_STYLES } from '../js/f1.js';

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
      }
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

console.log(`OK: ${n} combinations checked`);
