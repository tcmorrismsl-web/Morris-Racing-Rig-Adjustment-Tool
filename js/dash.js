// Live race dashboard. Reads the bridge's 10-per-second race stream and draws the
// track map, timing tower, pit options, adjustments and the race engineer.

import * as voice from './voice.js?v=mvhlfowh';
import { lapAdvice } from './advice.js?v=mvhlfowh';
import { talk } from './chat.js?v=mvhlfowh';
import { pfSplit } from './parcferme.js?v=mvhlfowh';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(`mr-dash-${k}`); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`mr-dash-${k}`, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

const params = new URLSearchParams(location.search);
const wantGame = params.get('game'); // optional: f1 or forza
let game = null;
let last = null;

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
function fmtLap(ms) {
  if (!ms || ms <= 0) return '–';
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return m ? `${m}:${s.toFixed(3).padStart(6, '0')}` : s.toFixed(3);
}
const fmtGap = (ms) => (ms === null || ms === undefined ? '–' : `${ms < 0 ? '-' : '+'}${(Math.abs(ms) / 1000).toFixed(Math.abs(ms) < 10000 ? 3 : 1)}`);
const fmtSec = (s) => (s === null || s === undefined ? '–' : fmtLap(s * 1000));
const clock = (mins) => (mins === null || mins === undefined ? '' : `${Math.floor(mins / 60) % 24}:${String(mins % 60).padStart(2, '0')}`);

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------
const map = { key: null, version: -1, points: [], closed: false, fetchedAt: 0, box: null, busy: false };
const flipKey = () => `flip-${map.key || game}`;
let flip = false;

// F1: +X points south and +Z west (EA's coordinate diagram), so north-up is (-z, x).
// Forza's axes aren't documented; draw (x, -z) and offer Flip if it comes out mirrored.
function project(x, z) {
  let sx, sy;
  if (game === 'f1') { sx = -z; sy = x; } else { sx = x; sy = -z; }
  return [flip ? -sx : sx, sy];
}

function fitBox(pts) {
  if (!pts.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, z] of pts) {
    const [sx, sy] = project(x, z);
    x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
  }
  const pad = Math.max(x1 - x0, y1 - y0) * 0.06 + 10;
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}

function drawOutline() {
  const pts = map.points;
  map.box = fitBox(pts);
  const svg = $('map');
  if (!map.box) { $('outline').setAttribute('d', ''); $('outline-in').setAttribute('d', ''); return; }
  svg.setAttribute('viewBox', `${map.box.x} ${map.box.y} ${map.box.w} ${map.box.h}`);
  let d = '';
  let prev = null;
  for (const [x, z] of pts) {
    const [sx, sy] = project(x, z);
    // Break the line across gaps the cars haven't covered yet.
    const jump = prev && Math.hypot(sx - prev[0], sy - prev[1]) > 60;
    d += `${!prev || jump ? 'M' : 'L'}${sx.toFixed(1)} ${sy.toFixed(1)}`;
    prev = [sx, sy];
  }
  if (map.closed) d += 'Z';
  $('outline').setAttribute('d', d);
  $('outline-in').setAttribute('d', d);
}

async function refreshTrack(m) {
  if (map.busy) return;
  const changed = m.key !== map.key;
  const due = m.version !== map.version && (changed || Date.now() - map.fetchedAt > 2500 || m.coverage >= 0.97);
  if (!changed && !due) return;
  map.busy = true;
  try {
    const t = await (await fetch(`api/track?game=${game}`, { cache: 'no-store' })).json();
    map.key = m.key; map.version = m.version; map.fetchedAt = Date.now();
    map.points = Array.isArray(t.points) ? t.points : [];
    map.length = t.length || 0;
    map.closed = !!t.complete;
    flip = store.get(flipKey(), false);
    drawOutline();
  } catch { /* try again on the next update */ }
  map.busy = false;
}

function drawCars(m) {
  const g = $('dots');
  if (!map.box && m.trail && m.trail.length) { map.points = m.trail; map.closed = false; drawOutline(); }
  if (!map.box) { g.innerHTML = ''; return; }
  const size = Math.max(map.box.w, map.box.h);
  const r = size * 0.016;
  const cars = [...m.cars].sort((a, b) => (a.me ? 1 : 0) - (b.me ? 1 : 0)); // player on top
  let html = '';
  for (const c of cars) {
    const [x, y] = project(c.x, c.z);
    const fill = c.me ? 'var(--gold)' : c.colour || '#9aa3ab';
    html += `<circle class="dot${c.pit ? ' pit' : ''}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(c.me ? r * 1.25 : r).toFixed(1)}" fill="${fill}"/>`;
    if (c.me) html += `<circle class="me-ring" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * 2).toFixed(1)}"/>`;
    if (c.pos) html += `<text class="dot-label" x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${(r * 1.3).toFixed(1)}" style="stroke-width:${(r * 0.25).toFixed(1)}px">${c.pos}</text>`;
  }
  g.innerHTML = html;
}

// Where you lost time on your last lap: each mini-sector coloured by how much.
function drawLoss(e) {
  const g = $('loss');
  const loss = e?.segLoss;
  if (!loss || !map.box || map.points.length < 20) { g.innerHTML = ''; return; }
  const n = loss.length, pts = map.points;
  let html = '';
  loss.forEach((ms, k) => {
    if (ms < 60) return;
    const a = Math.floor((k / n) * pts.length), b = Math.min(pts.length - 1, Math.ceil(((k + 1) / n) * pts.length));
    const seg = pts.slice(a, b + 1).map(([x, z]) => project(x, z).map((v) => v.toFixed(1)).join(' '));
    if (seg.length < 2) return;
    const strong = Math.min(1, ms / 400);
    html += `<path class="loss-seg" d="M${seg.join('L')}" stroke="rgba(255,${Math.round(176 - 110 * strong)},32,${(0.55 + 0.45 * strong).toFixed(2)})" stroke-width="${(5 + 5 * strong).toFixed(1)}"/>`;
  });
  g.innerHTML = html;
}

$('flip').addEventListener('click', () => {
  flip = !flip;
  store.set(flipKey(), flip);
  drawOutline();
  if (last) drawCars(last.map);
});

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------
let gapMode = store.get('gap', 'int'); // 'int' (to the car ahead) or 'leader'
$('tower-title').addEventListener('click', () => { gapMode = gapMode === 'int' ? 'leader' : 'int'; store.set('gap', gapMode); if (last) renderTower(last); });

const tyreChip = (t, age) => (t ? `<span class="tyre ${t}">${t}</span>${age !== null && age !== undefined ? `<span class="age">${age}</span>` : ''}` : '');

function renderTower(d) {
  if (d.game === 'forza') { renderForzaTiming(d); return; }
  const s = d.session;
  const race = s.race;
  $('tower-title').textContent = race ? (gapMode === 'int' ? 'Timing · interval' : 'Timing · to leader') : 'Timing · best laps';
  $('tower-title').title = race ? 'Tap to switch between interval and gap to leader' : '';
  $('tower-sub').textContent = `${d.tower.length} cars`;
  const leader = d.tower[0];
  const len = s.trackLength || null;
  const rows = d.tower.map((r) => {
    const lapsDown = race && leader && len && r !== leader ? Math.floor((leader.dist - r.dist) / len) : 0;
    let gap;
    if (r.result) gap = r.result;
    else if (race) gap = r.pos === 1 ? (gapMode === 'int' ? 'Leader' : 'Leader') : lapsDown >= 1 ? `+${lapsDown} lap${lapsDown > 1 ? 's' : ''}` : fmtGap(gapMode === 'int' ? r.gapAheadMs : r.gapLeaderMs);
    else gap = r.pos === 1 ? fmtLap(r.bestMs) : r.gapLeaderMs !== null ? fmtGap(r.gapLeaderMs) : '–';
    const flags = `${r.pit ? '<span class="flag pit">PIT</span>' : r.out ? '<span class="flag out">OUT</span>' : ''}${r.penaltySec ? `<span class="flag pen">+${r.penaltySec}s</span>` : ''}${r.result && r.result !== 'FIN' ? `<span class="flag dnf">${r.result}</span>` : ''}`;
    const lastCell = race ? fmtLap(r.lastMs) : r.pos === 1 ? '' : fmtLap(r.bestMs);
    return `<tr class="${r.me ? 'me' : ''}"><td class="p">${r.pos}</td><td class="team"><i style="background:${esc(r.colour || '#555')}"></i></td><td class="n">${esc(r.name)}${flags}</td><td class="g">${gap}</td><td class="lt">${lastCell}</td><td class="ty">${tyreChip(r.tyre, r.tyreAge)}</td></tr>`;
  }).join('');
  $('tower').innerHTML = rows ? `<table class="tower">${rows}</table>` : '<p class="empty">Waiting for the field…</p>';
  const me = $('tower').querySelector('tr.me');
  if (me && !renderTower.scrolled) { me.scrollIntoView({ block: 'center' }); renderTower.scrolled = true; }
}

function renderForzaTiming(d) {
  const t = d.timing || {};
  const s = d.session || {};
  $('tower-title').textContent = 'Timing';
  $('tower-sub').textContent = '';
  const delta = t.deltaS;
  $('tower').innerHTML = `
    <div class="ftime">
      <div><span>Position</span><b>${s.position ? `P${s.position}` : '–'}</b></div>
      <div><span>Lap</span><b>${s.lap ?? '–'}${s.totalLaps ? ` / ${s.totalLaps}` : ''}</b></div>
      <div class="wide delta"><span>Live delta to your best</span><b class="${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">${delta === null || delta === undefined ? '–' : `${delta > 0 ? '+' : ''}${delta.toFixed(2)}`}</b></div>
      <div><span>Current</span><b>${fmtSec(t.currentS)}</b></div>
      <div><span>Last</span><b>${fmtSec(t.lastS)}</b></div>
      <div><span>Best</span><b class="best">${fmtSec(t.bestS)}</b></div>
      <div><span>Speed</span><b>${s.speedKmh !== undefined ? Math.round(s.speedKmh * 0.621371) : '–'} <small>mph</small></b></div>
    </div>
    <p class="small">Forza only sends data for your own car, so there's no field, gaps or rivals here.${s.totalLaps ? '' : ' Set the race laps on the Setup tab to see laps remaining.'}</p>`;
}

const card = (x) => `<div class="card ${x.level}"><b>${esc(x.title)}</b>${x.text ? `<p>${esc(x.text)}</p>` : ''}</div>`;

const mmss = (sec) => (sec === null || sec === undefined ? '–' : `${sec < 0 ? '-' : ''}${Math.floor(Math.abs(sec) / 60)}:${String(Math.round(Math.abs(sec) % 60)).padStart(2, '0')}`);

// In the garage (qualifying and practice): when to leave, the clean gaps coming up, and the
// latest you can leave for one more lap.
function garageExit(l) {
  const state = l.waitS === null ? 'busy' : l.waitS <= 2 ? 'go' : 'wait';
  const head = state === 'go' ? `<b class="big">Go now</b><span>${l.clearForS ? `clear for ${l.clearForS} s` : 'clean air'}</span>`
    : state === 'wait' ? `<b class="big">Wait ${l.waitS} s</b><span>${l.blocker ? `${esc(l.blocker)} coming through` : 'for the next clean gap'}</span>`
      : '<b class="big">Pit exit busy</b><span>no clean gap in the next 2½ minutes</span>';
  const wins = (l.windows || []).map((w) => `<span class="win">${w.from <= 2 ? 'now' : mmss(w.from)}–${mmss(w.to)}</span>`).join('');
  const by = l.leaveByS === null || l.leaveByS === undefined ? ''
    : l.leaveByS > 0 ? `<div class="leaveby">Leave within <b>${mmss(l.leaveByS)}</b> for one more lap${l.leaveAtClockS ? ` · before the session clock shows <b>${mmss(l.leaveAtClockS)}</b>` : ''}</div>`
      : '<div class="leaveby late">Too late to start another flying lap.</div>';
  return `<div class="exit ${state}">${head}</div>${wins ? `<div class="wins"><span class="small">Clean gaps (leave in):</span>${wins}</div>` : ''}${by}${l.muted ? '<p class="small">Holding: she\'s quiet until you ask for a gap (Pit).</p>' : ''}`;
}

function renderPlan(p) {
  return `<div class="card info plan"><b>${esc(p.title)}</b><dl>${p.items.map((x) => `<dt>${esc(x.k)}</dt><dd>${esc(x.v)}</dd>`).join('')}</dl></div>`;
}

function renderPit(d) {
  const p = d.pit || {};
  const t = p.tyre || {};
  let html = '';
  const e = d.engineer || {};
  if (e.leave && e.leave.out === false) html += garageExit(e.leave);
  if (e.plan) html += renderPlan(e.plan);
  if (d.game === 'f1') {
    $('pit-sub').textContent = d.session.race ? 'From the game\'s strategy data' : '';
    if (t.short) {
      html += `<div class="card info"><b>${tyreChip(t.short)} ${esc(t.name)}${t.compound ? ` (${esc(t.compound)})` : ''} · ${t.age ?? 0} lap${t.age === 1 ? '' : 's'} old${t.wear !== null && t.wear !== undefined ? ` · ${t.wear}% worn` : ''}</b></div>`;
    }
    if (t.wearByWheel) html += `<div class="wearbar">${['FL', 'FR', 'RL', 'RR'].map((w, i) => `<span>${w}<b>${t.wearByWheel[i]}%</b></span>`).join('')}</div>`;
  } else {
    $('pit-sub').textContent = 'Estimates from your laps';
    if (t.wearByWheel) html += `<div class="wearbar">${['FL', 'FR', 'RL', 'RR'].map((w, i) => `<span>${w}<b>${t.wearByWheel[i]}%</b> · ${t.temps[i]}°F</span>`).join('')}</div>`;
  }
  html += `<div class="cards" style="margin-top:8px">${(p.items || []).map(card).join('') || '<p class="empty">Nothing to plan yet.</p>'}</div>`;
  if (p.sets && p.sets.length) {
    html += `<div class="sets">${p.sets.map((x) => `<span class="set">${tyreChip(x.tyre)}<b>${x.usableLife} laps</b>${x.wear ? ` · ${x.wear}% used` : ' · new'}${x.lapDeltaMs ? ` · ${x.lapDeltaMs > 0 ? '+' : ''}${(x.lapDeltaMs / 1000).toFixed(1)}s/lap` : ''}${x.reachesEnd ? ' · <span style="color:var(--green)">to the end</span>' : ''}</span>`).join('')}</div><p class="small">Sets you can fit: usable life and pace from the game.</p>`;
  }
  $('pit').innerHTML = html;
}

// Garage and pit-lane advice comes from this session's logged laps.
const sessionLaps = { at: 0, laps: [], key: null };
async function loadSessionLaps(d) {
  if (Date.now() - sessionLaps.at < 15000) return;
  sessionLaps.at = Date.now();
  try {
    const all = await (await fetch('api/laps', { cache: 'no-store' })).json();
    const mine = all.filter((l) => l.game === d.game);
    const key = d.game === 'f1' ? d.sessionId : mine.at(-1)?.session;
    sessionLaps.key = key;
    sessionLaps.laps = mine.filter((l) => l.session === key && l.valid !== false);
  } catch { /* keep what we have */ }
}

function renderAdjust(d) {
  const a = d.adjust || {};
  const mode = a.mode || 'track';
  const chip = (t) => `<span class="mode-chip">${t}</span>`;
  let html;
  if (mode === 'garage' || mode === 'pitlane') {
    loadSessionLaps(d);
    const adv = lapAdvice(sessionLaps.laps.slice(-5), { noTemps: true });
    const pitStop = mode === 'pitlane';
    $('adj-title').textContent = pitStop ? 'At this stop' : d.game === 'forza' ? 'Tune changes' : 'Setup changes';
    $('adj-sub').innerHTML = chip(pitStop ? 'Pit lane' : d.game === 'forza' ? 'Not racing' : 'In the garage');
    if (d.parcFerme?.on && !pitStop && d.game === 'f1') $('adj-title').textContent = 'What you can still change';
    let items = adv.findings;
    const pf = d.parcFerme || {};
    // At a race pit stop only the front wing can change, so keep wing changes.
    if (pitStop) items = items.map((f) => ({ ...f, changes: f.changes.filter((c) => /front wing/i.test(c)) })).filter((f) => f.changes.length);
    // Parc fermé: keep what you can still change (front wing, wheel settings, driving).
    else if (pf.on) items = items.map((f) => ({ ...f, changes: pfSplit(f.changes).ok.map((x) => `${x.text} (${x.how.toLowerCase()})`) })).filter((f) => f.changes.length);
    if (pf.on && !pitStop) $('adj-sub').innerHTML = chip('Parc fermé');
    else if (pf.soon && !pitStop) $('adj-sub').innerHTML = `${chip('In the garage')} ${chip('Parc fermé when you leave')}`;
    if (sessionLaps.laps.length < 2) html = `<p class="empty">${pitStop ? 'Tyres are on the Pit panel.' : 'Drive at least 2 clean laps this session and setup changes appear here.'}</p>`;
    else if (!items.length) html = `<p class="empty">${pitStop ? 'No wing change needed. Fresh tyres and go.' : 'Nothing to change from your laps. The car looks balanced.'}</p>`;
    else html = `<div class="cards">${items.slice(0, 4).map((f) => card({ level: f.severity === 'high' ? 'now' : f.severity === 'medium' ? 'soon' : 'info', title: f.title, text: `${f.changes.join(' ')} ${f.evidence}` })).join('')}</div><p class="small" style="margin-top:6px">From your last ${Math.min(5, sessionLaps.laps.length)} clean laps. Make one change, then run again.</p>`;
  } else {
    if (d.game === 'forza') {
      $('adj-title').textContent = 'Driving tips';
      $('adj-sub').innerHTML = chip('On track');
    } else {
      $('adj-title').textContent = 'From the wheel';
      $('adj-sub').innerHTML = `${chip('On track')} ${[a.bias ? `Bias ${a.bias}%` : '', a.diffOn ? `Diff ${a.diffOn}%` : '', a.ers !== null && a.ers !== undefined ? `ERS ${a.ers}%` : ''].filter(Boolean).join(' · ')}`;
    }
    if (!a.ready) html = '<p class="empty">Gathering data. Advice appears after a few corners.</p>';
    else if (!a.items.length) html = `<p class="empty">Nothing to change. ${d.game === 'forza' ? 'Clean driving.' : 'Car looks happy.'}</p>`;
    else html = `<div class="cards">${a.items.map(card).join('')}</div>`;
    if (d.game === 'forza') html += '<p class="small" style="margin-top:8px">Forza has no in-car changes. Tune changes show here when you are back in the menus.</p>';
  }
  $('adj').innerHTML = html;
  $('events').innerHTML = (d.events || []).map((e) => `<li>${esc(e.text)}</li>`).join('');
}

function renderBar(d) {
  const s = d.session || {};
  let html;
  if (d.game === 'f1') {
    const lap = s.race && s.lap ? `<b>Lap ${s.lap}${s.totalLaps ? `/${s.totalLaps}` : ''}</b>` : s.timeLeft !== null && s.timeLeft !== undefined ? `<b>${Math.floor(s.timeLeft / 60)}:${String(s.timeLeft % 60).padStart(2, '0')} left</b>` : '';
    html = `${esc(s.type || 'F1 25')} ${lap} ${s.position ? `· <b>P${s.position}</b>` : ''} <span class="dim">· ${esc(s.weather || '')}${s.trackTemp !== null && s.trackTemp !== undefined ? ` · track ${s.trackTemp}°C` : ''}${s.timeOfDay !== null && s.timeOfDay !== undefined ? ` · ${clock(s.timeOfDay)}` : ''}</span>`;
  } else {
    html = `Forza <b>Lap ${s.lap ?? '–'}${s.totalLaps ? `/${s.totalLaps}` : ''}</b> ${s.position ? `· <b>P${s.position}</b>` : ''} <span class="dim">· fuel ${s.fuelPct ?? '–'}%</span>`;
  }
  $('sess').innerHTML = html;
  const sc = $('sc');
  sc.hidden = !s.safetyCar;
  sc.textContent = s.safetyCar || '';
}

// ---------------------------------------------------------------------------
// Race engineer
// ---------------------------------------------------------------------------
let firstEngineer = true;
let pending = null;
function renderEngineer(d) {
  const e = d.engineer;
  if (!e) return;
  if (firstEngineer) { voice.catchUp(e.calls.slice(0, -1)); firstEngineer = false; }
  voice.receive(e.calls);
  pending = e.pending;
  const panel = document.querySelector('.eng-panel');
  panel.classList.toggle('pending', !!pending);
  panel.dataset.phase = e.phase || '';
  // Out of the garage: anything still queued about leaving is out of date.
  if (e.leave?.out || e.phase === 'race') voice.drop(/^leave-/);
  drawLoss(e);
}

voice.onTranscript(() => {
  const t = voice.transcript[0];
  const said = $('eng-said');
  if (t) { said.textContent = t.text; said.classList.toggle('ask-now', !!t.ask); said.classList.toggle('you', t.kind === 'you'); }
  $('radio-log').innerHTML = voice.transcript.map((x) => `<li>${esc(x.text)}</li>`).join('');
});

function setPower(on) {
  voice.settings.on = on;
  voice.saveSettings();
  $('eng-power').setAttribute('aria-pressed', String(on));
  $('eng-power-label').textContent = on ? 'Engineer on' : 'Engineer off';
  if (!on) voice.stop();
}
setPower(voice.settings.on);
$('eng-power').addEventListener('click', () => {
  const on = !voice.settings.on;
  setPower(on);
  // Phones only allow sound that starts from a tap, so unlock audio and say hello now.
  voice.unlockAudio();
  if (on) voice.speak({ fiery: `Hey ${voice.settings.name || 'superstar'}! I'm here, loud and clear. Let's go!`, sultry: `Hey ${voice.settings.name || 'handsome'}. I'm here. Ask me anything.` }[voice.settings.style] || 'Engineer on. Radio check.');
});
voice.onSpeaking((on) => $('eng-power').classList.toggle('talking', on));
// Any tap on the page also unlocks the radio click on phones.
document.addEventListener('pointerdown', () => voice.unlockAudio(), { once: true });

async function ask(topic) {
  try {
    await fetch('api/engineer', { method: 'POST', body: JSON.stringify({ game, ask: topic }) });
  } catch { /* the bridge will be back */ }
}
$('eng-asks').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-ask]');
  if (b) ask(b.dataset.ask);
});

// Voice replies, where the browser allows the microphone.
const mic = $('eng-mic');
mic.hidden = !voice.canListen;
$('mic-note').textContent = voice.canListen
  ? 'On this laptop you can also tap Talk and speak.'
  : 'On a phone, the keyboard\'s own microphone is the way to speak to her: tap the box, tap the mic on the keyboard, talk, then Send.';
mic.addEventListener('click', () => {
  voice.unlockAudio();
  voice.listen((cmd, said) => { talk(said, last, ask).then(showTalk); }, (st) => mic.classList.toggle('listening', st === 'listening'));
});

// Typing to her, or speaking with the phone keyboard's microphone.
function showTalk(r) {
  if (r?.error) $('eng-said').textContent = `${r.error}. She answered with a set reply.`;
}
$('eng-talk').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const input = $('eng-text');
  const text = input.value.trim();
  if (!text) return;
  voice.unlockAudio();
  input.value = '';
  talk(text, last, ask).then(showTalk).catch(() => {});
});

// Settings
function fillVoices() {
  const list = voice.voices();
  const cur = voice.pickVoice();
  $('set-voice').innerHTML = list.length ? list.map((v) => `<option value="${esc(v.name)}"${cur && v.name === cur.name ? ' selected' : ''}>${esc(v.name)}</option>`).join('') : '<option>Device default</option>';
}
if ('speechSynthesis' in window) speechSynthesis.addEventListener?.('voiceschanged', fillVoices);
function showEngine() {
  const oa = $('set-engine').value === 'openai';
  $('openai-box').hidden = !oa;
  $('device-voice').hidden = oa;
  $('device-tip').hidden = oa;
  const u = voice.settings.usage || { chars: 0 };
  $('usage').textContent = oa && u.chars ? `This month so far: about $${voice.costEstimate(u.chars).toFixed(2)}.` : '';
  const err = voice.engineError();
  $('engine-error').hidden = !err;
  $('engine-error').textContent = err;
}
voice.onEngineError((msg) => {
  if (msg) $('eng-said').textContent = msg;
  if ($('eng-dialog').open) showEngine();
});
$('set-ovoice').innerHTML = voice.OPENAI_VOICES.map((v) => `<option value="${v.id}">${esc(v.label)}</option>`).join('');
$('set-engine').addEventListener('change', (e) => {
  voice.settings.engine = e.target.value;
  voice.saveSettings();
  showEngine();
});
$('set-okey').addEventListener('change', (e) => {
  voice.settings.okey = e.target.value.trim();
  if (voice.settings.okey) voice.settings.engine = 'openai';
  voice.saveSettings();
  $('set-engine').value = voice.settings.engine;
  showEngine();
});
$('set-ovoice').addEventListener('change', (e) => { voice.settings.ovoice = e.target.value; voice.saveSettings(); });
const SOUND_IDEAS = [
  ['Southern', 'A strong, unmistakable Southern American accent, like a woman from rural Georgia: slow drawl, stretched vowels, warm and sweet, a little laugh when she teases.'],
  ['British', 'A clear British accent, like a woman from London: crisp consonants, cheeky and confident, like a real Formula 1 pit wall.'],
  ['Australian', 'A broad Australian accent: relaxed, cheeky, upbeat, with a grin in every line.'],
  ['Hype', 'Very excited and loud, almost shouting with joy on good news, like she is jumping up and down on the pit wall.'],
  ['Whisper', 'Close to the mic, soft and breathy, almost whispering, like a private message just for him.'],
  ['Cool', 'Calm and unbothered, dry sense of humour, never rushed even in a crisis.'],
];
$('sound-ideas').innerHTML = SOUND_IDEAS.map(([l]) => `<button type="button" class="mini" data-idea="${esc(l)}">${esc(l)}</button>`).join('') + '<button type="button" class="mini" data-idea="">Clear</button>';
$('sound-ideas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-idea]');
  if (!b) return;
  const idea = SOUND_IDEAS.find(([l]) => l === b.dataset.idea);
  $('set-sound').value = idea ? idea[1] : '';
  voice.settings.sound = $('set-sound').value;
  voice.saveSettings();
});
$('set-sound').addEventListener('input', (e) => { voice.settings.sound = e.target.value; voice.saveSettings(); });
$('eng-settings').addEventListener('click', () => {
  fillVoices();
  $('set-engine').value = voice.settings.engine;
  $('set-okey').value = voice.settings.okey;
  $('set-ovoice').value = voice.settings.ovoice;
  $('set-sound').value = voice.settings.sound || '';
  showEngine();
  $('set-style').innerHTML = voice.STYLES.map((x) => `<option value="${x.id}">${esc(x.label)}</option>`).join('');
  $('set-style').value = voice.settings.style;
  $('set-radio').checked = voice.settings.radio;
  $('set-chat').value = voice.settings.chat;
  $('set-name').value = voice.settings.name;
  $('set-rate').value = voice.settings.rate;
  $('eng-dialog').showModal();
});
$('set-radio').addEventListener('change', (e) => { voice.settings.radio = e.target.checked; voice.saveSettings(); });
for (const [id, key, num] of [['set-style', 'style'], ['set-chat', 'chat'], ['set-voice', 'voice'], ['set-name', 'name'], ['set-rate', 'rate', true]]) {
  $(id).addEventListener('change', (e) => { voice.settings[key] = num ? Number(e.target.value) : e.target.value.trim(); voice.saveSettings(); });
}
$('set-test').addEventListener('click', () => {
  voice.unlockAudio();
  voice.speak(voice.phrase({ kind: 'splits', priority: 'normal', text: 'P4, 6 to go. NORRIS 1.2 ahead, you took 0.3 off him. RUSSELL 0.9 behind.', data: { ahead: { changeMs: -300 } } }), { priority: 'normal', kind: 'test' });
});

// ---------------------------------------------------------------------------
// Stream
// ---------------------------------------------------------------------------
let towerAt = 0, panelsAt = 0;
function onDash(d) {
  last = d;
  if (d.game !== game) {
    game = d.game;
    document.body.dataset.game = game;
    map.key = null; map.version = -1; map.points = []; map.box = null;
    renderTower.scrolled = false;
  }
  const conn = $('conn');
  conn.classList.toggle('on', !!d.live);
  conn.querySelector('span').textContent = d.live ? 'Live' : 'No data';
  if (!d.session && d.game === 'forza') return;
  renderBar(d);
  if (d.map) {
    refreshTrack(d.map);
    drawCars(d.map);
    $('map-note').textContent = d.map.coverage < 0.97 && game === 'f1'
      ? `Drawing the track as cars drive it (${Math.round((d.map.coverage || 0) * 100)}%). It's saved for next time.`
      : !map.closed && game === 'forza' ? 'Drawing the track from your first lap. It\'s saved for next time.' : '';
  }
  const now = performance.now();
  if (now - towerAt > 250) { towerAt = now; renderTower(d); }
  if (now - panelsAt > 500) { panelsAt = now; renderPit(d); renderAdjust(d); }
  renderEngineer(d);
}

// Keep the screen on while the dashboard is open.
let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); } catch { /* not supported */ }
}
document.addEventListener('visibilitychange', keepAwake);

async function start() {
  try {
    const r = await fetch('api/status', { cache: 'no-store' });
    if (!r.ok || !(await r.json()).bridge) throw new Error('no bridge');
  } catch {
    $('offline').hidden = false;
    return;
  }
  keepAwake();
  const es = new EventSource(`dash-events${wantGame ? `?game=${encodeURIComponent(wantGame)}` : ''}`);
  es.addEventListener('dash', (e) => { try { onDash(JSON.parse(e.data)); } catch { /* skip a bad frame */ } });
  es.addEventListener('error', () => { $('conn').classList.remove('on'); $('conn').querySelector('span').textContent = 'Reconnecting'; });
}
start();
