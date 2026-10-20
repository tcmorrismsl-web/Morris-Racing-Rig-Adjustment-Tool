// F1 25 setup recommendations for the 2025 cars and the 2026 Season Pack cars.
// Values are full setup-screen numbers, clamped to the game's ranges.

import { F1_TRACKS, F1_RANGES as R } from './data.js?v=mvg687ce';

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const roundTo = (v, step) => Math.round(v / step) * step;

export const F1_STYLES = [
  { id: 'stable', label: 'Stable', hint: 'Forgiving. Good while learning the wheel.' },
  { id: 'balanced', label: 'Balanced', hint: 'A middle ground for most races.' },
  { id: 'aggressive', label: 'Aggressive', hint: 'Sharp and fast, less margin for error.' },
];

export const F1_COMPOUNDS = [
  { id: 'soft', label: 'Soft' },
  { id: 'medium', label: 'Medium' },
  { id: 'hard', label: 'Hard' },
  { id: 'inter', label: 'Inter' },
  { id: 'wet', label: 'Wet' },
];

// F1 25's race distances, as a share of the full Grand Prix.
export const F1_DISTANCES = [
  { id: 'laps5', label: '5 laps', laps: () => 5 },
  { id: '25', label: '25%', pct: 0.25 },
  { id: '35', label: '35%', pct: 0.35 },
  { id: '50', label: '50%', pct: 0.5 },
  { id: '100', label: '100%', pct: 1 },
];
export const lapsFor = (track, pct) => Math.max(1, Math.round(track.laps * pct));

export function f1Setup(input) {
  const era = Number(input.era) === 2026 ? 2026 : 2025;
  const track = F1_TRACKS.find((t) => t.id === input.track) || F1_TRACKS[0];
  const quali = input.session === 'quali';
  const compound = F1_COMPOUNDS.some((c) => c.id === input.compound) ? input.compound : quali ? 'soft' : 'medium';
  // Inters or full wets mean a wet setup, whatever the weather setting says.
  const wet = input.weather === 'wet' || compound === 'inter' || compound === 'wet';
  const laps = quali ? 0 : Math.max(0, Math.round(Number(input.laps) || 0));
  const share = laps ? laps / track.laps : null; // share of a full Grand Prix
  // short: tyre life barely matters. long: protect the tyres.
  const runLength = quali ? 'quali' : share === null ? 'medium' : share <= 0.2 ? 'short' : share <= 0.5 ? 'medium' : 'long';
  const short = runLength === 'short', longRun = runLength === 'long';
  const style = input.style || 'balanced';
  const stable = style === 'stable', aggressive = style === 'aggressive';
  const v = {}, why = {};
  const notes = [];

  // ---------------- Aero ----------------
  const fwMap = [5, 15, 26, 36, 50], rwMap = [2, 10, 20, 30, 46];
  let fw = fwMap[track.df - 1], rw = rwMap[track.df - 1];
  if (wet) { fw += 6; rw += 6; }
  if (era === 2026) { fw += 6; rw -= 4; }
  if (stable) rw += 3;
  if (aggressive) rw -= 2;
  v.frontWing = clamp(Math.round(fw), R.frontWing);
  v.rearWing = clamp(Math.round(rw), R.rearWing);
  why.frontWing = track.df >= 4 ? 'High-downforce track.' : track.df <= 2 ? 'Low-drag track with long straights.' : 'Medium downforce.';
  why.rearWing = era === 2026 ? 'Active aero opens the wings on straights, so the 2026 car runs less rear and more front.' : stable ? 'A little extra rear for stability.' : 'Front set higher than rear for turn-in.';

  // ---------------- Transmission ----------------
  let on = quali ? 80 : 65;
  if (aggressive) on += 15;
  if (stable) on -= 10;
  on -= track.traction * 2.5;
  if (wet) on -= 15;
  if (era === 2026) on -= 5;
  if (longRun) on -= 5; // less wheelspin, kinder to the rears over a long race
  let off = aggressive ? 30 : stable ? 55 : 45;
  if (wet) off += 10;
  v.diffOn = clamp(roundTo(on, 5), R.diffOn);
  v.diffOff = clamp(roundTo(off, 5), R.diffOff);
  why.diffOn = track.traction === 2 ? 'Lots of slow exits, so less lock helps traction.' : 'Higher locks for drive; lower if the rear snaps on power.';
  why.diffOff = 'Higher is more stable into corners; lower helps rotation.';

  // ---------------- Geometry ----------------
  const save = (!quali && !short) || stable;
  v.frontCamber = wet ? -3.0 : save ? (longRun ? -3.1 : -3.2) : -3.5;
  v.rearCamber = wet ? -1.5 : save ? (longRun ? -1.6 : -1.7) : -2.0;
  v.frontToe = save ? 0.05 : 0.0;
  v.rearToe = (stable || wet) ? 0.2 : 0.1;
  why.frontCamber = short && !stable ? 'Short race, so tyre wear barely matters: near-maximum for grip.' : save ? `Slightly less than maximum to save tyre wear${longRun ? ' over a long race' : ' over a race'}.` : 'Maximum for one-lap grip.';
  why.rearToe = v.rearToe > 0.1 ? 'More toe-in for rear stability.' : 'Minimum for less drag.';

  // ---------------- Suspension ----------------
  let fs = quali && !stable ? 41 : stable ? 30 : 36;
  fs -= track.bumps * 5;
  if (track.kerbs === 2) fs -= 4;
  if (wet) fs -= 6;
  let rs = quali && !stable ? 1 : stable ? 5 : 3;
  v.frontSusp = clamp(fs, R.frontSusp);
  v.rearSusp = clamp(rs, R.rearSusp);
  why.frontSusp = track.bumps || track.kerbs === 2 ? 'Softer to ride bumps and kerbs.' : 'Stiff front for response.';
  why.rearSusp = 'Soft rear for traction.';

  let fa = aggressive ? 9 : stable ? 8 : 9;
  let ra = aggressive ? 19 : stable ? 13 : 16;
  fa += (3 - track.df) * 3;
  if (wet) { fa -= 3; ra -= 4; }
  v.frontArb = clamp(fa, R.frontArb);
  v.rearArb = clamp(ra, R.rearArb);
  why.frontArb = track.df <= 2 ? 'Stiffer for high-speed direction changes.' : 'Softer front helps slow-corner turn-in.';
  why.rearArb = 'Lower if the rear steps out; higher for more rotation.';

  let fr = 21 + track.bumps + (track.kerbs === 2 ? 1 : 0);
  let rr = 48 + track.bumps * 2;
  if (track.df <= 2) rr -= 2;
  if (wet) { fr += 2; rr += 2; }
  if (era === 2026) rr += 3;
  v.frontRide = clamp(fr, R.frontRide);
  v.rearRide = clamp(rr, R.rearRide);
  why.frontRide = 'As low as possible without bottoming out.';
  why.rearRide = track.df <= 2 ? 'Less rake for lower drag.' : 'Rake adds downforce. Raise the rear for high-speed understeer.';

  // ---------------- Brakes ----------------
  v.brakePressure = clamp(stable || wet ? 95 : 100, R.brakePressure);
  let bb = aggressive || (quali && !stable) ? 56 : stable ? 57 : 55;
  if (wet) bb -= 1;
  v.brakeBias = clamp(bb, R.brakeBias);
  why.brakePressure = v.brakePressure < 100 ? 'A little lower to avoid lock-ups with the pedal.' : 'Full pressure.';
  why.brakeBias = 'Move it on track with the wheel buttons as fuel burns off and tyres wear.';

  // ---------------- Tyres ----------------
  let tf = quali && !stable ? 29.5 : stable ? 25.5 : 26.5;
  let tr = quali && !stable ? 26.5 : stable ? 23.5 : 24.0;
  if (short && !stable) { tf += 1.5; tr += 1.0; } // a few laps: closer to a quali setup
  if (longRun) { tf -= 0.3; tr -= 0.4; } // cooler tyres last longer
  if (compound === 'soft' && !quali) { tf -= 0.2; tr -= 0.2; } // softs run hot
  if (compound === 'hard') { tf += 0.3; tr += 0.3; } // hards are slow to warm
  if (wet) { tf = 25.0; tr = 23.0; }
  if (era === 2026) tr -= 2.0;
  v.frontTyre = clamp(roundTo(tf, 0.1), R.frontTyre);
  v.rearTyre = clamp(roundTo(tr, 0.1), R.rearTyre);
  why.frontTyre = quali ? 'High pressure for a quick lap.' : short ? 'A few laps only, so higher for response.' : longRun ? 'Lower to keep temperatures down over a long race.' : 'Lower to protect the tyres over a stint.';
  why.rearTyre = era === 2026 ? 'The narrower 2026 rears like lower pressure for traction.' : 'Keep rear surface temperatures near 90–100°C.';

  // ---------------- Tyre choice and strategy ----------------
  const cname = (id) => F1_COMPOUNDS.find((c) => c.id === id).label;
  let best, plan;
  if (input.weather === 'wet') {
    best = 'inter';
    plan = 'Inters for a damp track or light rain; full Wets only when there is standing water. Switch to slicks once a dry line appears.';
  } else if (quali) {
    best = 'soft'; plan = 'Softs for the fastest single lap.';
  } else if (share === null || share <= 0.2) {
    best = 'soft'; plan = 'Softs all the way. No stop needed.';
  } else if (share <= 0.4) {
    best = 'medium'; plan = 'Start on Mediums and pit once for Softs near the end, or Softs then Mediums if you want track position early.';
  } else {
    best = 'medium';
    plan = track.traction === 2 || track.kerbs === 2 ? 'Mediums then Hards, one stop. If the rears are struggling, a two-stop on Mediums is safer.' : 'Mediums then Hards, one stop around the middle of the race.';
  }
  const tyreAdvice = { compound: cname(compound), best: cname(best), ok: compound === best, plan };
  if (laps) notes.unshift(`${laps} lap${laps === 1 ? '' : 's'} is ${Math.round(share * 100)}% of the full ${track.laps}-lap race, so this is set up as a ${runLength === 'short' ? 'short race (grip over tyre life)' : runLength === 'long' ? 'long race (tyre life first)' : 'medium-length race'}.`);
  if (input.weather !== 'wet' && (compound === 'inter' || compound === 'wet')) notes.push(`${cname(compound)} tyres on a dry track overheat and wear fast, so this is set up for a wet track. Change Weather to Wet if it's raining, or pick a dry tyre.`);
  if (input.weather === 'wet' && !['inter', 'wet'].includes(compound)) notes.push('Slicks on a wet track have very little grip. Start on Inters unless the track is drying fast.');
  if (!quali && share !== null && share > 0.2 && input.weather !== 'wet') notes.push('If the mandatory pit stop is on, you must use two different dry compounds in the race.');

  // ---------------- Notes ----------------
  if (era === 2026) {
    notes.push('2026 cars are lighter and narrower with about 15% less downforce. Brake a touch earlier in fast corners than with the 2025 car.');
    notes.push('Active aero: Cornering mode is the default. Straight Line mode only works in marked zones and ends when you brake. Turn on the Active Aero assist if you do not want to manage it.');
    notes.push('Overtake mode replaces DRS. Within 1 second of the car ahead at the detection line, you get an electric boost for the rest of the lap if the battery has charge.');
    notes.push('2026 values are estimates. The Season Pack is newer, so community setups are still settling.');
  }
  if (track.only === 2026) notes.push('Madring can only be driven with the 2026 cars.');
  if (track.only === 2025) notes.push('Imola is not on the 2026 calendar.');
  if (wet) notes.push('Wet: more wing, softer suspension and less diff lock. Short-shift out of slow corners.');
  if (!quali) notes.push('Race setup trades a little one-lap pace for tyre life and consistency.');

  return { era, track, v, why, notes, tyreAdvice, laps, runLength };
}

export const F1_ROWS = [
  { group: 'Aerodynamics', items: [['frontWing', 'Front wing'], ['rearWing', 'Rear wing']] },
  { group: 'Transmission', items: [['diffOn', 'Diff on throttle', '%'], ['diffOff', 'Diff off throttle', '%']] },
  { group: 'Suspension geometry', items: [['frontCamber', 'Front camber', '°', 2], ['rearCamber', 'Rear camber', '°', 2], ['frontToe', 'Front toe', '°', 2], ['rearToe', 'Rear toe', '°', 2]] },
  { group: 'Suspension', items: [['frontSusp', 'Front suspension'], ['rearSusp', 'Rear suspension'], ['frontArb', 'Front anti-roll bar'], ['rearArb', 'Rear anti-roll bar'], ['frontRide', 'Front ride height'], ['rearRide', 'Rear ride height']] },
  { group: 'Brakes', items: [['brakePressure', 'Brake pressure', '%'], ['brakeBias', 'Front brake bias', '%']] },
  { group: 'Tyres', items: [['frontTyre', 'Front tyre pressure', ' psi', 1], ['rearTyre', 'Rear tyre pressure', ' psi', 1]] },
];

export const F1_ISSUES = [
  { id: 'us-entry', label: 'Understeer on corner entry' },
  { id: 'us-mid', label: 'Understeer in fast corners' },
  { id: 'os-entry', label: 'Rear steps out on entry' },
  { id: 'os-exit', label: 'Wheelspin or snap on exit' },
  { id: 'kerbs', label: 'Unsettled over kerbs and bumps' },
  { id: 'lockup', label: 'Front lock-ups' },
  { id: 'wear', label: 'Rear tyres overheat or wear fast' },
  { id: 'speed', label: 'Slow on the straights' },
];

export function f1Fix(issue) {
  return ({
    'us-entry': ['Add 2–3 front wing.', 'Soften the front anti-roll bar by 2.', 'Lower diff off throttle by 5%.'],
    'us-mid': ['Raise rear ride height by 1–2.', 'Add 2 front wing.', 'Soften the front anti-roll bar by 1–2.'],
    'os-entry': ['Raise diff off throttle by 5–10%.', 'Move brake bias 1% forward.', 'Add 0.05° rear toe.'],
    'os-exit': ['Lower diff on throttle by 5–10%.', 'Soften the rear suspension and rear anti-roll bar by 2.', 'Add 2–3 rear wing.'],
    kerbs: ['Soften front suspension by 4–5.', 'Raise ride height by 1 at both ends.'],
    lockup: ['Move brake bias 1–2% rearward.', 'Lower brake pressure to 95%.'],
    wear: ['Lower rear tyre pressure by 0.4 psi.', 'Lower diff on throttle by 5%.', 'Make rear camber 0.2° less negative.'],
    speed: ['Take 2–3 off both wings.', 'Lower rear ride height by 1–2.'],
  })[issue] || [];
}
