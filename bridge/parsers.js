'use strict';
// Packet decoders for Forza Motorsport "Data Out" and F1 25 UDP telemetry.
// All values are little-endian. Wheel arrays are returned as [FL, FR, RL, RR].

// ---------------------------------------------------------------------------
// Forza Motorsport (2023). Sled = 232 bytes, Car Dash = 331 bytes (311 on FM7).
// ---------------------------------------------------------------------------
function f4(b, o) { return [b.readFloatLE(o), b.readFloatLE(o + 4), b.readFloatLE(o + 8), b.readFloatLE(o + 12)]; }

function parseForza(b) {
  if (!Buffer.isBuffer(b) || b.length < 232) return null;
  const p = {
    game: 'forza',
    isRaceOn: b.readInt32LE(0) === 1,
    timestampMs: b.readUInt32LE(4),
    rpmMax: b.readFloatLE(8),
    rpm: b.readFloatLE(16),
    accel: { x: b.readFloatLE(20), y: b.readFloatLE(24), z: b.readFloatLE(28) },
    velocity: { x: b.readFloatLE(32), y: b.readFloatLE(36), z: b.readFloatLE(40) },
    suspNorm: f4(b, 68),        // 0 = full stretch, 1 = full compression
    slipRatio: f4(b, 84),
    rumble: [b.readInt32LE(116), b.readInt32LE(120), b.readInt32LE(124), b.readInt32LE(128)],
    slipAngle: f4(b, 164),
    combinedSlip: f4(b, 180),
    carOrdinal: b.readInt32LE(212),
    carClass: b.readInt32LE(216),
    pi: b.readInt32LE(220),
    drivetrain: ['fwd', 'rwd', 'awd'][b.readInt32LE(224)] || null,
    dash: false,
  };
  if (b.length >= 311) {
    Object.assign(p, {
      dash: true,
      speed: b.readFloatLE(244),          // m/s
      tyreTemp: f4(b, 256),               // Fahrenheit
      fuel: b.readFloatLE(276),
      bestLap: b.readFloatLE(284),        // seconds
      lastLap: b.readFloatLE(288),
      currentLap: b.readFloatLE(292),
      raceTime: b.readFloatLE(296),
      lapNumber: b.readUInt16LE(300),
      position: b.readUInt8(302),
      throttle: b.readUInt8(303) / 255,
      brake: b.readUInt8(304) / 255,
      gear: b.readUInt8(307),
      steer: b.readInt8(308) / 127,
    });
  }
  if (b.length >= 331) {
    p.tyreWear = f4(b, 311);
    p.trackOrdinal = b.readInt32LE(327);
  }
  return p;
}

// ---------------------------------------------------------------------------
// F1 25. Header is 29 bytes. Format 2025 has 22 cars per array; the 2026 Season
// Pack format has 24. Per-car strides are worked out from the packet length so a
// small layout change in either format doesn't break decoding.
// F1 wheel arrays are [RL, RR, FL, FR]; we reorder to [FL, FR, RL, RR].
// ---------------------------------------------------------------------------
const HEADER = 29;
const reorder = (a) => [a[2], a[3], a[0], a[1]];
const carsFor = (format) => (format >= 2026 ? 24 : 22);

const F1_TRACK_IDS = {
  0: 'australia', 2: 'china', 3: 'bahrain', 4: 'spain', 5: 'monaco', 6: 'canada', 7: 'britain',
  9: 'hungary', 10: 'belgium', 11: 'italy', 12: 'singapore', 13: 'japan', 14: 'abudhabi', 15: 'usa',
  16: 'brazil', 17: 'austria', 19: 'mexico', 20: 'baku', 26: 'netherlands', 27: 'imola', 29: 'saudi',
  30: 'miami', 31: 'vegas', 32: 'qatar', 39: 'britain', 40: 'austria', 41: 'netherlands',
};

function parseF1Header(b) {
  if (!Buffer.isBuffer(b) || b.length < HEADER) return null;
  const format = b.readUInt16LE(0);
  if (format < 2020 || format > 2030) return null;
  return {
    format,
    gameYear: b.readUInt8(2),
    packetId: b.readUInt8(6),
    sessionUID: b.readBigUInt64LE(7).toString(),
    sessionTime: b.readFloatLE(15),
    playerIndex: b.readUInt8(27),
  };
}

function parseF1(b) {
  const h = parseF1Header(b);
  if (!h) return null;
  const cars = carsFor(h.format);
  const out = { game: 'f1', header: h, type: null };
  const pi = h.playerIndex;
  if (pi >= cars && h.packetId !== 13 && h.packetId !== 1) return out;

  switch (h.packetId) {
    case 1: { // Session
      if (b.length < HEADER + 8) return out;
      out.type = 'session';
      out.weather = b.readUInt8(29);
      out.trackTemp = b.readInt8(30);
      out.airTemp = b.readInt8(31);
      out.totalLaps = b.readUInt8(32);
      out.sessionType = b.readUInt8(35);
      out.trackId = b.readInt8(36);
      out.track = F1_TRACK_IDS[out.trackId] || null;
      return out;
    }
    case 2: { // Lap data: 2 trailing bytes
      const stride = Math.floor((b.length - HEADER - 2) / cars);
      if (stride < 38) return out;
      const o = HEADER + pi * stride;
      out.type = 'lap';
      out.lastLapMs = b.readUInt32LE(o);
      out.currentLapMs = b.readUInt32LE(o + 4);
      out.lapDistance = b.readFloatLE(o + 20);
      out.position = b.readUInt8(o + 32);
      out.lapNum = b.readUInt8(o + 33);
      out.pitStatus = b.readUInt8(o + 34);
      out.invalid = b.readUInt8(o + 37) === 1;
      return out;
    }
    case 6: { // Car telemetry: 3 trailing bytes
      const stride = Math.floor((b.length - HEADER - 3) / cars);
      if (stride < 59) return out;
      const o = HEADER + pi * stride;
      const engineTempSize = stride >= 60 ? 2 : 1; // u16 in 2025 format, u8 in 2026
      const pOff = o + 38 + engineTempSize;
      out.type = 'telemetry';
      out.speedKmh = b.readUInt16LE(o);
      out.throttle = b.readFloatLE(o + 2);
      out.steer = b.readFloatLE(o + 6);
      out.brake = b.readFloatLE(o + 10);
      out.gear = b.readInt8(o + 15);
      out.rpm = b.readUInt16LE(o + 16);
      out.brakeTemp = reorder([b.readUInt16LE(o + 22), b.readUInt16LE(o + 24), b.readUInt16LE(o + 26), b.readUInt16LE(o + 28)]);
      out.surfaceTemp = reorder([b.readUInt8(o + 30), b.readUInt8(o + 31), b.readUInt8(o + 32), b.readUInt8(o + 33)]);
      out.innerTemp = reorder([b.readUInt8(o + 34), b.readUInt8(o + 35), b.readUInt8(o + 36), b.readUInt8(o + 37)]);
      out.pressure = reorder([b.readFloatLE(pOff), b.readFloatLE(pOff + 4), b.readFloatLE(pOff + 8), b.readFloatLE(pOff + 12)]);
      return out;
    }
    case 10: { // Car damage: no trailing bytes
      const stride = Math.floor((b.length - HEADER) / cars);
      if (stride < 16) return out;
      const o = HEADER + pi * stride;
      out.type = 'damage';
      out.tyreWear = reorder(f4(b, o)); // percent worn
      return out;
    }
    case 13: { // Motion ex: player car only
      if (b.length < HEADER + 241) return out;
      out.type = 'motionEx';
      out.suspPos = reorder(f4(b, 29));
      out.slipRatio = reorder(f4(b, 93));
      out.slipAngle = reorder(f4(b, 109));
      out.frontWheelsAngle = b.readFloatLE(197);
      out.frontAeroHeight = b.readFloatLE(217);
      out.rearAeroHeight = b.readFloatLE(221);
      return out;
    }
    default:
      return out;
  }
}

module.exports = { parseForza, parseF1, parseF1Header, F1_TRACK_IDS, carsFor };
