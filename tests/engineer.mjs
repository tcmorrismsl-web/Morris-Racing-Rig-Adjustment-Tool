// Race engineer checks: simulated races and qualifying through the real decoders.
// Run with: node tests/engineer.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseF1, parseForza } = require('../bridge/parsers.js');
const { F1Race, ForzaRace } = require('../bridge/race.js');
const { F1Sim, ForzaSim } = require('./race-sim.cjs');

const store = () => ({ loadTrack: () => null, saveTrack: () => {} });
const said = (race) => race.eng.calls.list.concat(race._older || []);
// Keep every call, not just the last 30 the engineer holds for the dashboard.
function track(race) {
  const all = [];
  const hook = () => { const c = race.eng.calls; if (c._hooked) return; c._hooked = true; const orig = c.say.bind(c); c.say = (...a) => { const r = orig(...a); if (r) all.push(r); return r; }; };
  return { all, hook };
}

// ---------------- Race ----------------
{
  const race = new F1Race(store());
  const sim = new F1Sim({ format: 2025, totalLaps: 15, scAt: 260, weatherAt: 560, slowZone: [2000, 2250, 0.7] });
  const { all, hook } = track(race);
  for (let k = 0; k < 14000; k++) {
    if (k === 1500) sim.press(3);            // "gaps" from the wheel
    if (k === 5300) sim.press(1);            // "yes" to the safety-car question
    if (k === 7000) sim.press(5);            // "where am I losing time"
    for (const b of sim.frame(k)) { race.push(parseF1(b)); hook(); }
  }
  const kinds = all.map((c) => c.kind);
  const find = (k) => all.filter((c) => c.kind === k);
  assert.ok(kinds.includes('session'), 'radio check');
  const splits = find('splits');
  assert.ok(splits.length >= 6, `splits each lap (${splits.length})`);
  assert.ok(splits.some((c) => c.data.ahead && c.data.behind && c.data.lapsLeft), 'splits carry car ahead/behind and laps left');
  assert.ok(splits.some((c) => c.data.ahead?.changeMs !== null && c.data.ahead?.changeMs !== undefined), 'gap trends after a lap');
  const answeredGaps = all.find((c) => c.kind === 'splits' && c.priority === 'high');
  assert.ok(answeredGaps, 'wheel button 3 answered with gaps');
  const sc = find('sc')[0];
  assert.ok(sc && sc.ask === 'box-sc', `safety car with a question: ${sc && sc.text}`);
  assert.ok(find('box-now').length >= 1, 'answered yes from the wheel: box now');
  assert.ok(find('weather-now').some((c) => c.data.to === 'light rain'), 'weather change called');
  assert.ok(find('rain-coming').length >= 1, 'rain forecast called');
  const loss = find('losing-time');
  assert.ok(loss.length >= 1, 'losing time called');
  assert.ok(loss.some((c) => c.data.fromKm >= 1.7 && c.data.toKm <= 2.6), `pinpoints the slow zone: ${loss.map((c) => c.text).join(' | ')}`);
  assert.ok(loss[0].text.includes('sector 2'), 'sector named');
  assert.ok(find('adjust').some((c) => /Brake bias back 1%/.test(c.text)), 'wheel change called (brake bias)');
  assert.ok(!all.some((c) => /°C\)/.test(c.text) && c.kind === 'adjust'), 'no tyre temperature adjustments');
  assert.ok(find('pit-soon').length === 1 && find('box-ask').length === 1, 'pit window calls once each');
  const st = race.state();
  assert.equal(st.engineer.segments, 20);
  assert.ok(Array.isArray(st.engineer.segLoss) && st.engineer.segLoss.length === 20, 'map gets per-sector losses');
  assert.equal(st.adjust.mode, 'track');
  assert.ok(st.adjust.items.every((x) => !/hot|cold/i.test(x.title)), 'adjust panel has no tyre temps');
  // Ask from the phone
  const ans = race.eng.ask('weather');
  assert.ok(/light rain/.test(ans.text) && /Forecast/.test(ans.text), ans.text);
  assert.ok(/Plan is lap|stopped|No stop/.test(race.eng.ask('pit').text));
  assert.ok(/Fuel plus/.test(race.eng.ask('tyres').text));
  assert.equal(race.eng.ask('repeat').text, race.eng.calls.list.at(-2).text, 'repeat says the last call again');
}

// ---------------- Qualifying: leaving the garage ----------------
{
  const race = new F1Race(store());
  const sim = new F1Sim({ format: 2026, sessionType: 5, garageUntil: 45, slowZone: [3000, 3250, 0.7] });
  const { all, hook } = track(race);
  let modeInGarage = null;
  for (let k = 0; k < 7000; k++) {
    for (const b of sim.frame(k)) { race.push(parseF1(b)); hook(); }
    if (k === 400) modeInGarage = race.state().adjust.mode;
  }
  assert.equal(modeInGarage, 'garage', 'garage mode while sitting in the garage');
  const kinds = all.map((c) => c.kind);
  assert.ok(kinds.includes('leave-go') || kinds.includes('leave-wait'), `pit exit advice: ${kinds.slice(0, 10)}`);
  const lw = all.find((c) => c.kind === 'leave-wait');
  if (lw) assert.ok(lw.data.seconds > 0 && lw.data.seconds <= 90);
  assert.ok(all.filter((c) => c.kind === 'lap-done').length >= 2, 'lap times called');
  const loss = all.filter((c) => c.kind === 'losing-time');
  assert.ok(loss.some((c) => c.data.fromKm >= 2.7 && c.data.toKm <= 3.6), `qualifying loss located: ${loss.map((c) => c.text).join(' | ')}`);
  assert.ok(loss[0].data.ref && loss[0].data.ref !== 'your best lap', 'compared with the fastest car');
  assert.ok(/P\d/.test(race.eng.ask('gaps').text));
}

// ---------------- Forza ----------------
{
  const race = new ForzaRace(store(), () => 5);
  const sim = new ForzaSim();
  const { all, hook } = track(race);
  for (let k = 0; k < 60 * 60 * 6.5; k++) {
    for (const b of sim.frame(k)) { race.push(parseForza(b)); hook(); }
    if (k % 600 === 0) race.state(); // the dashboard polls state
  }
  const kinds = [...new Set([...race.eng.calls.list, ...all])].map((c) => c.kind);
  assert.ok(kinds.includes('session') && kinds.filter((k) => k === 'lap-done').length >= 3, kinds.join(','));
  assert.ok(kinds.includes('losing-time'), `Forza losing time: ${kinds.join(',')}`);
  assert.ok(kinds.includes('pit-estimate'), 'fuel warning spoken');
  assert.ok(/Forza doesn't send/.test(race.eng.ask('gaps').text));
  assert.equal(race.state().adjust.mode, 'track');
}

console.log('OK: engineer checks passed (race, qualifying, Forza)');
