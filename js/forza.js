// Forza Motorsport tune recommendations.
// Builds starting values from track character, car class, drivetrain and conditions.
// Absolute values use Forza's own slider scales; items Forza scales per car
// (springs, ride height, aero, gearing) are given as changes from the car's default tune.

import { FORZA_TRACKS, FORZA_CLASSES } from './data.js?v=mvg5074w';
import { classFromPi, hasPart, PARTS, TYRES } from './garage.js?v=mvg5074w';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r1 = (v) => Math.round(v * 10) / 10;
const fmtSigned = (v, unit = '') => `${v > 0 ? '+' : ''}${v}${unit}`;
const psi = (v) => `${r1(v).toFixed(1)} psi`;
const deg = (v) => `${r1(v).toFixed(1)}°`;
const abs = (target, dp, unit = '') => ({ type: 'abs', target, dp, unit });

// Compares a value you have in the game now with the recommendation.
// Returns { ok, text } or null when nothing usable was entered.
export function compareValue(cmp, raw) {
  if (!cmp || raw === '' || raw === null || raw === undefined) return null;
  const cur = Number(raw);
  if (!Number.isFinite(cur)) return null;
  const f = (v, dp) => Number(v).toFixed(dp);
  if (cmp.type === 'abs') {
    let { target, dp, unit = '' } = cmp;
    // Pressures entered in bar: compare in bar.
    if (unit === ' psi' && cur > 0 && cur < 5) { target *= 0.0689476; dp = 2; unit = ' bar'; }
    target = Number(f(target, dp));
    const diff = Number(f(target - cur, dp));
    if (Math.abs(diff) < 10 ** -dp / 2) return { ok: true, text: 'Already set' };
    return { ok: false, text: `Change to ${f(target, dp)}${unit} (${diff > 0 ? '+' : ''}${f(diff, dp)})` };
  }
  if (cmp.type === 'pct') {
    if (!cmp.pct) return { ok: true, text: 'Keep it' };
    const dp = Number.isInteger(cur) && Math.abs(cur) >= 50 ? 0 : cur >= 10 ? 1 : 2;
    return { ok: false, text: `Change to ${f(cur * (1 + cmp.pct / 100), dp)}` };
  }
  if (cmp.type === 'gear') {
    const [a, b] = cmp.clicks.map((c) => Number(f(cur + c * 0.01, 2)));
    const lo = Math.min(a, b), hi = Math.max(a, b);
    if (lo <= cur && cur <= hi) return { ok: true, text: 'Already in range' };
    return { ok: false, text: `Change to about ${f(lo, 2)}–${f(hi, 2)}` };
  }
  if (cmp.type === 'clicks') {
    if (!cmp.n) return { ok: true, text: `Keep at ${raw}` };
    return { ok: false, text: `${cmp.n > 0 ? 'Raise' : 'Lower'} ${Math.abs(cmp.n)} click from ${raw}` };
  }
  return null;
}

export const DRIVETRAINS = [
  { id: 'fwd', label: 'FWD' },
  { id: 'rwd', label: 'RWD' },
  { id: 'awd', label: 'AWD' },
];

export const COMPOUNDS = [
  { id: 'soft', label: 'Soft' },
  { id: 'medium', label: 'Medium' },
  { id: 'hard', label: 'Hard' },
  { id: 'wet', label: 'Wet' },
];

// Race start times, on the hour.
export const START_TIMES = Array.from({ length: 24 }, (_, h) => ({
  id: `${String(h).padStart(2, '0')}:00`,
  label: `${h % 12 || 12}:00 ${h < 12 ? 'AM' : 'PM'}`,
}));

// Rough race duration from laps: average speed by class tier, scaled by how fast the track is.
export function estimateRace(track, tier, laps) {
  const mph = [60, 75, 90, 105][tier] * { 1: 0.8, 2: 0.95, 3: 1.05, 4: 1.15 }[track.speed];
  const lapMin = (track.miles / mph) * 60;
  return { lapMin, minutes: Math.round(lapMin * laps) };
}

export function forzaTune(input) {
  const track = FORZA_TRACKS.find((t) => t.id === input.track) || FORZA_TRACKS[0];
  // A garage car, when chosen, overrides class, drivetrain and aero.
  const car = input.car || null;
  const carCls = car ? classFromPi(car.pi) : null;
  const cls = FORZA_CLASSES.find((c) => c.id === (carCls || input.cls)) || FORZA_CLASSES[4];
  const dt = (car && car.drivetrain) || input.drivetrain || 'rwd';
  const wet = input.weather === 'wet';
  const startHour = input.start ? Number(String(input.start).slice(0, 2)) : null;
  const night = startHour !== null ? startHour >= 19 || startHour < 7 : input.time === 'night';
  // Temperature steps: -1 cool, 0 mild, +1 hot. Night pulls it one step cooler.
  let temp = { cool: -1, mild: 0, hot: 1 }[input.temp || 'mild'];
  if (night) temp = Math.max(-1, temp - 1);
  const wear = !!input.tyreWear;
  const laps = Math.max(0, Math.round(Number(input.laps) || 0));
  const est = laps ? estimateRace(track, cls.tier, laps) : null;
  // sprint | medium | long: from the lap count when given, otherwise picked directly.
  const length = est ? (est.minutes < 15 ? 'sprint' : est.minutes <= 35 ? 'medium' : 'long') : input.length || 'medium';
  const compound = COMPOUNDS.some((c) => c.id === input.compound) ? input.compound : 'medium';
  const aero = car ? hasPart(car, 'aero') : (input.aero ?? cls.tier >= 2);
  const tier = cls.tier; // 0..3
  const long = length === 'long';
  // Forgiving (default): stable and predictable, built around Normal steering and stability control on.
  // Sharp: the more pointy, faster setup for drivers who run with fewer assists.
  const easy = input.feel !== 'sharp';

  const sections = [];
  const notes = [];

  // ---------------- Tyres ----------------
  let pf = 28.5, pr = 28.5;
  pf += temp * -1.0; pr += temp * -1.0; // cool air: start higher so they reach target hot
  if (wet) { pf -= 0.5; pr -= 0.5; }
  if (dt === 'fwd') pf -= 0.5; // driven + steering fronts run hotter
  if (dt === 'rwd') pr -= 0.5;
  if (long && wear) { pf += 0.5; pr += 0.5; }
  if (compound === 'soft') { pf -= 0.5; pr -= 0.5; } // softs heat up fast
  if (compound === 'hard' || compound === 'wet') { pf += 0.5; pr += 0.5; } // slow to warm
  // Which compound suits this race.
  const mins = est ? est.minutes : { sprint: 10, medium: 25, long: 45 }[length];
  const best = wet ? 'wet' : !wear || mins <= 15 ? 'soft' : mins <= 35 ? 'medium' : 'hard';
  const cname = (id) => COMPOUNDS.find((c) => c.id === id).label;
  const bestWhy = {
    wet: 'The only tyre with real grip on a wet track.',
    soft: !wear ? 'Tyre wear is off, so the grippiest tyre lasts the whole race.' : 'Short race, so the extra grip is worth more than how long they last.',
    medium: 'Grippy enough, and holds up for a race this long.',
    hard: 'Lasts a long race without fading. Medium is quicker if you plan to pit.',
  }[best];
  const compoundRow = {
    label: 'Compound', value: cname(compound),
    why: compound === best ? `Good choice. ${bestWhy}` : `${cname(best)} is the better pick${est ? ` for about ${est.minutes} minutes` : ''}. ${bestWhy} Pressures below are set for ${cname(compound)}.`,
  };
  sections.push({
    title: 'Tyres',
    rows: [
      compoundRow,
      { key: 'pf', cmp: abs(pf, 1, ' psi'), label: 'Front pressure (cold)', value: psi(pf), why: 'Aim for about 30–32 psi hot. Check in telemetry after 2–3 corners.' },
      { key: 'pr', cmp: abs(pr, 1, ' psi'), label: 'Rear pressure (cold)', value: psi(pr), why: temp < 0 ? 'Cool track, so tyres build heat slowly. Started higher to reach the hot target.' : temp > 0 ? 'Hot track, so pressures climb fast. Started lower.' : 'Mild conditions. Adjust 0.5 psi at a time.' },
    ],
  });

  // ---------------- Alignment ----------------
  let cf = [-1.3, -1.6, -2.0, -2.4][tier];
  if (track.speed === 1) cf -= 0.3; // tight corners load the outside front hard
  if (wet) cf += 0.3;
  if (long && wear) cf += 0.3;
  cf = clamp(cf, -3.0, -0.8);
  const cr = clamp(cf * 0.6, -2.0, -0.5);
  let tf = 0.0, tr = 0.0;
  if (dt === 'fwd') { tf = -0.1; tr = -0.1; }
  if (dt === 'rwd') { tr = 0.1; }
  if (wet && dt !== 'fwd') tr += 0.1;
  if (easy) { if (dt === 'fwd') { tf = 0.0; tr = 0.0; } else tr = Math.max(tr, 0.1); } // calmer: rear toe-in steadies a RWD/AWD car; a FWD car keeps neutral rear toe so it still turns
  const caster = track.speed >= 3 ? 6.0 : 5.5;
  sections.push({
    title: 'Alignment',
    rows: [
      { key: 'cf', cmp: abs(cf, 1, '°'), label: 'Front camber', value: deg(cf), why: track.speed === 1 ? 'Extra negative camber for long, tight corners.' : 'Grip through the corners without hurting braking.' },
      { key: 'cr', cmp: abs(cr, 1, '°'), label: 'Rear camber', value: deg(cr) },
      { key: 'tf', cmp: abs(tf, 1, '°'), label: 'Front toe', value: deg(tf), why: tf < 0 ? 'Slight toe-out sharpens turn-in on a front-driver.' : 'Neutral.' },
      { key: 'tr', cmp: abs(tr, 1, '°'), label: 'Rear toe', value: deg(tr), why: tr > 0 ? 'Slight toe-in keeps the rear stable on exit.' : tr < 0 ? 'Slight toe-out helps the rear rotate.' : 'Neutral.' },
      { key: 'caster', cmp: abs(caster, 1, '°'), label: 'Caster', value: deg(caster), why: caster > 5.5 ? 'More caster for stability at speed.' : 'Default-ish caster for turn-in.' },
    ],
  });

  // ---------------- Anti-roll bars (1–65) ----------------
  let af = { fwd: 18, rwd: 30, awd: 26 }[dt];
  let ar = { fwd: 38, rwd: 22, awd: 30 }[dt];
  const tierAdj = [-4, 0, 3, 6][tier];
  af += tierAdj; ar += tierAdj;
  af -= track.bumps * 3; ar -= track.bumps * 3;
  if (wet) { af -= 4; ar -= 4; }
  if (easy) { af -= 2; ar -= dt === 'fwd' ? 0 : 3; } // softer = more grip and a calmer car
  const fp = car?.frontPct;
  if (fp >= 56) { af -= 2; ar += 2; }
  if (fp && fp <= 46) { af += 2; ar -= 2; }
  af = clamp(Math.round(af), 1, 65); ar = clamp(Math.round(ar), 1, 65);
  sections.push({
    title: 'Anti-roll bars',
    rows: [
      { key: 'af', cmp: abs(af, 0), label: 'Front', value: `${af}`, why: dt === 'fwd' ? 'Soft front lets the driven wheels find grip.' : 'Front set firmer than rear for a stable platform.' },
      { key: 'ar', cmp: abs(ar, 0), label: 'Rear', value: `${ar}`, why: dt === 'fwd' ? 'Stiff rear is the main fix for front-driver understeer.' : wet ? 'Softened for wet grip.' : 'Softer rear helps traction out of corners.' },
    ],
    hint: fp >= 56 || (fp && fp <= 46) ? `Forza scale is 1–65. Adjusted for this car's ${fp}% front weight.` : 'Forza scale is 1–65.',
  });

  // ---------------- Springs & ride height (relative) ----------------
  let springPct = 0;
  springPct -= track.bumps * 5;
  if (track.speed >= 3 && track.bumps === 0) springPct += 5;
  if (wet) springPct -= 10;
  const rideClicks = Math.min(2, track.bumps + (track.elev === 2 ? 1 : 0)) + (wet ? 1 : 0);
  sections.push({
    title: 'Springs and ride height',
    rows: [
      ...['Front', 'Rear'].map((end, i) => ({ key: i ? 'sr' : 'sf', cmp: { type: 'pct', pct: springPct }, label: `${end} springs`, value: springPct === 0 ? 'Default' : fmtSigned(springPct, '%'), why: i ? undefined : springPct < 0 ? 'Softer so the tyres stay on the road over bumps and crests.' : springPct > 0 ? 'Firmer for a smooth, fast track.' : 'The default tune is a fine start here.', rel: true })),
      { label: 'Spring balance', value: dt === 'fwd' ? 'Keep rear stiffer than front' : 'Keep front slightly stiffer than rear', rel: true },
      { label: 'Ride height', value: rideClicks === 0 ? 'Minimum' : `Minimum ${fmtSigned(rideClicks)} click${rideClicks > 1 ? 's' : ''}`, why: rideClicks ? 'Clearance for bumps, crests and kerbs. Lower 1 click if the car never bottoms out.' : 'Smooth track, so run it low.', rel: true },
    ],
  });

  // ---------------- Damping (1–20) ----------------
  let rb = [7, 9, 11, 13][tier];
  let bp = rb * 0.6;
  rb -= track.bumps; bp -= track.bumps;
  if (wet) { rb -= 1; bp -= 1; }
  if (easy) { rb -= 0.5; bp -= 0.3; }
  const rbf = clamp(r1(rb), 1, 20), rbr = clamp(r1(dt === 'fwd' ? rb + 0.5 : rb - 0.5), 1, 20);
  const bpf = clamp(r1(bp), 1, 20), bpr = clamp(r1(dt === 'fwd' ? bp + 0.3 : bp - 0.3), 1, 20);
  sections.push({
    title: 'Damping',
    rows: [
      { key: 'rbf', cmp: abs(rbf, 1), label: 'Front rebound', value: rbf.toFixed(1) },
      { key: 'rbr', cmp: abs(rbr, 1), label: 'Rear rebound', value: rbr.toFixed(1) },
      { key: 'bpf', cmp: abs(bpf, 1), label: 'Front bump', value: bpf.toFixed(1), why: track.bumps ? 'Softer bump so the car rides the bumps instead of skipping.' : 'Bump about 60% of rebound.' },
      { key: 'bpr', cmp: abs(bpr, 1), label: 'Rear bump', value: bpr.toFixed(1) },
    ],
    hint: 'Forza scale is 1–20.',
  });

  // ---------------- Suspension geometry (relative) ----------------
  // Small, late adjustments. Sources agree the stock values are a good base.
  let rcF = 0, rcR = 0;
  if (track.speed === 1 && track.bumps < 2 && !wet) { rcF = 1; rcR = 1; } // tight track: a touch more response
  if (wet) rcR = -1; // lower rear roll centre for traction
  const clickTxt = (n) => (n === 0 ? 'Stock' : `${n > 0 ? 'Raise' : 'Lower'} ${Math.abs(n)} click`);
  sections.push({
    title: 'Suspension geometry',
    rows: [
      { key: 'rcf', cmp: { type: 'clicks', n: rcF }, label: 'Front roll center height offset', value: clickTxt(rcF), why: rcF ? 'A higher roll center makes the car respond faster on tight, twisty tracks.' : 'Leave it until the springs and anti-roll bars are right. It is a powerful setting.', rel: true },
      { key: 'rcr', cmp: { type: 'clicks', n: rcR }, label: 'Rear roll center height offset', value: clickTxt(rcR), why: rcR < 0 ? 'A lower rear roll center gives the rear more grip on a wet exit.' : undefined, rel: true },
      { key: 'agf', cmp: { type: 'clicks', n: 0 }, label: 'Front anti-geometry (anti-dive)', value: 'Stock', why: 'Raise it a little only if the nose dives hard under braking. Too much adds entry understeer.', rel: true },
      { key: 'agr', cmp: { type: 'clicks', n: 0 }, label: 'Rear anti-geometry (anti-squat)', value: 'Stock', why: 'Raise it a little only if the rear squats and wallows on exit. Too much makes the rear livelier.', rel: true },
    ],
    hint: 'Change these last, one click at a time. If the car\'s tuning menu has no Suspension Geometry page, skip this section.',
  });

  // ---------------- Aero (relative %) ----------------
  if (aero) {
    let lvl = { 1: 95, 2: 70, 3: 50, 4: 25 }[track.speed];
    if (wet) lvl = Math.min(100, lvl + 20);
    if (easy) lvl = Math.min(100, lvl + 10); // grip and stability over top speed
    let f = lvl, rr = lvl;
    if (dt === 'fwd') f = Math.min(100, lvl + 10);
    if (dt === 'rwd') rr = Math.min(100, lvl + 10);
    sections.push({
      title: 'Aero',
      rows: [
        { label: 'Front downforce', value: `${f}% of slider`, why: 'Percent of the way from minimum to maximum on the slider.', rel: true },
        { label: 'Rear downforce', value: `${rr}% of slider`, why: track.speed >= 4 ? 'Low drag for the long straights. Add rear if the car is nervous in fast corners.' : track.speed === 1 ? 'Few straights, so grip is worth more than top speed.' : 'Balanced grip and drag.', rel: true },
      ],
    });
  } else if (car) {
    sections.push({ title: 'Aero', part: 'aero', rows: [{ label: 'Front and rear downforce', value: 'Not adjustable yet', why: 'Fit adjustable aero in the upgrade shop, then mark it in the Garage.' }] });
  } else {
    notes.push('No adjustable aero selected. If your car has a wing upgrade, turn on "Adjustable aero" for downforce values.');
  }

  // ---------------- Brakes ----------------
  let bal = { fwd: 50, rwd: 52, awd: 51 }[dt];
  if (wet) bal += 1;
  if (easy && dt !== 'fwd') bal += 1; // a touch more front bias keeps the rear planted
  sections.push({
    title: 'Brakes',
    rows: [
      { key: 'bal', cmp: abs(bal, 0, '%'), label: 'Balance (front)', value: `${bal}%`, why: dt === 'fwd' ? 'Slightly rearward to help a front-driver rotate.' : wet ? 'One step forward for stability in the wet.' : 'Stable on entry with some rotation.' },
      { key: 'bpress', cmp: abs(wet ? 95 : 105, 0, '%'), label: 'Pressure', value: wet ? '95%' : '105%', why: 'Lower by 5% at a time if the brakes lock with the pedal.' },
    ],
  });

  // ---------------- Differential ----------------
  const slow = track.speed === 1;
  const diffRows = [];
  const adj = (v) => clamp(Math.round(v), 0, 100);
  const accAdj = (slow ? -10 : 0) + (wet ? -10 : 0) + (long && wear ? -5 : 0) + (easy ? -10 : 0);
  const decAdj = (wet ? 5 : 0) + (easy ? 5 : 0);
  if (dt === 'fwd') {
    diffRows.push({ key: 'dfa', cmp: abs(adj(28 + accAdj * 0.5), 0, '%'), label: 'Front acceleration', value: `${adj(28 + accAdj * 0.5)}%`, why: 'Low lock stops the car pushing wide on exit.' });
    diffRows.push({ key: 'dfd', cmp: abs(adj(10 + decAdj), 0, '%'), label: 'Front deceleration', value: `${adj(10 + decAdj)}%` });
  } else if (dt === 'rwd') {
    diffRows.push({ key: 'dra', cmp: abs(adj(55 + accAdj), 0, '%'), label: 'Rear acceleration', value: `${adj(55 + accAdj)}%`, why: slow ? 'Lower for tight hairpins so the car turns on power.' : 'Traction without too much push.' });
    diffRows.push({ key: 'drd', cmp: abs(adj(20 + decAdj), 0, '%'), label: 'Rear deceleration', value: `${adj(20 + decAdj)}%`, why: 'Raise if the rear steps out on entry.' });
  } else {
    diffRows.push({ key: 'dfa', cmp: abs(adj(20 + accAdj * 0.5), 0, '%'), label: 'Front acceleration', value: `${adj(20 + accAdj * 0.5)}%` });
    diffRows.push({ key: 'dfd', cmp: abs(adj(5 + decAdj), 0, '%'), label: 'Front deceleration', value: `${adj(5 + decAdj)}%` });
    diffRows.push({ key: 'dra', cmp: abs(adj(55 + accAdj), 0, '%'), label: 'Rear acceleration', value: `${adj(55 + accAdj)}%` });
    diffRows.push({ key: 'drd', cmp: abs(adj(20 + decAdj), 0, '%'), label: 'Rear deceleration', value: `${adj(20 + decAdj)}%` });
    diffRows.push({ key: 'dcb', cmp: abs(wet ? 65 : 70, 0, '%'), label: 'Center balance (rear)', value: wet ? '65%' : '70%', why: 'Rear-biased so the car rotates. Lower it if the rear slides on power.' });
  }
  sections.push({ title: 'Differential', rows: diffRows });

  // ---------------- Gearing ----------------
  // Final drive: a higher number is shorter gearing. [text, why, click range (+ = shorter)]
  const gear = {
    1: ['3–5 clicks shorter', 'Few straights, so acceleration out of slow corners matters most.', [3, 5]],
    2: ['1–2 clicks shorter', 'Slightly quicker acceleration without topping out.', [1, 2]],
    3: ['Default, or 1–2 longer', 'Only lengthen if you hit the limiter.', [-2, 0]],
    4: ['2–4 clicks longer', 'Top speed matters on the long straights.', [-4, -2]],
  }[track.straight];
  sections.push({
    title: 'Gearing',
    rows: [
      { key: 'fd', cmp: { type: 'gear', clicks: gear[2] }, label: 'Final drive', value: gear[0], why: `${gear[1]} Check you are just short of the limiter at the end of ${track.straightName}.`, rel: true },
    ],
  });

  // ---------------- Which sections this car can actually adjust ----------------
  const partFor = { 'Springs and ride height': 'suspension', Damping: 'suspension', 'Anti-roll bars': 'arb', Differential: 'diff', Gearing: 'gearing' };
  if (car) {
    for (const sec of sections) {
      const key = sec.part || partFor[sec.title];
      if (!key || hasPart(car, key)) continue;
      const part = PARTS.find((p) => p[0] === key);
      sec.locked = `This car needs ${part[1].toLowerCase()} before you can adjust ${part[2]}. Values are shown for when you fit them.`;
      if (sec.part === 'aero') sec.locked = null;
    }
  }

  // ---------------- Notes ----------------
  notes.unshift(track.note);
  if (est) notes.splice(1, 0, `${laps} lap${laps === 1 ? '' : 's'} is about ${est.minutes} minutes (around ${est.lapMin < 1 ? 'under a minute' : `${est.lapMin.toFixed(1)} min`} a lap), so this is set up as a ${length === 'sprint' ? 'short sprint' : length === 'medium' ? 'medium-length race' : 'long race'}. It's an estimate; your real lap time will vary.`);
  if (startHour !== null && est && !night) {
    const endHour = startHour + est.minutes / 60;
    if (endHour >= 19) notes.push('The race runs into the evening, so the track cools and grip rises as it goes on. Expect the car to feel better late on.');
  }
  if (compound === 'wet' && !wet) notes.push('Wet tyres on a dry track overheat and wear out fast. Only use them if rain is coming.');
  if (compound !== 'wet' && wet) notes.push('Slick tyres on a wet track have very little grip. Use Wet tyres if the race allows it.');
  if (compound === 'soft' && wear && mins > 15) notes.push('Softs will fade in the second half. Brake a little earlier as they go off.');
  notes.splice(1, 0, easy
    ? 'Forgiving: built to work with Normal steering, stability control on and Sport traction control. Stable on the brakes and on the power, for clean laps. Switch to Sharp once you want more speed.'
    : 'Sharp: pointier and faster, for driving with Simulation steering and stability control off. Less forgiving of mistakes.');
  if (car && !carCls) notes.push(`Add a PI for ${car.name} in the Garage so the tune uses the right class. Using ${cls.id} class for now.`);
  if (car && ['stock', 'street', 'sport'].includes(car.tyre)) notes.push(`${TYRES.find((t) => t.id === car.tyre).label} tyres overheat sooner than race tyres. Aim for the low end of the hot pressure target.`);
  if (tier === 0) notes.push('Low classes often have few tuning options. Tyres, pressures and alignment matter most.');
  if (wet) notes.push('Wet: be gentle on the throttle on exit. Lap 1 grip is lowest until tyres warm.');
  if (night) notes.push('Night: brake markers are harder to see, so brake a little earlier on lap 1.');
  if (long) notes.push(wear ? 'Long race with tyre wear: this tune leans stable and easy on tyres. That beats an edgy quali tune by the final laps.' : 'Long race: consistency beats one fast lap.');
  if (input.fuel) notes.push('Fuel use is on: the car gets lighter through the race, so it will feel more nervous late on.');
  notes.push('If the race is a spec event, tuning may be locked. Wheel settings still apply.');

  return { track, cls, car, drivetrain: dt, sections, notes };
}

// ---------------------------------------------------------------------------
// Handling fixes
// ---------------------------------------------------------------------------
export const FORZA_ISSUES = [
  { id: 'us-entry', label: 'Understeer on corner entry' },
  { id: 'us-mid', label: 'Understeer mid-corner' },
  { id: 'us-exit', label: 'Understeer on exit (pushes wide on power)' },
  { id: 'os-entry', label: 'Oversteer on entry or under braking' },
  { id: 'os-mid', label: 'Oversteer mid-corner' },
  { id: 'os-exit', label: 'Oversteer or wheelspin on exit' },
  { id: 'bumps', label: 'Skips or bounces over bumps and kerbs' },
  { id: 'bottom', label: 'Bottoms out on crests or compressions' },
  { id: 'lockup', label: 'Locks the brakes' },
  { id: 'hot', label: 'Tyres overheat late in the race' },
  { id: 'limiter', label: 'Hits the limiter on the straight' },
];

export function forzaFix(issue, drivetrain = 'rwd') {
  const fwd = drivetrain === 'fwd', awd = drivetrain === 'awd';
  const F = {
    'us-entry': [
      'Soften the front anti-roll bar by 2–3.',
      'Move brake balance 1% toward the rear.',
      fwd ? 'Add front toe-out: 0.1° more.' : 'Lower deceleration diff lock by 5%.',
    ],
    'us-mid': [
      'Turn in smoothly and a little later. Normal steering holds back a sudden, big input, which feels like understeer.',
      'Soften the front anti-roll bar by 2–3, or stiffen the rear by 2–3.',
      'Add 0.2° more negative front camber.',
      'If the car has aero, add front downforce.',
    ],
    'us-exit': fwd ? [
      'Lower front acceleration diff lock by 5–10%.',
      'Soften front springs by 5%.',
      'Stiffen the rear anti-roll bar by 2–3.',
    ] : awd ? [
      'Move center balance 5% further rearward.',
      'Lower front acceleration diff lock by 5%.',
      'Soften the front anti-roll bar by 2.',
    ] : [
      'Lower rear acceleration diff lock by 5%. A locked diff can push the car wide.',
      'Soften the front anti-roll bar by 2.',
      'Be patient on throttle until the car is pointed.',
    ],
    'os-entry': [
      'Raise deceleration diff lock by 5%.',
      'Move brake balance 1% toward the front.',
      'Soften the rear anti-roll bar by 2.',
    ],
    'os-mid': [
      'Soften the rear anti-roll bar by 3.',
      'If the car has aero, add rear downforce.',
      'Add 0.1° rear toe-in.',
    ],
    'os-exit': fwd ? [
      'Soften the rear anti-roll bar by 3. Front-drivers rarely oversteer on power, so check the rear is not too stiff.',
      'Reduce rear toe-out to 0.0°.',
    ] : [
      `Lower ${awd ? 'rear ' : ''}acceleration diff lock by 5–10%.`,
      'Soften rear springs by 5% and rear rebound by 1.',
      'Make rear camber 0.2° less negative for more traction.',
      awd ? 'Move center balance 5% toward the front.' : 'Use a longer 1st and 2nd gear if wheelspin is in slow corners.',
    ],
    bumps: [
      'Soften bump damping by 1–2 at both ends.',
      'Soften springs by 5%.',
      'Raise ride height by 1 click.',
    ],
    bottom: [
      'Raise ride height by 1–2 clicks.',
      'Stiffen springs by 5%.',
      'Raise bump damping by 1.',
    ],
    lockup: [
      'Lower brake pressure by 5–10%.',
      'Move brake balance 1% toward whichever end is not locking.',
      'In the MOZA app, recalibrate the brake pedal so full pressure is at the end of travel.',
    ],
    hot: [
      'Lower cold pressure by 1 psi.',
      'Make camber 0.2° less negative.',
      'Lower acceleration diff lock by 5% to reduce wheelspin heat.',
    ],
    limiter: [
      'Lengthen the final drive by 1–2 clicks.',
      'If the car has aero, take a little rear wing off.',
    ],
  };
  return F[issue] || [];
}
