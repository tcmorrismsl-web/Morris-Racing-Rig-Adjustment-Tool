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
const CLEAR_S = 3;            // a clean exit: no car within this many seconds of you at pit exit
const HORIZON_S = 150;        // how far ahead the clean-window list looks
const KEEP = 30;

const sec = (ms, d = 1) => (ms / 1000).toFixed(d);
const lapTime = (ms) => { const m = Math.floor(ms / 60000); const s = (ms % 60000) / 1000; return m ? `${m}:${s.toFixed(3).padStart(6, '0')}` : s.toFixed(3); };
const mins = (n) => `${n} minute${n === 1 ? '' : 's'}`;
const SC_NAME = ['', 'Safety car', 'Virtual safety car', 'Formation lap'];
const WEATHER = ['clear', 'light cloud', 'overcast', 'light rain', 'heavy rain', 'a storm'];

// F1 25 button flags: UDP Action 1-12 are bits 20-31. Bind them to wheel buttons in the game.
const UDP_ACTIONS = { 1: 'yes', 2: 'no', 3: 'gaps', 4: 'pit', 5: 'time', 6: 'weather', 7: 'tyres', 8: 'repeat', 9: 'wait' };
const TYRE_NAME = { 16: 'Soft', 17: 'Medium', 18: 'Hard', 7: 'Inter', 8: 'Wet' };
const udpBit = (n) => 2 ** (19 + n);

// Cooldowns run on the game's clock, so pausing the game pauses the engineer too.
class Calls {
  constructor(clock) { this.clock = clock; this.list = []; this.seq = 0; this.last = {}; this.pending = null; }
  // ttlS: how long the call stays worth saying. The dashboard drops it if it can't be said in time.
  say(kind, data, text, { priority = 'normal', cooldownS = 0, key = kind, ask = null, ttlS = null } = {}) {
    const now = this.clock();
    if (cooldownS && this.last[key] && now - this.last[key] < cooldownS * 1000) return null;
    this.last[key] = now;
    const call = { id: ++this.seq, at: Date.now(), t: now, kind, priority, data, text };
    if (ttlS) call.ttlS = ttlS;
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
  // bounds: start distance of each zone (corner zones, or equal parts when the track isn't known)
  constructor(bounds) { this.bounds = bounds; this.n = bounds.length; this.enter = new Array(this.n).fill(null); this.lapNum = null; this.lastSeg = -1; this.lastLap = null; this.bestLap = null; this.bestMs = 0; }
  zoneOf(d) { let k = 0; while (k + 1 < this.n && d >= this.bounds[k + 1]) k++; return k; }
  update(c) {
    if (c.lapNum !== this.lapNum) {
      if (this.lapNum !== null && c.lapNum === this.lapNum + 1 && c.lastLapMs > 0) this.finish(c.lastLapMs);
      this.lapNum = c.lapNum; this.enter = new Array(this.n).fill(null); this.enter[0] = 0; this.lastSeg = 0;
      return true;
    }
    if (!(c.lapDistance >= 0)) return false;
    const seg = this.zoneOf(c.lapDistance);
    if (seg > this.lastSeg) {
      for (let k = this.lastSeg + 1; k <= seg; k++) this.enter[k] = c.currentLapMs;
      this.lastSeg = seg;
    }
    return false;
  }
  finish(lapMs) {
    if (this.enter.some((v) => v === null)) { this.lastLap = null; return; }
    const segs = this.enter.map((v, k) => (k < this.n - 1 ? this.enter[k + 1] - v : lapMs - v));
    if (segs.some((v) => v <= 0)) { this.lastLap = null; return; }
    this.lastLap = { ms: lapMs, segs };
    if (!this.bestMs || lapMs < this.bestMs) { this.bestMs = lapMs; this.bestLap = this.lastLap; }
  }
}

// Pick one of several wordings, avoiding the ones used most recently.
class Variety {
  constructor() { this.used = {}; }
  pick(key, options) {
    const used = this.used[key] || (this.used[key] = []);
    const idx = options.map((_, i) => i);
    const fresh = idx.filter((i) => !used.includes(i));
    const pool = fresh.length ? fresh : idx;
    const i = pool[Math.floor(Math.random() * pool.length)];
    used.push(i);
    while (used.length > Math.max(1, options.length - 1)) used.shift(); // every wording before any repeats
    const o = options[i];
    return typeof o === 'function' ? o() : o;
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
    this.leave = null; this.garage = null;
    this.briefed = false; this.formationSaid = false; this.lightsOut = false; this.raceSeen = 0; this.pfSaid = false;
    this.wearBucket = 0;
    this.boxPlan = null;
    this.flagAt = {};
    this.adviceSeen = {};
    this.vary = new Variety();
    this.topicLap = {};       // talking point -> lap it was last used
    this.lapNotes = null;     // what the last lap tells us, for the next talking point
    this.coached = [];        // corners recently coached, so advice moves around the lap
    this.secLive = null; this.bestSec = [0, 0, 0];
    this.sayAt = 0;           // last time a non-urgent talking point went out
    this.deferred = null;     // a second talking point for later in the lap
    this.rivalPitAt = {}; this.tmState = null; this.aheadOrder = null; this.aheadOrderAt = 0;
  }

  blankLapInfo() { return { lock: new Array(SEGMENTS).fill(0), spin: new Array(SEGMENTS).fill(0), minSpeed: new Array(SEGMENTS).fill(999) }; }

  get segLen() { return (this.race.session.trackLength || 5000) / SEGMENTS; }
  bounds() {
    const z = this.race.coach?.zones || [];
    if (z.length) return z.map((x) => x.from);
    return Array.from({ length: SEGMENTS }, (_, k) => k * this.segLen);
  }
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
      if (this.isRace) return; // races open with the pre-race briefing instead (see raceStart)
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
    // Before a race start the briefing covers the rain, so no separate call.
    if (rain && key !== this.rainKey && !(this.isRace && !this.briefed)) {
      const onSlicks = [16, 17, 18].includes(this.race.status[this.me]?.visual);
      const askInters = this.isRace && onSlicks && rain.minutes <= 5 && rain.weather >= 3;
      this.calls.say('rain-coming', { minutes: rain.minutes, rain: rain.rain, heavy: rain.weather >= 4 },
        `Rain ${rain.rain}% likely in ${mins(rain.minutes)}.${askInters ? ' Do you want to box for Inters when it starts?' : ''}`,
        { priority: 'high', cooldownS: 60, ask: askInters ? 'box-inters' : null });
    }
    if (!rain && this.rainKey && this.rainKey !== 'none') this.calls.say('rain-clear', {}, 'Rain risk has dropped off the forecast.', { priority: 'low', cooldownS: 120 });
    this.rainNow = key;
    if (!(this.isRace && !this.briefed)) this.rainKey = key;
  }

  onLap() {
    const r = this.race;
    const me = this.me;
    const len = r.session.trackLength;
    if (!len) return;
    if (!this.boundsCache || this.boundsLen !== len || this.boundsZones !== (r.coach?.zones || []).length) { this.boundsCache = this.bounds(); this.boundsLen = len; this.boundsZones = (r.coach?.zones || []).length; }
    // Zone times for every car; pit exit position learned from cars leaving the pits.
    r.lap.forEach((c, i) => {
      if (!c || !c.position || c.resultStatus > 2) return;
      if (!this.splits[i] || this.splits[i].n !== this.boundsCache.length) this.splits[i] = new Splits(this.boundsCache);
      this.splits[i].update(c);
      const wasPit = this.prevPit[i];
      if (wasPit > 0 && c.pitStatus === 0 && c.lapDistance > 0 && c.lapDistance < len / 3) {
        this.pitExits.push(c.lapDistance);
        if (this.pitExits.length > 15) this.pitExits.shift();
      }
      this.prevPit[i] = c.pitStatus;
    });
    const c = r.lap[me];
    if (!c || !c.lapNum) return;

    // Your sector splits as they happen (the lap packet resets them at the line).
    if (c.sector >= 1 && c.s1Ms) this.secLive = { lap: c.lapNum, s1: c.s1Ms, s2: c.sector >= 2 && c.s2Ms ? c.s2Ms : (this.secLive?.lap === c.lapNum ? this.secLive.s2 : 0) };
    // Lap completed
    if (this.lastLapNum !== null && c.lapNum === this.lastLapNum + 1) this.lapDone(c);
    this.lastLapNum = c.lapNum;

    if (this.isRace) { this.raceStart(c); this.raceCalls(c); }
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
    if (m.code === 'LGOT' && this.isRace && !this.lightsOut) {
      this.lightsOut = true;
      this.calls.say('lights', {}, 'Lights out! Go, go, go. Clean through turn one.', { priority: 'high', ttlS: 4 });
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
    const r = this.race;
    const ms = c.lastLapMs;
    this.mine = this.blankLapInfo();
    const invalid = r.lastLapInvalid;
    const res = r.coach.lapDone(c.lapNum - 1, ms, invalid);
    if (!ms) return;
    const prevBestMs = this.myBestMs;
    if (!invalid && (!this.myBestMs || ms < this.myBestMs)) this.myBestMs = ms;

    // Sector times for this lap, and whether they were personal or session bests.
    const sl = this.secLive && this.secLive.lap === c.lapNum - 1 && this.secLive.s1 && this.secLive.s2 ? this.secLive : null;
    const secs = sl ? [sl.s1, sl.s2, ms - sl.s1 - sl.s2] : null;
    const session = r.sectors()?.session || [null, null, null];
    const marks = secs && !invalid ? secs.map((v, k) => {
      const purple = v > 0 && (!session[k] || v <= session[k] + 1);
      const pb = v > 0 && (!this.bestSec[k] || v < this.bestSec[k]);
      if (pb) this.bestSec[k] = v;
      return purple ? 'purple' : pb ? 'pb' : null;
    }) : [null, null, null];

    // Time per corner against a reference: the car ahead in a race, the fastest car otherwise.
    const sp = this.splits[me];
    let ref = null, refName = null;
    if (this.isRace) {
      const ahead = r.lap.findIndex((x) => x && x.position === c.position - 1);
      const a = this.splits[ahead];
      if (ahead >= 0 && a?.lastLap) { ref = a.lastLap.segs; refName = this.name(ahead); }
    } else {
      let best = null;
      for (const [i, s] of Object.entries(this.splits)) if (Number(i) !== me && s.bestLap && (!best || s.bestMs < best.ms)) best = { ms: s.bestMs, segs: s.bestLap.segs, i: Number(i) };
      if (best && best.ms < ms) { ref = best.segs; refName = this.name(best.i); }
    }
    const zones = r.coach.zones;
    const lap = res?.lap || null;
    const own = lap && res.prevBest && res.prevBest !== lap ? res.prevBest : lap && r.coach.best !== lap ? r.coach.best : null;
    let loss = null;
    if (ref && sp?.lastLap && sp.lastLap.segs.length === ref.length) loss = sp.lastLap.segs.map((v, k) => v - ref[k]);
    else if (lap && own) { loss = lap.corners.map((x, k) => x.time - own.corners[k].time); refName = 'your best lap'; }
    if (loss) this.segLoss = loss.map((v) => Math.round(v));
    const coaching = this.coaching(lap, own, loss, refName);
    const gains = lap && own && ms < own.ms ? lap.corners.map((x, k) => ({ k, d: own.corners[k].time - x.time })).filter((x) => x.d >= 80).sort((a, b) => b.d - a.d) : [];
    const ers = lap && r.format < 2026 && !this.isQuali ? r.coach.ers(lap) : null;
    this.lapNotesPrev = this.lapNotes;
    this.lapNotes = { lap: c.lapNum - 1, ms, invalid, secs, marks, coaching, gains: gains.slice(0, 2).map((g) => zones[g.k]?.name).filter(Boolean), ers };

    if (!this.isRace) {
      const delta = prevBestMs ? ms - prevBestMs : null;
      const secText = this.sectorText(marks, secs, delta);
      const pb = !invalid && delta !== null && delta < 0;
      const base = invalid ? `Lap deleted, track limits. ${lapTime(ms)}.`
        : pb ? this.vary.pick('pb', [`${lapTime(ms)}, personal best by ${sec(-delta, 3)}.`, `Personal best: ${lapTime(ms)}, ${sec(-delta, 3)} quicker.`, `That's ${lapTime(ms)}. Improvement of ${sec(-delta, 3)}.`])
          : delta !== null ? this.vary.pick('lap', [`${lapTime(ms)}, plus ${sec(delta, 3)}.`, `${lapTime(ms)}. ${sec(delta, 3)} off your best.`, `Lap time ${lapTime(ms)}, ${sec(delta, 3)} down.`])
            : `${lapTime(ms)}.`;
      const gainText = pb && this.lapNotes.gains.length ? ` ${this.vary.pick('gain', [`${this.lapNotes.gains[0]} was your best yet.`, `Big gain in ${this.lapNotes.gains[0]}.`, `${this.lapNotes.gains[0]} made the difference.`])}` : '';
      this.calls.say('lap-done', { ms, delta, invalid, pos: c.position, marks }, `${base}${secText}${gainText} P${c.position}.`, { priority: 'normal' });
      // Coaching straight after the lap time, but not every lap at the same corner.
      if (coaching && !invalid) this.calls.say('losing-time', coaching.data, coaching.text, { priority: 'normal', key: `coach-${c.lapNum}` });
    }
  }

  sectorText(marks, secs, delta) {
    if (!secs) return '';
    const p = marks.map((m, k) => (m === 'purple' ? k + 1 : null)).filter(Boolean);
    const g = marks.map((m, k) => (m === 'pb' ? k + 1 : null)).filter(Boolean);
    if (p.length === 3) return ' Purple in every sector!';
    const parts = [];
    if (p.length) parts.push(`purple sector ${p.join(' and ')}`);
    if (g.length) parts.push(`personal best in sector ${g.join(' and ')}`);
    if (!parts.length) return '';
    const s = parts.join(', ');
    return ` ${s[0].toUpperCase()}${s.slice(1)}.`;
  }

  // Where the lap went and what to do about it, by corner.
  coaching(lap, own, loss, refName) {
    const zones = this.race.coach.zones;
    if (!loss || !zones.length || loss.length !== zones.length) return null;
    const ranked = loss.map((v, k) => ({ k, v })).filter((x) => x.v >= 100).sort((a, b) => b.v - a.v).slice(0, 4);
    if (!ranked.length) return null;
    // Prefer a corner not coached on the last two laps, unless one is clearly the worst.
    // Same corner told twice running: move on to the next one, and only come back every few laps.
    this.coachCount = this.coachCount || {};
    let pickZ = ranked.find((x) => !this.coached.includes(x.k));
    if (!pickZ || ranked[0].v > pickZ.v * 1.6) pickZ = ranked[0];
    const told = this.coachCount[pickZ.k] || { n: 0, lap: -99 };
    if (told.n >= 2 && this.race.lap[this.me]?.lapNum - told.lap < 5) {
      pickZ = ranked.find((x) => x.k !== pickZ.k && !(this.coachCount[x.k]?.n >= 2 && this.race.lap[this.me]?.lapNum - this.coachCount[x.k].lap < 5));
      if (!pickZ) return null;
    }
    const k = pickZ.k, z = zones[k];
    this.coachCount[k] = { n: (this.coachCount[k]?.n || 0) + 1, lap: this.race.lap[this.me]?.lapNum || 0 };
    const adv = lap && own ? this.race.coach.advise(k, lap, own) : lap ? this.race.coach.advise(k, lap, null) : null;
    const again = this.coached.includes(k);
    this.coached.unshift(k); this.coached.length = Math.min(this.coached.length, 2);
    const lossS = sec(pickZ.v, 2);
    const vs = refName ? (refName === 'your best lap' ? 'to your best lap' : `to ${refName}`) : '';
    const what = adv ? adv.bits.join(', ') : null;
    const fix = adv ? adv.fix : this.vary.pick('samefix', ['Your inputs matched your best there, so try a later apex and an earlier throttle.', 'Same brake point and apex speed as your best, so it is the line: open the exit up.']);
    const text = adv
      ? this.vary.pick('coach', [
        `${z.name}: ${lossS} ${vs}. ${cap(what)}. ${fix}`,
        `Biggest loss was ${z.name}, ${lossS} ${vs}. ${cap(what)}. ${fix}`,
        `Look at ${z.name}. ${cap(what)}, worth ${lossS}. ${fix}`,
        again ? `Still losing in ${z.name}, ${lossS}. ${cap(what)}. ${this.vary.pick('alt', ['Try something different there:', 'New approach:', 'Next lap:'])} ${fix}` : `In ${z.name} ${what}. That cost ${lossS}. ${fix}`,
      ])
      : this.vary.pick('coach0', [`Most time went in ${z.name}, ${lossS} ${vs}. ${fix}`, `${z.name} is where it's going, ${lossS} ${vs}. ${fix}`]);
    const data = { zone: k, corner: z.name, from: Math.round(z.from), to: Math.round(z.to), lossMs: Math.round(pickZ.v), ref: refName, fix: adv?.kind || 'line', bits: adv?.bits || [], named: !!this.race.coach.map?.named };
    this.lastLoss = data;
    this.lastLossText = text;
    return { text, data, score: Math.min(90, 55 + pickZ.v / 10) };
  }

  // ---------------- race ----------------
  // Urgent calls (box, flags, safety car, attack/defend, position changes) go out straight away.
  // Everything else is a talking point: at the line each lap she picks the most interesting one
  // she hasn't used lately, and maybe a second one for later in the lap.
  raceCalls(c) {
    const r = this.race;
    const s = r.session;
    const me = this.me;
    const now = this.now();
    const lapsLeft = s.totalLaps ? s.totalLaps - c.lapNum + 1 : null;
    const behindIdx = r.lap.findIndex((x) => x && x.position === c.position + 1 && x.resultStatus === 2);
    const aheadIdx = r.lap.findIndex((x) => x && x.position === c.position - 1);
    const gapAhead = c.position > 1 ? c.gapAheadMs : null;
    const gapBehind = behindIdx >= 0 ? r.lap[behindIdx].gapAheadMs : null;

    if (this.lineLap !== c.lapNum && c.lapDistance > 0 && c.lapDistance < 400 && c.lapNum > 1) {
      this.lineLap = c.lapNum;
      if (lapsLeft === 1) this.calls.say('final-lap', { pos: c.position }, this.vary.pick('final', [`Final lap. P${c.position}. Bring it home clean.`, `Last lap, P${c.position}. Nice and tidy now.`, `This is the last one. P${c.position}, no risks.`]), { priority: 'high' });
      // Pit window from the game's strategy.
      if (s.pitIdealLap > 0 && (c.pitStops || 0) === 0) {
        if (c.lapNum === s.pitIdealLap - 2) this.calls.say('pit-soon', { lap: s.pitIdealLap, rejoin: s.pitRejoinPosition }, `Pit window opens in two laps. Plan is lap ${s.pitIdealLap}.`, { priority: 'normal' });
        if (c.lapNum === s.pitIdealLap) this.calls.say('box-ask', { lap: s.pitIdealLap, rejoin: s.pitRejoinPosition, tyre: this.bestSet()?.name }, `This is the lap. Box, box?${s.pitRejoinPosition ? ` You'd rejoin around P${s.pitRejoinPosition}.` : ''}`, { priority: 'high', ask: 'box-window' });
      }
      if (this.boxPlan && this.boxPlan.lap === c.lapNum) this.calls.say('box-now', { tyre: this.boxPlan.tyre }, `Box this lap, box this lap.${this.boxPlan.tyre ? ` ${this.boxPlan.tyre}s are ready.` : ''}`, { priority: 'high', cooldownS: 20 });
      if (lapsLeft !== 1) this.talkingPoints(c, { aheadIdx, behindIdx, gapAhead, gapBehind, lapsLeft });
    }
    // The second talking point, once you're a third of the way round.
    if (this.deferred && this.deferred.lap === c.lapNum && c.lapDistance > (s.trackLength || 5000) * 0.35 && now - this.sayAt > 8000) {
      const d = this.deferred; this.deferred = null;
      this.speakTopic(d.t, c.lapNum);
    }

    // DRS / defend alerts.
    if (gapAhead !== null && this.prevGapAhead !== null && gapAhead < 1000 && this.prevGapAhead >= 1000 && aheadIdx >= 0) {
      const name = this.name(aheadIdx), drs = r.format >= 2026 ? 'Overtake mode is yours next lap.' : 'DRS range.';
      this.calls.say('attack', { name, gapMs: gapAhead, era: r.format >= 2026 ? 2026 : 2025 }, this.vary.pick('attack', [`Within a second of ${name}. ${drs} Go get him.`, `${drs} You're on ${name}'s gearbox.`, `${name} is in range, under a second. ${drs}`]), { priority: 'normal', cooldownS: 25, key: `attack-${aheadIdx}` });
    }
    if (gapBehind !== null && this.prevGapBehind !== null && gapBehind < 1000 && this.prevGapBehind >= 1000 && behindIdx >= 0) {
      const name = this.name(behindIdx);
      this.calls.say('defend', { name, gapMs: gapBehind }, this.vary.pick('defend', [`${name} is within a second behind. Defend into the braking zones.`, `${name} has DRS on you. Cover the inside.`, `Car behind, ${name}, under a second. Protect your line.`]), { priority: 'normal', cooldownS: 25, key: `defend-${behindIdx}` });
    }
    this.prevGapAhead = gapAhead; this.prevGapBehind = gapBehind;

    // Position changes (after 3 seconds stable, so swaps in a corner don't spam).
    if (c.position !== this.posStable) {
      if (this.prevPos !== c.position) { this.prevPos = c.position; this.posSince = now; }
      else if (now - this.posSince > 3000) {
        if (this.posStable !== null && c.pitStatus === 0) {
          const gained = c.position < this.posStable;
          const other = gained ? r.lap.findIndex((x) => x && x.position === c.position + 1) : r.lap.findIndex((x) => x && x.position === c.position - 1);
          const who = other >= 0 ? this.name(other) : null;
          this.calls.say(gained ? 'pos-gain' : 'pos-lost', { pos: c.position, name: who }, gained
            ? this.vary.pick('gain', [`P${c.position}. Nice move${who ? ` on ${who}` : ''}.`, `That's P${c.position}${who ? `, ${who} done` : ''}.`, `Up to P${c.position}. Clean pass.`])
            : this.vary.pick('lost', [`Lost one to ${who || 'the car behind'}. P${c.position}. Stay with him.`, `${who || 'He'} is through. P${c.position}, stay in the tow.`, `P${c.position}. ${who || 'He'} got by, keep him honest.`]), { priority: 'normal', cooldownS: 5 });
        }
        this.posStable = c.position;
      }
    }
    this.raceEvents(c);
  }

  // Things around you that happen mid-lap: rivals pitting, your teammate, overtakes ahead.
  raceEvents(c) {
    const r = this.race;
    const now = this.now();
    if (!this.lightsOut || c.lapNum < 2) { this.snapshotAhead(c); return; }
    const pitLoss = (r.coach.map?.pit || 22) * 1000;
    r.lap.forEach((o, i) => {
      if (!o || i === this.me || o.resultStatus !== 2) return;
      const was = this.prevPitEv?.[i] ?? 0;
      if (was === 0 && o.pitStatus === 1 && Math.abs(o.position - c.position) <= 3 && now - (this.rivalPitAt[i] || 0) > 60000) {
        this.rivalPitAt[i] = now;
        const ahead = o.position < c.position;
        const gap = Math.abs((o.totalDistance - (r.lap[this.me].totalDistance || 0)) / Math.max(1, r.session.trackLength || 5000)) * (this.myBestMs || 90000);
        const name = this.name(i);
        const text = ahead
          ? (gap < pitLoss ? `${name} ahead is in the pits. He should come out behind you. Push now.` : `${name} ahead has boxed. He'll rejoin in front, but on fresher tyres.`)
          : (gap < pitLoss ? `${name} behind is pitting. Watch the undercut: push hard this lap and next.` : `${name} behind has stopped. He's out of your fight for now.`);
        this.calls.say('rival-pit', { name, ahead }, text, { priority: 'normal', key: `rp-${i}` });
      }
    });
    this.prevPitEv = r.lap.map((o) => o?.pitStatus ?? 0);
    // Your teammate stopping or retiring.
    const tm = this.teammate();
    if (tm !== null) {
      const o = r.lap[tm];
      const st = { pit: o?.pitStatus, res: o?.resultStatus };
      const name = this.name(tm);
      if (this.tmState && this.tmState.pit === 0 && st.pit === 1) this.calls.say('teammate', { name, event: 'pit' }, this.vary.pick('tmpit', [`Your teammate ${name} is boxing this lap.`, `${name}, your teammate, is in the pits.`]), { priority: 'low', key: 'tm-pit', cooldownS: 30 });
      if (this.tmState && this.tmState.res === 2 && st.res > 2) this.calls.say('teammate', { name, event: 'out' }, `${name} is out of the race. It's all on you now.`, { priority: 'normal', key: 'tm-out' });
      this.tmState = st;
    }
    // Overtakes among the cars just ahead of you.
    const order = this.snapshotAhead(c);
    if (order && this.aheadOrder && now - this.aheadOrderAt > 25000) {
      for (let k = 0; k + 1 < order.length; k++) {
        const a = order[k], b = order[k + 1];
        const pa = this.aheadOrder.indexOf(a), pb = this.aheadOrder.indexOf(b);
        if (pa >= 0 && pb >= 0 && pa > pb) {
          this.aheadOrderAt = now;
          const pos = r.lap[a]?.position;
          this.calls.say('battle-pass', { name: this.name(a), over: this.name(b), pos }, this.vary.pick('pass', [`${this.name(a)} is through on ${this.name(b)} ahead of you, for P${pos}.`, `Change of order up the road: ${this.name(a)} past ${this.name(b)}.`]), { priority: 'low' });
          break;
        }
      }
    }
    this.aheadOrder = order;
  }

  snapshotAhead(c) {
    const r = this.race;
    const out = [];
    for (let p = c.position - 3; p < c.position; p++) { const i = r.lap.findIndex((x) => x && x.position === p && x.resultStatus === 2); if (i >= 0) out.push(i); }
    return out.length >= 2 ? out : null;
  }

  teammate() {
    const parts = this.race.parts || [];
    const my = parts[this.me];
    if (!my || my.teamId === undefined || my.teamId === 255) return null;
    const i = parts.findIndex((p, k) => k !== this.me && p && p.teamId === my.teamId);
    return i >= 0 && this.race.lap[i]?.position ? i : null;
  }

  // Gather what's worth saying this lap, score it, and say the best one or two.
  talkingPoints(c, g) {
    const r = this.race;
    const lap = c.lapNum;
    const t = [];
    const add = (kind, score, every, text, data = {}) => { if (text && (this.topicLap[kind] === undefined || lap - this.topicLap[kind] >= every)) t.push({ kind, score, text, data }); };
    const name = (i) => this.name(i);
    const prev = this.lineGaps;

    // Gaps to the cars around you.
    const data = {
      pos: c.position, lapsLeft: g.lapsLeft,
      ahead: g.aheadIdx >= 0 ? { name: name(g.aheadIdx), gapMs: g.gapAhead, changeMs: prev?.ahead === name(g.aheadIdx) && prev.gapAhead !== null ? g.gapAhead - prev.gapAhead : null } : null,
      behind: g.behindIdx >= 0 ? { name: name(g.behindIdx), gapMs: g.gapBehind, changeMs: prev?.behind === name(g.behindIdx) && prev.gapBehind !== null ? g.gapBehind - prev.gapBehind : null } : null,
    };
    this.lineGaps = { ahead: data.ahead?.name, gapAhead: g.gapAhead, behind: data.behind?.name, gapBehind: g.gapBehind };
    const big = Math.max(Math.abs(data.ahead?.changeMs || 0), Math.abs(data.behind?.changeMs || 0));
    const close = (data.ahead && data.ahead.gapMs < 2000) || (data.behind && data.behind.gapMs < 2000);
    add('splits', big >= 500 ? 85 : close ? 70 : 40, big >= 500 ? 1 : close ? 2 : 3, this.splitsVaried(data), data);

    // Wheel settings against the app's suggestion for this track (brake bias and diff change on the move).
    const tg = this.targets;
    const st0 = r.status[this.me] || {};
    const bias = r.setup?.brakeBias || st0.brakeBias, diff = r.setup?.diffOn;
    if (tg && Date.now() - tg.at < 120000) {
      const parts = [];
      if (tg.brakeBias && bias && Math.abs(bias - tg.brakeBias) >= 2) parts.push(`brake bias ${bias > tg.brakeBias ? 'back' : 'forward'} ${Math.abs(bias - tg.brakeBias)}, to ${tg.brakeBias}%`);
      if (tg.diffOn && diff && Math.abs(diff - tg.diffOn) >= 10) parts.push(`on-throttle diff ${diff > tg.diffOn ? 'down' : 'up'} to ${tg.diffOn}%`);
      if (parts.length) add('wheel-setup', 60, 8, this.vary.pick('ws', [`From the wheel: ${parts.join(', and ')}. That's the suggested setup for this track and it's allowed on the move.`, `One for the MFD: ${parts.join(' and ')}. Matches the setup sheet for here.`]), { parts });
    }

    // Battles ahead and behind.
    const near = (pos) => r.lap.findIndex((x) => x && x.position === pos && x.resultStatus === 2);
    const a1 = near(c.position - 1), a2 = near(c.position - 2);
    if (a1 >= 0 && a2 >= 0 && r.lap[a1].gapAheadMs < 1000 && g.gapAhead < 5000) {
      add('battle-ahead', 72, 4, this.vary.pick('bah', [
        `${name(a2)} and ${name(a1)} are fighting for P${c.position - 2} just up the road, ${sec(g.gapAhead)} ahead of you. They're slowing each other down.`,
        `There's a scrap ahead: ${name(a1)} is all over ${name(a2)}. You're ${sec(g.gapAhead)} behind them. Be ready to pick one off.`,
        `${name(a1)} is trying to pass ${name(a2)} ahead. Close in while they fight.`,
      ]), { a: name(a2), b: name(a1) });
    }
    const b1 = near(c.position + 1), b2 = near(c.position + 2);
    if (b1 >= 0 && b2 >= 0 && r.lap[b2].gapAheadMs < 1000 && g.gapBehind !== null && g.gapBehind < 4000) {
      add('battle-behind', 62, 4, this.vary.pick('bbe', [
        `${name(b1)} and ${name(b2)} are fighting behind you, ${sec(g.gapBehind)} back. Good for us, they're losing time.`,
        `Behind you, ${name(b2)} is attacking ${name(b1)}. Use it and build the gap.`,
      ]), { a: name(b1), b: name(b2) });
    }

    // Your teammate.
    const tm = this.teammate();
    if (tm !== null) {
      const o = r.lap[tm], st = r.status[tm] || {};
      const gap = (o.totalDistance - (c.totalDistance || 0)) / Math.max(1, r.session.trackLength || 5000) * ((this.myBestMs || 90000) / 1000);
      const where = Math.abs(gap) < 15 ? `, ${sec(Math.abs(gap) * 1000)} ${gap > 0 ? 'ahead of' : 'behind'} you` : '';
      const tyre = TYRE_NAME[st.visual] ? ` on ${st.tyreAge}-lap ${TYRE_NAME[st.visual]}s` : '';
      add('teammate', Math.abs(gap) < 3 ? 70 : 48, 6, this.vary.pick('tm', [`Your teammate ${name(tm)} is P${o.position}${where}${tyre}.`, `Team update: ${name(tm)} running P${o.position}${where}.`, `${name(tm)} is P${o.position}${tyre}. ${Math.abs(gap) < 3 ? 'Race him clean.' : ''}`]), { name: name(tm), pos: o.position });
    }

    // The race as a whole.
    const leader = near(1), second = near(2);
    if (leader >= 0 && second >= 0) {
      const lastLaps = r.lap.map((x, i) => ({ i, ms: x?.lastLapMs || 0, pos: x?.position })).filter((x) => x.ms > 0 && x.pos <= 12).sort((a, b) => a.ms - b.ms);
      const scNow = r.session.safetyCar === 1 || r.session.safetyCar === 2;
      const quick = scNow ? '' : lastLaps[0] && lastLaps[0].i !== this.me ? ` Quickest on track last lap was ${name(lastLaps[0].i)}, ${lapTime(lastLaps[0].ms)}.` : lastLaps[0] ? ' You were the quickest car on track last lap.' : '';
      const me1 = c.position === 1;
      add('overview', 44, 7, this.vary.pick('ov', [
        `Race update: ${name(leader)} leads by ${sec(r.lap[second].gapAheadMs)} from ${name(second)}.${me1 ? '' : ` You're ${sec(c.gapLeaderMs)} off the lead.`}${quick}`,
        `${me1 ? `You lead by ${sec(r.lap[second].gapAheadMs)}.` : `Up front it's ${name(leader)}, ${sec(r.lap[second].gapAheadMs)} clear of ${name(second)}.`}${quick}`,
      ]));
    }

    // Tyres on the cars around you.
    const tyreOf = (i) => ({ st: r.status[i] || {}, wear: r.wearAll?.[i] ? Math.max(...r.wearAll[i]) : null });
    const mine = tyreOf(this.me);
    for (const [i, side] of [[g.aheadIdx, 'ahead'], [g.behindIdx, 'behind']]) {
      if (i < 0) continue;
      const o = tyreOf(i);
      const ageDiff = (o.st.tyreAge ?? 0) - (mine.st.tyreAge ?? 0);
      const wearDiff = o.wear !== null && mine.wear !== null ? o.wear - mine.wear : 0;
      const gap = side === 'ahead' ? g.gapAhead : g.gapBehind;
      if (!TYRE_NAME[o.st.visual] || gap === null || gap > 4000) continue;
      const desc = `${o.st.tyreAge}-lap-old ${TYRE_NAME[o.st.visual]}s${o.wear !== null ? `, about ${Math.round(o.wear)}% worn` : ''}`;
      if (side === 'ahead' && (ageDiff >= 6 || wearDiff >= 12)) add('tyres-rival', 66, 5, this.vary.pick('tra', [`${name(i)} ahead is on ${desc}. Yours are fresher. He'll fade, keep the pressure on.`, `${name(i)}'s tyres are going off, ${desc}. Stay close, the pass will come.`]));
      else if (side === 'behind' && (ageDiff <= -6 || wearDiff <= -12)) add('tyres-rival', 64, 5, this.vary.pick('trb', [`${name(i)} behind has fresher rubber, ${desc}. Expect him to come at you.`, `Heads up, ${name(i)} is on newer tyres than you, ${desc}. Defend smart.`]));
      else if (side === 'ahead' && ageDiff <= -6) add('tyres-rival', 50, 6, `${name(i)} ahead is on fresher tyres, ${desc}. Don't burn yours chasing him.`);
    }

    // What the last lap tells us: corners, sectors, battery.
    const n = this.lapNotes && this.lapNotes.lap === lap - 1 ? this.lapNotes : null;
    if (n?.coaching && !n.invalid) add('coach', n.coaching.score, 2, n.coaching.text, n.coaching.data);
    if (n?.marks?.some((m) => m === 'purple')) add('sector', 58, 3, this.vary.pick('psec', [`Purple sector ${n.marks.indexOf('purple') + 1}! Fastest of anyone.`, `That's a purple sector ${n.marks.indexOf('purple') + 1}.`]));
    else if (n?.marks?.some((m) => m === 'pb')) add('sector', 38, 4, `Personal best in sector ${n.marks.indexOf('pb') + 1}.`);
    if (n?.ers) {
      const e = n.ers;
      const st = r.status[this.me] || {};
      if (e.end < 25 && e.longest) add('ers', 68, 4, this.vary.pick('erl', [`Battery's down to ${e.end}%. Harvest on ${e.shortest?.name || e.longest.name}: Medium mode there${e.bigStop ? `, and lift and coast into ${e.bigStop.name}` : ''}.`, `You're running the battery flat, ${e.end}% at the line. Ease off the deploy on ${e.shortest?.name || e.longest.name} and save it for ${e.longest.name}.`]));
      else if (e.end > 85 && e.longest && (g.gapAhead === null || g.gapAhead > 1500)) add('ers', 55, 5, this.vary.pick('erh', [`You're finishing laps with ${e.end}% battery. Use Overtake on ${e.longest.name}, that's free lap time.`, `Plenty of charge, ${e.end}%. Deploy more on ${e.longest.name}.`]));
      else if (g.gapAhead !== null && g.gapAhead < 1500 && e.longest && e.end > 40) add('ers', 70, 3, this.vary.pick('era', [`Save the battery for ${e.longest.name}. Hit Overtake there to get alongside ${data.ahead?.name || 'him'}.`, `Attack plan: full deploy on ${e.longest.name}, then late on the brakes.`]));
      else if (g.gapBehind !== null && g.gapBehind < 1200 && e.longest) add('ers', 60, 4, `Keep some battery to defend on ${e.longest.name}.`);
      else if (st.ersMode !== undefined) add('ers', 30, 8, `Battery's balanced, ${e.start} to ${e.end}% over the lap. Good management.`);
    }

    // Under a safety car, no pushing advice: just the race picture.
    const sc = r.session.safetyCar === 1 || r.session.safetyCar === 2;
    if (sc) for (let k = t.length - 1; k >= 0; k--) if (['coach', 'ers', 'battle-ahead', 'battle-behind', 'sector'].includes(t[k].kind)) t.splice(k, 1);
    if (!t.length) return;
    t.sort((a, b) => b.score - a.score);
    const first = t[0];
    this.speakTopic(first, lap);
    const next = t.find((x) => x !== first && x.score >= 55);
    if (next) this.deferred = { lap, t: next };
  }

  speakTopic(x, lap) {
    this.topicLap[x.kind] = lap;
    this.sayAt = this.now();
    this.calls.say(x.kind === 'coach' ? 'losing-time' : x.kind, x.data, x.text, { priority: 'normal', key: `topic-${x.kind}-${lap}` });
  }

  splitsVaried(d) {
    const nm = (o) => o?.name;
    const trendA = d.ahead?.changeMs, trendB = d.behind?.changeMs;
    const closingAhead = trendA !== null && trendA !== undefined && trendA <= -200;
    const losingBehind = trendB !== null && trendB !== undefined && trendB <= -200;
    const opts = [() => splitsText(d)];
    if (d.ahead && d.behind) opts.push(() => `Gap to ${nm(d.ahead)} is ${sec(d.ahead.gapMs)}${closingAhead ? `, you took ${sec(-trendA)} that lap` : ''}. ${nm(d.behind)} is ${sec(d.behind.gapMs)} back.`);
    if (d.ahead) opts.push(() => `${nm(d.ahead)} is ${sec(d.ahead.gapMs)} up the road${closingAhead ? `, and you're reeling him in, ${sec(-trendA)} that lap` : trendA >= 200 ? `, he's pulling away, ${sec(trendA)} that lap` : ''}.${d.lapsLeft ? ` ${d.lapsLeft} to go.` : ''}`);
    if (d.behind && losingBehind) opts.push(() => `${nm(d.behind)} is closing, ${sec(d.behind.gapMs)} behind now, ${sec(-trendB)} quicker that lap.`);
    if (d.behind && trendB >= 200) opts.push(() => `You're pulling away from ${nm(d.behind)}, ${sec(d.behind.gapMs)} now.`);
    return this.vary.pick(`splits${opts.length}`, opts);
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
  // In the garage she reads the traffic at pit exit and keeps a list of clean windows plus the
  // latest you can leave for one more flying lap (both on the dashboard). On the radio she says
  // what the traffic is doing once, calls the gap once and asks if you're going. Say "wait"
  // (or no) and she stays quiet until you ask. Once you're out of the garage, no more pit-exit calls.
  qualiCalls(c) {
    const r = this.race;
    const s = r.session;
    const len = s.trackLength;
    const now = this.now();
    const moving = (r.tel?.speedKmh || 0) > 10;
    if (c.driverStatus !== 0 || moving) {
      if (!this.leave?.out) {
        this.leave = { out: true };
        this.garage = null;
        if (this.calls.pending?.ask === 'leave') this.calls.pending = null;
      }
      return;
    }
    if (!this.garage) this.garage = { since: now, said: null, muted: false, warned: {} };
    const g = this.garage;
    // Parc fermé starts the moment you drive out in qualifying: one reminder while changes are still possible.
    const pf = r.parcFerme();
    if (pf.soon && !this.pfSaid && now - g.since > 1500) {
      this.pfSaid = true;
      this.calls.say('parc-ferme', { soon: true }, "Heads up: parc fermé starts when you leave the garage. Any setup changes, make them now. After that it's front wing only.", { priority: 'normal' });
    }
    if (now - (this.leaveCalcAt || 0) < 1000) return;
    this.leaveCalcAt = now;
    const pitExit = this.pitExits.length ? [...this.pitExits].sort((a, b) => a - b)[Math.floor(this.pitExits.length / 2)] : len * 0.06;
    const myBest = this.myBestMs || r.history[this.me]?.bestLapMs || 0;
    const fieldBest = Object.values(r.history).map((h) => h.bestLapMs).filter((v) => v > 0).sort((a, b) => a - b)[0] || 0;
    const lapS = (myBest || fieldBest || len / 52 * 1000) / 1000;
    // When will each car on track pass the pit exit (this lap and the next two)?
    const arrivals = [];
    r.lap.forEach((o, i) => {
      if (i === this.me || !o || o.resultStatus !== 2 || o.pitStatus !== 0 || ![1, 2, 3, 4].includes(o.driverStatus) || !(o.lapDistance >= 0)) return;
      const v = (len / lapS) * (o.driverStatus === 3 ? 0.75 : 1); // out laps are slower
      const d = (pitExit - o.lapDistance + len) % len;
      for (let k = 0; k < 3; k++) arrivals.push({ t: (d + k * len) / v, i, flying: o.driverStatus === 1 && k === 0, inLap: o.driverStatus === 2 });
    });
    // Clean windows: leave-in seconds where you'd reach pit exit with nobody within CLEAR_S.
    const windows = [];
    for (let w = 0; w <= HORIZON_S; w++) {
      const at = PIT_EXIT_S + w;
      const clear = !arrivals.some((a) => !a.inLap && Math.abs(a.t - at) < CLEAR_S);
      const open = windows[windows.length - 1];
      if (clear) { if (open && open.to === w - 1) open.to = w; else windows.push({ from: w, to: w }); }
    }
    // Only gaps of 3 s or more are worth calling: easy to hit when you leave.
    const good = windows.filter((x) => x.to - x.from >= 2);
    const wait = good.length ? good[0].from : null;
    const blocker = wait ? arrivals.filter((a) => Math.abs(a.t - PIT_EXIT_S) < CLEAR_S).sort((a, b) => a.t - b.t)[0] : null;
    // Latest time to leave and still start a final flying lap before the clock runs out.
    const need = PIT_EXIT_S + lapS * OUTLAP_FACTOR * (1 - pitExit / len) + 5;
    const timeLeft = s.timeLeft ?? null;
    const leaveByS = timeLeft !== null ? Math.round(timeLeft - need) : null;
    const clearForS = wait !== null && wait <= 2 ? good[0].to - wait + 1 : null;
    this.leave = {
      out: false, waitS: wait, clearForS, windows: good.slice(0, 4), cars: new Set(arrivals.map((a) => a.i)).size,
      blocker: blocker ? this.name(blocker.i) : null, blockerFlying: blocker?.flying || false,
      leaveByS, leaveAtClockS: leaveByS !== null ? Math.max(0, Math.round(need)) : null, muted: g.muted,
    };
    if (now - g.since < 3000) return; // settle first

    // The deadline matters even when she's been told to wait: once at 90 s and once at 30 s.
    for (const th of [90, 30]) {
      if (leaveByS !== null && leaveByS <= th && leaveByS > 0 && !g.warned[th]) {
        g.warned[90] = true; if (th === 30) g.warned[30] = true;
        this.calls.say('leave-by', { seconds: leaveByS }, `${leaveByS} seconds left to leave the garage for one more lap.`, { priority: 'high', key: `leave-by-${th}`, ttlS: 8 });
      }
    }
    if (g.muted) return;
    const go = () => {
      g.said = 'go';
      const cars = this.leave.cars;
      this.calls.say('leave-go', { cars, clearForS }, cars ? `Gap at pit exit now${clearForS ? `, clean for about ${Math.min(clearForS, 60)} seconds` : ''}. Are you going?` : 'Track is clear. Go whenever you like.', { priority: 'high', ask: cars ? 'leave' : null, ttlS: 6 });
    };
    if (!g.said) {
      if (wait !== null && wait <= 2) go();
      else if (wait === null) { g.said = 'busy'; this.calls.say('leave-wait', { seconds: null }, "Pit exit is busy for the next couple of minutes. Sit tight, I'm watching it.", { priority: 'normal', ttlS: 10 }); }
      else if (wait >= 6) {
        g.said = 'wait';
        this.calls.say('leave-wait', { seconds: wait, blocker: this.leave.blocker, flying: this.leave.blockerFlying }, `Traffic at pit exit${this.leave.blocker ? `, ${this.leave.blocker} is coming through${this.leave.blockerFlying ? ' on a flying lap' : ''}` : ''}. Next clean gap in about ${wait} seconds. I'll call it.`, { priority: 'normal', ttlS: 10 });
      }
    } else if (g.said !== 'go' && wait !== null && wait <= 2) go(); // the gap she promised
    // After the go call: quiet, unless you ask.
  }

  // Wait / hold in the garage: stop the pit-exit calls until asked again.
  holdInGarage(reason) {
    if (this.garage) { this.garage.muted = true; if (this.leave) this.leave.muted = true; }
    const l = this.leave;
    const by = l && !l.out && l.leaveByS !== null && l.leaveByS > 0 ? ` Leave within ${fmtClock(l.leaveByS)} for a final lap.` : '';
    return this.calls.say('answer', { topic: 'wait', reason }, `Copy. Holding in the garage, I'll stay quiet.${by} Ask me for a gap when you're ready.`, { priority: 'high', key: `ans-${this.now()}` });
  }

  // ---------------- before the start: briefing, formation lap, lights out ----------------
  raceStart(c) {
    const r = this.race;
    const s = r.session;
    const now = this.now();
    if (!this.raceSeen) this.raceSeen = now || 1;
    const speed = r.tel?.speedKmh || 0;
    if (!this.lightsOut && c.lapNum === 1 && speed > 80 && s.safetyCar !== 3 && this.briefed) this.lightsOut = true; // no LGOT event seen
    const onGrid = !this.lightsOut && c.lapNum === 1 && (speed < 5 || s.safetyCar === 3);
    if (!this.briefed && onGrid && c.position && r.status[this.me]?.visual && now - this.raceSeen > 1500) {
      this.briefed = true;
      const p = this.plan();
      this.calls.say('briefing', p, p.say, { priority: 'high' });
      this.rainKey = this.rainNow ?? null; // the briefing covered the forecast
    }
    if (!this.briefed && !onGrid) { // joined mid-race: a plain radio check instead of the briefing
      this.briefed = true;
      this.calls.say('session', { type: 'race', laps: s.totalLaps, weather: WEATHER[s.weather], trackTemp: s.trackTemp }, `Radio check. Race, ${s.totalLaps ? `${s.totalLaps} laps, ` : ''}you're P${c.position}.`, { priority: 'normal' });
    }
    if (!this.formationSaid && s.safetyCar === 3 && c.lapNum === 1 && !this.lightsOut) {
      this.formationSaid = true;
      const assisted = s.raceStarts === 1;
      this.calls.say('formation', { assisted }, `Formation lap. Weave to put heat in the fronts, a few hard bursts of throttle out of the slow corners for the rears, and one firm stop before the last corner for the brakes. Stay within ten car lengths of the car ahead. ${assisted ? 'On the grid, just hold full throttle at lights out and the game does the clutch.' : 'On the grid: clutch in, revs up, release at lights out and short-shift into second.'}`, { priority: 'high' });
    }
  }

  // Race notes: the plan for the race, from the game's own data. Spoken in the briefing and shown on the dashboard.
  plan() {
    const r = this.race;
    const s = r.session;
    const me = this.me;
    const c = r.lap[me] || {};
    const st = r.status[me] || {};
    const items = [];
    const say = [];
    const grid = c.grid || c.position;
    const field = r.lap.filter((x) => x && x.position && x.resultStatus >= 2).length;
    const tyre = TYRE_NAME[st.visual];
    if (grid) items.push({ k: 'Start', v: `P${grid}${field ? ` of ${field}` : ''}${s.totalLaps ? ` · ${s.totalLaps} laps` : ''}` });
    if (tyre) items.push({ k: 'Tyres', v: `${tyre}${st.tyreAge ? `, ${st.tyreAge} laps old` : ', new'}` });
    say.push(`Race briefing. You start P${grid}${tyre ? ` on ${tyre}s` : ''}${s.totalLaps ? `, ${s.totalLaps} laps` : ''}.`);
    const set = this.bestSet();
    if (s.pitIdealLap > 0) {
      const v = `Box around lap ${s.pitIdealLap}${s.pitLatestLap && s.pitLatestLap !== s.pitIdealLap ? `, no later than lap ${s.pitLatestLap}` : ''}${set ? `, onto ${set.name}s` : ''}`;
      items.push({ k: 'Stop', v });
      say.push(`Plan is one stop: ${v.replace(/^Box/, 'box')}.`);
    } else if (s.totalLaps && s.totalLaps > 5) {
      items.push({ k: 'Stop', v: 'No stop in the game\'s plan' });
      say.push('No stop planned, so look after the tyres.');
    } else {
      items.push({ k: 'Stop', v: 'Flat out, no stop' });
      say.push('Short race, no stop. Flat out.');
    }
    if (Number.isFinite(st.fuelLaps)) {
      const f = st.fuelLaps;
      items.push({ k: 'Fuel', v: `${f >= 0 ? '+' : ''}${f.toFixed(1)} laps${f < 0 ? ', save from the start' : f < 0.3 ? ', a little lift and coast late' : ''}` });
      if (f < 0) say.push(`Fuel is ${Math.abs(f).toFixed(1)} laps short, so lift and coast from the start.`);
      else if (f < 0.3) say.push('Fuel is tight, a little lift and coast later on.');
    }
    const rainMax = Math.max(0, ...(s.forecast || []).filter((x) => x.sessionType === s.sessionType).map((x) => x.rain));
    if (s.weather !== undefined) {
      const w = `${WEATHER[s.weather] || 'unknown'}, track ${s.trackTemp}°C${rainMax >= 30 ? `, rain up to ${rainMax}% later` : ', no rain expected'}`;
      items.push({ k: 'Weather', v: w[0].toUpperCase() + w.slice(1) });
      say.push(`It's ${w}.`);
    }
    const near = (pos) => r.lap.findIndex((x) => x && (x.grid || x.position) === pos);
    const ahead = grid > 1 ? near(grid - 1) : -1, behind = near(grid + 1);
    if (ahead >= 0 || behind >= 0) {
      items.push({ k: 'Around you', v: [ahead >= 0 ? `${this.name(ahead)} ahead` : '', behind >= 0 ? `${this.name(behind)} behind` : ''].filter(Boolean).join(', ') });
      say.push(`${ahead >= 0 ? `${this.name(ahead)} starts ahead of you` : ''}${ahead >= 0 && behind >= 0 ? ', ' : ''}${behind >= 0 ? `${this.name(behind)} behind` : ''}.`);
    }
    const pf = r.parcFerme();
    if (pf.on) items.push({ k: 'Parc fermé', v: 'Front wing only at the stop. Bias and diff from the wheel.' });
    items.push({ k: 'Turn 1', v: 'Clean start, no heroes. The race is long.' });
    say.push('Clean start, no heroes into turn one.');
    return { title: 'Race plan', items, say: say.join(' ') };
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
      if (kind === 'ERS') continue; // battery advice is a talking point, with the corners to use
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
      if (pend.ask === 'leave') {
        if (!yes) return this.holdInGarage('no');
        if (this.garage) this.garage.muted = true;
        return this.calls.say('answer', { topic, ask: pend.ask, yes }, 'Copy. Out you go, build the tyres on the out lap and go for it.', { priority: 'high', key: `ans-${this.now()}` });
      }
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
    if (topic === 'wait') {
      if (pend && this.now() - pend.at < 120000) return this.ask('no');
      if (!this.isRace && this.leave && !this.leave.out) return this.holdInGarage('wait');
      return this.calls.say('answer', { topic }, 'Copy.', { priority: 'high', key: `ans-${this.now()}` });
    }
    if (topic === 'plan') {
      const p = this.isRace ? this.plan() : null;
      return this.calls.say('answer', { topic }, p ? p.say.replace(/^Race briefing\.\s*/, '') : 'Plan for this session: find a clean gap, build the tyres on the out lap, then two good pushes.', { priority: 'high', key: `ans-${this.now()}` });
    }
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
        // Asking again turns the pit-exit calls back on: she'll call the next gap once.
        if (this.garage) { this.garage.muted = false; this.garage.said = l && l.waitS !== null && l.waitS <= 2 ? 'go' : 'wait'; }
        const text = !l || l.out ? 'You\'re out on track. Ask me again from the garage and I\'ll find you a gap.' : l.waitS !== null && l.waitS <= 2 ? `Gap at pit exit right now${l.clearForS ? `, clean for about ${Math.min(l.clearForS, 60)} seconds` : ''}. Go.` : l.waitS === null ? 'Pit exit is busy for the next couple of minutes. Sit tight.' : `Next clean gap in about ${l.waitS} seconds. I'll call it.`;
        return this.calls.say('answer', { topic, leave: l }, `${text}${l && !l.out && l.leaveByS !== null && l.leaveByS < 300 ? ` You need to leave within ${fmtClock(Math.max(0, l.leaveByS))} for a final lap.` : ''}`, { priority: 'high', key: `ans-${this.now()}` });
      }
      const set = this.bestSet();
      const text = (c.pitStops || 0) > 0 && !s.pitIdealLap ? `You've stopped${set ? `; if we need another, ${set.name}s are best` : ''}.`
        : s.pitIdealLap ? `Plan is lap ${s.pitIdealLap}${s.pitLatestLap ? `, latest ${s.pitLatestLap}` : ''}.${s.pitRejoinPosition ? ` Box now and you'd rejoin about P${s.pitRejoinPosition}.` : ''}${set ? ` ${set.name}s next${set.reachesEnd ? ', they go to the end' : ''}.` : ''}`
          : 'No stop planned yet.';
      return this.calls.say('answer', { topic }, text, { priority: 'high', key: `ans-${this.now()}` });
    }
    if (topic === 'time') {
      const l = this.lastLoss;
      return this.calls.say(l ? 'losing-time' : 'answer', l || { topic }, l ? this.lastLossText : 'Need a full lap first to compare.', { priority: 'high', key: `ans-${this.now()}` });
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
    const showPlan = this.isRace && !this.lightsOut && this.race.lap[this.me]?.lapNum === 1;
    return { calls: this.calls.list.slice(-15), pending: p && this.now() - p.at < 120000 ? { id: p.id, ask: p.ask } : null, segLoss: this.segLoss, segments: this.segLoss ? this.segLoss.length : SEGMENTS, zones: this.race.coach?.state().zones || null, lossText: this.lastLossText || null, leave: this.isRace ? null : this.leave, plan: showPlan ? this.plan() : null, phase: this.isRace ? (this.lightsOut ? 'race' : this.race.session.safetyCar === 3 ? 'formation' : 'grid') : this.leave?.out === false ? 'garage' : 'track' };
  }
}

// 95 -> "1 minute 35", 40 -> "40 seconds"
function fmtClock(sec) {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return m ? `${m} minute${m === 1 ? '' : 's'}${s ? ` ${s}` : ''}` : `${s} seconds`;
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

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
    if (!this.started && p.isRaceOn) {
      this.started = true;
      const laps = Number(this.race.getLaps()) || null;
      this.calls.say('session', { laps }, `Radio check. I can hear you.${laps ? ` ${laps} laps today.` : ''} Clean first lap, then build. Forza only sends me your car, so I'll keep you posted on your laps, fuel and tyres.`, { priority: 'normal' });
    }
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
    if (topic === 'yes' || topic === 'no' || topic === 'wait') return this.calls.say('answer', { topic }, 'Copy.', { priority: 'high', key });
    if (topic === 'plan') { const laps = Number(this.race.getLaps()) || null; return this.calls.say('answer', { topic }, `${laps ? `${laps} laps. ` : ''}Clean first lap, then build. I'll call fuel and tyres as we go.`, { priority: 'high', key }); }
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

  state() { return { calls: this.calls.list.slice(-15), pending: null, segLoss: this.segLoss, segments: this.segLoss ? this.segLoss.length : 0, phase: 'race' }; }
}

module.exports = { F1Engineer, ForzaEngineer, UDP_ACTIONS, SEGMENTS, splitsText };
