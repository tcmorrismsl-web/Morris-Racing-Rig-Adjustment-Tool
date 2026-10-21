'use strict';
// Full-size race simulator for testing the live dashboard without an Xbox.
// Packets are written from EA's F1 25 spec (2025 and 2026 Season Pack formats) and
// Turn 10's Car Dash layout, independently of the decoders in bridge/parsers.js.
//
//   node tests/race-sim.cjs f1            stream a 2025-format race to a local bridge
//   node tests/race-sim.cjs f1-2026       same, 2026 Season Pack format (24 cars)
//   node tests/race-sim.cjs forza         stream a Forza race
// Options: host and port after the game, e.g. `node tests/race-sim.cjs f1 192.168.1.20 20777`.

const dgram = require('dgram');

// A 5.3 km track: two straights joined by two half circles, with a kink.
const TRACK_LEN = 5300;
const R = 400;
const STRAIGHT = (TRACK_LEN - 2 * Math.PI * R) / 2;
function trackPoint(d) {
  d = ((d % TRACK_LEN) + TRACK_LEN) % TRACK_LEN;
  if (d < STRAIGHT) return { x: -STRAIGHT / 2 + d, z: -R };
  d -= STRAIGHT;
  if (d < Math.PI * R) { const a = -Math.PI / 2 + d / R; return { x: STRAIGHT / 2 + R * Math.cos(a), z: R * Math.sin(a) }; }
  d -= Math.PI * R;
  if (d < STRAIGHT) return { x: STRAIGHT / 2 - d, z: R };
  d -= STRAIGHT;
  const a = Math.PI / 2 + d / R;
  return { x: -STRAIGHT / 2 + R * Math.cos(a), z: R * Math.sin(a) };
}

const NAMES = ['VERSTAPPEN', 'NORRIS', 'LECLERC', 'PIASTRI', 'HAMILTON', 'RUSSELL', 'SAINZ', 'ALONSO', 'GASLY', 'OCON', 'ALBON', 'STROLL', 'HULKENBERG', 'TSUNODA', 'BEARMAN', 'LAWSON', 'ANTONELLI', 'BORTOLETO', 'HADJAR', 'COLAPINTO', 'DRIVER21', 'DRIVER22', 'DRIVER23', 'DRIVER24'];
const COLOURS = [[54, 113, 198], [255, 135, 0], [232, 0, 45], [255, 135, 0], [232, 0, 45], [39, 244, 210], [100, 196, 255], [34, 153, 113], [0, 147, 204], [182, 186, 189], [100, 196, 255], [34, 153, 113], [82, 226, 82], [102, 146, 255], [182, 186, 189], [102, 146, 255], [39, 244, 210], [82, 226, 82], [102, 146, 255], [0, 147, 204], [200, 200, 200], [200, 200, 200], [200, 200, 200], [200, 200, 200]];

const carsIn = (format) => (format >= 2026 ? 24 : 22);

function header(format, id, t, player, uid) {
  const b = Buffer.alloc(29);
  b.writeUInt16LE(format, 0); b.writeUInt8(25, 2); b.writeUInt8(1, 3); b.writeUInt8(10, 4); b.writeUInt8(1, 5);
  b.writeUInt8(id, 6); b.writeBigUInt64LE(uid, 7); b.writeFloatLE(t, 15);
  b.writeUInt32LE(Math.floor(t * 60), 19); b.writeUInt32LE(Math.floor(t * 60), 23);
  b.writeUInt8(player, 27); b.writeUInt8(255, 28);
  return b;
}

// ---------------------------------------------------------------------------
// F1 race model: 20 active cars with different pace, the player's pit stop, a safety car.
// ---------------------------------------------------------------------------
class F1Sim {
  // sessionType 15 = race, 5 = Q1. garageUntil: seconds the player sits in the garage (qualifying).
  // weatherAt: seconds into the session when light rain starts. scAt: seconds when a safety car comes out.
  // gridS: seconds sat on the grid before the start (the last formationS of them on the formation lap),
  // then lights out. parcFerme / weekend: the game's parc fermé option and the weekend's session list.
  constructor({ format = 2025, totalLaps = 15, active = 20, player = 4, uid = 777n, sessionType = 15, garageUntil = 0, weatherAt = null, scAt = null, slowZone = null, gridS = 0, formationS = 0, parcFerme = false, weekend = [] } = {}) {
    this.gridS = gridS; this.formationS = formationS; this.grid = gridS > 0; this.parcFerme = parcFerme; this.weekend = weekend;
    this.format = format; this.n = carsIn(format); this.totalLaps = totalLaps; this.active = active; this.player = player; this.uid = uid;
    this.sessionType = sessionType; this.garageUntil = garageUntil; this.weatherAt = weatherAt; this.scAt = scAt; this.slowZone = slowZone;
    this.quali = sessionType >= 5 && sessionType <= 14;
    this.t = 0;
    this.cars = Array.from({ length: this.n }, (_, i) => ({
      i, dist: -i * 18, speed: 70 - i * 0.12 + (i % 3) * 0.05, // m/s
      lastLapMs: 0, lapStartT: 0, pitStops: 0, pit: 0, compound: i % 2 ? 18 : 17, visual: i % 2 ? 17 : 16, tyreAge: 0,
      stints: [], bestMs: 0, laps: [],
    }));
    this.player === undefined || (this.cars[player].speed = 69.4);
    if (this.quali) this.cars.forEach((c, i) => { c.dist = (i * 263) % TRACK_LEN; c.lapStartT = -(c.dist / c.speed); }); // spread round the lap
    if (garageUntil) Object.assign(this.cars[player], { garage: true, dist: 0, lapStartT: 0 });
    this.sc = 0;
    this.events = [];
  }
  get weather() { return this.weatherAt !== null && this.t >= this.weatherAt ? 3 : 1; }

  step(dt) {
    this.t += dt;
    const lapT = TRACK_LEN;
    if (this.grid) {
      this.sc = this.formationS && this.t >= this.gridS - this.formationS ? 3 : 0;
      if (this.t >= this.gridS) { this.grid = false; this.sc = 0; this.events.push(['LGOT', []]); this.cars.forEach((c) => { c.lapStartT = this.t; }); }
      else return;
    }
    const me = this.cars[this.player];
    if (me.garage && this.t >= this.garageUntil) Object.assign(me, { garage: false, out: true, dist: 300, lapStartT: this.t - 300 / me.speed });
    if (this.scAt !== null && !this.sc && this.t >= this.scAt) { this.sc = 1; this.events.push(['SCAR', [1, 0]]); }
    for (const c of this.cars.slice(0, this.active)) {
      if (c.garage) continue;
      const before = Math.floor(c.dist / lapT);
      let v = c.speed;
      if (c.pit) v = 22;
      // Optional slow zone for the player (e.g. a missed braking point): [fromM, toM, factor]
      if (this.slowZone && c.i === this.player) { const ld = ((c.dist % TRACK_LEN) + TRACK_LEN) % TRACK_LEN; if (ld >= this.slowZone[0] && ld < this.slowZone[1]) v *= this.slowZone[2]; }
      if (this.sc) v = Math.min(v, 45);
      c.dist += v * dt;
      const after = Math.floor(c.dist / lapT);
      if (after > before && c.dist > 0) {
        const lapMs = Math.round((this.t - c.lapStartT) * 1000);
        if (before >= 0) {
          c.lastLapMs = lapMs; c.laps.push(lapMs);
          if (!c.bestMs || lapMs < c.bestMs) c.bestMs = lapMs;
        }
        c.lapStartT = this.t; c.tyreAge++; c.out = false;
        if (c.pit) { c.pit = 0; }
      }
    }
  }

  // Player pits on lap 8 for hards.
  maybePit() {
    if (this.quali) return;
    const me = this.cars[this.player];
    const lap = Math.floor(me.dist / TRACK_LEN) + 1;
    if (lap === 8 && !me.pitStops && (me.dist % TRACK_LEN) > TRACK_LEN - 300) {
      me.pit = 1; me.pitStops = 1; me.stints.push({ endLap: 7, compound: me.compound, visual: me.visual });
      me.compound = 19; me.visual = 18; me.tyreAge = 0;
    }
  }

  order() {
    return this.cars.slice(0, this.active).slice().sort((a, b) => b.dist - a.dist);
  }

  motion() {
    const stride = this.format >= 2026 ? 54 : 60;
    const body = Buffer.alloc(this.n * stride);
    this.cars.forEach((c, i) => {
      const p = i < this.active ? trackPoint(c.dist) : { x: 0, z: 0 };
      const o = i * stride;
      body.writeFloatLE(p.x, o); body.writeFloatLE(1.5, o + 4); body.writeFloatLE(p.z, o + 8);
    });
    return Buffer.concat([header(this.format, 0, this.t, this.player, this.uid), body]);
  }

  session() {
    const size = this.format >= 2026 ? 926 : 753;
    const b = Buffer.alloc(size);
    header(this.format, 1, this.t, this.player, this.uid).copy(b, 0);
    b.writeUInt8(this.weather, 29); b.writeInt8(32, 30); b.writeInt8(24, 31); b.writeUInt8(this.totalLaps, 32);
    b.writeUInt16LE(TRACK_LEN, 33); b.writeUInt8(this.sessionType, 35); b.writeInt8(17, 36);
    b.writeUInt16LE(Math.max(0, Math.round((this.quali ? 18 * 60 : 3600) - this.t)), 38); b.writeUInt16LE(3600, 40); b.writeUInt8(80, 42);
    b.writeUInt8(this.sc, 153); b.writeUInt8(0, 154);
    // Forecast: rain 60% in 10 minutes.
    b.writeUInt8(2, 155);
    const rainIn = this.weatherAt !== null ? Math.max(1, Math.ceil((this.weatherAt - this.t) / 60)) : 10;
    [[0, this.weather, 0], [rainIn, 3, this.weatherAt !== null ? 80 : 60]].forEach(([mins, w, rain], k) => {
      const o = 156 + k * 8;
      b.writeUInt8(this.sessionType, o); b.writeUInt8(mins, o + 1); b.writeUInt8(w, o + 2); b.writeInt8(32, o + 3); b.writeInt8(2, o + 4); b.writeInt8(24, o + 5); b.writeInt8(2, o + 6); b.writeUInt8(rain, o + 7);
    });
    b.writeUInt8(8, 682); b.writeUInt8(10, 683); b.writeUInt8(9, 684);
    b.writeUInt32LE(14 * 60, 696);
    b.writeUInt8(0, 713); b.writeUInt8(this.parcFerme ? 1 : 0, 723); b.writeUInt8(this.formationS ? 1 : 0, 727);
    b.writeUInt8(this.weekend.length, 732); this.weekend.forEach((t, k) => b.writeUInt8(t, 733 + k));
    b.writeFloatLE(1800, 745); b.writeFloatLE(3600, 749);
    return b;
  }

  lap() {
    const stride = 57;
    const body = Buffer.alloc(this.n * stride + 2);
    const order = this.order();
    const leader = order[0];
    order.forEach((c, k) => {
      const o = c.i * stride;
      const ahead = order[k - 1];
      const gapAhead = ahead ? Math.round(((ahead.dist - c.dist) / c.speed) * 1000) : 0;
      const gapLeader = Math.round(((leader.dist - c.dist) / c.speed) * 1000);
      const lapDist = ((c.dist % TRACK_LEN) + TRACK_LEN) % TRACK_LEN;
      body.writeUInt32LE(c.lastLapMs, o);
      body.writeUInt32LE(Math.max(0, Math.round((this.t - c.lapStartT) * 1000)), o + 4);
      body.writeUInt16LE(gapAhead % 60000, o + 14); body.writeUInt8(Math.floor(gapAhead / 60000), o + 16);
      body.writeUInt16LE(gapLeader % 60000, o + 17); body.writeUInt8(Math.floor(gapLeader / 60000), o + 19);
      body.writeFloatLE(c.garage ? 0 : c.dist < 0 ? c.dist : lapDist, o + 20);
      body.writeFloatLE(c.dist, o + 24);
      body.writeUInt8(k + 1, o + 32);
      body.writeUInt8(Math.max(1, Math.floor(c.dist / TRACK_LEN) + 1), o + 33);
      body.writeUInt8(c.garage ? 2 : c.pit, o + 34); body.writeUInt8(c.pitStops, o + 35);
      body.writeUInt8(Math.min(2, Math.floor(lapDist / (TRACK_LEN / 3))), o + 36);
      body.writeUInt8(c.i === 7 ? 5 : 0, o + 38); // car 7 has a 5 s penalty
      body.writeUInt8(c.i + 1, o + 43);
      body.writeUInt8(c.garage ? 0 : c.pit ? 2 : this.quali ? (c.out ? 3 : c.i % 4 === 0 ? 3 : 1) : 4, o + 44);
      body.writeUInt8(2, o + 45);
    });
    return Buffer.concat([header(this.format, 2, this.t, this.player, this.uid), body]);
  }

  participants() {
    const wide = this.format >= 2026 ? 3 : 0;
    const stride = 57 + wide;
    const body = Buffer.alloc(1 + this.n * stride);
    body.writeUInt8(this.active, 0);
    this.cars.forEach((c, i) => {
      const o = 1 + i * stride;
      body.writeUInt8(i === this.player ? 0 : 1, o);
      if (wide) body.writeUInt16LE(i % 10, o + 5); else body.writeUInt8(i % 10, o + 3);
      body.writeUInt8(i + 1, o + 5 + wide);
      body.write(i === this.player ? 'MORRIS' : NAMES[i], o + 7 + wide, 31, 'utf8');
      body.writeUInt8(1, o + 44 + wide);
      COLOURS[i].forEach((v, k) => body.writeUInt8(v, o + 45 + wide + k));
    });
    return Buffer.concat([header(this.format, 4, this.t, this.player, this.uid), body]);
  }

  status() {
    const stride = this.format >= 2026 ? 59 : 55;
    const body = Buffer.alloc(this.n * stride);
    this.cars.forEach((c, i) => {
      const o = i * stride;
      body.writeUInt8(56, o + 3);
      body.writeFloatLE(40, o + 5); body.writeFloatLE(110, o + 9); body.writeFloatLE(i === this.player ? 0.4 : 1, o + 13);
      body.writeUInt8(c.compound, o + 25); body.writeUInt8(c.visual, o + 26); body.writeUInt8(c.tyreAge, o + 27);
      body.writeInt8(0, o + 28);
      body.writeFloatLE(i === this.player ? 400000 : 2000000, o + 37); // player ERS at 10%
      body.writeUInt8(2, o + (this.format >= 2026 ? 45 : 41));
    });
    return Buffer.concat([header(this.format, 7, this.t, this.player, this.uid), body]);
  }

  setup() {
    const body = Buffer.alloc(this.n * 50 + 4);
    const o = this.player * 50;
    [22, 18, 65, 45].forEach((v, k) => body.writeUInt8(v, o + k));
    [-3.2, -1.7, 0.05, 0.2].forEach((v, k) => body.writeFloatLE(v, o + 4 + k * 4));
    [36, 3, 9, 16, 22, 50, 100, 56, 0].forEach((v, k) => body.writeUInt8(v, o + 20 + k));
    [24.0, 24.0, 26.5, 26.5].forEach((v, k) => body.writeFloatLE(v, o + 29 + k * 4)); // RL, RR, FL, FR
    body.writeUInt8(6, o + 45); body.writeFloatLE(30, o + 46);
    return Buffer.concat([header(this.format, 5, this.t, this.player, this.uid), body]);
  }

  history(i) {
    const c = this.cars[i];
    const b = Buffer.alloc(1460);
    header(this.format, 11, this.t, this.player, this.uid).copy(b, 0);
    b.writeUInt8(i, 29); b.writeUInt8(c.laps.length, 30); b.writeUInt8(c.stints.length + 1, 31);
    const bestIdx = c.laps.length ? c.laps.indexOf(Math.min(...c.laps)) : -1;
    b.writeUInt8(bestIdx + 1, 32);
    c.laps.slice(0, 100).forEach((ms, k) => { b.writeUInt32LE(ms, 36 + k * 14); b.writeUInt8(15, 36 + k * 14 + 13); });
    [...c.stints, { endLap: 255, compound: c.compound, visual: c.visual }].slice(0, 8).forEach((s, k) => {
      b.writeUInt8(s.endLap, 1436 + k * 3); b.writeUInt8(s.compound, 1437 + k * 3); b.writeUInt8(s.visual, 1438 + k * 3);
    });
    return b;
  }

  tyreSets() {
    const b = Buffer.alloc(231);
    header(this.format, 12, this.t, this.player, this.uid).copy(b, 0);
    b.writeUInt8(this.player, 29);
    const sets = [[18, 16, 0, 1, 4, 3, 0], [19, 17, 0, 1, 14, 14, 600], [20, 18, 0, 1, 22, 22, 1100], [19, 17, 30, 1, 14, 9, 650], [18, 16, 12, 0, 4, 3, 0]];
    sets.forEach(([act, vis, wear, avail, life, usable, delta], k) => {
      const o = 30 + k * 10;
      b.writeUInt8(act, o); b.writeUInt8(vis, o + 1); b.writeUInt8(wear, o + 2); b.writeUInt8(avail, o + 3); b.writeUInt8(15, o + 4);
      b.writeUInt8(life, o + 5); b.writeUInt8(usable, o + 6); b.writeInt16LE(delta, o + 7); b.writeUInt8(k === 4 ? 1 : 0, o + 9);
    });
    b.writeUInt8(4, 230);
    return b;
  }

  telemetry(o) {
    const stride = this.format >= 2026 ? 59 : 60;
    const body = Buffer.alloc(this.n * stride + 3);
    const p = this.player * stride;
    body.writeUInt16LE(o.speedKmh, p); body.writeFloatLE(o.throttle, p + 2); body.writeFloatLE(o.brake, p + 10);
    body.writeInt8(6, p + 15); body.writeUInt16LE(11000, p + 16);
    // F1 wheel order RL, RR, FL, FR
    [o.tR, o.tR, o.tF, o.tF].forEach((v, k) => body.writeUInt8(v, p + 30 + k));
    [100, 100, 100, 100].forEach((v, k) => body.writeUInt8(v, p + 34 + k));
    return Buffer.concat([header(this.format, 6, this.t, this.player, this.uid), body]);
  }

  motionEx(slip) {
    const b = Buffer.alloc(273);
    header(this.format, 13, this.t, this.player, this.uid).copy(b, 0);
    [slip[2], slip[3], slip[0], slip[1]].forEach((v, k) => b.writeFloatLE(v, 93 + k * 4));
    return b;
  }

  damage(wear) {
    const stride = (this.format >= 2026 ? 1133 - 29 : 1041 - 29) / this.n;
    const body = Buffer.alloc(this.n * stride);
    [wear[2], wear[3], wear[0], wear[1]].forEach((v, k) => body.writeFloatLE(v, this.player * stride + k * 4));
    return Buffer.concat([header(this.format, 10, this.t, this.player, this.uid), body]);
  }

  // Wheel button press: UDP Action n (1-12) held for one frame, then released.
  press(n) { this.events.push(['BUTN', [...Buffer.from(new Uint32Array([2 ** (19 + n)]).buffer)]], ['BUTN', [0, 0, 0, 0]]); }

  event(code, bytes = []) {
    const b = Buffer.alloc(45);
    header(this.format, 3, this.t, this.player, this.uid).copy(b, 0);
    b.write(code, 29, 4, 'ascii');
    bytes.forEach((v, k) => b.writeUInt8(v, 33 + k));
    return b;
  }

  // All packets for one 1/20 s frame. Player locks fronts and spins the rears to trigger advice.
  frame(k) {
    this.maybePit();
    this.step(0.05);
    const out = [this.motion(), this.lap()];
    const ph = k % 40;
    const braking = ph >= 20 && ph < 26, exiting = ph >= 30;
    const parked = this.cars[this.player].garage || this.grid;
    out.push(this.telemetry({ speedKmh: parked ? 0 : braking ? 160 : 260, throttle: braking ? 0 : 1, brake: braking ? 0.9 : 0, tF: 98, tR: 109 }));
    for (let r = 0; r < 3; r++) out.push(this.motionEx(braking && ph % 2 ? [-0.3, -0.3, -0.05, -0.05] : exiting ? [0.02, 0.02, 0.3, 0.3] : [0.02, 0.02, 0.03, 0.03]));
    if (k % 10 === 0) out.push(this.session(), this.status(), this.setup(), this.damage([20, 21, 30, 31]));
    if (k % 100 === 0) out.push(this.participants(), this.tyreSets());
    while (this.events.length) { const [code, bytes] = this.events.shift(); out.push(this.event(code, bytes)); }
    out.push(this.history(k % this.active));
    return out;
  }
}

// ---------------------------------------------------------------------------
// Forza race: your car only, on the same track shape.
// ---------------------------------------------------------------------------
function forzaDash(o) {
  const b = Buffer.alloc(331);
  b.writeInt32LE(1, 0); b.writeUInt32LE(o.t, 4); b.writeFloatLE(8000, 8); b.writeFloatLE(o.rpm || 7000, 16);
  b.writeFloatLE(o.latG || 0, 20);
  [0.5, 0.5, 0.5, 0.5].forEach((v, k) => b.writeFloatLE(v, 68 + k * 4));
  (o.slip || [0, 0, 0, 0]).forEach((v, k) => b.writeFloatLE(v, 84 + k * 4));
  b.writeInt32LE(3021, 212); b.writeInt32LE(4, 216); b.writeInt32LE(652, 220); b.writeInt32LE(0, 224); b.writeInt32LE(4, 228);
  b.writeFloatLE(o.x, 232); b.writeFloatLE(2, 236); b.writeFloatLE(o.z, 240);
  b.writeFloatLE(o.speed, 244);
  (o.temps || [200, 200, 180, 180]).forEach((v, k) => b.writeFloatLE(v, 256 + k * 4));
  b.writeFloatLE(o.fuel, 276); b.writeFloatLE(o.distance, 280);
  b.writeFloatLE(o.best, 284); b.writeFloatLE(o.last, 288); b.writeFloatLE(o.current, 292); b.writeFloatLE(o.raceTime, 296);
  b.writeUInt16LE(o.lap, 300); b.writeUInt8(o.position, 302);
  b.writeUInt8(Math.round(o.throttle * 255), 303); b.writeUInt8(Math.round(o.brake * 255), 304); b.writeUInt8(4, 307);
  o.wear.forEach((v, k) => b.writeFloatLE(v, 311 + k * 4));
  b.writeInt32LE(860, 327);
  return b;
}

class ForzaSim {
  constructor() { this.t = 0; this.dist = 0; this.lapStart = 0; this.last = 0; this.best = 0; this.lap = 0; this.fuel = 1; }
  frame(k) {
    const dt = 1 / 60;
    this.t += dt;
    const v = 55 + 6 * Math.sin(this.t / 3) + (this.lap === 2 ? 1.5 : 0);
    this.dist += v * dt;
    this.fuel -= 0.0022 * v * dt / 55; // about 21% a lap
    const lap = Math.floor(this.dist / TRACK_LEN);
    if (lap > this.lap) {
      this.last = this.t - this.lapStart; this.lapStart = this.t; this.lap = lap;
      if (!this.best || this.last < this.best) this.best = this.last;
    }
    const p = trackPoint(this.dist);
    const ph = k % 120;
    const braking = ph >= 60 && ph < 75;
    const wear = 0.012 * (this.dist / TRACK_LEN);
    return [forzaDash({ t: Math.round(this.t * 1000), x: p.x, z: p.z, speed: v, fuel: Math.max(0, this.fuel), distance: this.dist, best: this.best, last: this.last, current: this.t - this.lapStart, raceTime: this.t, lap: this.lap, position: 3, throttle: braking ? 0 : 1, brake: braking ? 0.8 : 0, slip: braking && ph % 2 ? [-0.3, -0.3, 0, 0] : [0.02, 0.02, 0, 0], wear: [wear * 1.3, wear * 1.3, wear, wear], temps: [215, 214, 188, 187] })];
  }
}

module.exports = { F1Sim, ForzaSim, trackPoint, TRACK_LEN };

if (require.main === module) {
  const [game = 'f1', host = '127.0.0.1', portArg] = process.argv.slice(2);
  const port = Number(portArg) || (game === 'forza' ? 5300 : 20777);
  const sock = dgram.createSocket('udp4');
  // f1-quali: qualifying, you start in the garage. f1 / f1-2026: a race with a safety car and rain.
  // f1-start: grid, formation lap and lights out, in a weekend with parc fermé on.
  const garageS = Number(process.env.SIM_GARAGE) || 40;
  const sim = game === 'forza' ? new ForzaSim()
    : game === 'f1-quali' ? new F1Sim({ format: 2025, sessionType: 5, garageUntil: garageS, slowZone: [3000, 3250, 0.7], parcFerme: true, weekend: [1, 2, 3, 5, 6, 7, 15] })
      : game === 'f1-start' ? new F1Sim({ format: 2025, gridS: 40, formationS: 20, parcFerme: true, weekend: [1, 2, 3, 5, 6, 7, 15], slowZone: [2000, 2250, 0.7] })
        : new F1Sim({ format: game === 'f1-2026' ? 2026 : 2025, scAt: 260, weatherAt: 560, slowZone: [2000, 2250, 0.7] });
  const hz = game === 'forza' ? 60 : 20;
  let k = 0;
  console.log(`Streaming a ${game} race to ${host}:${port}. Ctrl+C to stop.`);
  const speed = Number(process.env.SIM_SPEED) || 1; // >1 plays the race faster than real time
  setInterval(() => { for (const b of sim.frame(k++)) sock.send(b, port, host); }, 1000 / hz / speed);
}
