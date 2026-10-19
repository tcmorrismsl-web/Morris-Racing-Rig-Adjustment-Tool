// Forza Motorsport tune recommendations.
// Builds starting values from track character, car class, drivetrain and conditions.
// Absolute values use Forza's own slider scales; items Forza scales per car
// (springs, ride height, aero, gearing) are given as changes from the car's default tune.

import { FORZA_TRACKS, FORZA_CLASSES } from './data.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r1 = (v) => Math.round(v * 10) / 10;
const fmtSigned = (v, unit = '') => `${v > 0 ? '+' : ''}${v}${unit}`;
const psi = (v) => `${r1(v).toFixed(1)} psi`;
const deg = (v) => `${r1(v).toFixed(1)}°`;

export const DRIVETRAINS = [
  { id: 'fwd', label: 'FWD' },
  { id: 'rwd', label: 'RWD' },
  { id: 'awd', label: 'AWD' },
];

export function forzaTune(input) {
  const track = FORZA_TRACKS.find((t) => t.id === input.track) || FORZA_TRACKS[0];
  const cls = FORZA_CLASSES.find((c) => c.id === input.cls) || FORZA_CLASSES[4];
  const dt = input.drivetrain || 'rwd';
  const wet = input.weather === 'wet';
  const night = input.time === 'night';
  // Temperature steps: -1 cool, 0 mild, +1 hot. Night pulls it one step cooler.
  let temp = { cool: -1, mild: 0, hot: 1 }[input.temp || 'mild'];
  if (night) temp = Math.max(-1, temp - 1);
  const length = input.length || 'medium'; // sprint | medium | long
  const wear = !!input.tyreWear;
  const aero = input.aero ?? cls.tier >= 2;
  const tier = cls.tier; // 0..3
  const long = length === 'long';

  const sections = [];
  const notes = [];

  // ---------------- Tyres ----------------
  let pf = 28.5, pr = 28.5;
  pf += temp * -1.0; pr += temp * -1.0; // cool air: start higher so they reach target hot
  if (wet) { pf -= 0.5; pr -= 0.5; }
  if (dt === 'fwd') pf -= 0.5; // driven + steering fronts run hotter
  if (dt === 'rwd') pr -= 0.5;
  if (long && wear) { pf += 0.5; pr += 0.5; }
  sections.push({
    title: 'Tyres',
    rows: [
      { label: 'Front pressure (cold)', value: psi(pf), why: 'Aim for about 30–32 psi hot. Check in telemetry after 2–3 corners.' },
      { label: 'Rear pressure (cold)', value: psi(pr), why: temp < 0 ? 'Cool track, so tyres build heat slowly. Started higher to reach the hot target.' : temp > 0 ? 'Hot track, so pressures climb fast. Started lower.' : 'Mild conditions. Adjust 0.5 psi at a time.' },
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
  const caster = track.speed >= 3 ? 6.0 : 5.5;
  sections.push({
    title: 'Alignment',
    rows: [
      { label: 'Front camber', value: deg(cf), why: track.speed === 1 ? 'Extra negative camber for long, tight corners.' : 'Grip through the corners without hurting braking.' },
      { label: 'Rear camber', value: deg(cr) },
      { label: 'Front toe', value: deg(tf), why: tf < 0 ? 'Slight toe-out sharpens turn-in on a front-driver.' : 'Neutral.' },
      { label: 'Rear toe', value: deg(tr), why: tr > 0 ? 'Slight toe-in keeps the rear stable on exit.' : tr < 0 ? 'Slight toe-out helps the rear rotate.' : 'Neutral.' },
      { label: 'Caster', value: deg(caster), why: caster > 5.5 ? 'More caster for stability at speed.' : 'Default-ish caster for turn-in.' },
    ],
  });

  // ---------------- Anti-roll bars (1–65) ----------------
  let af = { fwd: 18, rwd: 30, awd: 26 }[dt];
  let ar = { fwd: 38, rwd: 22, awd: 30 }[dt];
  const tierAdj = [-4, 0, 3, 6][tier];
  af += tierAdj; ar += tierAdj;
  af -= track.bumps * 3; ar -= track.bumps * 3;
  if (wet) { af -= 4; ar -= 4; }
  af = clamp(Math.round(af), 1, 65); ar = clamp(Math.round(ar), 1, 65);
  sections.push({
    title: 'Anti-roll bars',
    rows: [
      { label: 'Front', value: `${af}`, why: dt === 'fwd' ? 'Soft front lets the driven wheels find grip.' : 'Front set firmer than rear for a stable platform.' },
      { label: 'Rear', value: `${ar}`, why: dt === 'fwd' ? 'Stiff rear is the main fix for front-driver understeer.' : wet ? 'Softened for wet grip.' : 'Softer rear helps traction out of corners.' },
    ],
    hint: 'Forza scale is 1–65.',
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
      { label: 'Springs', value: springPct === 0 ? 'Default' : `${fmtSigned(springPct, '%')} both ends`, why: springPct < 0 ? 'Softer so the tyres stay on the road over bumps and crests.' : springPct > 0 ? 'Firmer for a smooth, fast track.' : 'The default tune is a fine start here.', rel: true },
      { label: 'Spring balance', value: dt === 'fwd' ? 'Keep rear stiffer than front' : 'Keep front slightly stiffer than rear', rel: true },
      { label: 'Ride height', value: rideClicks === 0 ? 'Minimum' : `Minimum ${fmtSigned(rideClicks)} click${rideClicks > 1 ? 's' : ''}`, why: rideClicks ? 'Clearance for bumps, crests and kerbs. Lower 1 click if the car never bottoms out.' : 'Smooth track, so run it low.', rel: true },
    ],
  });

  // ---------------- Damping (1–20) ----------------
  let rb = [7, 9, 11, 13][tier];
  let bp = rb * 0.6;
  rb -= track.bumps; bp -= track.bumps;
  if (wet) { rb -= 1; bp -= 1; }
  const rbf = clamp(r1(rb), 1, 20), rbr = clamp(r1(dt === 'fwd' ? rb + 0.5 : rb - 0.5), 1, 20);
  const bpf = clamp(r1(bp), 1, 20), bpr = clamp(r1(dt === 'fwd' ? bp + 0.3 : bp - 0.3), 1, 20);
  sections.push({
    title: 'Damping',
    rows: [
      { label: 'Rebound (front / rear)', value: `${rbf.toFixed(1)} / ${rbr.toFixed(1)}` },
      { label: 'Bump (front / rear)', value: `${bpf.toFixed(1)} / ${bpr.toFixed(1)}`, why: track.bumps ? 'Softer bump so the car rides the bumps instead of skipping.' : 'Bump about 60% of rebound.' },
    ],
    hint: 'Forza scale is 1–20.',
  });

  // ---------------- Aero (relative %) ----------------
  if (aero) {
    let lvl = { 1: 95, 2: 70, 3: 50, 4: 25 }[track.speed];
    if (wet) lvl = Math.min(100, lvl + 20);
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
  } else {
    notes.push('No adjustable aero selected. If your car has a wing upgrade, turn on "Adjustable aero" for downforce values.');
  }

  // ---------------- Brakes ----------------
  let bal = { fwd: 50, rwd: 52, awd: 51 }[dt];
  if (wet) bal += 1;
  sections.push({
    title: 'Brakes',
    rows: [
      { label: 'Balance (front)', value: `${bal}%`, why: dt === 'fwd' ? 'Slightly rearward to help a front-driver rotate.' : wet ? 'One step forward for stability in the wet.' : 'Stable on entry with some rotation.' },
      { label: 'Pressure', value: wet ? '95%' : '105%', why: 'Lower by 5% at a time if the brakes lock with the pedal.' },
    ],
  });

  // ---------------- Differential ----------------
  const slow = track.speed === 1;
  const diffRows = [];
  const adj = (v) => clamp(Math.round(v), 0, 100);
  const accAdj = (slow ? -10 : 0) + (wet ? -10 : 0) + (long && wear ? -5 : 0);
  const decAdj = wet ? 5 : 0;
  if (dt === 'fwd') {
    diffRows.push({ label: 'Front acceleration', value: `${adj(28 + accAdj * 0.5)}%`, why: 'Low lock stops the car pushing wide on exit.' });
    diffRows.push({ label: 'Front deceleration', value: `${adj(10 + decAdj)}%` });
  } else if (dt === 'rwd') {
    diffRows.push({ label: 'Rear acceleration', value: `${adj(55 + accAdj)}%`, why: slow ? 'Lower for tight hairpins so the car turns on power.' : 'Traction without too much push.' });
    diffRows.push({ label: 'Rear deceleration', value: `${adj(20 + decAdj)}%`, why: 'Raise if the rear steps out on entry.' });
  } else {
    diffRows.push({ label: 'Front acceleration', value: `${adj(20 + accAdj * 0.5)}%` });
    diffRows.push({ label: 'Front deceleration', value: `${adj(5 + decAdj)}%` });
    diffRows.push({ label: 'Rear acceleration', value: `${adj(55 + accAdj)}%` });
    diffRows.push({ label: 'Rear deceleration', value: `${adj(20 + decAdj)}%` });
    diffRows.push({ label: 'Center balance (rear)', value: wet ? '65%' : '70%', why: 'Rear-biased so the car rotates. Lower it if the rear slides on power.' });
  }
  sections.push({ title: 'Differential', rows: diffRows });

  // ---------------- Gearing ----------------
  const gear = {
    1: ['3–5 clicks shorter', 'Few straights, so acceleration out of slow corners matters most.'],
    2: ['1–2 clicks shorter', 'Slightly quicker acceleration without topping out.'],
    3: ['Default, or 1–2 longer', 'Only lengthen if you hit the limiter.'],
    4: ['2–4 clicks longer', 'Top speed matters on the long straights.'],
  }[track.straight];
  sections.push({
    title: 'Gearing',
    rows: [
      { label: 'Final drive', value: gear[0], why: `${gear[1]} Check you are just short of the limiter at the end of ${track.straightName}.`, rel: true },
    ],
  });

  // ---------------- Notes ----------------
  notes.unshift(track.note);
  if (tier === 0) notes.push('Low classes often have few tuning options. Tyres, pressures and alignment matter most.');
  if (wet) notes.push('Wet: be gentle on the throttle on exit. Lap 1 grip is lowest until tyres warm.');
  if (night) notes.push('Night: brake markers are harder to see, so brake a little earlier on lap 1.');
  if (long) notes.push(wear ? 'Long race with tyre wear: this tune leans stable and easy on tyres. That beats an edgy quali tune by the final laps.' : 'Long race: consistency beats one fast lap.');
  if (input.fuel) notes.push('Fuel use is on: the car gets lighter through the race, so it will feel more nervous late on.');
  notes.push('If the race is a spec event, tuning may be locked. Wheel settings still apply.');

  return { track, cls, sections, notes };
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
