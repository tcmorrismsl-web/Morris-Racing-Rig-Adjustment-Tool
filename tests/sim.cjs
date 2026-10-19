'use strict';
// Builds fake Forza Motorsport and F1 25 packets for testing the bridge without an Xbox.
// Run `node tests/sim.cjs forza 192.168.1.20 5300` to stream a few laps to a running bridge.

const dgram = require('dgram');

// ---------------------------------------------------------------------------
// Forza "Car Dash" packet (331 bytes)
// ---------------------------------------------------------------------------
function forzaPacket(o) {
  const b = Buffer.alloc(331);
  const w4 = (off, arr) => arr.forEach((v, i) => b.writeFloatLE(v, off + i * 4));
  b.writeInt32LE(o.racing === false ? 0 : 1, 0);
  b.writeUInt32LE(o.t || 0, 4);
  b.writeFloatLE(8000, 8); b.writeFloatLE(900, 12); b.writeFloatLE(o.rpm || 6000, 16);
  b.writeFloatLE(o.latG || 0, 20); b.writeFloatLE(0, 24); b.writeFloatLE(o.lonG || 0, 28);
  w4(68, o.susp || [0.5, 0.5, 0.5, 0.5]);
  w4(84, o.slipRatio || [0, 0, 0, 0]);
  w4(164, o.slipAngle || [0, 0, 0, 0]);
  w4(180, o.combined || [0.2, 0.2, 0.2, 0.2]);
  b.writeInt32LE(o.carOrdinal ?? 3021, 212);
  b.writeInt32LE(4, 216);
  b.writeInt32LE(o.pi ?? 652, 220);
  b.writeInt32LE({ fwd: 0, rwd: 1, awd: 2 }[o.dt || 'fwd'], 224);
  b.writeInt32LE(4, 228);
  b.writeFloatLE(o.speed ?? 40, 244);
  w4(256, o.tyreTemp || [190, 190, 175, 175]);
  b.writeFloatLE(o.fuel ?? 1, 276);
  b.writeFloatLE(o.lastLap || 0, 288);
  b.writeFloatLE(o.currentLap || 0, 292);
  b.writeUInt16LE(o.lap || 0, 300);
  b.writeUInt8(1, 302);
  b.writeUInt8(Math.round((o.throttle || 0) * 255), 303);
  b.writeUInt8(Math.round((o.brake || 0) * 255), 304);
  b.writeUInt8(o.gear || 3, 307);
  w4(311, o.wear || [0, 0, 0, 0]);
  b.writeInt32LE(o.trackOrdinal ?? 860, 327);
  return b;
}

// One lap of Forza frames. Problems are switched on with flags.
function forzaLap(lap, opts = {}) {
  const frames = [];
  const n = opts.frames || 1800; // 30 s at 60 Hz
  for (let i = 0; i < n; i++) {
    const ph = i % 120; // 2-second loop: straight, brake, corner, exit
    const f = { lap, t: i * 16, currentLap: i / 60, lastLap: lap > 0 ? opts.lastLap || 95.123 : 0, dt: opts.dt || 'fwd', speed: 40, tyreTemp: opts.tyreTemp, wear: [lap * 0.03 + i / n * 0.03, lap * 0.03 + i / n * 0.03, lap * 0.015, lap * 0.015], fuel: 1 - lap * 0.05 };
    if (ph < 40) Object.assign(f, { throttle: 1, speed: 55 });
    else if (ph < 60) Object.assign(f, { brake: 0.8, speed: 35, latG: 2 });
    else if (ph < 90) Object.assign(f, { throttle: 0.3, latG: 8, speed: 28, combined: opts.understeer ? [1.0, 1.0, 0.6, 0.6] : [0.7, 0.7, 0.7, 0.7] });
    else Object.assign(f, { throttle: 0.95, latG: 3, speed: 30, slipRatio: opts.wheelspin && ph % 3 === 0 ? [0.35, 0.3, 0, 0] : [0.05, 0.05, 0, 0] });
    if (opts.bottomRear && i % 50 === 0) f.susp = [0.6, 0.6, 0.7, 0.99];
    frames.push(forzaPacket(f));
  }
  return frames;
}

// ---------------------------------------------------------------------------
// F1 25 packets (format 2025 = 22 cars, 2026 = 24 cars)
// ---------------------------------------------------------------------------
function header(format, id, uid = 123456789n, player = 0) {
  const b = Buffer.alloc(29);
  b.writeUInt16LE(format, 0); b.writeUInt8(25, 2); b.writeUInt8(1, 3); b.writeUInt8(0, 4); b.writeUInt8(1, 5);
  b.writeUInt8(id, 6); b.writeBigUInt64LE(uid, 7); b.writeFloatLE(1, 15); b.writeUInt32LE(1, 19); b.writeUInt32LE(1, 23);
  b.writeUInt8(player, 27); b.writeUInt8(255, 28);
  return b;
}
const cars = (format) => (format >= 2026 ? 24 : 22);
// F1 wheel order is RL, RR, FL, FR. Inputs here are FL, FR, RL, RR.
const toF1 = (a) => [a[2], a[3], a[0], a[1]];

function f1Telemetry(format, o, player = 0) {
  const stride = format >= 2026 ? 59 : 60;
  const body = Buffer.alloc(cars(format) * stride + 3);
  const p = player * stride;
  body.writeUInt16LE(o.speedKmh, p); body.writeFloatLE(o.throttle || 0, p + 2); body.writeFloatLE(0, p + 6); body.writeFloatLE(o.brake || 0, p + 10);
  body.writeInt8(o.gear || 5, p + 15); body.writeUInt16LE(11000, p + 16);
  toF1(o.brakeTemp || [500, 500, 400, 400]).forEach((v, i) => body.writeUInt16LE(v, p + 22 + i * 2));
  toF1(o.surface || [95, 95, 95, 95]).forEach((v, i) => body.writeUInt8(v, p + 30 + i));
  toF1(o.inner || [100, 100, 100, 100]).forEach((v, i) => body.writeUInt8(v, p + 34 + i));
  const et = format >= 2026 ? 1 : 2;
  if (et === 2) body.writeUInt16LE(90, p + 38); else body.writeUInt8(90, p + 38);
  toF1(o.pressure || [24, 24, 22, 22]).forEach((v, i) => body.writeFloatLE(v, p + 38 + et + i * 4));
  return Buffer.concat([header(format, 6, undefined, player), body]);
}

function f1Lap(format, o, player = 0) {
  const body = Buffer.alloc(cars(format) * 57 + 2);
  const p = player * 57;
  body.writeUInt32LE(o.lastLapMs || 0, p); body.writeUInt32LE(o.currentLapMs || 0, p + 4);
  body.writeFloatLE(o.lapDistance || 0, p + 20);
  body.writeUInt8(1, p + 32); body.writeUInt8(o.lapNum, p + 33); body.writeUInt8(o.invalid ? 1 : 0, p + 37);
  return Buffer.concat([header(format, 2, undefined, player), body]);
}

function f1Session(format, trackId) {
  const body = Buffer.alloc(700);
  body.writeUInt8(0, 0); body.writeInt8(30, 1); body.writeInt8(24, 2); body.writeUInt8(5, 3); body.writeUInt16LE(5300, 4); body.writeUInt8(10, 6); body.writeInt8(trackId, 7);
  return Buffer.concat([header(format, 1), body]);
}

function f1Damage(format, wear, player = 0) {
  const body = Buffer.alloc(cars(format) * 46);
  toF1(wear).forEach((v, i) => body.writeFloatLE(v, player * 46 + i * 4));
  return Buffer.concat([header(format, 10, undefined, player), body]);
}

function f1MotionEx(format, o) {
  const b = Buffer.alloc(302);
  header(format, 13).copy(b, 0);
  toF1(o.slipRatio || [0, 0, 0, 0]).forEach((v, i) => b.writeFloatLE(v, 93 + i * 4));
  toF1(o.slipAngle || [0.05, 0.05, 0.05, 0.05]).forEach((v, i) => b.writeFloatLE(v, 109 + i * 4));
  b.writeFloatLE(o.wheelAngle || 0, 197);
  return b;
}

// One F1 lap of packets. Flags switch problems on.
function f1LapPackets(format, lapNum, opts = {}) {
  const out = [f1Session(format, opts.trackId ?? 17)];
  const n = opts.frames || 1200;
  const player = opts.player || 0;
  for (let i = 0; i < n; i++) {
    const ph = i % 120;
    let t = { speedKmh: 280, throttle: 1, brake: 0, inner: opts.hotRears ? [100, 100, 114, 114] : [100, 100, 100, 100] };
    let m = { slipRatio: [0.02, 0.02, 0.03, 0.03], slipAngle: [0.03, 0.03, 0.03, 0.03], wheelAngle: 0 };
    if (ph >= 40 && ph < 60) { t = { ...t, throttle: 0, brake: 0.9, speedKmh: 180 }; m.slipRatio = opts.frontLock && ph % 2 ? [-0.3, -0.25, -0.05, -0.05] : [-0.05, -0.05, -0.05, -0.05]; m.wheelAngle = 0.05; }
    else if (ph >= 60 && ph < 90) { t = { ...t, throttle: 0.4, speedKmh: 150 }; m.wheelAngle = 0.08; m.slipAngle = [0.05, 0.05, 0.05, 0.05]; }
    else if (ph >= 90) {
      t = { ...t, throttle: 0.9, speedKmh: 170 }; m.wheelAngle = 0.05;
      if (opts.exitOversteer) m.slipAngle = [0.04, 0.04, 0.08, 0.08];
      if (opts.wheelspin && ph % 3 === 0) m.slipRatio = [0.02, 0.02, 0.25, 0.25];
    }
    out.push(f1Telemetry(format, t, player));
    out.push(f1MotionEx(format, m));
    if (i % 20 === 0) out.push(f1Lap(format, { lapNum, currentLapMs: i * 50, lastLapMs: opts.lastLapMs || 81234, lapDistance: i * 4 }, player));
    if (i % 60 === 0) out.push(f1Damage(format, [lapNum * 1.0 + i / n, lapNum * 1.0 + i / n, lapNum * 2.0 + i / n * 2, lapNum * 2.0 + i / n * 2], player));
  }
  return out;
}

module.exports = { forzaPacket, forzaLap, f1Telemetry, f1Lap, f1Session, f1Damage, f1MotionEx, f1LapPackets };

// CLI: stream laps to a bridge so the app can be tried without an Xbox.
if (require.main === module) {
  const [game = 'forza', host = '127.0.0.1', portArg] = process.argv.slice(2);
  const port = Number(portArg) || (game === 'forza' ? 5300 : 20777);
  const sock = dgram.createSocket('udp4');
  const packets = [];
  for (let lap = 0; lap < 4; lap++) {
    if (game === 'forza') packets.push(...forzaLap(lap, { understeer: true, bottomRear: true, wheelspin: true, lastLap: 95 + Math.random() * 2 }));
    else packets.push(...f1LapPackets(game === 'f1-2026' ? 2026 : 2025, lap + 1, { exitOversteer: true, hotRears: true, lastLapMs: 80000 + Math.round(Math.random() * 2000) }));
  }
  if (game === 'forza') packets.push(forzaPacket({ lap: 4, lastLap: 96.5 }));
  else packets.push(f1Lap(game === 'f1-2026' ? 2026 : 2025, { lapNum: 5, lastLapMs: 81500 }));
  let i = 0;
  const tick = () => {
    for (let k = 0; k < 240 && i < packets.length; k++, i++) sock.send(packets[i], port, host);
    if (i < packets.length) setTimeout(tick, 5); else setTimeout(() => { sock.close(); console.log(`Sent ${packets.length} ${game} packets to ${host}:${port}`); }, 200);
  };
  tick();
}
