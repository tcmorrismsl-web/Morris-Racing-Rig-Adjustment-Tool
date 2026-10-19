'use strict';
// Turns the 60-per-second packet stream into one summary per completed lap.
// Summaries are what the app's advice works from, so they keep only the
// numbers that point to a setup change.

const W = 4;
const zeros = () => [0, 0, 0, 0];
const round = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const avg = (sum, n) => (n ? sum / n : null);
const frac = (count, n, min = 30) => (n >= min ? round(count / n, 3) : null);

class Acc {
  constructor() {
    this.n = 0;
    this.temp = zeros(); this.tempMax = zeros(); this.tempN = 0;
    this.inner = zeros(); this.pressure = zeros(); this.tyreN = 0;
    this.bottom = zeros(); this.suspN = 0;
    this.thrN = 0; this.spin = 0;
    this.brkN = 0; this.lockF = 0; this.lockR = 0;
    this.phase = { entry: [0, 0, 0], mid: [0, 0, 0], exit: [0, 0, 0] }; // [frontSum, rearSum, n]
    this.top = 0;
    this.wearStart = null; this.wearEnd = null;
    this.fuelStart = null; this.fuelEnd = null;
  }
  corner(phase, front, rear) {
    const p = this.phase[phase];
    p[0] += front; p[1] += rear; p[2]++;
  }
  balance() {
    const out = {};
    for (const [k, [f, r, n]] of Object.entries(this.phase)) out[k] = n >= 40 && r > 0 ? round(f / r, 2) : null;
    return out;
  }
}

// ---------------------------------------------------------------------------
// Forza Motorsport
// ---------------------------------------------------------------------------
class ForzaLaps {
  constructor(onLap) {
    this.onLap = onLap;
    this.acc = new Acc();
    this.prev = null;
    this.session = null;
    this.live = null;
  }

  push(p) {
    if (!p || !p.dash) return;
    const prev = this.prev;
    // New session when the car or track changes, or the lap counter goes backwards (restart).
    if (!prev || p.carOrdinal !== prev.carOrdinal || p.trackOrdinal !== prev.trackOrdinal || p.lapNumber < prev.lapNumber) {
      this.session = `forza-${Date.now().toString(36)}`;
      this.acc = new Acc();
    } else if (p.lapNumber > prev.lapNumber) {
      this.finish(p, prev);
    }
    this.prev = p;
    this.live = { game: 'forza', lap: p.lapNumber + 1, currentLap: round(p.currentLap, 2), speedKmh: Math.round((p.speed || 0) * 3.6), gear: p.gear, racing: p.isRaceOn, pi: p.pi, drivetrain: p.drivetrain, carOrdinal: p.carOrdinal, trackOrdinal: p.trackOrdinal ?? null };
    if (!p.isRaceOn || p.speed < 5) return;
    this.sample(p);
  }

  sample(p) {
    const a = this.acc;
    a.n++;
    a.top = Math.max(a.top, p.speed * 3.6);
    for (let i = 0; i < W; i++) {
      a.temp[i] += p.tyreTemp[i];
      a.tempMax[i] = Math.max(a.tempMax[i], p.tyreTemp[i]);
      if (p.suspNorm[i] >= 0.98) a.bottom[i]++;
    }
    a.tempN++; a.suspN++;
    if (p.tyreWear) { a.wearStart = a.wearStart || p.tyreWear.slice(); a.wearEnd = p.tyreWear.slice(); }
    if (a.fuelStart === null) a.fuelStart = p.fuel;
    a.fuelEnd = p.fuel;

    // Wheelspin on the driven wheels under heavy throttle.
    const driven = p.drivetrain === 'fwd' ? [0, 1] : p.drivetrain === 'rwd' ? [2, 3] : [0, 1, 2, 3];
    if (p.throttle > 0.8 && p.brake < 0.1) {
      a.thrN++;
      if (driven.some((i) => p.slipRatio[i] > 0.2)) a.spin++;
    }
    // Lock-ups under braking.
    if (p.brake > 0.4) {
      a.brkN++;
      if (Math.min(p.slipRatio[0], p.slipRatio[1]) < -0.2) a.lockF++;
      if (Math.min(p.slipRatio[2], p.slipRatio[3]) < -0.2) a.lockR++;
    }
    // Front vs rear slip while cornering hard (lateral g above ~0.6).
    if (Math.abs(p.accel.x) > 6 && p.speed > 15) {
      const front = (Math.abs(p.combinedSlip[0]) + Math.abs(p.combinedSlip[1])) / 2;
      const rear = (Math.abs(p.combinedSlip[2]) + Math.abs(p.combinedSlip[3])) / 2;
      const phase = p.brake > 0.2 ? 'entry' : p.throttle > 0.6 ? 'exit' : 'mid';
      a.corner(phase, front, rear);
    }
  }

  finish(p, prev) {
    const a = this.acc;
    const timeMs = Math.round((p.lastLap || 0) * 1000);
    if (timeMs > 0 && a.n > 60) {
      this.onLap({
        game: 'forza',
        session: this.session,
        lap: prev.lapNumber + 1,
        timeMs,
        valid: null,
        car: { ordinal: p.carOrdinal, pi: p.pi, drivetrain: p.drivetrain },
        track: { ordinal: p.trackOrdinal ?? null },
        samples: a.n,
        tempUnit: 'F',
        tyres: {
          temp: a.temp.map((s) => round(avg(s, a.tempN))),
          tempMax: a.tempMax.map((v) => round(v)),
          wear: a.wearStart && a.wearEnd ? a.wearEnd.map((v, i) => round(Math.abs(v - a.wearStart[i]) * 100, 2)) : null,
        },
        bottoming: a.bottom.map((c) => frac(c, a.suspN)),
        wheelspin: frac(a.spin, a.thrN),
        lockFront: frac(a.lockF, a.brkN),
        lockRear: frac(a.lockR, a.brkN),
        balance: a.balance(),
        topSpeedKmh: Math.round(a.top),
        fuelUsed: a.fuelStart !== null ? round((a.fuelStart - a.fuelEnd) * 100, 1) : null,
      });
    }
    this.acc = new Acc();
  }
}

// ---------------------------------------------------------------------------
// F1 25
// ---------------------------------------------------------------------------
class F1Laps {
  constructor(onLap) {
    this.onLap = onLap;
    this.acc = new Acc();
    this.session = null;
    this.lapNum = null;
    this.invalid = false;
    this.tel = null;
    this.track = null; this.trackId = null; this.weather = null; this.trackTemp = null; this.format = null;
    this.wear = null;
    this.live = null;
  }

  push(m) {
    if (!m || !m.type) return;
    const h = m.header;
    this.format = h.format;
    if (h.sessionUID !== this.session) {
      this.session = h.sessionUID;
      this.acc = new Acc();
      this.lapNum = null;
    }
    const a = this.acc;
    switch (m.type) {
      case 'session':
        this.track = m.track; this.trackId = m.trackId; this.weather = m.weather; this.trackTemp = m.trackTemp;
        break;
      case 'damage':
        this.wear = m.tyreWear;
        if (!a.wearStart) a.wearStart = m.tyreWear.slice();
        a.wearEnd = m.tyreWear.slice();
        break;
      case 'telemetry':
        this.tel = m;
        if (m.speedKmh > 20) {
          for (let i = 0; i < W; i++) {
            a.temp[i] += m.surfaceTemp[i];
            a.tempMax[i] = Math.max(a.tempMax[i], m.surfaceTemp[i]);
            a.inner[i] += m.innerTemp[i];
            a.pressure[i] += m.pressure[i];
          }
          a.tempN++; a.tyreN++;
          a.top = Math.max(a.top, m.speedKmh);
        }
        break;
      case 'motionEx': {
        const t = this.tel;
        if (!t || t.speedKmh < 20) break;
        a.n++;
        if (t.throttle > 0.8 && t.brake < 0.1) {
          a.thrN++;
          if (Math.max(m.slipRatio[2], m.slipRatio[3]) > 0.15) a.spin++;
        }
        if (t.brake > 0.4) {
          a.brkN++;
          if (Math.min(m.slipRatio[0], m.slipRatio[1]) < -0.15) a.lockF++;
          if (Math.min(m.slipRatio[2], m.slipRatio[3]) < -0.15) a.lockR++;
        }
        if (Math.abs(m.frontWheelsAngle) > 0.02 && t.speedKmh > 60) {
          const front = (Math.abs(m.slipAngle[0]) + Math.abs(m.slipAngle[1])) / 2;
          const rear = (Math.abs(m.slipAngle[2]) + Math.abs(m.slipAngle[3])) / 2;
          const phase = t.brake > 0.2 ? 'entry' : t.throttle > 0.6 ? 'exit' : 'mid';
          a.corner(phase, front, rear);
        }
        break;
      }
      case 'lap': {
        if (this.lapNum !== null && m.lapNum > this.lapNum) this.finish(m);
        if (this.lapNum === null || m.lapNum !== this.lapNum) this.invalid = false;
        this.lapNum = m.lapNum;
        if (m.invalid) this.invalid = true;
        this.live = { game: 'f1', lap: m.lapNum, currentLap: round(m.currentLapMs / 1000, 2), speedKmh: this.tel?.speedKmh ?? null, gear: this.tel?.gear ?? null, track: this.track, format: this.format, racing: true };
        break;
      }
      default:
    }
  }

  finish(m) {
    const a = this.acc;
    if (m.lastLapMs > 0 && a.tyreN > 30) {
      this.onLap({
        game: 'f1',
        session: `f1-${this.session}`,
        lap: this.lapNum,
        timeMs: m.lastLapMs,
        valid: !this.invalid,
        car: { format: this.format },
        track: { id: this.trackId, name: this.track },
        weather: this.weather,
        trackTemp: this.trackTemp,
        samples: a.n,
        tempUnit: 'C',
        tyres: {
          temp: a.temp.map((s) => round(avg(s, a.tempN))),
          tempMax: a.tempMax.map((v) => round(v)),
          inner: a.inner.map((s) => round(avg(s, a.tyreN))),
          pressure: a.pressure.map((s) => round(avg(s, a.tyreN), 2)),
          wear: a.wearStart && a.wearEnd ? a.wearEnd.map((v, i) => round(v - a.wearStart[i], 2)) : null,
        },
        bottoming: null,
        wheelspin: frac(a.spin, a.thrN),
        lockFront: frac(a.lockF, a.brkN),
        lockRear: frac(a.lockR, a.brkN),
        balance: a.balance(),
        topSpeedKmh: Math.round(a.top),
      });
    }
    this.acc = new Acc();
    if (this.wear) { this.acc.wearStart = this.wear.slice(); this.acc.wearEnd = this.wear.slice(); }
  }
}

module.exports = { ForzaLaps, F1Laps };
