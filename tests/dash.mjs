// Live dashboard checks: full simulated races through the real decoders and race model.
// Run with: node tests/dash.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseF1, parseForza } = require('../bridge/parsers.js');
const { F1Race, ForzaRace } = require('../bridge/race.js');
const { F1Sim, ForzaSim, TRACK_LEN } = require('./race-sim.cjs');

const memStore = () => {
  const saved = {};
  return { saved, loadTrack: (k) => saved[k] || null, saveTrack: (k, d) => { saved[k] = d; } };
};

function runF1(format) {
  const store = memStore();
  const race = new F1Race(store);
  const sim = new F1Sim({ format, totalLaps: 15 });
  let maxPitItems = 0, sawTwoCompound = false;
  // About 9.5 laps of the 76 s lap at 20 frames a second.
  for (let k = 0; k < 14500; k++) {
    for (const b of sim.frame(k)) {
      const m = parseF1(b);
      assert.ok(m && m.header.format === format, 'decodes');
      race.push(m);
    }
    if (k === 2000) {
      const s = race.state();
      sawTwoCompound = s.pit.items.some((x) => x.title === 'Two dry compounds needed');
      maxPitItems = s.pit.items.length;
    }
  }
  // Fastest-lap event
  race.push(parseF1(sim.event('FTLP', [3, ...Buffer.from(new Float32Array([78.456]).buffer)])));
  return { race, store, sim, s: race.state(), sawTwoCompound, maxPitItems };
}

for (const format of [2025, 2026]) {
  const { s, store, sim, sawTwoCompound } = runF1(format);
  const active = sim.active;
  // Timing tower
  assert.equal(s.tower.length, active, `${format}: tower has every active car`);
  assert.deepEqual(s.tower.map((r) => r.pos), Array.from({ length: active }, (_, k) => k + 1), 'positions in order');
  const me = s.tower.find((r) => r.me);
  assert.equal(me.name, 'MORRIS', `${format}: player name decoded`);
  assert.ok(s.tower.every((r) => /^#[0-9a-f]{6}$/.test(r.colour)), 'team colours decoded');
  assert.ok(s.tower.every((r) => ['S', 'M', 'H'].includes(r.tyre)), 'tyres decoded');
  assert.equal(s.tower[0].gapLeaderMs, 0, 'leader gap is zero');
  for (let k = 1; k < s.tower.length; k++) {
    assert.ok(s.tower[k].gapLeaderMs >= s.tower[k - 1].gapLeaderMs, `gap to leader grows down the order (${k})`);
    assert.ok(s.tower[k].gapAheadMs > 0, 'interval positive');
  }
  assert.ok(s.tower.every((r) => r.lastMs > 60000 && r.lastMs < 100000), 'last laps decoded');
  assert.ok(s.tower.every((r) => r.bestMs > 60000 && r.bestMs <= r.lastMs + 5000), 'best laps from session history');
  assert.equal(s.tower.find((r) => r.i === 7).penaltySec, 5, 'penalty decoded');
  assert.equal(me.stops, 1, 'player pit stop counted');
  assert.equal(me.tyre, 'H', 'player on hards after the stop');
  // Session
  assert.equal(s.session.race, true); assert.equal(s.session.type, 'Race'); assert.equal(s.session.track, 'austria');
  assert.equal(s.session.totalLaps, 15); assert.equal(s.session.timeOfDay, 14 * 60);
  assert.ok(s.session.lap >= 9, `lap ${s.session.lap}`);
  // Map
  assert.ok(s.map.coverage >= 0.97, `${format}: outline coverage ${s.map.coverage}`);
  assert.ok(store.saved['f1-17'] && store.saved['f1-17'].points.length >= TRACK_LEN / 10 * 0.97, 'outline saved');
  assert.equal(s.map.cars.length, active, 'every car on the map');
  // Pit
  assert.ok(sawTwoCompound, 'two-compound reminder before the stop');
  assert.ok(!s.pit.items.some((x) => x.title === 'Two dry compounds needed'), 'reminder clears after the stop');
  assert.ok(s.pit.items.some((x) => /Pit window open|Ideal stop/.test(x.title)), 'pit window from the game');
  assert.ok(s.pit.items.some((x) => x.title.startsWith('Fuel: +0.4 laps')), 'fuel from MFD');
  assert.ok(s.pit.items.some((x) => x.title.startsWith('Rain 60% in 10 min')), 'rain forecast');
  assert.deepEqual(s.pit.sets.map((x) => x.tyre), ['S', 'M', 'H'], 'tyre sets: best per compound, fastest first');
  assert.equal(s.pit.sets.find((x) => x.tyre === 'H').reachesEnd, true);
  assert.equal(s.pit.tyre.short, 'H');
  // Adjustments
  const titles = s.adjust.items.map((x) => x.title).join(' | ');
  assert.ok(/Brake bias back 1% \(to 55%\)/.test(titles), `${format}: bias advice: ${titles}`);
  assert.ok(/Lower on-throttle diff \(now 65%\)/.test(titles), 'diff advice');
  assert.ok(/Rears hot \(109°C\)/.test(titles), 'tyre temp advice');
  if (format === 2025) assert.ok(/ERS low \(10%\)/.test(titles), 'ERS advice'); else assert.ok(!/ERS/.test(titles), 'no ERS % for 2026');
  // Events
  assert.ok(s.events[0].text.startsWith('Fastest lap:') && s.events[0].text.includes('1:18.456'), s.events[0].text);
}

// Spectating or between sessions: a new session UID resets everything.
{
  const race = new F1Race(memStore());
  const a = new F1Sim({ format: 2025, uid: 1n }), b = new F1Sim({ format: 2025, uid: 2n });
  for (let k = 0; k < 50; k++) for (const p of a.frame(k)) race.push(parseF1(p));
  for (const p of b.frame(0)) race.push(parseF1(p));
  assert.equal(race.uid, '2');
}

// Forza
{
  const store = memStore();
  const race = new ForzaRace(store, () => 10);
  const sim = new ForzaSim();
  for (let k = 0; k < 60 * 60 * 6.5; k++) for (const b of sim.frame(k)) race.push(parseForza(b));
  const s = race.state();
  assert.equal(s.game, 'forza');
  assert.ok(s.session.lap >= 4, `lap ${s.session.lap}`);
  assert.equal(s.session.totalLaps, 10);
  assert.equal(s.session.position, 3);
  assert.ok(store.saved['forza-860'] && store.saved['forza-860'].points.length > 400, 'Forza outline saved after lap 1');
  assert.ok(s.map.version > 0 && s.map.trail === null, 'outline replaces the trail');
  assert.ok(s.timing.bestS > 80 && s.timing.lastS > 80, `times ${s.timing.bestS} ${s.timing.lastS}`);
  assert.ok(Number.isFinite(s.timing.deltaS) && Math.abs(s.timing.deltaS) < 5, `delta ${s.timing.deltaS}`);
  const fuel = s.pit.items.find((x) => x.title.startsWith('Fuel'));
  assert.ok(fuel && /Fuel runs out in/.test(fuel.title), `fuel: ${fuel && fuel.title}`);
  const tyre = s.pit.items.find((x) => x.title.startsWith('Tyres about'));
  assert.ok(tyre, 'tyre projection');
  const tips = s.adjust.items.map((x) => x.title).join(' | ');
  assert.ok(/Front lock-ups/.test(tips) && /Front tyres hotter/.test(tips), tips);
  assert.equal(s.adjust.forza, true);
}

console.log('OK: dashboard checks passed (2025 and 2026 F1 races, Forza race)');
