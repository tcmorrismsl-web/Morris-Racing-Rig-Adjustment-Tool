// Turns lap summaries from the bridge into setup changes.
// Thresholds are deliberately conservative: a finding only appears when the
// pattern shows up across the laps being looked at, not on one bad corner.

const mean = (xs) => { const v = xs.filter((x) => x !== null && x !== undefined && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const pct = (f) => `${Math.round(f * 100)}%`;
const r1 = (v) => Math.round(v * 10) / 10;

export function fmtLap(ms) {
  if (!ms || ms <= 0) return '–';
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

export function lapStats(laps) {
  const times = laps.filter((l) => l.valid !== false).map((l) => l.timeMs).filter((t) => t > 0);
  if (!times.length) return null;
  const best = Math.min(...times);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const sd = Math.sqrt(times.reduce((a, t) => a + (t - avg) ** 2, 0) / times.length);
  return { best, avg, spread: sd, count: times.length };
}

// Average a per-lap field across laps (handles arrays of 4 wheels).
function across(laps, get) {
  const vals = laps.map(get).filter((v) => v !== null && v !== undefined);
  if (!vals.length) return null;
  if (Array.isArray(vals[0])) return [0, 1, 2, 3].map((i) => mean(vals.map((v) => v[i])));
  return mean(vals);
}

const BAL = { forza: { us: 1.2, os: 0.83 }, f1: { us: 1.25, os: 0.8 } };
const PHASE = { entry: 'on corner entry', mid: 'mid-corner', exit: 'on exit' };

function balanceFindings(laps, game, dt) {
  const out = [];
  for (const phase of ['entry', 'mid', 'exit']) {
    const r = across(laps, (l) => l.balance?.[phase]);
    if (r === null) continue;
    const t = BAL[game];
    if (r >= t.us) out.push({ key: `us-${phase}`, phase, ratio: r, kind: 'understeer' });
    else if (r <= t.os) out.push({ key: `os-${phase}`, phase, ratio: r, kind: 'oversteer' });
  }
  return out.map((b) => ({
    title: `${b.kind === 'understeer' ? 'Understeer' : 'Oversteer'} ${PHASE[b.phase]}`,
    severity: Math.abs(Math.log(b.ratio)) > 0.35 ? 'high' : 'medium',
    evidence: b.kind === 'understeer'
      ? `The front tyres slipped ${r1(b.ratio)}× as much as the rears ${PHASE[b.phase]}.`
      : `The rear tyres slipped ${r1(1 / b.ratio)}× as much as the fronts ${PHASE[b.phase]}.`,
    changes: game === 'forza' ? forzaBalanceFix(b.key, dt) : f1BalanceFix(b.key),
  }));
}

function forzaBalanceFix(key, dt) {
  const fwd = dt === 'fwd', awd = dt === 'awd';
  return ({
    'us-entry': ['Soften the front anti-roll bar by 2–3.', 'Move brake balance 1% toward the rear.'],
    'us-mid': ['Soften the front anti-roll bar by 2–3, or stiffen the rear by 2–3.', 'Add 0.2° more negative front camber.'],
    'us-exit': fwd ? ['Lower front acceleration diff lock by 5–10%.', 'Stiffen the rear anti-roll bar by 2–3.']
      : awd ? ['Move center balance 5% further rearward.', 'Lower front acceleration diff lock by 5%.']
        : ['Lower rear acceleration diff lock by 5%.', 'Soften the front anti-roll bar by 2.'],
    'os-entry': ['Raise deceleration diff lock by 5%.', 'Move brake balance 1% toward the front.'],
    'os-mid': ['Soften the rear anti-roll bar by 3.', 'If the car has aero, add a little rear downforce.'],
    'os-exit': fwd ? ['Soften the rear anti-roll bar by 3.'] : [`Lower ${awd ? 'rear ' : ''}acceleration diff lock by 5–10%.`, 'Soften rear springs by 5%.'],
  })[key];
}

function f1BalanceFix(key) {
  return ({
    'us-entry': ['Add 2 front wing.', 'Lower diff off throttle by 5%.'],
    'us-mid': ['Soften the front anti-roll bar by 2.', 'Raise rear ride height by 1.'],
    'us-exit': ['Lower diff on throttle by 5%.', 'Add 2 front wing.'],
    'os-entry': ['Raise diff off throttle by 5–10%.', 'Move brake bias 1% forward.'],
    'os-mid': ['Soften the rear anti-roll bar by 2.', 'Add 2 rear wing.'],
    'os-exit': ['Lower diff on throttle by 5–10%.', 'Soften the rear suspension by 2.'],
  })[key];
}

export function lapAdvice(laps, opts = {}) {
  if (!laps.length) return { findings: [], stats: null, laps: 0 };
  const game = laps[0].game;
  const dt = opts.drivetrain || laps[laps.length - 1].car?.drivetrain || 'rwd';
  const findings = [...balanceFindings(laps, game, dt)];

  // Wheelspin
  const spin = across(laps, (l) => l.wheelspin);
  if (spin !== null && spin >= (game === 'f1' ? 0.06 : 0.08)) {
    findings.push({
      title: 'Wheelspin on throttle',
      severity: spin > 0.2 ? 'high' : 'medium',
      evidence: `The driven wheels were spinning in ${pct(spin)} of full-throttle moments.`,
      changes: game === 'f1'
        ? ['Lower diff on throttle by 5–10%.', 'Soften the rear suspension by 2.', 'Short-shift out of slow corners.']
        : dt === 'fwd'
          ? ['Lower front acceleration diff lock by 5%.', 'Soften front springs by 5%.']
          : [`Lower ${dt === 'awd' ? 'rear ' : ''}acceleration diff lock by 5–10%.`, 'Soften rear springs by 5%.', 'Make rear camber 0.2° less negative.'],
    });
  }

  // Lock-ups
  const lf = across(laps, (l) => l.lockFront), lr = across(laps, (l) => l.lockRear);
  if (lf !== null && lf >= 0.06 && (lr === null || lf >= lr)) {
    findings.push({
      title: 'Front brakes locking',
      severity: lf > 0.15 ? 'high' : 'medium',
      evidence: `The fronts locked in ${pct(lf)} of heavy braking.`,
      changes: game === 'f1' ? ['Move brake bias 1–2% rearward.', 'Lower brake pressure to 95%.'] : ['Move brake balance 1% toward the rear.', 'Lower brake pressure by 5%.'],
    });
  } else if (lr !== null && lr >= 0.06) {
    findings.push({
      title: 'Rear brakes locking',
      severity: lr > 0.15 ? 'high' : 'medium',
      evidence: `The rears locked in ${pct(lr)} of heavy braking.`,
      changes: game === 'f1' ? ['Move brake bias 1–2% forward.', 'Raise diff off throttle by 5%.'] : ['Move brake balance 1% toward the front.', 'Raise deceleration diff lock by 5%.'],
    });
  }

  // Bottoming (Forza only; F1 doesn't send normalised travel)
  const bot = across(laps, (l) => l.bottoming);
  if (bot) {
    const front = Math.max(bot[0] ?? 0, bot[1] ?? 0), rear = Math.max(bot[2] ?? 0, bot[3] ?? 0);
    for (const [axle, v] of [['front', front], ['rear', rear]]) {
      if (v >= 0.01) {
        findings.push({
          title: `${axle === 'front' ? 'Front' : 'Rear'} suspension bottoming out`,
          severity: v > 0.04 ? 'high' : 'medium',
          evidence: `The ${axle} suspension hit full compression ${pct(v)} of the time.`,
          changes: [`Raise ${axle} ride height by 1 click.`, `Stiffen ${axle} springs by 5%.`, `Raise ${axle} bump damping by 1.`],
        });
      }
    }
  }

  // Tyre temperatures (left out when opts.noTemps is set)
  const temp = opts.noTemps ? null : across(laps, (l) => l.tyres?.temp);
  const inner = opts.noTemps ? null : across(laps, (l) => l.tyres?.inner);
  if (game === 'f1' && inner) {
    const fr = mean([inner[0], inner[1]]), rr = mean([inner[2], inner[3]]);
    for (const [axle, v, idx] of [['front', fr, 'Front'], ['rear', rr, 'Rear']]) {
      if (v === null) continue;
      if (v > 108) {
        findings.push({
          title: `${idx} tyres overheating`, severity: v > 115 ? 'high' : 'medium',
          evidence: `${idx} tyre carcass averaged ${Math.round(v)}°C. Aim for roughly 90–105°C.`,
          changes: axle === 'rear' ? ['Lower rear tyre pressure by 0.4 psi.', 'Lower diff on throttle by 5%.', 'Smoother throttle out of slow corners.']
            : ['Lower front tyre pressure by 0.4 psi.', 'Make front camber 0.1° less negative.'],
        });
      } else if (v < 85 && laps.length >= 2) {
        findings.push({
          title: `${idx} tyres running cold`, severity: 'low',
          evidence: `${idx} tyre carcass averaged ${Math.round(v)}°C. Aim for roughly 90–105°C.`,
          changes: [`Raise ${axle} tyre pressure by 0.4 psi.`],
        });
      }
    }
  }
  if (game === 'forza' && temp) {
    const fr = mean([temp[0], temp[1]]), rr = mean([temp[2], temp[3]]);
    if (fr !== null && rr !== null && Math.abs(fr - rr) >= 20) {
      const front = fr > rr;
      findings.push({
        title: `${front ? 'Front' : 'Rear'} tyres working much harder`, severity: 'low',
        evidence: `${front ? 'Fronts' : 'Rears'} averaged ${Math.round(Math.max(fr, rr))}°F against ${Math.round(Math.min(fr, rr))}°F at the other end.`,
        changes: front
          ? ['The front end is doing most of the work. Softening the front anti-roll bar by 2 spreads the load.']
          : ['The rear end is doing most of the work. Softening the rear anti-roll bar by 2 spreads the load.'],
      });
    }
  }

  // Tyre wear balance
  const wear = across(laps, (l) => l.tyres?.wear);
  if (wear) {
    const fw = mean([wear[0], wear[1]]), rw = mean([wear[2], wear[3]]);
    if (fw > 0 && rw > 0 && (fw / rw >= 1.4 || rw / fw >= 1.4)) {
      const front = fw > rw;
      findings.push({
        title: `${front ? 'Front' : 'Rear'} tyres wearing faster`, severity: 'low',
        evidence: `${front ? 'Fronts' : 'Rears'} lost ${r1(Math.max(fw, rw))}% per lap against ${r1(Math.min(fw, rw))}% at the other end.`,
        changes: front
          ? [game === 'f1' ? 'Lower front tyre pressure by 0.4 psi and soften the front anti-roll bar by 1.' : 'Make front camber 0.2° less negative and soften the front anti-roll bar by 2.']
          : [game === 'f1' ? 'Lower diff on throttle by 5% and rear tyre pressure by 0.4 psi.' : `Lower ${dt === 'fwd' ? 'front' : 'rear'} acceleration diff lock by 5% to cut wheelspin wear.`],
      });
    }
  }

  const order = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return { findings, stats: lapStats(laps), laps: laps.length };
}

// Groups laps into sessions, newest first.
export function sessions(laps) {
  const map = new Map();
  for (const l of laps) {
    if (!map.has(l.session)) map.set(l.session, { id: l.session, game: l.game, laps: [], at: l.at });
    map.get(l.session).laps.push(l);
  }
  return [...map.values()].sort((a, b) => (a.laps.at(-1).at < b.laps.at(-1).at ? 1 : -1));
}
