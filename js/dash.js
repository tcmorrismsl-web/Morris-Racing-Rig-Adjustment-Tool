// Live race dashboard. Reads the bridge's 10-per-second race stream and draws the
// track map, timing tower, pit options and on-track adjustments.

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
const fmtGap = (ms) => (ms === null || ms === undefined ? '–' : `+${(ms / 1000).toFixed(ms < 10000 ? 3 : 1)}`);
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

function renderPit(d) {
  const p = d.pit || {};
  const t = p.tyre || {};
  let html = '';
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

function renderAdjust(d) {
  const a = d.adjust || {};
  if (d.game === 'forza') {
    $('adj-title').textContent = 'Driving tips';
    $('adj-sub').textContent = 'Last minute of driving';
  } else {
    $('adj-title').textContent = 'Adjust on track';
    $('adj-sub').textContent = [a.bias ? `Bias ${a.bias}%` : '', a.diffOn ? `Diff ${a.diffOn}%` : '', a.ers !== null && a.ers !== undefined ? `ERS ${a.ers}%` : ''].filter(Boolean).join(' · ');
  }
  let html;
  if (!a.ready) html = '<p class="empty">Gathering data. Advice appears after a few corners.</p>';
  else if (!a.items.length) html = `<p class="empty">Nothing to change. ${d.game === 'forza' ? 'Clean driving.' : 'Car looks happy.'}</p>`;
  else html = `<div class="cards">${a.items.map(card).join('')}</div>`;
  if (d.game === 'forza') html += '<p class="small" style="margin-top:8px">Forza has no in-car setup changes. After the race, Fix it has tune changes.</p>';
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
