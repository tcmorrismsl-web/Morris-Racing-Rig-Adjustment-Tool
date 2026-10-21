'use strict';
// Race engineer: turns the live race state into radio calls, answers questions and
// asks a few of its own (box for Inters? box under the safety car?).
//
// Calls carry structured data plus a plain-English line. The dashboard turns them into
// speech in the chosen style. Everything is worked out from the game's own data; the
// few estimates (qualifying traffic, out-lap time) say so in their text.

const SEGMENTS = 20;          // mini-sectors per lap for "where am I losing time"
const PIT_EXIT_S = 20;        // estimate: garage to pit exit, seconds
const OUTLAP_FACTOR = 1.35;   // estimate: out lap vs flying lap time
const KEEP = 30;

const sec = (ms, d = 1) => (ms / 1000).toFixed(d);
const lapTime = (ms) => { const m = Math.floor(ms / 60000); const s = (ms % 60000) / 1000; return m ? `${m}:${s.toFixed(3).padStart(6, '0')}` : s.toFixed(3); };
const mins = (n) => `${n} minute${n === 1 ? '' : 's'}`;
const SC_NAME = ['', 'Safety car', 'Virtual safety car', 'Formation lap'];
const WEATHER = ['clear', 'light cloud', 'overcast', 'light rain', 'heavy rain', 'a storm'];

// F1 25 button flags: UDP Action 1-12 are bits 20-31. Bind them to wheel buttons in the game.
const UDP_ACTIONS = { 1: 'yes', 2: 'no', 3: 'gaps', 4: 'pit', 5: 'time', 6: 'weather', 7: 'tyres', 8: 'repeat' };
const udpBit = (n) => 2 ** (19 + n);

// Cooldowns run on the game's clock, so pausing the game pauses the engineer too.
class Calls {
  constructor(clock) { this.clock = clock; this.list = []; this.seq = 0; this.last = {}; this.pending = null; }
  say(kind, data, text, { priority = 'normal', cooldownS = 0, key = kind, ask = null } = {}) {
    const now = this.clock();
    if (cooldownS && this.last[key] && now - this.last[key] < cooldownS * 1000) return null;
    this.last[key] = now;
    const call = { id: ++this.seq, at: Date.now(), t: now, kind, priority, data, text };
    if (ask) { call.ask = ask; this.pending = { id: call.id, ask, kind, data, at: now }; }
    this.list.push(call);
    if (this.list.length > KEEP) this.list.shift();
    return call;
  }
  repeat() {
    const lastCall = [...this.list].reverse().find((c) => c.kind !== 'repeat-none');
    if (!lastCall) return this.say('answer', {}, "Nothing to repeat yet.", { priority: 'high' });
    return this.say(lastCall.kind, lastCall.data, lastCall.text, { priority: 'high', key: `repeat-${this.seq}` });
  }
}

// Mini-sector times for one car.
class Splits {
  constructor() { this.enter = new Array(SEGMENTS).fill(null); this.lapNum = null; this.lastSeg = -1; this.lastLap = null; this.bestLap = null; this.bestMs = 0; }
  update(c, segLen) {
    if (c.lapNum !== this.lapNum) {
      if (this.lapNum !== null && c.lapNum === this.lapNum + 1 && c.lastLapMs > 0) this.finish(c.lastLapMs);
      this.lapNum = c.lapNum; this.enter = new Array(SEGMENTS).fill(null); this.enter[0] = 0; this.lastSeg = 0;
      return true;
    }
    if (!(c.lapDistance >= 0)) return false;
    const seg = Math.min(SEGMENTS - 1, Math.floor(c.lapDistance / segLen));
    if (seg > this.lastSeg) {
      for (let k = this.lastSeg + 1; k <= seg; k++) this.enter[k] = c.currentLapMs;
      this.lastSeg = seg;
    }
    return false;
  }
  finish(lapMs) {
    if (this.enter.some((v) => v === null)) { this.lastLap = null; return; }
    const segs = this.enter.map((v, k) => (k < SEGMENTS - 1 ? this.enter[k + 1] - v : lapMs - v));
    if (segs.some((v) => v <= 0)) { this.lastLap = null; return; }
    this.lastLap = { ms: lapMs, segs };
    if (!this.bestMs || lapMs < this.bestMs) { this.bestMs = lapMs; this.bestLap = this.lastLap; }
  }
}

// ---------------------------------------------------------------------------
// F1 25
// ---------------------------------------------------------------------------
class F1Engineer {
  constructor(race) {
    this.race = race;
    this.reset();
  }

  now() { return (this.race.t || 0) * 1000; }

  reset() {
    this.calls = new Calls(() => this.now());
    this.splits = {};             // car -> Splits
    this.mine = this.blankLapInfo();
    this.myLast = null; this.myBest = null; this.myBestMs = 0;
    this.lastLapNum = null;
    this.prevPos = null; this.posSince = 0; this.posStable = null;
    this.prevGapAhead = null; this.prevGapBehind = null; this.lineGaps = null;
    this.prevPit = {}; this.pitExits = [];
    this.weather = null; this.rainKey = null;
    this.lastLoss = null; this.segLoss = null;
    this.button = 0;
    this.started = false;
    this.leave = null; this.leaveSaidAt = 0; this.leaveState = null;
    this.wearBucket = 0;
    this.boxPlan = null;
    this.flagAt = {};
    this.adviceSeen = {};
  }

  blankLapInfo() { return { lock: new Array(SEGMENTS).fill(0), spin: new Array(SEGMENTS).fill(0), minSpeed: new Array(SEGMENTS).fill(999) }; }

  get segLen() { return (this.race.session.trackLength || 5000) / SEGMENTS; }
  name(i) { return this.race.name(i); }
  get me() { return this.race.player; }
  get isRace() { const t = this.race.session.sessionType; return t >= 15 && t <= 17; }
  get isQuali() { const t = this.race.session.sessionType; return t >= 5 && t <= 14; }
  sectorOf(dist) {
    const s = this.race.session;
    if (s.sector3Start && dist >= s.sector3Start) return 3;
    if (s.sector2Start && dist >= s.sector2Start) return 2;
    return 1;
  }

  // ---------------- per packet hooks ----------------
  onSession(m) {
    const s = this.race.session;
    if (!this.started && s.sessionType) {
      this.started = true;
      const type = this.isRace ? 'race' : this.isQuali ? 'qualifying' : s.sessionType === 18 ? 'time trial' : 'practice';
      this.calls.say('session', { type, laps: this.isRace ? s.totalLaps : null, weather: WEATHER[s.weather], trackTemp: s.trackTemp },
        `Radio check. ${type[0].toUpperCase()}${type.slice(1)}${this.isRace && s.totalLaps ? `, ${s.totalLaps} laps` : ''}. ${WEATHER[s.weather] ? `It's ${WEATHER[s.weather]}, track ${s.trackTemp}°C.` : ''}`, { priority: 'normal' });
    }
    // Weather now
    if (this.weather !== null && m.weather !== undefined && m.weather !== this.weather) {
      const wetter = m.weather > this.weather;
      this.calls.say('weather-now', { from: WEATHER[this.weather], to: WEATHER[m.weather], wetter }, `Weather change: now ${WEATHER[m.weather]}.${m.weather >= 3 && wetter ? ' Grip is going away, be careful.' : ''}`, { priority: m.weather >= 3 ? 'high' : 'normal', cooldownS: 30 });
    }
    if (m.weather !== undefined) this.weather = m.weather;
    // Rain in the forecast for this session
    const next = (m.forecast || []).filter((f) => f.sessionType === s.sessionType && f.minutes > 0 && f.minutes <= 15).sort((a, b) => a.minutes - b.minutes);
    const rain = next.find((f) => f.rain >= 40 || f.weather >= 3);
    const key = rain ? `${Math.round(rain.rain / 20)}-${rain.minutes <= 5 ? 'near' : 'far'}` : 'none';
    if (rain && key !== this.rainKey) {
      const onSlicks = [16, 17, 18].includes(this.race.status[this.me]?.visual);
      const askInters = this.isRace && onSlicks && rain.minutes <= 5 && rain.weather >= 3;
      this.calls.say('rain-coming', { minutes: rain.minutes, rain: rain.rain, heavy: rain.weather >= 4 },
        `Rain ${rain.rain}% likely in ${mins(rain.minutes)}.${askInters ? ' Do you want to box for Inters when it starts?' : ''}`,
        { priority: 'high', cooldownS: 60, ask: askInters ? 'box-inters' : null });
    }
    if (!rain && this.rainKey && this.rainKey !== 'none') this.calls.say('rain-clear', {}, 'Rain risk has dropped off the forecast.', { priority: 'low', cooldownS: 120 });
    this.rainKey = key;
  }

  onLap() {
    const r = this.race;
    const me = this.me;
    const len = r.session.trackLength;
    if (!len) return;
    // Mini-sectors for every car; pit exit position learned from cars leaving the pits.
    r.lap.forEach((c, i) => {
      if (!c || !c.position || c.resultStatus > 2) return;
      if (!this.splits[i]) this.splits[i] = new Splits();
      this.splits[i].update(c, this.segLen);
      const wasPit = this.prevPit[i];
      if (wasPit > 0 && c.pitStatus === 0 && c.lapDistance > 0 && c.lapDistance < len / 3) {
        this.pitExits.push(c.lapDistance);
        if (this.pitExits.length > 15) this.pitExits.shift();
      }
      this.prevPit[i] = c.pitStatus;
    });
    const c = r.lap[me];
    if (!c || !c.lapNum) return;

    // Lap completed
    if (this.lastLapNum !== null && c.lapNum === this.lastLapNum + 1) this.lapDone(c);
    this.lastLapNum = c.lapNum;

    if (this.isRace) this.raceCalls(c);
    else if (this.isQuali || r.session.sessionType <= 4) this.qualiCalls(c);
    this.carCalls();
  }

  // Player's telemetry per mini-sector, for "how to fix it".
  onSample(lockF, spin, speedKmh) {
    const c = this.race.lap[this.me];
    if (!c || !(c.lapDistance >= 0)) return;
    const k = Math.min(SEGMENTS - 1, Math.floor(c.lapDistance / this.segLen));
    if (lockF) this.mine.lock[k]++;
    if (spin) this.mine.spin[k]++;
    this.mine.minSpeed[k] = Math.min(this.mine.minSpeed[k], speedKmh);
  }

  onEvent(m) {
    const me = this.me;
    if (m.code === 'BUTN') {
      const pressed = m.buttons & ~this.button;
      this.button = m.buttons;
      for (const [n, topic] of Object.entries(UDP_ACTIONS)) if (pressed & udpBit(Number(n))) this.ask(topic);
      return;
    }
    if (m.code === 'SCAR') {
      const type = SC_NAME[m.safetyCarType] || 'Safety car';
      if (m.eventType === 0) {
        const c = this.race.lap[me] || {};
        const s = this.race.session;
        const lapsLeft = s.totalLaps ? s.totalLaps - c.lapNum + 1 : null;
        const canGain = this.isRace && (c.pitStops || 0) === 0 && lapsLeft > 3 && s.totalLaps >= 5;
        this.calls.say('sc', { type, deployed: true }, `${type} deployed.${canGain ? ' A stop is cheap right now. Box this lap?' : ' Keep it tidy, watch your delta.'}`, { priority: 'high', ask: canGain ? 'box-sc' : null });
      } else if (m.eventType === 1) this.calls.say('sc', { type, ending: true }, `${type} ending. Get the tyres warm, restart coming.`, { priority: 'high' });
    } else if (m.code === 'FTLP') {
      if (m.car === me) this.calls.say('fastest-lap', { me: true, ms: m.lapTime * 1000 }, `Fastest lap of the race, ${lapTime(m.lapTime * 1000)}. Beautiful.`, { priority: 'normal' });
      else this.calls.say('fastest-lap', { me: false, name: this.name(m.car), ms: m.lapTime * 1000 }, `Fastest lap for ${this.name(m.car)}, ${lapTime(m.lapTime * 1000)}.`, { priority: 'low', cooldownS: 30 });
    } else if (m.code === 'PENA' && m.car === me) {
      this.calls.say('penalty', { seconds: m.time < 255 ? m.time : null, type: m.penaltyType }, m.time > 0 && m.time < 255 ? `You've got a ${m.time} second penalty.` : 'Penalty given. Check the screen.', { priority: 'high' });
    } else if (m.code === 'CHQF') {
      const c = this.race.lap[me] || {};
      this.calls.say('finish', { pos: c.position }, `Chequered flag. P${c.position}. ${c.position <= 3 ? 'What a drive.' : 'Good job, bring it home.'}`, { priority: 'high' });
    }
  }

  // ---------------- lap complete ----------------
  lapDone(c) {
    const me = this.me;
    const sp = this.splits[me];
    const ms = c.lastLapMs;
    const info = this.mine;
    this.mine = this.blankLapInfo();
    if (!ms || !sp?.lastLap) return;
    const invalid = this.race.lastLapInvalid;
    // Remember my best lap and its per-sector detail.
    const myLap = { ms, segs: sp.lastLap.segs, info };
    const prevBest = this.myBest;
    if (!invalid && (!this.myBestMs || ms < this.myBestMs)) { this.myBest = myLap; this.myBestMs = ms; }

    // Reference: qualifying = the fastest lap anyone has done; race = the car ahead's last lap.
    let ref = null, refName = null;
    if (this.isRace) {
      const ahead = this.race.lap.findIndex((x) => x && x.position === c.position - 1);
      const a = this.splits[ahead];
      if (ahead >= 0 && a?.lastLap) { ref = a.lastLap.segs; refName = this.name(ahead); }
    } else {
      let best = null;
      for (const [i, s] of Object.entries(this.splits)) if (Number(i) !== me && s.bestLap && (!best || s.bestMs < best.ms)) best = { ms: s.bestMs, segs: s.bestLap.segs, i: Number(i) };
      if (best && best.ms < ms) { ref = best.segs; refName = this.name(best.i); }
    }
    if (!ref && prevBest && prevBest.ms < ms) { ref = prevBest.segs; refName = 'your best lap'; }

    if (!this.isRace) {
      const delta = prevBest ? ms - prevBest.ms : null;
      this.calls.say('lap-done', { ms, delta, invalid, pos: c.position }, `${invalid ? 'Lap deleted, track limits. ' : ''}${lapTime(ms)}${delta !== null && !invalid ? `, ${delta < 0 ? 'personal best by' : 'plus'} ${sec(Math.abs(delta), 3)}` : ''}. P${c.position}.`, { priority: 'normal' });
    }
    if (ref) {
      const loss = myLap.segs.map((v, k) => v - ref[k]);
      this.segLoss = loss.map((v) => Math.round(v));
      let worst = 0;
      loss.forEach((v, k) => { if (v > loss[worst]) worst = k; });
      if (loss[worst] >= 120) {
        const from = worst * this.segLen, to = from + this.segLen;
        const fix = this.fixFor(worst, info);
        const data = { seg: worst, fromKm: from / 1000, toKm: to / 1000, sector: this.sectorOf(from), lossMs: loss[worst], ref: refName, fix: fix.kind };
        const same = this.lastLoss && this.lastLoss.seg === worst && this.lastLoss.fix === data.fix;
        this.lossRepeat = same ? (this.lossRepeat || 0) + 1 : 0;
        this.lastLoss = data;
        // Same spot, same problem: mention it every third lap rather than every lap.
        if (this.lossRepeat % 3 === 0) this.calls.say('losing-time', data, `Most time lost in sector ${data.sector}, ${data.fromKm.toFixed(1)} to ${data.toKm.toFixed(1)} km: ${sec(data.lossMs, 2)} slower than ${refName} there. ${fix.text}`, { priority: 'normal' });
      }
    }
  }

  fixFor(k, info) {
    const best = this.myBest?.info;
    if (info.lock[k] >= 3) return { kind: 'lockup', text: 'You locked the fronts in there. Brake a touch earlier and ease off the pedal as you turn in.' };
    if (info.spin[k] >= 3) return { kind: 'traction', text: 'Wheelspin on the exit. Be more patient with the throttle and short-shift.' };
    if (best && info.minSpeed[k] < 900 && best.minSpeed[k] < 900 && info.minSpeed[k] < best.minSpeed[k] - 6) {
      return { kind: 'apex', text: `Minimum speed was ${Math.round(best.minSpeed[k] - info.minSpeed[k])} km/h down on your best. Brake a little lighter and carry more speed to the apex.` };
    }
    return { kind: 'line', text: 'Try braking a fraction later and get on the power earlier on the exit.' };
  }

  // ---------------- race ----------------
  raceCalls(c) {
    const r = this.race;
    const s = r.session;
    const me = this.me;
    const lapsLeft = s.totalLaps ? s.totalLaps - c.lapNum + 1 : null;
    const behindIdx = r.lap.findIndex((x) => x && x.position === c.position + 1 && x.resultStatus === 2);
    const aheadIdx = r.lap.findIndex((x) => x && x.position === c.position - 1);
    const gapAhead = c.position > 1 ? c.gapAheadMs : null;
    const gapBehind = behindIdx >= 0 ? r.lap[behindIdx].gapAheadMs : null;

    // Splits once per lap as you cross the line.
    if (this.lineLap !== c.lapNum && c.lapDistance > 0 && c.lapDistance < 400 && c.lapNum > 1) {
      this.lineLap = c.lapNum;
      const prev = this.lineGaps;
      const data = {
        pos: c.position, lapsLeft,
        ahead: aheadIdx >= 0 ? { name: this.name(aheadIdx), gapMs: gapAhead, changeMs: prev?.ahead === this.name(aheadIdx) && prev.gapAhead !== null ? gapAhead - prev.gapAhead : null } : null,
        behind: behindIdx >= 0 ? { name: this.name(behindIdx), gapMs: gapBehind, changeMs: prev?.behind === this.name(behindIdx) && prev.gapBehind !== null ? gapBehind - prev.gapBehind : null } : null,
      };
      this.lineGaps = { ahead: data.ahead?.name, gapAhead, behind: data.behind?.name, gapBehind };
      this.calls.say('splits', data, splitsText(data), { priority: 'normal' });
      if (lapsLeft === 1) this.calls.say('final-lap', { pos: c.position }, `Final lap. P${c.position}. Bring it home clean.`, { priority: 'high' });
      // Pit window from the game's strategy.
      if (s.pitIdealLap > 0 && (c.pitStops || 0) === 0) {
        if (c.lapNum === s.pitIdealLap - 2) this.calls.say('pit-soon', { lap: s.pitIdealLap, rejoin: s.pitRejoinPosition }, `Pit window opens in two laps. Plan is lap ${s.pitIdealLap}.`, { priority: 'normal' });
        if (c.lapNum === s.pitIdealLap) this.calls.say('box-ask', { lap: s.pitIdealLap, rejoin: s.pitRejoinPosition, tyre: this.bestSet()?.name }, `This is the lap. Box, box?${s.pitRejoinPosition ? ` You'd rejoin around P${s.pitRejoinPosition}.` : ''}`, { priority: 'high', ask: 'box-window' });
      }
      if (this.boxPlan && this.boxPlan.lap === c.lapNum) this.calls.say('box-now', { tyre: this.boxPlan.tyre }, `Box this lap, box this lap.${this.boxPlan.tyre ? ` ${this.boxPlan.tyre}s are ready.` : ''}`, { priority: 'high', cooldownS: 20 });
    }

    // DRS / defend alerts.
    if (gapAhead !== null && this.prevGapAhead !== null && gapAhead < 1000 && this.prevGapAhead >= 1000 && aheadIdx >= 0) {
      this.calls.say('attack', { name: this.name(aheadIdx), gapMs: gapAhead, era: r.format >= 2026 ? 2026 : 2025 }, `Within a second of ${this.name(aheadIdx)}. ${r.format >= 2026 ? 'Overtake mode is yours next lap.' : 'DRS range.'} Go get him.`, { priority: 'normal', cooldownS: 25, key: `attack-${aheadIdx}` });
    }
    if (gapBehind !== null && this.prevGapBehind !== null && gapBehind < 1000 && this.prevGapBehind >= 1000 && behindIdx >= 0) {
      this.calls.say('defend', { name: this.name(behindIdx), gapMs: gapBehind }, `${this.name(behindIdx)} is within a second behind. Defend into the braking zones.`, { priority: 'normal', cooldownS: 25, key: `defend-${behindIdx}` });
    }
    this.prevGapAhead = gapAhead; this.prevGapBehind = gapBehind;

    // Position changes (after 3 seconds stable, so swaps in a corner don't spam).
    const now = this.now();
    if (c.position !== this.posStable) {
      if (this.prevPos !== c.position) { this.prevPos = c.position; this.posSince = now; }
      else if (now - this.posSince > 3000) {
        if (this.posStable !== null && c.pitStatus === 0) {
          const gained = c.position < this.posStable;
          const other = gained ? r.lap.findIndex((x) => x && x.position === c.position + 1) : r.lap.findIndex((x) => x && x.position === c.position - 1);
          this.calls.say(gained ? 'pos-gain' : 'pos-lost', { pos: c.position, name: other >= 0 ? this.name(other) : null }, gained ? `P${c.position}. Nice move${other >= 0 ? ` on ${this.name(other)}` : ''}.` : `Lost one to ${other >= 0 ? this.name(other) : 'the car behind'}. P${c.position}. Stay with him.`, { priority: 'normal', cooldownS: 5 });
        }
        this.posStable = c.position;
      }
    }
  }

  bestSet() {
    const s = this.race.tyreSets;
    if (!s) return null;
    const lapsLeft = this.race.session.totalLaps ? this.race.session.totalLaps - (this.race.lap[this.me]?.lapNum || 0) : 0;
    const names = { 16: 'Soft', 17: 'Medium', 18: 'Hard', 7: 'Inter', 8: 'Wet' };
    const sets = s.sets.filter((x) => x.available && !x.fitted && names[x.visual] && x.visual >= 16);
    const reach = sets.filter((x) => x.usableLife >= lapsLeft).sort((a, b) => a.lapDeltaMs - b.lapDeltaMs || a.wear - b.wear);
    const pick = reach[0] || sets.sort((a, b) => b.usableLife - a.usableLife)[0];
    return pick ? { name: names[pick.visual], life: pick.usableLife, reachesEnd: pick.usableLife >= lapsLeft } : null;
  }

  // ---------------- qualifying and practice: when to leave the garage ----------------
  qualiCalls(c) {
    const r = this.race;
    const s = r.session;
    const len = s.trackLength;
    if (c.driverStatus !== 0) { this.leaveState = null; return; } // only while sitting in the garage
    const now = this.now();
    if (now - (this.leaveCalcAt || 0) < 1000) return;
    this.leaveCalcAt = now;
    const pitExit = this.pitExits.length ? [...this.pitExits].sort((a, b) => a - b)[Math.floor(this.pitExits.length / 2)] : len * 0.06;
    const myBest = this.myBestMs || r.history[this.me]?.bestLapMs || 0;
    const fieldBest = Object.values(r.history).map((h) => h.bestLapMs).filter((v) => v > 0).sort((a, b) => a - b)[0] || 0;
    const lapS = (myBest || fieldBest || len / 52 * 1000) / 1000;
    // When will each car on track pass the pit exit?
    const arrivals = [];
    r.lap.forEach((o, i) => {
      if (i === this.me || !o || o.resultStatus !== 2 || o.pitStatus !== 0 || ![1, 3, 4].includes(o.driverStatus) || !(o.lapDistance >= 0)) return;
      const v = (len / lapS) * (o.driverStatus === 3 ? 0.75 : 1); // out laps are slower
      const d = (pitExit - o.lapDistance + len) % len;
      arrivals.push({ t: d / v, i, flying: o.driverStatus === 1 });
    });
    // Earliest moment you'd reach pit exit with no car within 3 s either side.
    let wait = null;
    for (let w = 0; w <= 90; w++) {
      const at = PIT_EXIT_S + w;
      if (!arrivals.some((a) => Math.abs(a.t - at) < 3)) { wait = w; break; }
    }
    const blocker = wait ? arrivals.filter((a) => Math.abs(a.t - PIT_EXIT_S) < 3).sort((a, b) => a.t - b.t)[0] : null;
    // Latest time to leave and still start a final flying lap.
    const need = PIT_EXIT_S + lapS * OUTLAP_FACTOR * (1 - pitExit / len) + 5;
    const timeLeft = s.timeLeft ?? null;
    this.leave = { waitS: wait, blocker: blocker ? this.name(blocker.i) : null, blockerFlying: blocker?.flying || false, leaveByS: timeLeft !== null ? Math.round(timeLeft - need) : null, cars: arrivals.length };

    if (timeLeft !== null && this.leave.leaveByS !== null && this.leave.leaveByS <= 90 && this.leave.leaveByS > 0) {
      this.calls.say('leave-by', { seconds: this.leave.leaveByS }, `${this.leave.leaveByS} seconds to leave the garage if you want one more lap.`, { priority: 'high', cooldownS: 30 });
    }
    const state = wait === null ? 'busy' : wait <= 2 ? 'go' : 'wait';
    // Once told to go, give the driver 12 s to leave before changing the call; short waits aren't worth a call.
    const holdGo = this.leaveState === 'go' && now - this.leaveSaidAt < 12000;
    if (!holdGo && !(state === 'wait' && wait < 6) && (state !== this.leaveState || now - this.leaveSaidAt > 30000)) {
      this.leaveState = state; this.leaveSaidAt = now;
      if (state === 'go') this.calls.say('leave-go', { cars: arrivals.length }, arrivals.length ? 'Gap in the traffic at pit exit. Go now, go now.' : 'Track is clear. You can go whenever you like.', { priority: 'high', cooldownS: 10 });
      else if (state === 'wait') this.calls.say('leave-wait', { seconds: wait, blocker: this.leave.blocker, flying: this.leave.blockerFlying }, `Hold for about ${wait} seconds${this.leave.blocker ? `, ${this.leave.blocker} is coming through${this.leave.blockerFlying ? ' on a flying lap' : ''}` : ''}. I'll tell you when.`, { priority: 'normal', cooldownS: 10 });
    }
  }

  // ---------------- car state: flags, fuel, tyres, wheel changes ----------------
  carCalls() {
    const r = this.race;
    const st = r.status[this.me] || {};
    const now = this.now();
    if (st.flag === 2 && now - (this.flagAt.blue || 0) > 15000) { this.flagAt.blue = now; this.calls.say('blue-flag', {}, 'Blue flag, let the leader through.', { priority: 'high' }); }
    if (st.flag === 3 && now - (this.flagAt.yellow || 0) > 20000) { this.flagAt.yellow = now; this.calls.say('yellow-flag', {}, 'Yellow flag ahead. Careful, no overtaking.', { priority: 'high' }); }
    if (this.isRace && Number.isFinite(st.fuelLaps) && st.fuelLaps < -0.3) this.calls.say('fuel-short', { laps: st.fuelLaps }, `Fuel is ${Math.abs(st.fuelLaps).toFixed(1)} laps short. Lift and coast into the big stops.`, { priority: 'high', cooldownS: 90 });
    const wear = r.wear ? Math.max(...r.wear) : 0;
    const bucket = Math.floor(wear / 10);
    if (bucket >= 6 && bucket > this.wearBucket) { this.wearBucket = bucket; this.calls.say('tyre-wear', { wear: Math.round(wear) }, `Tyres at ${Math.round(wear)}% wear. Grip will start dropping.`, { priority: 'normal' }); }
    // On-track changes you can make from the wheel.
    const adj = r.adjustments(this.isRace);
    if (adj.mode !== 'track') return;
    for (const a of adj.items || []) {
      // One change at a time, with a few seconds between them. Say each once; say it again only
      // if you changed that setting and the problem is still there, or once more after 5 minutes.
      const kind = a.title.split(' ')[0];
      const value = kind === 'Brake' ? adj.bias : kind === 'On-throttle' ? adj.diffOn : null;
      const seen = this.adviceSeen[kind];
      const due = !seen || (value !== null && value !== seen.value && now - seen.at > 30000) || (!seen.repeated && now - seen.at > 300000);
      if (due && now - (this.lastAdjustAt || 0) > 8000) {
        if (this.calls.say('adjust', { title: a.title, why: a.text }, `${a.title}. ${a.text}`, { priority: 'normal', key: `adjust-${kind}` })) {
          this.adviceSeen[kind] = { at: now, value, repeated: !!seen && value === seen.value };
          this.lastAdjustAt = now;
        }
      }
    }
  }

  // ---------------- questions from you ----------------
  ask(topic) {
    const r = this.race;
    const s = r.session;
    const c = r.lap[this.me] || {};
    const pend = this.calls.pending;
    if (topic === 'yes' || topic === 'no') {
      if (!pend || this.now() - pend.at > 120000) return this.calls.say('answer', { topic }, "Copy. Nothing's waiting on an answer.", { priority: 'high', key: `ans-${this.now()}` });
      this.calls.pending = null;
      const yes = topic === 'yes';
      if (pend.ask === 'box-inters') {
        if (yes) this.boxPlan = { lap: c.lapNum + 1, tyre: 'Inter' };
        return this.calls.say('answer', { topic, ask: pend.ask, yes }, yes ? "Copy, we'll box for Inters at the end of this lap. I'll call it." : "Copy, staying out on slicks. I'll keep watching the rain.", { priority: 'high', key: `ans-${this.now()}` });
      }
      if (pend.ask === 'box-sc' || pend.ask === 'box-window') {
        const set = this.bestSet();
        if (yes) { this.calls.say('box-now', { tyre: set?.name }, `Box this lap, box this lap.${set ? ` ${set.name}s, good for ${set.life} laps.` : ''}`, { priority: 'high', key: `box-${this.now()}` }); return null; }
        return this.calls.say('answer', { topic, ask: pend.ask, yes }, "Copy, staying out. Push now, overcut is on.", { priority: 'high', key: `ans-${this.now()}` });
      }
      return null;
    }
    if (topic === 'repeat') return this.calls.repeat();
    if (topic === 'gaps') {
      if (this.isRace && c.position) {
        const aheadIdx = r.lap.findIndex((x) => x && x.position === c.position - 1);
        const behindIdx = r.lap.findIndex((x) => x && x.position === c.position + 1 && x.resultStatus === 2);
        const data = { pos: c.position, lapsLeft: s.totalLaps ? s.totalLaps - c.lapNum + 1 : null, ahead: aheadIdx >= 0 ? { name: this.name(aheadIdx), gapMs: c.gapAheadMs, changeMs: null } : null, behind: behindIdx >= 0 ? { name: this.name(behindIdx), gapMs: r.lap[behindIdx].gapAheadMs, changeMs: null } : null };
        return this.calls.say('splits', data, splitsText(data), { priority: 'high', key: `ans-${this.now()}` });
      }
      const best = Object.entries(r.history).map(([i, h]) => ({ i: Number(i), ms: h.bestLapMs })).filter((x) => x.ms > 0).sort((a, b) => a.ms - b.ms);
      const mine = best.find((x) => x.i === this.me);
      const pole = best[0];
      return this.calls.say('answer', { topic, pos: c.position, gapToPole: mine && pole ? mine.ms - pole.ms : null, pole: pole ? this.name(pole.i) : null },
        mine && pole ? (pole.i === this.me ? `You're P1. Top of the times.` : `P${c.position}, ${sec(mine.ms - pole.ms, 3)} off ${this.name(pole.i)} at the top.`) : 'No timed lap from you yet.', { priority: 'high', key: `ans-${this.now()}` });
    }
    if (topic === 'pit') {
      if (!this.isRace) {
        const l = this.leave;
        const text = c.driverStatus !== 0 ? 'You\'re out on track. Ask me again from the garage and I\'ll find you a gap.' : !l ? 'Give me a second to read the traffic.' : l.waitS !== null && l.waitS <= 2 ? 'Gap at pit exit right now. Go.' : l.waitS === null ? 'Pit exit is busy for the next minute and a half. Sit tight.' : `Leave in about ${l.waitS} seconds for clean air.`;
        return this.calls.say('answer', { topic, leave: l }, `${text}${l?.leaveByS !== null && l?.leaveByS !== undefined && l.leaveByS < 300 ? ` You need to leave within ${Math.max(0, l.leaveByS)} seconds for a final lap.` : ''}`, { priority: 'high', key: `ans-${this.now()}` });
      }
      const set = this.bestSet();
      const text = (c.pitStops || 0) > 0 && !s.pitIdealLap ? `You've stopped${set ? `; if we need another, ${set.name}s are best` : ''}.`
        : s.pitIdealLap ? `Plan is lap ${s.pitIdealLap}${s.pitLatestLap ? `, latest ${s.pitLatestLap}` : ''}.${s.pitRejoinPosition ? ` Box now and you'd rejoin about P${s.pitRejoinPosition}.` : ''}${set ? ` ${set.name}s next${set.reachesEnd ? ', they go to the end' : ''}.` : ''}`
          : 'No stop planned yet.';
      return this.calls.say('answer', { topic }, text, { priority: 'high', key: `ans-${this.now()}` });
    }
    if (topic === 'time') {
      const l = this.lastLoss;
      return this.calls.say(l ? 'losing-time' : 'answer', l || { topic }, l ? `Last lap, most time went in sector ${l.sector}, ${l.fromKm.toFixed(1)} to ${l.toKm.toFixed(1)} km: ${sec(l.lossMs, 2)} slower than ${l.ref} there. ${this.fixFor(l.seg, this.myBest?.info || this.blankLapInfo()).text}` : 'Need a full lap first to compare.', { priority: 'high', key: `ans-${this.now()}` });
    }
    if (topic === 'weather') {
      const next = (s.forecast || []).filter((f) => f.sessionType === s.sessionType && f.minutes > 0).sort((a, b) => a.minutes - b.minutes).slice(0, 3);
      const fc = next.map((f) => `in ${mins(f.minutes)}, ${WEATHER[f.weather]}, ${f.rain}% rain`).join('; ');
      return this.calls.say('answer', { topic }, `It's ${WEATHER[s.weather] || 'unknown'}, track ${s.trackTemp}°C, air ${s.airTemp}°C.${fc ? ` Forecast: ${fc}.` : ''}`, { priority: 'high', key: `ans-${this.now()}` });
    }
    if (topic === 'tyres') {
      const st = r.status[this.me] || {};
      const names = { 16: 'Softs', 17: 'Mediums', 18: 'Hards', 7: 'Inters', 8: 'Wets' };
      const wear = r.wear ? Math.round(Math.max(...r.wear)) : null;
      const ers = Number.isFinite(st.ersStore) && r.format < 2026 ? Math.round((st.ersStore / 4e6) * 100) : null;
      return this.calls.say('answer', { topic }, `${names[st.visual] || 'Tyres'}, ${st.tyreAge ?? 0} laps old${wear !== null ? `, ${wear}% worn` : ''}.${Number.isFinite(st.fuelLaps) ? ` Fuel ${st.fuelLaps >= 0 ? 'plus' : 'minus'} ${Math.abs(st.fuelLaps).toFixed(1)} laps.` : ''}${ers !== null ? ` Battery ${ers}%.` : ''}`, { priority: 'high', key: `ans-${this.now()}` });
    }
    return null;
  }

  state() {
    const p = this.calls.pending;
    return { calls: this.calls.list.slice(-15), pending: p && this.now() - p.at < 120000 ? { id: p.id, ask: p.ask } : null, segLoss: this.segLoss, segments: SEGMENTS, leave: this.leave, buttons: UDP_ACTIONS };
  }
}

function splitsText(d) {
  const part = (o, who) => {
    if (!o || o.gapMs === null || o.gapMs === undefined) return '';
    const ch = o.changeMs;
    const trend = ch === null || ch === undefined || Math.abs(ch) < 50 ? '' : who === 'ahead'
      ? (ch < 0 ? `, you took ${sec(-ch)} off him` : `, he pulled ${sec(ch)}`)
      : (ch < 0 ? `, closing ${sec(-ch)}` : `, dropping back ${sec(ch)}`);
    return who === 'ahead' ? ` ${o.name} ${sec(o.gapMs)} ahead${trend}.` : ` ${o.name} ${sec(o.gapMs)} behind${trend}.`;
  };
  return `P${d.pos}${d.lapsLeft ? `, ${d.lapsLeft} to go` : ''}.${part(d.ahead, 'ahead')}${part(d.behind, 'behind')}`;
}

// ---------------------------------------------------------------------------
// Forza Motorsport: your car only.
// ---------------------------------------------------------------------------
class ForzaEngineer {
  constructor(race) { this.race = race; this.reset(); }
  now() { return this.race.p?.timestampMs || 0; }
  reset() { this.calls = new Calls(() => this.now()); this.lastPos = null; this.posSince = 0; this.prevPos = null; this.lastLoss = null; this.segLoss = null; this.fuelSaid = false; this.wearBucket = 0; this.finalSaid = false; this.started = false; }

  onPacket(p) {
    if (!this.started && p.isRaceOn) { this.started = true; this.calls.say('session', {}, "Radio check. I can hear you. Forza only sends me your car, so I'll keep you posted on your laps, fuel and tyres.", { priority: 'normal' }); }
    const now = this.now();
    if (p.isRaceOn && p.position) {
      if (p.position !== this.prevPos) { this.prevPos = p.position; this.posSince = now; }
      else if (p.position !== this.lastPos && now - this.posSince > 3000) {
        if (this.lastPos !== null) {
          const gained = p.position < this.lastPos;
          this.calls.say(gained ? 'pos-gain' : 'pos-lost', { pos: p.position }, gained ? `P${p.position}. Nice move.` : `Dropped to P${p.position}. Stay with him.`, { priority: 'normal', cooldownS: 5 });
        }
        this.lastPos = p.position;
      }
    }
  }

  onLapDone(lapS, bestS, segs, bestSegs, lap, totalLaps) {
    const delta = bestS && bestS !== lapS ? lapS - bestS : null;
    this.calls.say('lap-done', { ms: lapS * 1000, delta: delta !== null ? delta * 1000 : null }, `${sec(lapS * 1000, 3)}${delta !== null ? `, plus ${sec(delta * 1000, 3)} to your best` : ', your best so far'}.`, { priority: 'normal' });
    if (segs && bestSegs && delta !== null && delta > 0) {
      const loss = segs.map((v, k) => (v - bestSegs[k]) * 1000);
      this.segLoss = loss.map((v) => Math.round(v));
      let worst = 0;
      loss.forEach((v, k) => { if (v > loss[worst]) worst = k; });
      if (loss[worst] >= 150) {
        const n = segs.length;
        const data = { seg: worst, part: worst < n / 3 ? 'first third' : worst < (2 * n) / 3 ? 'middle third' : 'final third', lossMs: loss[worst], ref: 'your best lap' };
        this.lastLoss = data;
        this.calls.say('losing-time', data, `Most time lost in the ${data.part} of the lap: ${sec(data.lossMs, 2)} to your best. Brake a fraction later there and get on the power sooner.`, { priority: 'normal', cooldownS: 45 });
      }
    }
    if (totalLaps && lap === totalLaps && !this.finalSaid) { this.finalSaid = true; this.calls.say('final-lap', {}, 'Final lap. Bring it home clean.', { priority: 'high' }); }
  }

  onEstimates(pit) {
    for (const it of pit.items || []) {
      if (it.level === 'now' || it.level === 'soon') this.calls.say('pit-estimate', { title: it.title }, `${it.title}. ${it.text}`, { priority: it.level === 'now' ? 'high' : 'normal', cooldownS: 120, key: `est-${it.title.split(' ')[0]}` });
    }
  }

  ask(topic) {
    const s = this.race.state();
    const key = `ans-${this.now()}`;
    if (topic === 'repeat') return this.calls.repeat();
    if (topic === 'yes' || topic === 'no') return this.calls.say('answer', { topic }, 'Copy.', { priority: 'high', key });
    if (topic === 'gaps') return this.calls.say('answer', { topic }, `P${s.session?.position ?? '–'}. Forza doesn't send me the other cars, so no gaps, sorry.`, { priority: 'high', key });
    if (topic === 'pit' || topic === 'tyres') {
      const items = (s.pit?.items || []).map((i) => i.title).join('. ');
      return this.calls.say('answer', { topic }, items ? `${items}.` : 'Need a full lap to work out fuel and tyres.', { priority: 'high', key });
    }
    if (topic === 'time') {
      const l = this.lastLoss;
      return this.calls.say(l ? 'losing-time' : 'answer', l || { topic }, l ? `Last lap you lost ${sec(l.lossMs, 2)} in the ${l.part} compared with your best.` : 'Nothing to compare yet. I need a lap slower than your best.', { priority: 'high', key });
    }
    if (topic === 'weather') return this.calls.say('answer', { topic }, "Forza doesn't send me the weather. Trust your eyes.", { priority: 'high', key });
    return null;
  }

  state() { return { calls: this.calls.list.slice(-15), pending: null, segLoss: this.segLoss, segments: this.segLoss ? this.segLoss.length : 0, buttons: null }; }
}

module.exports = { F1Engineer, ForzaEngineer, UDP_ACTIONS, SEGMENTS, splitsText };
