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
      posX: b.readFloatLE(232),           // metres, world space (Y is up)
      posY: b.readFloatLE(236),
      posZ: b.readFloatLE(240),
      speed: b.readFloatLE(244),          // m/s
      tyreTemp: f4(b, 256),               // Fahrenheit
      fuel: b.readFloatLE(276),           // 0..1
      distance: b.readFloatLE(280),       // metres travelled this race
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
  if (pi >= cars && ![0, 1, 3, 4, 11, 12, 13].includes(h.packetId)) return out;

  switch (h.packetId) {
    case 0: { // Motion: every car's position. 60 bytes per car (54 in the 2026 format).
      const stride = Math.floor((b.length - HEADER) / cars);
      if (stride < 24) return out;
      out.type = 'motion';
      out.cars = [];
      for (let i = 0; i < cars; i++) {
        const o = HEADER + i * stride;
        out.cars.push({ x: b.readFloatLE(o), y: b.readFloatLE(o + 4), z: b.readFloatLE(o + 8) });
      }
      return out;
    }
    case 1: { // Session (753 bytes; 926 in 2026 with extra fields at the end)
      if (b.length < HEADER + 8) return out;
      out.type = 'session';
      out.weather = b.readUInt8(29);
      out.trackTemp = b.readInt8(30);
      out.airTemp = b.readInt8(31);
      out.totalLaps = b.readUInt8(32);
      out.sessionType = b.readUInt8(35);
      out.trackId = b.readInt8(36);
      out.track = F1_TRACK_IDS[out.trackId] || null;
      if (b.length >= 753) {
        out.trackLength = b.readUInt16LE(33);
        out.timeLeft = b.readUInt16LE(38);
        out.pitSpeedLimit = b.readUInt8(42);
        out.paused = b.readUInt8(43) === 1;
        out.safetyCar = b.readUInt8(153); // 0 none, 1 full, 2 virtual, 3 formation lap
        out.online = b.readUInt8(154) === 1;
        const n = Math.min(b.readUInt8(155), 64);
        out.forecast = [];
        for (let k = 0; k < n; k++) {
          const o = 156 + k * 8;
          out.forecast.push({ sessionType: b.readUInt8(o), minutes: b.readUInt8(o + 1), weather: b.readUInt8(o + 2), trackTemp: b.readInt8(o + 3), rain: b.readUInt8(o + 7) });
        }
        out.pitIdealLap = b.readUInt8(682);
        out.pitLatestLap = b.readUInt8(683);
        out.pitRejoinPosition = b.readUInt8(684);
        out.timeOfDay = b.readUInt32LE(696); // minutes since midnight
        out.sector2Start = b.readFloatLE(745);
        out.sector3Start = b.readFloatLE(749);
      }
      return out;
    }
    case 2: { // Lap data: 57 bytes per car, 2 trailing bytes
      const stride = Math.floor((b.length - HEADER - 2) / cars);
      if (stride < 38) return out;
      const mmss = (o) => b.readUInt16LE(o) + b.readUInt8(o + 2) * 60000;
      out.type = 'lap';
      out.cars = [];
      for (let i = 0; i < cars; i++) {
        const o = HEADER + i * stride;
        const c = {
          lastLapMs: b.readUInt32LE(o),
          currentLapMs: b.readUInt32LE(o + 4),
          s1Ms: mmss(o + 8),
          s2Ms: mmss(o + 11),
          gapAheadMs: mmss(o + 14),
          gapLeaderMs: mmss(o + 17),
          lapDistance: b.readFloatLE(o + 20),
          totalDistance: b.readFloatLE(o + 24),
          position: b.readUInt8(o + 32),
          lapNum: b.readUInt8(o + 33),
          pitStatus: b.readUInt8(o + 34), // 0 none, 1 pitting, 2 in pit area
          pitStops: b.readUInt8(o + 35),
          sector: b.readUInt8(o + 36),
          invalid: b.readUInt8(o + 37) === 1,
        };
        if (stride >= 57) Object.assign(c, {
          penaltySec: b.readUInt8(o + 38),
          warnings: b.readUInt8(o + 39),
          driveThroughs: b.readUInt8(o + 41),
          stopGos: b.readUInt8(o + 42),
          grid: b.readUInt8(o + 43),
          driverStatus: b.readUInt8(o + 44), // 0 garage, 1 flying lap, 2 in lap, 3 out lap, 4 on track
          resultStatus: b.readUInt8(o + 45), // 2 active, 3 finished, 4 DNF, 5 DSQ, 6 NC, 7 retired
        });
        out.cars.push(c);
      }
      Object.assign(out, out.cars[pi] || {});
      return out;
    }
    case 3: { // Event
      if (b.length < 33) return out;
      out.type = 'event';
      out.code = b.toString('ascii', 29, 33);
      const d = 33;
      if (out.code === 'FTLP') { out.car = b.readUInt8(d); out.lapTime = b.readFloatLE(d + 1); }
      else if (out.code === 'RTMT') { out.car = b.readUInt8(d); out.reason = b.readUInt8(d + 1); }
      else if (out.code === 'PENA') { out.penaltyType = b.readUInt8(d); out.infringement = b.readUInt8(d + 1); out.car = b.readUInt8(d + 2); out.time = b.readUInt8(d + 4); out.lapNum = b.readUInt8(d + 5); }
      else if (out.code === 'SCAR') { out.safetyCarType = b.readUInt8(d); out.eventType = b.readUInt8(d + 1); }
      else if (out.code === 'RCWN') { out.car = b.readUInt8(d); }
      else if (out.code === 'DTSV' || out.code === 'SGSV') { out.car = b.readUInt8(d); }
      return out;
    }
    case 4: { // Participants: 57 bytes per car (60 in 2026, where three ids became 16-bit)
      const stride = Math.floor((b.length - HEADER - 1) / cars);
      if (stride < 45) return out;
      const wide = stride >= 60 ? 3 : 0;
      out.type = 'participants';
      out.numActive = b.readUInt8(29);
      out.cars = [];
      for (let i = 0; i < cars; i++) {
        const o = HEADER + 1 + i * stride;
        const nameBuf = b.subarray(o + 7 + wide, o + 39 + wide);
        const end = nameBuf.indexOf(0);
        const nColours = b.readUInt8(o + 44 + wide);
        const c0 = o + 45 + wide;
        out.cars.push({
          ai: b.readUInt8(o) === 1,
          teamId: wide ? b.readUInt16LE(o + 5) : b.readUInt8(o + 3),
          raceNumber: b.readUInt8(o + 5 + wide),
          name: nameBuf.toString('utf8', 0, end === -1 ? 32 : end).trim(),
          colour: nColours > 0 && c0 + 3 <= b.length ? `#${[0, 1, 2].map((k) => b.readUInt8(c0 + k).toString(16).padStart(2, '0')).join('')}` : null,
        });
      }
      return out;
    }
    case 5: { // Car setups: 50 bytes per car + 4 trailing. Player's live adjustable values.
      const stride = Math.floor((b.length - HEADER - 4) / cars);
      if (stride < 29) return out;
      const o = HEADER + pi * stride;
      out.type = 'setup';
      Object.assign(out, {
        frontWing: b.readUInt8(o), rearWing: b.readUInt8(o + 1),
        diffOn: b.readUInt8(o + 2), diffOff: b.readUInt8(o + 3),
        frontCamber: b.readFloatLE(o + 4), rearCamber: b.readFloatLE(o + 8),
        frontToe: b.readFloatLE(o + 12), rearToe: b.readFloatLE(o + 16),
        frontSusp: b.readUInt8(o + 20), rearSusp: b.readUInt8(o + 21),
        frontArb: b.readUInt8(o + 22), rearArb: b.readUInt8(o + 23),
        frontRide: b.readUInt8(o + 24), rearRide: b.readUInt8(o + 25),
        brakePressure: b.readUInt8(o + 26), brakeBias: b.readUInt8(o + 27), engineBraking: b.readUInt8(o + 28),
        // Tyre pressures in F1 order RL, RR, FL, FR
        tyrePressure: reorder([b.readFloatLE(o + 29), b.readFloatLE(o + 33), b.readFloatLE(o + 37), b.readFloatLE(o + 41)]),
        ballast: b.readUInt8(o + 45),
        fuelLoad: b.readFloatLE(o + 46),
      });
      return out;
    }
    case 7: { // Car status: 55 bytes per car (59 in 2026; a field was added after ERS store)
      const stride = Math.floor((b.length - HEADER) / cars);
      if (stride < 42) return out;
      const ersModeOff = stride >= 59 ? 45 : 41;
      out.type = 'status';
      out.cars = [];
      for (let i = 0; i < cars; i++) {
        const o = HEADER + i * stride;
        out.cars.push({
          brakeBias: b.readUInt8(o + 3),
          pitLimiter: b.readUInt8(o + 4) === 1,
          fuel: b.readFloatLE(o + 5),            // kg
          fuelCapacity: b.readFloatLE(o + 9),
          fuelLaps: b.readFloatLE(o + 13),       // spare laps of fuel, as on the MFD
          drsAllowed: b.readUInt8(o + 22) === 1,
          compound: b.readUInt8(o + 25),         // actual: 16 C5 ... 20 C1, 7 inter, 8 wet
          visual: b.readUInt8(o + 26),           // 16 soft, 17 medium, 18 hard, 7 inter, 8 wet
          tyreAge: b.readUInt8(o + 27),
          flag: b.readInt8(o + 28),              // -1 unknown, 0 none, 1 green, 2 blue, 3 yellow
          ersStore: b.readFloatLE(o + 37),       // joules (4 MJ max)
          ersMode: b.readUInt8(o + ersModeOff),  // 0 none, 1 medium, 2 hotlap, 3 overtake
        });
      }
      Object.assign(out, out.cars[pi] || {});
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
    case 11: { // Session history: one car per packet, 1460 bytes
      if (b.length < 1460) return out;
      out.type = 'history';
      out.car = b.readUInt8(29);
      const numLaps = b.readUInt8(30);
      const numStints = b.readUInt8(31);
      const bestLapNum = b.readUInt8(32);
      out.numLaps = numLaps;
      out.bestLapMs = bestLapNum > 0 && bestLapNum <= 100 ? b.readUInt32LE(36 + (bestLapNum - 1) * 14) : 0;
      out.stints = [];
      for (let k = 0; k < Math.min(numStints, 8); k++) {
        const o = 1436 + k * 3;
        out.stints.push({ endLap: b.readUInt8(o), compound: b.readUInt8(o + 1), visual: b.readUInt8(o + 2) });
      }
      return out;
    }
    case 12: { // Tyre sets: one car per packet, 20 sets, 231 bytes
      if (b.length < 231) return out;
      out.type = 'tyreSets';
      out.car = b.readUInt8(29);
      out.sets = [];
      for (let k = 0; k < 20; k++) {
        const o = 30 + k * 10;
        out.sets.push({ compound: b.readUInt8(o), visual: b.readUInt8(o + 1), wear: b.readUInt8(o + 2), available: b.readUInt8(o + 3) === 1, life: b.readUInt8(o + 5), usableLife: b.readUInt8(o + 6), lapDeltaMs: b.readInt16LE(o + 7), fitted: b.readUInt8(o + 9) === 1 });
      }
      out.fittedIdx = b.readUInt8(230);
      return out;
    }
    default:
      return out;
  }
}

module.exports = { parseForza, parseF1, parseF1Header, F1_TRACK_IDS, carsFor };
