// Checks every Forza and F1 combination for valid, in-range output.
// Run with: npm test
import assert from 'node:assert/strict';
import { FORZA_TRACKS, FORZA_CLASSES, F1_TRACKS, F1_RANGES } from '../js/data.js';
import { forzaTune, forzaFix, compareValue, estimateRace, COMPOUNDS, START_TIMES, FORZA_ISSUES, DRIVETRAINS } from '../js/forza.js';
import { f1Setup, f1Fix, lapsFor, F1_COMPOUNDS, F1_DISTANCES, F1_ISSUES, F1_ROWS, F1_STYLES } from '../js/f1.js';
import { classFromPi, normalizeCar, upsertCar, diffCar, hasPart, PARTS } from '../js/garage.js';
import { FORZA_CARS, FORZA_DIVISIONS, findCar, searchCars } from '../js/cars.js';
import { pfSplit, pfState, PF_DRIVING } from '../js/parcferme.js';

let n = 0;
const bad = (s) => /NaN|undefined|null|Infinity/.test(s);

for (const t of FORZA_TRACKS) for (const c of FORZA_CLASSES) for (const d of DRIVETRAINS)
  for (const weather of ['dry', 'wet']) for (const time of ['day', 'night']) for (const temp of ['cool', 'mild', 'hot'])
    for (const length of ['sprint', 'medium', 'long']) for (const tyreWear of [true, false]) for (const aero of [true, false]) for (const feel of ['forgiving', 'sharp']) {
      const r = forzaTune({ track: t.id, cls: c.id, drivetrain: d.id, weather, time, temp, length, tyreWear, aero, fuel: true, feel });
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

// F1 laps and compounds
for (const era of [2025, 2026]) for (const t of F1_TRACKS) {
  assert.ok(t.laps >= 40 && t.laps <= 80, `${t.id} laps`);
  for (const d of F1_DISTANCES) for (const c of F1_COMPOUNDS) for (const weather of ['dry', 'wet']) {
    const laps = d.laps ? d.laps() : lapsFor(t, d.pct);
    const r = f1Setup({ era, track: t.id, session: 'race', weather, style: 'balanced', laps, compound: c.id });
    for (const g of F1_ROWS) for (const [k] of g.items) assert.ok(r.v[k] >= F1_RANGES[k][0] && r.v[k] <= F1_RANGES[k][1], `F1 ${t.id} ${d.id} ${c.id} ${k}=${r.v[k]}`);
    assert.ok(r.tyreAdvice.plan && r.notes.every((x) => !bad(x)));
    n++;
  }
}
const f1Short = f1Setup({ era: 2025, track: 'australia', session: 'race', weather: 'dry', style: 'balanced', laps: 5, compound: 'soft' });
const f1Full = f1Setup({ era: 2025, track: 'australia', session: 'race', weather: 'dry', style: 'balanced', laps: 58, compound: 'medium' });
assert.equal(f1Short.runLength, 'short'); assert.equal(f1Full.runLength, 'long');
assert.ok(f1Short.v.frontTyre > f1Full.v.frontTyre, 'Short races run higher pressure');
assert.ok(f1Short.v.frontCamber < f1Full.v.frontCamber, 'Short races run more camber');
assert.equal(f1Setup({ era: 2025, track: 'monaco', session: 'race', weather: 'dry', laps: 20, compound: 'inter' }).v.frontTyre, 25.0, 'Inters use the wet setup');

// Spot checks that the logic points the right way.
const dry = f1Setup({ era: 2025, track: 'monaco', session: 'race', weather: 'dry', style: 'balanced' });
const monza = f1Setup({ era: 2025, track: 'italy', session: 'race', weather: 'dry', style: 'balanced' });
assert.ok(dry.v.frontWing > monza.v.frontWing, 'Monaco should run more wing than Monza');
const wet = f1Setup({ era: 2025, track: 'monaco', session: 'race', weather: 'wet', style: 'balanced' });
assert.ok(wet.v.diffOn < dry.v.diffOn, 'Wet should lower on-throttle diff');
const fuj = forzaTune({ track: 'fujimi', cls: 'A', drivetrain: 'fwd', weather: 'dry', time: 'night', temp: 'mild', length: 'long', tyreWear: true, aero: true });
const diffOf = (r) => Number(r.sections.find((s) => s.title === 'Differential').rows[0].value.replace('%', ''));
const easyR = forzaTune({ track: 'spa', cls: 'S', drivetrain: 'rwd', weather: 'dry', time: 'day', temp: 'mild', length: 'medium' });
const sharpR = forzaTune({ track: 'spa', cls: 'S', drivetrain: 'rwd', weather: 'dry', time: 'day', temp: 'mild', length: 'medium', feel: 'sharp' });
assert.ok(diffOf(easyR) < diffOf(sharpR), 'Forgiving should lock the diff less on power');
const arbs = fuj.sections.find((s) => s.title === 'Anti-roll bars').rows.map((r) => Number(r.value));
assert.ok(arbs[1] > arbs[0], 'FWD rear ARB should be stiffer than front');

// ---------------- Laps, start time and compound ----------------
for (const t of FORZA_TRACKS) {
  assert.ok(t.miles > 0, `${t.id} has a lap length`);
  for (const c of FORZA_CLASSES) {
    const e = estimateRace(t, c.tier, 10);
    assert.ok(e.lapMin > 0.5 && e.lapMin < 20, `${t.id} ${c.id} lap ${e.lapMin}`);
  }
  for (const compound of COMPOUNDS) for (const start of ['06:00', '13:00', '20:00']) for (const laps of [1, 5, 30]) for (const weather of ['dry', 'wet']) {
    const r = forzaTune({ track: t.id, cls: 'A', drivetrain: 'rwd', weather, temp: 'mild', laps, start, compound: compound.id, tyreWear: true });
    const rows = r.sections.flatMap((s) => s.rows);
    assert.ok(rows.every((x) => x.value && !bad(x.value)) && r.notes.every((x) => !bad(x)), `${t.id} ${compound.id} ${laps}`);
    n++;
  }
}
assert.equal(START_TIMES.length, 24);
const tyreRow = (r) => r.sections[0].rows[0];
const fuj3 = forzaTune({ track: 'fujimi', cls: 'A', drivetrain: 'fwd', weather: 'dry', laps: 3, start: '20:00', compound: 'medium', tyreWear: true });
assert.equal(tyreRow(fuj3).label, 'Compound');
assert.ok(fuj3.notes.some((x) => /3 laps is about \d+ minutes/.test(x)), fuj3.notes.join(' | '));
const sprint = forzaTune({ track: 'limerock', cls: 'C', drivetrain: 'rwd', weather: 'dry', laps: 3, start: '13:00', compound: 'medium', tyreWear: true });
assert.ok(/Soft is the better pick/.test(tyreRow(sprint).why), tyreRow(sprint).why);
const rain = forzaTune({ track: 'spa', cls: 'A', drivetrain: 'rwd', weather: 'wet', laps: 5, start: '13:00', compound: 'soft', tyreWear: true });
assert.ok(rain.notes.some((x) => x.startsWith('Slick tyres on a wet track')));
const softP = parseFloat(forzaTune({ track: 'spa', cls: 'A', drivetrain: 'rwd', weather: 'dry', laps: 5, start: '13:00', compound: 'soft' }).sections[0].rows[1].value);
const hardP = parseFloat(forzaTune({ track: 'spa', cls: 'A', drivetrain: 'rwd', weather: 'dry', laps: 5, start: '13:00', compound: 'hard' }).sections[0].rows[1].value);
assert.ok(softP < hardP, 'Softs should start at lower pressure than hards');

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

// ---------------- Car list ----------------
assert.ok(FORZA_CARS.length >= 550, `car count ${FORZA_CARS.length}`);
assert.equal(new Set(FORZA_CARS.map((c) => c.name)).size, FORZA_CARS.length, 'duplicate car names');
assert.ok(FORZA_CARS.every((c) => c.division && FORZA_DIVISIONS.includes(c.division) && c.year >= 1900 && c.year <= 2030), 'car fields');
assert.equal(FORZA_CARS.filter((c) => FORZA_DIVISIONS.indexOf(c.division) < 38).length, 499, 'official launch roster is 499 cars');
assert.equal(findCar('2020 honda #73 la honda world racing CIVIC').division, 'Forza Touring Cars');
assert.ok(findCar('2020 Honda #73 LA Honda World Racing Civic').raceCar);
assert.ok(!findCar('2018 Honda Civic Type R').raceCar);
assert.deepEqual(searchCars('gt3 rs').map((c) => c.name).sort(), ['2016 Porsche 911 GT3 RS', '2019 Porsche 911 GT3 RS']);
assert.equal(normalizeCar({ name: '1997 McLaren F1 GT' }).division, 'Early Factory Racecars');

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

// Parc fermé: every F1 fix sorts into allowed / locked, and every issue has something you can still do.
for (const i of F1_ISSUES) {
  const sp = pfSplit(f1Fix(i.id));
  assert.equal(sp.ok.length + sp.locked.length, f1Fix(i.id).length);
  assert.ok(sp.ok.length || PF_DRIVING[i.id], `parc fermé fallback for ${i.id}`);
  assert.ok(sp.ok.every((x) => /front wing|brake bias|diff on throttle|short-shift|smoother|brake/i.test(x.text)), JSON.stringify(sp.ok));
}
assert.deepEqual(pfSplit(['Add 2 front wing.', 'Soften the front anti-roll bar by 2.', 'Lower diff on throttle by 5%.']).locked, ['Soften the front anti-roll bar by 2.']);
assert.equal(pfState('auto', { on: true, reason: 'x' }).on, true);
assert.equal(pfState('off', { on: true }).on, false);
assert.equal(pfState('on', null).on, true);
assert.equal(pfState('auto', null).on, false);

console.log(`OK: ${n} combinations checked, garage and parc fermé checks passed`);
