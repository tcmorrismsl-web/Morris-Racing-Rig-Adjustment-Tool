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
  assert.ok(splits.length >= 3, `gap updates (${splits.length})`);
  // Variety: several kinds of talking point, and no line said twice in a row.
  const topics = new Set(all.map((c) => c.kind).filter((k) => ['splits', 'battle-ahead', 'battle-behind', 'teammate', 'overview', 'tyres-rival', 'losing-time', 'sector', 'ers', 'rival-pit', 'battle-pass'].includes(k)));
  assert.ok(topics.size >= 5, `talking points: ${[...topics]}`);
  const texts = all.map((c) => c.text);
  assert.ok(texts.every((x, k) => k === 0 || x !== texts[k - 1]), 'no repeated line back to back');
  const coachCorners = all.filter((c) => c.kind === 'losing-time').map((c) => c.data.corner);
  assert.ok(coachCorners.every((x, k) => k < 2 || !(x === coachCorners[k - 1] && x === coachCorners[k - 2])), `corner coaching moves around: ${coachCorners}`);
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
  assert.ok(loss.some((c) => c.data.from <= 2150 && c.data.to >= 2100), `pinpoints the slow corner: ${loss.map((c) => `${c.data.corner} ${c.data.from}-${c.data.to}`).join(' | ')}`);
  assert.ok(loss.every((c) => /Turns? \d/.test(c.text)) && loss.every((c) => !/sector \d/.test(c.text)), 'corner numbers, not sectors');
  assert.ok(find('adjust').some((c) => /Brake bias back 1%/.test(c.text)), 'wheel change called (brake bias)');
  assert.ok(!all.some((c) => /°C\)/.test(c.text) && c.kind === 'adjust'), 'no tyre temperature adjustments');
  assert.ok(find('pit-soon').length === 1 && find('box-ask').length === 1, 'pit window calls once each');
  const st = race.state();
  assert.equal(st.engineer.segments, st.engineer.zones.length, 'one loss value per corner zone');
  assert.ok(Array.isArray(st.engineer.segLoss) && st.engineer.segLoss.length === st.engineer.zones.length && st.engineer.zones[0].name === 'Turn 1', 'map gets per-corner losses');
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
  assert.ok(loss.some((c) => c.data.from <= 3150 && c.data.to >= 3100), `qualifying loss located: ${loss.map((c) => c.text).join(' | ')}`);
  assert.ok(loss[0].data.ref && loss[0].data.ref !== 'your best lap', 'compared with the fastest car');
  assert.ok(/P\d/.test(race.eng.ask('gaps').text));
}

// ---------------- Before the start: briefing, formation lap, lights out, parc fermé ----------------
{
  const race = new F1Race(store());
  const sim = new F1Sim({ format: 2025, totalLaps: 15, gridS: 25, formationS: 12, parcFerme: true, weekend: [1, 2, 3, 5, 6, 7, 15] });
  const { all, hook } = track(race);
  let planOnGrid = null, phases = new Set();
  for (let k = 0; k < 2400; k++) {
    for (const b of sim.frame(k)) { race.push(parseF1(b)); hook(); }
    const st = race.state();
    phases.add(st.engineer.phase);
    if (k === 200) planOnGrid = st.engineer.plan;
  }
  const kinds = all.map((c) => c.kind);
  assert.ok(!kinds.includes('session'), 'briefing replaces the radio check');
  const brief = all.find((c) => c.kind === 'briefing');
  assert.ok(brief && /You start P5 on Softs, 15 laps/.test(brief.text) && /box around lap 8/.test(brief.text), brief?.text);
  assert.ok(planOnGrid && planOnGrid.items.some((x) => x.k === 'Stop') && planOnGrid.items.some((x) => x.k === 'Parc fermé'), 'race plan on the dashboard');
  assert.ok(kinds.indexOf('briefing') < kinds.indexOf('formation') && kinds.indexOf('formation') < kinds.indexOf('lights'), `order: ${kinds.slice(0, 6)}`);
  assert.equal(all.filter((c) => c.kind === 'formation').length, 1);
  assert.ok(['grid', 'formation', 'race'].every((p) => phases.has(p)), [...phases].join(','));
  assert.equal(race.state().engineer.plan, null, 'plan card goes away after the start');
  assert.ok(race.state().parcFerme.on, 'race after qualifying is in parc fermé');
  assert.ok(/stop/i.test(race.eng.ask('plan').text));
}

// ---------------- Qualifying: one gap call, quiet once out, quiet when told to wait ----------------
for (const answer of [null, 'wait']) {
  const race = new F1Race(store());
  const sim = new F1Sim({ format: 2025, sessionType: 5, garageUntil: 150, parcFerme: true, weekend: [1, 5, 6, 7, 15] });
  const { all, hook } = track(race);
  let answeredAt = null, leaveSeen = null, pfBefore = null;
  for (let k = 0; k < 6000; k++) {
    for (const b of sim.frame(k)) { race.push(parseF1(b)); hook(); }
    const st = race.state();
    if (k === 1000) { leaveSeen = st.engineer.leave; pfBefore = st.parcFerme; }
    if (answer && answeredAt === null && all.some((c) => /^leave-(go|wait)$/.test(c.kind))) { answeredAt = all.length; race.eng.ask(answer); }
  }
  const leftAt = all.findIndex((c) => c.t > 150000);
  const inGarage = all.slice(0, leftAt < 0 ? all.length : leftAt);
  const afterOut = leftAt < 0 ? [] : all.slice(leftAt);
  assert.ok(leaveSeen && leaveSeen.out === false && Array.isArray(leaveSeen.windows) && leaveSeen.leaveByS > 0, `garage timers: ${JSON.stringify(leaveSeen)}`);
  assert.ok(leaveSeen.windows.every((w) => w.to >= w.from), 'clean windows');
  assert.ok(pfBefore.soon && !pfBefore.on, 'parc fermé not yet on in the garage before the first run');
  assert.ok(inGarage.some((c) => c.kind === 'parc-ferme'), 'parc fermé reminder before leaving');
  assert.ok(race.state().parcFerme.on, 'parc fermé on after the first run');
  assert.ok(inGarage.filter((c) => c.kind === 'leave-go').length <= 1, `one go call per garage visit: ${inGarage.map((c) => c.kind)}`);
  assert.ok(!afterOut.some((c) => /^leave-/.test(c.kind)), `no pit-exit calls once out: ${afterOut.map((c) => c.kind)}`);
  assert.equal(race.state().engineer.leave.out, true);
  if (answer) {
    const after = all.slice(answeredAt, leftAt < 0 ? all.length : leftAt);
    assert.ok(after.some((c) => c.kind === 'answer' && /Holding/.test(c.text)), 'acknowledges the wait');
    assert.ok(!after.some((c) => c.kind === 'leave-go' || c.kind === 'leave-wait'), `quiet after "wait": ${after.map((c) => c.kind)}`);
  }
}

// Sprint weekends: the Grand Prix qualifying starts open; the sprint and the GP are locked.
{
  const pf = (type, weekend) => { const r = new F1Race(store()); r.session = { sessionType: type, parcFermeRules: true, weekend }; return r.parcFerme(); };
  const sprint = [1, 10, 11, 12, 15, 5, 6, 7, 16];
  assert.ok(pf(15, sprint).on && pf(16, sprint).on && pf(6, sprint).on, 'sprint, GP and Q2 locked');
  assert.ok(!pf(5, sprint).on && pf(5, sprint).soon, 'GP Q1 open until you drive out');
  assert.ok(!pf(15, [15]).on, 'race-only weekend is open');
  const off = new F1Race(store()); off.session = { sessionType: 15, parcFermeRules: false, weekend: [5, 15] };
  assert.ok(!off.parcFerme().on, 'rules off in the game');
}

// ---------------- Corner coaching from telemetry ----------------
{
  const { Coach } = require('../bridge/coach.js');
  const coach = new Coach();
  coach.setTrack('austria', 17, 4318);
  const z = coach.zones.find((x) => x.name === 'Turn 3');
  const drive = (lapNum, brakeAt, apexSpeed, ers) => {
    let t = 0;
    for (let d = 0; d < 4318; d += 5) {
      const inBrake = d >= z.apex - brakeAt && d < z.apex;
      const near = Math.abs(d - z.apex) < 40;
      const v = near ? apexSpeed : inBrake ? 150 : 280;
      t += (5 / (v / 3.6)) * 1000;
      coach.sample(lapNum, d, Math.round(t), { speedKmh: v, throttle: inBrake || near ? 0 : 1, brake: inBrake ? 0.9 : 0, gear: near ? 3 : 7 }, ers(d));
    }
    return coach.lapDone(lapNum, Math.round(t), false);
  };
  drive(1, 100, 95, () => 2e6);
  const r2 = drive(2, 125, 88, (d) => 2e6 - d * 200);
  const k = coach.zones.indexOf(z);
  const adv = coach.advise(k, r2.lap, r2.prevBest);
  assert.ok(adv && /braked [23]\d m earlier than your best lap/.test(adv.text) && /7 km\/h slower at the apex/.test(adv.text), adv?.text);
  assert.ok(/Brake later, about \d+ m before the apex/.test(adv.fix), adv.fix);
  const e = coach.ers(r2.lap);
  assert.ok(e && e.end < e.start && e.longest && /the run from Turn \d+ to Turn \d+/.test(e.longest.name), JSON.stringify(e));
  // Reverse layouts don't use real corner numbers.
  const rev = new Coach(); rev.setTrack('austria', 40, 4318);
  assert.ok(!rev.state().named && /km mark/.test(rev.zones[0].name));
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

console.log('OK: engineer checks passed (race, briefing, qualifying, parc fermé, Forza)');
