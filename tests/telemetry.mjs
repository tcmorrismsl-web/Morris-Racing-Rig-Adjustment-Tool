// Telemetry tests: packet decoding, lap summaries, advice, and the bridge end to end.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import dgram from 'node:dgram';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { lapAdvice, sessions, fmtLap } from '../js/advice.js';

const require = createRequire(import.meta.url);
const { parseForza, parseF1 } = require('../bridge/parsers.js');
const { ForzaLaps, F1Laps } = require('../bridge/laps.js');
const sim = require('./sim.cjs');

// ---------------- Decoding ----------------
const fp = parseForza(sim.forzaPacket({ lap: 2, pi: 705, dt: 'rwd', speed: 50, throttle: 1, tyreTemp: [180, 181, 170, 171], trackOrdinal: 860, wear: [0.1, 0.1, 0.05, 0.05] }));
assert.equal(fp.dash, true); assert.equal(fp.pi, 705); assert.equal(fp.drivetrain, 'rwd'); assert.equal(fp.lapNumber, 2);
assert.equal(fp.trackOrdinal, 860); assert.equal(Math.round(fp.tyreTemp[1]), 181); assert.equal(fp.throttle, 1);
assert.equal(parseForza(Buffer.alloc(100)), null);

for (const format of [2025, 2026]) {
  for (const player of [0, 5]) {
    const t = parseF1(sim.f1Telemetry(format, { speedKmh: 287, throttle: 0.75, inner: [101, 102, 111, 112], pressure: [24.5, 24.6, 22.1, 22.2] }, player));
    assert.equal(t.type, 'telemetry'); assert.equal(t.speedKmh, 287, `speed ${format} p${player}`);
    assert.deepEqual(t.innerTemp, [101, 102, 111, 112], `inner ${format} p${player}`);
    assert.equal(Math.round(t.pressure[3] * 10), 222, `pressure ${format} p${player}`);
    const l = parseF1(sim.f1Lap(format, { lapNum: 7, lastLapMs: 81234, invalid: true }, player));
    assert.equal(l.lapNum, 7); assert.equal(l.lastLapMs, 81234); assert.equal(l.invalid, true);
    const d = parseF1(sim.f1Damage(format, [1, 2, 3, 4], player));
    assert.deepEqual(d.tyreWear, [1, 2, 3, 4]);
  }
  const s = parseF1(sim.f1Session(format, 17));
  assert.equal(s.track, 'austria');
  const m = parseF1(sim.f1MotionEx(format, { slipRatio: [0.1, 0.2, 0.3, 0.4], wheelAngle: 0.05 }));
  assert.deepEqual(m.slipRatio.map((v) => Math.round(v * 10) / 10), [0.1, 0.2, 0.3, 0.4]);
}

// ---------------- Forza laps + advice ----------------
const fl = [];
const forza = new ForzaLaps((l) => fl.push(l));
for (let lap = 0; lap < 4; lap++) sim.forzaLap(lap, { understeer: true, bottomRear: true, wheelspin: true, lastLap: 95.5 }).forEach((b) => forza.push(parseForza(b)));
forza.push(parseForza(sim.forzaPacket({ lap: 4, lastLap: 96.1 })));
assert.equal(fl.length, 4, 'four Forza laps');
assert.equal(fl[3].timeMs, 96100);
assert.equal(fl[0].car.drivetrain, 'fwd');
assert.ok(fl[0].balance.mid > 1.2, `mid balance ${fl[0].balance.mid}`);
assert.ok(fl[0].bottoming[3] >= 0.01, 'RR bottoming');
assert.ok(fl[0].wheelspin > 0.08, `wheelspin ${fl[0].wheelspin}`);
const fa = lapAdvice(fl.slice(-3));
const titles = fa.findings.map((f) => f.title);
assert.ok(titles.includes('Understeer mid-corner'), titles.join(', '));
assert.ok(titles.includes('Rear suspension bottoming out'), titles.join(', '));
assert.ok(titles.includes('Wheelspin on throttle'), titles.join(', '));
assert.ok(fa.findings.find((f) => f.title === 'Wheelspin on throttle').changes[0].includes('front acceleration'), 'FWD wheelspin advice uses the front diff');
assert.ok(!titles.some((t) => t.startsWith('Oversteer')), 'no oversteer finding');

// A clean car should produce no balance findings.
const clean = [];
const fz2 = new ForzaLaps((l) => clean.push(l));
for (let lap = 0; lap < 3; lap++) sim.forzaLap(lap, {}).forEach((b) => fz2.push(parseForza(b)));
fz2.push(parseForza(sim.forzaPacket({ lap: 3, lastLap: 95 })));
assert.equal(lapAdvice(clean).findings.filter((f) => /steer|Wheelspin|bottoming/.test(f.title)).length, 0, 'clean laps give no handling findings');

// ---------------- F1 laps + advice (both formats) ----------------
for (const format of [2025, 2026]) {
  const out = [];
  const f1 = new F1Laps((l) => out.push(l));
  for (let lap = 1; lap <= 3; lap++) sim.f1LapPackets(format, lap, { exitOversteer: true, hotRears: true, frontLock: true, lastLapMs: 81000 + lap }).forEach((b) => f1.push(parseF1(b)));
  f1.push(parseF1(sim.f1Lap(format, { lapNum: 4, lastLapMs: 81555 })));
  assert.equal(out.length, 3, `three F1 laps (${format})`);
  assert.equal(out[2].timeMs, 81555);
  assert.equal(out[0].track.name, 'austria');
  assert.equal(out[0].tyres.inner[2], 114);
  const a = lapAdvice(out);
  const t = a.findings.map((f) => f.title);
  assert.ok(t.includes('Oversteer on exit'), `${format}: ${t.join(', ')}`);
  assert.ok(t.includes('Rear tyres overheating'), `${format}: ${t.join(', ')}`);
  assert.ok(t.includes('Front brakes locking'), `${format}: ${t.join(', ')}`);
  assert.ok(t.includes('Rear tyres wearing faster'), `${format}: ${t.join(', ')}`);
}

assert.equal(fmtLap(81555), '1:21.555');
assert.equal(sessions([...fl, ...clean]).length, 2);

// ---------------- Bridge end to end ----------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-'));
process.env.MR_DATA = dir; process.env.MR_HTTP = '18080'; process.env.MR_FORZA = '15300'; process.env.MR_F1 = '17777';
const bridge = require('../bridge/bridge.js');
const quiet = console.log; console.log = () => {};
bridge.start();
await new Promise((r) => setTimeout(r, 300));
const sock = dgram.createSocket('udp4');
const send = async (packets, port) => {
  for (let i = 0; i < packets.length; i += 200) {
    await Promise.all(packets.slice(i, i + 200).map((p) => new Promise((r) => sock.send(p, port, '127.0.0.1', r))));
    await new Promise((r) => setTimeout(r, 2));
  }
};
const fz = [];
for (let lap = 0; lap < 2; lap++) fz.push(...sim.forzaLap(lap, { understeer: true, frames: 600, lastLap: 90 }));
fz.push(sim.forzaPacket({ lap: 2, lastLap: 91.25 }));
await send(fz, 17777); // Forza sent to the F1 port still works
const f1p = [...sim.f1LapPackets(2026, 1, { frames: 400 }), sim.f1Lap(2026, { lapNum: 2, lastLapMs: 80321 })];
await send(f1p, 15300);
await new Promise((r) => setTimeout(r, 500));
const lapsRes = await (await fetch('http://127.0.0.1:18080/api/laps')).json();
const st = await (await fetch('http://127.0.0.1:18080/api/status')).json();
const page = await fetch('http://127.0.0.1:18080/');
const traversal = await fetch('http://127.0.0.1:18080/bridge/bridge.js');
await fetch('http://127.0.0.1:18080/api/context', { method: 'PUT', body: JSON.stringify({ forza: { carId: 'tcr73', tune: 'Fujimi night' } }) });
console.log = quiet;
assert.ok(lapsRes.filter((l) => l.game === 'forza').length >= 1, `forza laps via bridge: ${lapsRes.length}`);
assert.ok(lapsRes.some((l) => l.game === 'f1' && l.timeMs === 80321), 'f1 lap via bridge');
assert.ok(st.bridge && st.forza.packets > 0 && st.f1.packets > 0);
assert.equal(page.status, 200); assert.match(await page.text(), /Morris Racing/);
assert.equal(traversal.status, 404, 'bridge source is not served');
sock.close(); bridge.server.close();
console.log(`OK: telemetry checks passed (${lapsRes.length} laps through the bridge)`);
process.exit(0);
