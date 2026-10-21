'use strict';
// Corner-by-corner coaching for F1 25.
//
// The lap is split into corner zones using the real corner numbers (corners.js), scaled to the
// game's lap length. Your own telemetry is recorded every 10 m: speed, throttle, brake, gear,
// battery. When a lap ends, each corner is compared with your best lap: where you braked, your
// speed at the apex and when you got back on full throttle. That turns "sector 2" into
// "Turn 4: you braked 15 m earlier than your best lap and were 6 km/h slower at the apex".

const CORNERS = require('./corners');

const BUCKET = 10;          // metres per telemetry sample
const GROUP_M = 140;        // corners closer than this are one complex ("Turns 9-10")
const REVERSED = new Set([39, 40, 41]); // F1 25 reverse layouts: real corner numbers don't apply
const r0 = (v) => Math.round(v);

// Corner zones for a track, scaled to the game's lap length. Falls back to 12 equal parts.
function zonesFor(trackKey, trackId, len) {
  const data = !REVERSED.has(trackId) && CORNERS[trackKey];
  if (!len) return { zones: [], named: false, straights: [], pit: null, pitSC: null };
  if (!data) {
    const n = 12;
    return {
      named: false, pit: null, pitSC: null, straights: [],
      zones: Array.from({ length: n }, (_, k) => ({ name: `the ${((k + 0.5) * len / n / 1000).toFixed(1)} km mark`, short: `${((k + 0.5) * len / n / 1000).toFixed(1)} km`, from: (k * len) / n, to: ((k + 1) * len) / n, apex: ((k + 0.5) * len) / n, labels: [] })),
    };
  }
  const scale = len / data.len;
  const cs = data.corners.map(([label, d, cls]) => ({ label, d: d * scale, cls })).filter((c) => c.d > 0 && c.d < len);
  const groups = [];
  for (const c of cs) {
    const g = groups[groups.length - 1];
    if (g && c.d - g[g.length - 1].d < GROUP_M && c.d - g[0].d < 230) g.push(c); else groups.push([c]);
  }
  const zones = groups.map((g, k) => {
    const next = groups[k + 1];
    const last = g[g.length - 1];
    const to = next ? last.d + 0.35 * (next[0].d - last.d) : len;
    const labels = g.map((c) => c.label);
    // The slowest corner of a complex is where the time is (low before medium before high).
    const main = [...g].sort((a, b) => 'LMHF'.indexOf(a.cls) - 'LMHF'.indexOf(b.cls))[0];
    return { name: labels.length === 1 ? `Turn ${labels[0]}` : `Turns ${labels[0]} to ${labels[labels.length - 1]}`, short: labels.length === 1 ? `T${labels[0]}` : `T${labels[0]}-${labels[labels.length - 1]}`, labels, apex: main.d, cls: main.cls, to };
  });
  zones.forEach((z, k) => { z.from = k ? zones[k - 1].to : 0; });
  const straights = (data.straights || []).map(([a, b]) => ({ from: a * scale, to: b * scale })).filter((s) => s.to - s.from > 250);
  return { zones, named: true, straights, pit: data.pit, pitSC: data.pitSC };
}

// The corner just before / after a distance, for naming straights and places.
function cornerBefore(zones, d) { let z = null; for (const x of zones) if (x.apex <= d) z = x; return z || zones[zones.length - 1]; }
function cornerAfter(zones, d) { return zones.find((x) => x.apex > d) || zones[0]; }

class Coach {
  constructor() { this.track = null; this.reset(); }

  reset() {
    this.cur = null;      // lap being recorded
    this.last = null;     // last finished lap
    this.best = null;     // best valid lap
    this.laps = [];       // recent finished laps (for battery trends)
  }

  setTrack(trackKey, trackId, len) {
    const key = `${trackKey}|${trackId}|${len}`;
    if (key === this.trackKeyStr || !len) return;
    this.trackKeyStr = key;
    this.len = len;
    this.map = zonesFor(trackKey, trackId, len);
    this.reset();
  }

  get zones() { return this.map ? this.map.zones : []; }
  zoneAt(d) { return this.zones.find((z) => d >= z.from && d < z.to) || null; }

  // One telemetry sample for your car.
  sample(lapNum, dist, lapMs, tel, ers, flags = {}) {
    if (!this.len || !(dist >= 0) || dist > this.len + 50 || !tel) return;
    if (!this.cur || this.cur.lapNum !== lapNum) this.cur = { lapNum, n: Math.ceil(this.len / BUCKET) + 1, t: [], v: [], thr: [], brk: [], gear: [], ers: [], lock: [], spin: [] };
    const c = this.cur;
    const k = Math.min(c.n - 1, Math.floor(dist / BUCKET));
    if (c.t[k] === undefined) { c.t[k] = lapMs; c.v[k] = tel.speedKmh; c.thr[k] = tel.throttle; c.brk[k] = tel.brake; c.gear[k] = tel.gear; c.ers[k] = ers; }
    else { c.v[k] = Math.min(c.v[k], tel.speedKmh); c.brk[k] = Math.max(c.brk[k], tel.brake); c.thr[k] = Math.min(c.thr[k], tel.throttle); c.gear[k] = Math.min(c.gear[k], tel.gear); }
    if (flags.lock) c.lock[k] = (c.lock[k] || 0) + 1;
    if (flags.spin) c.spin[k] = (c.spin[k] || 0) + 1;
  }

  // A lap finished: keep it if we saw most of it, and work out each corner.
  lapDone(lapNum, lapMs, invalid) {
    const c = this.cur && this.cur.lapNum === lapNum ? this.cur : null;
    this.cur = null;
    if (!c || !lapMs) return null;
    const seen = c.t.filter((x) => x !== undefined).length;
    if (seen < c.n * 0.85) return null;
    // Fill small gaps so times and speeds are continuous.
    for (const key of ['t', 'v', 'thr', 'brk', 'gear', 'ers']) {
      let prev = null;
      for (let k = 0; k < c.n; k++) { if (c[key][k] === undefined) c[key][k] = prev; else prev = c[key][k]; }
      const first = c[key].find((x) => x !== null && x !== undefined);
      for (let k = 0; k < c.n && (c[key][k] === null || c[key][k] === undefined); k++) c[key][k] = first;
    }
    const lap = { lapNum, ms: lapMs, invalid, trace: c, corners: this.zones.map((z) => this.cornerStats(c, z, lapMs)) };
    const prevBest = this.best;
    this.last = lap;
    this.laps.push(lap); if (this.laps.length > 6) this.laps.shift();
    if (!invalid && (!this.best || lapMs < this.best.ms)) this.best = lap;
    return { lap, prevBest };
  }

  cornerStats(c, z, lapMs) {
    const b = (d) => Math.max(0, Math.min(c.n - 1, Math.floor(d / BUCKET)));
    const tAt = (d) => (d >= this.len ? lapMs : c.t[b(d)]);
    const time = tAt(z.to) - tAt(z.from);
    // Apex: lowest speed near the main corner.
    let kMin = b(z.apex), vMin = Infinity;
    for (let k = b(Math.max(z.from, z.apex - 150)); k <= b(Math.min(z.to, z.apex + 150)); k++) if (c.v[k] < vMin) { vMin = c.v[k]; kMin = k; }
    // Braking point: walk back from the apex while braking.
    let kBrake = null;
    for (let k = kMin; k >= b(z.from); k--) { if (c.brk[k] > 0.25) kBrake = k; else if (kBrake !== null) break; }
    // Back on full throttle after the apex.
    let kThr = null;
    for (let k = kMin; k <= b(z.to); k++) if (c.thr[k] > 0.9) { kThr = k; break; }
    let lock = 0, spin = 0;
    for (let k = b(z.from); k <= b(z.to); k++) { lock += c.lock[k] || 0; spin += c.spin[k] || 0; }
    const apexD = kMin * BUCKET;
    return {
      time, vMin: Number.isFinite(vMin) ? r0(vMin) : null, gear: c.gear[kMin],
      brakeBefore: kBrake !== null ? r0(apexD - kBrake * BUCKET) : null, // metres before the apex
      braked: kBrake !== null,
      throttleAfter: kThr !== null ? r0(kThr * BUCKET - apexD) : null,  // metres after the apex
      lock, spin,
    };
  }

  // Specific advice for one corner on a lap, against your best lap. Returns null if nothing stands out.
  advise(k, lap, ref) {
    const z = this.zones[k];
    const a = lap.corners[k], r = ref && ref.corners[k];
    if (!z || !a) return null;
    const bits = [], fixes = [];
    let kind = 'line';
    if (a.lock >= 2) { bits.push('you locked the fronts'); fixes.push('Ease off the pedal as you turn in.'); kind = 'lockup'; }
    if (r && a.braked && r.braked && a.brakeBefore !== null && r.brakeBefore !== null) {
      const d = a.brakeBefore - r.brakeBefore;
      if (d >= 8) { bits.push(`you braked ${r0(d)} m earlier than your best lap`); fixes.push(`Brake later, about ${r.brakeBefore} m before the apex like your best lap.`); kind = kind === 'line' ? 'early-brake' : kind; }
      else if (d <= -8 && r.vMin - a.vMin >= 3) { bits.push(`you braked ${r0(-d)} m later than your best but over-slowed`); fixes.push('Brake a touch earlier and lighter, and roll more speed to the apex.'); kind = kind === 'line' ? 'overdrive' : kind; }
    }
    if (r && r.vMin - a.vMin >= 4) {
      bits.push(`${r0(r.vMin - a.vMin)} km/h slower at the apex (${a.vMin} against ${r.vMin})`);
      if (kind === 'line') { fixes.push('Release the brake earlier and let the car carry speed in.'); kind = 'apex'; }
    }
    if (r && a.throttleAfter !== null && r.throttleAfter !== null && a.throttleAfter - r.throttleAfter >= 12) {
      bits.push(`back on full throttle ${r0(a.throttleAfter - r.throttleAfter)} m later`);
      if (kind === 'line') { fixes.push('Get the car turned earlier so you can pick up the throttle sooner.'); kind = 'exit'; }
    }
    if (a.spin >= 3) { bits.push('wheelspin on the exit'); fixes.push('Squeeze the throttle and short-shift out of it.'); if (kind === 'line') kind = 'traction'; }
    if (r && a.gear && r.gear && a.gear < r.gear) bits.push(`gear ${a.gear} at the apex, your best lap used ${r.gear}`);
    if (!bits.length) return null;
    return { kind, corner: z.name, short: z.short, text: `${z.name}: ${bits.join(', ')}.`, fix: fixes[0] || 'Copy your best lap there: same brake point, same apex speed.', bits };
  }

  // Battery: where you spent it and where you got it back, for 2025-spec cars (4 MJ store).
  ers(lap) {
    const c = lap.trace;
    const pct = (j) => (j === null || j === undefined ? null : (j / 4e6) * 100);
    const start = pct(c.ers[0]), end = pct(c.ers[c.n - 1]);
    if (start === null || end === null) return null;
    // Full-throttle runs of 300 m or more are the straights.
    const runs = [];
    let s = null;
    for (let k = 0; k < c.n; k++) {
      const full = c.thr[k] > 0.95 && c.brk[k] < 0.05;
      if (full && s === null) s = k;
      if ((!full || k === c.n - 1) && s !== null) { if ((k - s) * BUCKET >= 300) runs.push({ from: s * BUCKET, to: k * BUCKET, used: pct(c.ers[s]) - pct(c.ers[k]) }); s = null; }
    }
    // No long full-throttle runs seen (wet, traffic): use the track's known straights.
    if (!runs.length) for (const st of this.map?.straights || []) {
      const a = Math.floor(st.from / BUCKET), z = Math.min(c.n - 1, Math.floor(st.to / BUCKET));
      runs.push({ from: st.from, to: st.to, used: pct(c.ers[a]) - pct(c.ers[z]) });
    }
    const name = (r) => `the run from ${cornerBefore(this.zones, r.from)?.name || 'the start'} to ${cornerAfter(this.zones, r.to)?.name || 'the line'}`;
    runs.forEach((r) => { r.name = name(r); r.len = r.to - r.from; });
    // Biggest stops are where you harvest the most.
    const stops = this.zones.map((z, k) => ({ z, a: lap.corners[k] })).filter((x) => x.a && x.a.braked && x.a.brakeBefore > 60).sort((x, y) => y.a.brakeBefore - x.a.brakeBefore);
    return { start: r0(start), end: r0(end), runs, longest: [...runs].sort((x, y) => y.len - x.len)[0] || null, shortest: [...runs].sort((x, y) => x.len - y.len)[0] || null, bigStop: stops[0]?.z || null };
  }

  state() {
    return {
      named: !!this.map?.named,
      len: this.len || null,
      zones: this.zones.map((z) => ({ name: z.name, short: z.short, labels: z.labels, from: r0(z.from), to: r0(z.to), apex: r0(z.apex) })),
    };
  }
}

module.exports = { Coach, zonesFor, BUCKET };
