'use strict';
// Live race state for the dashboard: track map, timing tower, pit options and
// on-track adjustments. Built from the decoded packets in parsers.js.
//
// Everything shown comes from the game's own data. Where we estimate something
// (Forza fuel and tyre projections), the dashboard labels it as an estimate.

const BUCKET_M = 10;           // track outline resolution, metres of lap distance
const WINDOW_S = 60;           // rolling window for on-track advice, seconds of driving
const round = (v, d = 0) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

// ---------------------------------------------------------------------------
// Track outline: one point per 10 m of lap distance, filled in as cars drive.
// ---------------------------------------------------------------------------
class Outline {
  constructor(lengthM) { this.reset(lengthM); }
  reset(lengthM) {
    this.length = lengthM || 0;
    this.points = new Map(); // bucket -> [x, z]
    this.version = 0;
    this.complete = false;
  }
  add(dist, x, z) {
    if (!this.length || !(dist >= 0) || dist > this.length || !Number.isFinite(x) || !Number.isFinite(z) || (x === 0 && z === 0)) return;
    const k = Math.floor(dist / BUCKET_M);
    if (this.points.has(k)) return;
    this.points.set(k, [round(x, 1), round(z, 1)]);
    this.version++;
    if (!this.complete && this.coverage() >= 0.97) this.complete = true;
  }
  coverage() { return this.length ? this.points.size / Math.ceil(this.length / BUCKET_M) : 0; }
  toJSON() {
    return { length: this.length, complete: this.complete, points: [...this.points.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p) };
  }
  load(data) {
    if (!data || !Array.isArray(data.points) || !data.length) return false;
    this.reset(data.length);
    data.points.forEach((p, i) => this.points.set(i, p));
    this.complete = !!data.complete;
    this.version = 1;
    return true;
  }
}

// Rolling counters over the last WINDOW_S seconds, one slot per second.
class Rolling {
  constructor() { this.slots = []; }
  add(t, key, n = 1) {
    const s = Math.floor(t);
    let slot = this.slots[this.slots.length - 1];
    if (!slot || slot.s !== s) { slot = { s }; this.slots.push(slot); }
    slot[key] = (slot[key] || 0) + n;
    while (this.slots.length && this.slots[0].s < s - WINDOW_S) this.slots.shift();
  }
  sum(key) { return this.slots.reduce((a, x) => a + (x[key] || 0), 0); }
  reset() { this.slots = []; }
}

// ---------------------------------------------------------------------------
// F1 25
// ---------------------------------------------------------------------------
const VISUAL = { 16: 'S', 17: 'M', 18: 'H', 7: 'I', 8: 'W' };
const VISUAL_NAME = { 16: 'Soft', 17: 'Medium', 18: 'Hard', 7: 'Inter', 8: 'Wet' };
const ACTUAL = { 16: 'C5', 17: 'C4', 18: 'C3', 19: 'C2', 20: 'C1', 21: 'C0', 22: 'C6', 7: 'Inter', 8: 'Wet' };
const SESSION = { 0: 'Unknown', 1: 'Practice 1', 2: 'Practice 2', 3: 'Practice 3', 4: 'Short practice', 5: 'Q1', 6: 'Q2', 7: 'Q3', 8: 'Short qualifying', 9: 'One-shot qualifying', 10: 'Sprint shootout 1', 11: 'Sprint shootout 2', 12: 'Sprint shootout 3', 13: 'Short sprint shootout', 14: 'One-shot sprint shootout', 15: 'Race', 16: 'Race 2', 17: 'Race 3', 18: 'Time trial' };
const isRace = (t) => t >= 15 && t <= 17;
const WEATHER = ['Clear', 'Light cloud', 'Overcast', 'Light rain', 'Heavy rain', 'Storm'];
const SC = ['', 'Safety car', 'Virtual safety car', 'Formation lap'];
const RESULT = { 3: 'FIN', 4: 'DNF', 5: 'DSQ', 6: 'NC', 7: 'RET' };

class F1Race {
  constructor(store) {
    this.store = store;
    this.reset(null);
  }

  reset(uid) {
    this.uid = uid;
    this.format = null;
    this.player = 0;
    this.session = {};
    this.lap = [];
    this.motion = [];
    this.parts = [];
    this.status = [];
    this.history = {}; // car -> { bestLapMs, stints }
    this.tyreSets = null;
    this.setup = null;
    this.tel = null;
    this.wear = null;
    this.events = [];
    this.outline = new Outline(0);
    this.trackKey = null;
    this.roll = new Rolling();
    this.lastSeen = 0;
  }

  push(m) {
    if (!m || !m.type) return;
    const h = m.header;
    if (h.sessionUID !== this.uid) this.reset(h.sessionUID);
    this.format = h.format;
    this.player = h.playerIndex;
    this.lastSeen = Date.now();
    switch (m.type) {
      case 'session': {
        this.session = { ...this.session, ...m };
        if (m.trackLength && m.trackId >= 0) {
          const key = `f1-${m.trackId}`;
          if (key !== this.trackKey) {
            this.trackKey = key;
            this.outline = new Outline(m.trackLength);
            this.outline.load(this.store.loadTrack(key));
          }
        }
        break;
      }
      case 'motion': this.motion = m.cars; this.trace(); break;
      case 'lap': this.lap = m.cars; break;
      case 'participants': this.parts = m.cars; this.numActive = m.numActive; break;
      case 'status': this.status = m.cars; break;
      case 'setup': this.setup = m; break;
      case 'history': this.history[m.car] = { bestLapMs: m.bestLapMs, stints: m.stints }; break;
      case 'tyreSets': if (m.car === this.player) this.tyreSets = m; break;
      case 'damage': this.wear = m.tyreWear; break;
      case 'telemetry': this.tel = m; break;
      case 'motionEx': this.sample(m, h.sessionTime); break;
      case 'event': this.event(m, h.sessionTime); break;
      default:
    }
  }

  // Fill in the track outline from every car that's on the racing line.
  trace() {
    if (!this.outline.length || this.outline.complete) return;
    const before = this.outline.complete;
    this.lap.forEach((c, i) => {
      const p = this.motion[i];
      if (!p || c.pitStatus !== 0 || !(c.resultStatus === 2 || c.resultStatus === undefined)) return;
      this.outline.add(c.lapDistance, p.x, p.z);
    });
    if (!before && this.outline.complete) this.store.saveTrack(this.trackKey, this.outline.toJSON());
  }

  // Rolling window of lock-ups, wheelspin and tyre heat for on-track advice.
  sample(m, t) {
    const tel = this.tel;
    if (!tel || tel.speedKmh < 40) return;
    const r = this.roll;
    r.add(t, 'n');
    if (tel.brake > 0.4) {
      r.add(t, 'brk');
      if (Math.min(m.slipRatio[0], m.slipRatio[1]) < -0.15) r.add(t, 'lockF');
      if (Math.min(m.slipRatio[2], m.slipRatio[3]) < -0.15) r.add(t, 'lockR');
    }
    if (tel.throttle > 0.8 && tel.brake < 0.1) {
      r.add(t, 'thr');
      if (Math.max(m.slipRatio[2], m.slipRatio[3]) > 0.15) r.add(t, 'spin');
    }
    r.add(t, 'tF', (tel.surfaceTemp[0] + tel.surfaceTemp[1]) / 2);
    r.add(t, 'tR', (tel.surfaceTemp[2] + tel.surfaceTemp[3]) / 2);
  }

  event(m, t) {
    const who = (i) => this.name(i);
    let text = null;
    if (m.code === 'FTLP') text = `Fastest lap: ${who(m.car)} ${fmtMs(m.lapTime * 1000)}`;
    else if (m.code === 'PENA' && m.time > 0 && m.time < 255) text = `Penalty: ${who(m.car)} +${m.time}s`;
    else if (m.code === 'PENA' && m.penaltyType === 0) text = `Drive-through: ${who(m.car)}`;
    else if (m.code === 'RTMT') text = `Retired: ${who(m.car)}`;
    else if (m.code === 'SCAR') text = `${SC[m.safetyCarType] || 'Safety car'} ${['deployed', 'in this lap', 'ended'][m.eventType] || ''}`.trim();
    else if (m.code === 'CHQF') text = 'Chequered flag';
    else if (m.code === 'RCWN') text = `Winner: ${who(m.car)}`;
    if (text) {
      this.events.unshift({ t: round(t), text });
      this.events = this.events.slice(0, 8);
    }
  }

  name(i) {
    const p = this.parts[i];
    if (!p) return `Car ${i + 1}`;
    return p.name && !/^player$/i.test(p.name) ? p.name : `#${p.raceNumber}`;
  }

  state() {
    const s = this.session;
    const race = isRace(s.sessionType);
    const me = this.player;
    const n = Math.min(this.numActive || this.lap.length, this.lap.length);
    const rows = [];
    for (let i = 0; i < this.lap.length; i++) {
      const c = this.lap[i];
      if (!c || !c.position || (i >= n && c.resultStatus !== 2)) continue;
      if (c.resultStatus !== undefined && c.resultStatus < 2) continue;
      const st = this.status[i] || {};
      const hist = this.history[i] || {};
      const p = this.parts[i] || {};
      rows.push({
        i, me: i === me,
        pos: c.position,
        name: this.name(i),
        num: p.raceNumber ?? null,
        colour: p.colour,
        lap: c.lapNum,
        gapLeaderMs: c.gapLeaderMs,
        gapAheadMs: c.gapAheadMs,
        lastMs: c.lastLapMs || null,
        bestMs: hist.bestLapMs || null,
        tyre: VISUAL[st.visual] || null,
        tyreAge: st.tyreAge ?? null,
        stops: c.pitStops,
        pit: c.pitStatus > 0,
        out: c.driverStatus === 3,
        penaltySec: c.penaltySec || 0,
        result: RESULT[c.resultStatus] || null,
        dist: c.totalDistance,
      });
    }
    rows.sort((a, b) => a.pos - b.pos);
    // Practice and qualifying: gaps come from best laps.
    if (!race) {
      const best = rows.find((r) => r.bestMs)?.bestMs;
      rows.forEach((r, k) => {
        r.gapLeaderMs = best && r.bestMs ? r.bestMs - best : null;
        r.gapAheadMs = k && r.bestMs && rows[k - 1].bestMs ? r.bestMs - rows[k - 1].bestMs : null;
      });
    }

    const meLap = this.lap[me] || {};
    const map = {
      key: this.trackKey,
      version: this.outline.version,
      coverage: round(this.outline.coverage(), 2),
      cars: this.lap.map((c, i) => {
        const p = this.motion[i];
        if (!p || !c || !c.position || c.resultStatus > 2 || c.resultStatus < 2) return null;
        return { i, x: round(p.x, 1), z: round(p.z, 1), pos: c.position, me: i === me, pit: c.pitStatus > 0, colour: this.parts[i]?.colour || null };
      }).filter(Boolean),
    };

    return {
      game: 'f1',
      live: Date.now() - this.lastSeen < 3000,
      format: this.format,
      session: {
        type: SESSION[s.sessionType] || '',
        race,
        track: s.track,
        lap: meLap.lapNum || null,
        totalLaps: race ? s.totalLaps || null : null,
        timeLeft: race ? null : s.timeLeft ?? null,
        weather: WEATHER[s.weather] ?? null,
        trackTemp: s.trackTemp ?? null,
        airTemp: s.airTemp ?? null,
        safetyCar: SC[s.safetyCar] || '',
        timeOfDay: s.timeOfDay ?? null,
        position: meLap.position || null,
        cars: rows.length,
        trackLength: s.trackLength || null,
      },
      tower: rows,
      map,
      pit: this.pitAdvice(race),
      adjust: this.adjustments(race),
      events: this.events,
    };
  }

  pitAdvice(race) {
    const s = this.session;
    const me = this.player;
    const c = this.lap[me] || {};
    const st = this.status[me] || {};
    const out = { items: [], tyre: null, sets: [] };
    if (!c.lapNum) return out;
    const lapsLeft = race && s.totalLaps ? Math.max(0, s.totalLaps - c.lapNum + 1) : null; // includes the current lap
    const wear = this.wear ? Math.max(...this.wear) : null;
    out.tyre = { name: VISUAL_NAME[st.visual] || null, short: VISUAL[st.visual] || null, compound: ACTUAL[st.compound] || null, age: st.tyreAge ?? null, wear: wear !== null ? round(wear) : null, wearByWheel: this.wear ? this.wear.map((w) => round(w)) : null };

    if (race) {
      if (s.pitIdealLap > 0) {
        const lapsTo = s.pitIdealLap - c.lapNum;
        out.items.push({
          level: lapsTo <= 0 ? 'now' : lapsTo <= 2 ? 'soon' : 'info',
          title: lapsTo <= 0 ? `Pit window open: box by lap ${s.pitLatestLap || s.pitIdealLap}` : `Ideal stop: lap ${s.pitIdealLap}${s.pitLatestLap ? ` (latest ${s.pitLatestLap})` : ''}`,
          text: `From the game's strategy for your car.${s.pitRejoinPosition ? ` Stopping now you'd rejoin about P${s.pitRejoinPosition}.` : ''}`,
        });
      } else if (s.pitRejoinPosition) {
        out.items.push({ level: 'info', title: `Stop now: rejoin about P${s.pitRejoinPosition}`, text: "The game's prediction if you pit this lap." });
      }
      if (s.safetyCar === 1 || s.safetyCar === 2) {
        out.items.push({ level: 'now', title: `${SC[s.safetyCar]} out`, text: 'A stop costs much less time under a safety car. If you are due to pit in the next few laps, consider boxing now.' });
      }
      // Two dry compounds rule.
      const stints = this.history[me]?.stints || [];
      const dryUsed = new Set([...stints.map((x) => x.visual), st.visual].filter((v) => v >= 16 && v <= 18));
      const wetRace = [7, 8].includes(st.visual) || stints.some((x) => x.visual === 7 || x.visual === 8);
      if (!wetRace && dryUsed.size === 1 && lapsLeft !== null && lapsLeft > 0 && (c.pitStops || 0) === 0 && s.totalLaps >= 5) {
        out.items.push({ level: 'info', title: 'Two dry compounds needed', text: `You have only run ${VISUAL_NAME[[...dryUsed][0]]}. If the mandatory stop is on, fit a different dry compound when you pit.` });
      }
      // Fuel.
      if (Number.isFinite(st.fuelLaps)) {
        const spare = st.fuelLaps;
        out.items.push(spare < -0.2
          ? { level: 'now', title: `Fuel: ${Math.abs(spare).toFixed(1)} laps short`, text: 'Lift and coast before the big braking zones, or switch to a leaner mode, to make the finish.' }
          : { level: 'ok', title: `Fuel: ${spare >= 0 ? '+' : ''}${spare.toFixed(1)} laps`, text: 'Fuel to spare at the finish, as shown on your MFD.' });
      }
      // Weather.
      const next = (s.forecast || []).filter((f) => f.sessionType === s.sessionType && f.minutes > 0).sort((a, b) => a.minutes - b.minutes);
      const rainSoon = next.find((f) => f.rain >= 50 && f.minutes <= 20);
      if (rainSoon && ![7, 8].includes(st.visual)) out.items.push({ level: 'soon', title: `Rain ${rainSoon.rain}% in ${rainSoon.minutes} min`, text: 'Be ready to switch to Inters when the track gets wet.' });
    }

    // Tyre sets you can fit, from the game's tyre-set data.
    if (this.tyreSets) {
      const sets = this.tyreSets.sets.filter((x) => x.available && !x.fitted && VISUAL[x.visual]);
      const best = {};
      for (const x of sets) {
        const k = x.visual;
        if (!best[k] || x.wear < best[k].wear) best[k] = x;
      }
      out.sets = Object.values(best).map((x) => ({
        tyre: VISUAL[x.visual], name: VISUAL_NAME[x.visual], wear: x.wear, usableLife: x.usableLife,
        lapDeltaMs: x.lapDeltaMs,
        reachesEnd: lapsLeft !== null ? x.usableLife >= Math.max(0, lapsLeft - 1) : null,
      })).sort((a, b) => a.lapDeltaMs - b.lapDeltaMs);
    }
    return out;
  }

  adjustments(race) {
    const me = this.player;
    const st = this.status[me] || {};
    const r = this.roll;
    const out = [];
    const n = r.sum('n');
    if (n < 300) return { ready: false, items: out }; // about 5 s of driving at 60 Hz
    const brk = r.sum('brk'), thr = r.sum('thr');
    const lockF = brk >= 60 ? r.sum('lockF') / brk : 0;
    const lockR = brk >= 60 ? r.sum('lockR') / brk : 0;
    const spin = thr >= 120 ? r.sum('spin') / thr : 0;
    const tF = r.sum('tF') / n, tR = r.sum('tR') / n;
    const bias = this.setup?.brakeBias || st.brakeBias;

    if (lockF > 0.12 && lockF > lockR * 1.5) out.push({ level: 'now', title: `Brake bias back 1%${bias ? ` (to ${bias - 1}%)` : ''}`, text: `Front wheels locked in ${Math.round(lockF * 100)}% of braking in the last minute.` });
    else if (lockR > 0.12 && lockR > lockF * 1.5) out.push({ level: 'now', title: `Brake bias forward 1%${bias ? ` (to ${bias + 1}%)` : ''}`, text: `Rear wheels locked in ${Math.round(lockR * 100)}% of braking in the last minute.` });
    if (spin > 0.15) {
      const d = this.setup?.diffOn;
      out.push({ level: 'now', title: `Lower on-throttle diff${d ? ` (now ${d}%)` : ''}`, text: `Rear wheelspin in ${Math.round(spin * 100)}% of full-throttle time. A more open diff and short-shifting out of slow corners will help.` });
    }
    if (tR > 105) out.push({ level: 'soon', title: `Rears hot (${Math.round(tR)}°C)`, text: 'Smoother on the throttle out of slow corners and short-shift to bring them back to 90–100°C.' });
    if (tF > 105) out.push({ level: 'soon', title: `Fronts hot (${Math.round(tF)}°C)`, text: 'Brake a touch earlier and use less steering lock mid-corner.' });
    if (tF > 0 && tF < 80 && tR < 80) out.push({ level: 'info', title: `Tyres cold (${Math.round((tF + tR) / 2)}°C)`, text: 'Push a little harder or weave under the safety car to bring them up.' });
    // ERS as a percentage of the 4 MJ store (2025 cars only; the 2026 battery rules differ).
    if (Number.isFinite(st.ersStore) && this.format < 2026) {
      const pct = (st.ersStore / 4e6) * 100;
      if (pct < 15 && st.ersMode >= 2) out.push({ level: 'soon', title: `ERS low (${Math.round(pct)}%)`, text: 'Switch the ERS mode to Medium or None for a lap to recharge.' });
      else if (pct > 85 && st.ersMode <= 1 && race) out.push({ level: 'info', title: `ERS full (${Math.round(pct)}%)`, text: 'You have charge to spare. Use Overtake mode to attack or defend.' });
    }
    return { ready: true, items: out, bias: bias || null, diffOn: this.setup?.diffOn ?? null, ers: Number.isFinite(st.ersStore) && this.format < 2026 ? round((st.ersStore / 4e6) * 100) : null };
  }

  track() { return { key: this.trackKey, ...this.outline.toJSON() }; }
}

// ---------------------------------------------------------------------------
// Forza Motorsport: only your own car is sent, so there's no field data.
// ---------------------------------------------------------------------------
class ForzaRace {
  constructor(store, getLaps) {
    this.store = store;
    this.getLaps = getLaps; // total race laps from the app's Setup tab
    this.reset();
  }

  reset() {
    this.p = null;
    this.trackKey = null;
    this.outline = new Outline(0);
    this.lapStartDist = null;
    this.lapStartFuel = null;
    this.lapStartWear = null;
    this.fuelPerLap = [];
    this.wearPerLap = [];
    this.trace = [];       // [bucket -> seconds] for the lap in progress
    this.bestTrace = null; // trace of the best lap
    this.bestLap = null;
    this.trail = [];       // points driven so far, before the outline is known
    this.roll = new Rolling();
    this.lastSeen = 0;
    this.carOrdinal = null;
  }

  push(p) {
    if (!p || !p.dash) return;
    this.lastSeen = Date.now();
    const prev = this.p;
    const key = p.trackOrdinal != null ? `forza-${p.trackOrdinal}` : null;
    if (!prev || p.carOrdinal !== this.carOrdinal || key !== this.trackKey || p.lapNumber < prev.lapNumber) {
      const keepTrack = key === this.trackKey ? this.outline : null;
      this.reset();
      this.carOrdinal = p.carOrdinal;
      this.trackKey = key;
      if (keepTrack) this.outline = keepTrack;
      else if (key) {
        const saved = this.store.loadTrack(key);
        if (saved) this.outline.load(saved);
      }
      this.lapStartDist = p.distance;
      this.lapStartFuel = p.fuel;
      this.lapStartWear = p.tyreWear ? p.tyreWear.slice() : null;
    } else if (p.lapNumber > prev.lapNumber) {
      this.lapDone(p, prev);
    }
    this.p = p;
    if (!p.isRaceOn) return;
    const d = p.distance - (this.lapStartDist ?? p.distance);
    if (d >= 0) {
      const k = Math.floor(d / BUCKET_M);
      if (this.trace[k] === undefined) this.trace[k] = p.currentLap;
      if (!this.outline.length) {
        const last = this.trail[this.trail.length - 1];
        if (!last || Math.hypot(last[0] - p.posX, last[1] - p.posZ) > BUCKET_M) this.trail.push([round(p.posX, 1), round(p.posZ, 1)]);
        if (this.trail.length > 3000) this.trail.shift();
      }
    }
    this.sample(p);
  }

  lapDone(p, prev) {
    const lapLen = p.distance - this.lapStartDist;
    // The first full lap defines the outline.
    if (!this.outline.length && lapLen > 500 && this.trail.length > 20) {
      this.outline.reset(lapLen);
      this.trail.forEach((pt, i) => this.outline.points.set(i, pt));
      this.outline.complete = true;
      this.outline.version++;
      if (this.trackKey) this.store.saveTrack(this.trackKey, this.outline.toJSON());
    }
    if (this.lapStartFuel !== null && p.fuel <= this.lapStartFuel) this.fuelPerLap.push(this.lapStartFuel - p.fuel);
    if (this.lapStartWear && p.tyreWear) this.wearPerLap.push(Math.max(...p.tyreWear.map((w, i) => w - this.lapStartWear[i])));
    if (p.lastLap > 0 && (this.bestLap === null || p.lastLap <= this.bestLap + 0.001)) {
      this.bestLap = p.lastLap;
      this.bestTrace = this.trace.slice();
    }
    this.trace = [];
    this.lapStartDist = p.distance;
    this.lapStartFuel = p.fuel;
    this.lapStartWear = p.tyreWear ? p.tyreWear.slice() : null;
  }

  sample(p) {
    if (p.speed < 10) return;
    const r = this.roll;
    const t = p.timestampMs / 1000;
    r.add(t, 'n');
    const driven = p.drivetrain === 'fwd' ? [0, 1] : p.drivetrain === 'rwd' ? [2, 3] : [0, 1, 2, 3];
    if (p.throttle > 0.8 && p.brake < 0.1) { r.add(t, 'thr'); if (driven.some((i) => p.slipRatio[i] > 0.2)) r.add(t, 'spin'); }
    if (p.brake > 0.4) {
      r.add(t, 'brk');
      if (Math.min(p.slipRatio[0], p.slipRatio[1]) < -0.2) r.add(t, 'lockF');
      if (Math.min(p.slipRatio[2], p.slipRatio[3]) < -0.2) r.add(t, 'lockR');
    }
    r.add(t, 'tF', (p.tyreTemp[0] + p.tyreTemp[1]) / 2);
    r.add(t, 'tR', (p.tyreTemp[2] + p.tyreTemp[3]) / 2);
  }

  liveDelta() {
    const p = this.p;
    if (!p || !this.bestTrace) return null;
    const k = Math.floor((p.distance - this.lapStartDist) / BUCKET_M);
    const ref = this.bestTrace[k];
    return ref === undefined ? null : round(p.currentLap - ref, 2);
  }

  state() {
    const p = this.p;
    if (!p) return { game: 'forza', live: false };
    const totalLaps = Number(this.getLaps()) || null;
    const lap = p.lapNumber + 1;
    const lapsLeft = totalLaps ? Math.max(0, totalLaps - lap + 1) : null;
    const avg = (a) => (a.length ? a.slice(-3).reduce((x, y) => x + y, 0) / Math.min(3, a.length) : null);
    const fuelLap = avg(this.fuelPerLap);
    const wearLap = avg(this.wearPerLap);
    const wearNow = p.tyreWear ? Math.max(...p.tyreWear) : null;
    const pit = { items: [], tyre: { wear: wearNow !== null ? round(wearNow * 100) : null, wearByWheel: p.tyreWear ? p.tyreWear.map((w) => round(w * 100)) : null, temps: p.tyreTemp.map((x) => round(x)) }, estimate: true };
    if (fuelLap > 0) {
      const lapsOfFuel = p.fuel / fuelLap;
      const shortBy = lapsLeft !== null ? lapsLeft - lapsOfFuel : null;
      pit.items.push(shortBy !== null && shortBy > 0.1
        ? { level: lapsOfFuel < 2 ? 'now' : 'soon', title: `Fuel runs out in ${lapsOfFuel.toFixed(1)} laps`, text: `You need about ${shortBy.toFixed(1)} more laps of fuel. Pit for fuel at the end of lap ${lap + Math.max(0, Math.floor(lapsOfFuel) - 1)}${lapsOfFuel < 1 ? ' (this lap)' : ''}.` }
        : { level: 'ok', title: `Fuel: ${lapsOfFuel.toFixed(1)} laps left`, text: lapsLeft !== null ? `Enough to finish with about ${(lapsOfFuel - lapsLeft).toFixed(1)} laps spare.` : 'Set the race laps on the Setup tab to see if that is enough.' });
    } else if (p.isRaceOn) {
      pit.items.push({ level: 'info', title: 'Fuel and tyre estimates after lap 1', text: 'They are worked out from how much you use per lap.' });
    }
    if (wearLap > 0 && wearNow !== null && lapsLeft !== null) {
      const atFinish = (wearNow + wearLap * lapsLeft) * 100;
      pit.items.push({ level: atFinish >= 70 ? 'soon' : 'ok', title: `Tyres about ${Math.round(atFinish)}% worn by the finish`, text: `Wearing ${(wearLap * 100).toFixed(1)}% a lap.${atFinish >= 70 ? ' Grip will fall away late on; a stop for fresh tyres may be quicker if the race allows it.' : ''}` });
    }

    // Driving tips (Forza has no in-car setup changes).
    const r = this.roll, tips = [];
    const n = r.sum('n');
    if (n >= 300) {
      const brk = r.sum('brk'), thr = r.sum('thr');
      const lockF = brk >= 60 ? r.sum('lockF') / brk : 0;
      const lockR = brk >= 60 ? r.sum('lockR') / brk : 0;
      const spin = thr >= 120 ? r.sum('spin') / thr : 0;
      const tF = r.sum('tF') / n, tR = r.sum('tR') / n;
      if (lockF > 0.12) tips.push({ level: 'now', title: 'Front lock-ups', text: `In ${Math.round(lockF * 100)}% of braking. Brake a little earlier and ease off the pedal as you turn in.` });
      if (lockR > 0.12) tips.push({ level: 'now', title: 'Rear lock-ups', text: `In ${Math.round(lockR * 100)}% of braking. Brake in a straight line and downshift more gently.` });
      if (spin > 0.15) tips.push({ level: 'now', title: 'Wheelspin on exits', text: `In ${Math.round(spin * 100)}% of full-throttle time. Squeeze the throttle on gradually until the car is straight.` });
      if (Math.abs(tF - tR) >= 20) tips.push({ level: 'info', title: tF > tR ? 'Front tyres hotter than rears' : 'Rear tyres hotter than fronts', text: `${Math.round(tF)}°F front, ${Math.round(tR)}°F rear. ${tF > tR ? 'Less steering lock and smoother turn-in will spare the fronts.' : 'Smoother throttle will spare the rears.'} After the race, Fix it has setup changes.` });
    }

    return {
      game: 'forza',
      live: Date.now() - this.lastSeen < 3000 && p.isRaceOn,
      session: { lap, totalLaps, position: p.position || null, speedKmh: Math.round(p.speed * 3.6), gear: p.gear, fuelPct: round(p.fuel * 100) },
      timing: { currentS: round(p.currentLap, 3), lastS: p.lastLap > 0 ? round(p.lastLap, 3) : null, bestS: p.bestLap > 0 ? round(p.bestLap, 3) : null, deltaS: this.liveDelta(), raceTimeS: round(p.raceTime, 1) },
      map: {
        key: this.trackKey,
        version: this.outline.version,
        coverage: this.outline.length ? 1 : 0,
        trail: this.outline.length ? null : this.trail.slice(-1500),
        cars: [{ x: round(p.posX, 1), z: round(p.posZ, 1), me: true, pos: p.position || null }],
      },
      pit,
      adjust: { ready: n >= 300, items: tips, forza: true },
    };
  }

  track() { return { key: this.trackKey, ...this.outline.toJSON() }; }
}

function fmtMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return m ? `${m}:${s.toFixed(3).padStart(6, '0')}` : s.toFixed(3);
}

module.exports = { F1Race, ForzaRace, Outline, VISUAL, ACTUAL, SESSION, fmtMs };
