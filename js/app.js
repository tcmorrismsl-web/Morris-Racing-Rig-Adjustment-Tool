import { WHEEL_PROFILES, SWITCH_TIPS, APP_GUIDE, FORZA_TRACKS, FORZA_CLASSES, F1_TRACKS, F1_RANGES } from './data.js';
import { forzaTune, forzaFix, compareValue, FORZA_ISSUES, DRIVETRAINS } from './forza.js';
import { f1Setup, f1Fix, F1_ISSUES, F1_ROWS, F1_STYLES } from './f1.js';
import { STATS, SPECS, PARTS, TYRES, classFromPi, normalizeCar, upsertCar, hasPart } from './garage.js';
import { lapAdvice, lapStats, sessions, fmtLap } from './advice.js';
import { live, detectBridge, connect, putContext, putState, getRemoteState, deleteSession } from './live.js';

// ---------------------------------------------------------------------------
// State (kept in this browser only)
// ---------------------------------------------------------------------------
const KEY = 'morris-racing-v1';
const defaults = {
  game: 'forza',
  tab: 'wheel',
  wheelSetFor: null,
  forza: { carId: '', track: 'fujimi', cls: 'A', drivetrain: 'fwd', weather: 'dry', time: 'night', temp: 'mild', length: 'medium', tyreWear: true, fuel: false, aero: true, compare: false },
  f1: { era: 2025, track: 'australia', session: 'race', weather: 'dry', style: 'balanced' },
  saved: [],
  current: {}, // values in the game now, per garage car ('_any' when no car is picked)
  links: { forzaCars: {}, forzaTracks: {} }, // Forza car/track numbers from telemetry, linked to your garage and track list
  dataLaps: '3',
  garage: [normalizeCar({
    id: 'tcr73', name: '2020 Honda #73 LA Honda World Racing Civic Type R TCR', drivetrain: 'fwd', raceCar: true, tyre: 'slick',
    history: [{ date: new Date().toISOString(), changes: ['Added to garage'] }],
  })],
};
function load(raw) {
  try {
    const s = raw !== undefined ? raw : JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!s) return structuredClone(defaults);
    return {
      ...structuredClone(defaults), ...s,
      forza: { ...defaults.forza, ...s.forza }, f1: { ...defaults.f1, ...s.f1 },
      garage: Array.isArray(s.garage) ? s.garage.map(normalizeCar) : structuredClone(defaults.garage),
      links: { forzaCars: { ...s.links?.forzaCars }, forzaTracks: { ...s.links?.forzaTracks } },
      current: s.current && typeof s.current === 'object' ? s.current : {},
    };
  } catch { return structuredClone(defaults); }
}
let hadLocal = false;
try { hadLocal = !!localStorage.getItem(KEY); } catch { /* storage unavailable */ }
const state = load();
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
  if (live.bridge) putState(state); // keeps a copy on the laptop too
}

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = $('#view');
const gameName = (g) => WHEEL_PROFILES[g].name;
const currentCar = () => state.garage.find((c) => c.id === state.forza.carId) || null;
const dtLabel = (d) => d.toUpperCase();
let editingId = null; // car being edited in the Garage ('new' for a new car)

function toast(msg) {
  const t = $('.toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 1800);
}

// ---------------------------------------------------------------------------
// LED strip: sweeps from both ends to the centre, like the ESX in Xbox mode
// ---------------------------------------------------------------------------
function sweepLeds() {
  const leds = [...document.querySelectorAll('.leds span')];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  leds.forEach((l) => l.classList.remove('on'));
  if (reduce) { leds.forEach((l) => l.classList.add('on')); return; }
  for (let i = 0; i < 5; i++) {
    setTimeout(() => { leds[i].classList.add('on'); leds[9 - i].classList.add('on'); }, 90 * i);
  }
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------
const row = (k, v, why, opts = {}) => `
  <div class="row${String(v).length > 16 ? ' long' : ''}">
    <span class="k">${esc(k)}</span>
    <span class="v${opts.rel ? ' rel' : ''}">${esc(v)}</span>
    ${opts.range ? `<span class="range">${esc(opts.range)}</span>` : ''}
    ${why ? `<span class="why">${esc(why)}</span>` : ''}
  </div>`;

function seg(name, options, current) {
  return `<div class="seg" data-seg="${name}">${options.map((o) =>
    `<button type="button" data-value="${esc(o.id)}" aria-pressed="${String(o.id) === String(current)}">${esc(o.label)}</button>`).join('')}</div>`;
}
const field = (label, inner, wide) => `<div class="field${wide ? ' wide' : ''}"><span>${esc(label)}</span>${inner}</div>`;

// ---------------------------------------------------------------------------
// Wheel tab
// ---------------------------------------------------------------------------
function renderWheel() {
  const g = state.game, p = WHEEL_PROFILES[g];
  let banner = '';
  if (state.wheelSetFor !== g) {
    const from = state.wheelSetFor ? WHEEL_PROFILES[state.wheelSetFor] : null;
    const items = p.moza.filter((m) => !/preset default/i.test(m.value) && (!from || from.moza.find((x) => x.key === m.key)?.value !== m.value));
    banner = `
      <section class="switch">
        <h2>Switch the wheel to ${esc(p.name)}</h2>
        <p class="small">${from ? `Your wheel is set up for ${esc(from.name)}.` : ''} Open the MOZA Racing app on your phone and change these, in this order. The base can stay plugged into the Xbox.</p>
        <ul class="checklist">
          ${items.map((m, i) => {
            const prev = from?.moza.find((x) => x.key === m.key)?.value;
            return `<li><input type="checkbox" id="c${i}"><label for="c${i}">${esc(m.label)}<br>${prev ? `<span class="from">${esc(prev)}</span>` : ''}<span class="to">${esc(m.value)}</span></label></li>`;
          }).join('')}
          <li><input type="checkbox" id="cg"><label for="cg">Check the in-game wheel settings below</label></li>
        </ul>
        <p class="small">Pick the ${esc(p.moza[0].value)} preset first, because it resets everything else, then work down the list. Settings marked "Preset default" are left as the preset sets them.</p>
        <button type="button" class="btn" data-action="wheel-done">Wheel is set for ${esc(p.name)}</button>
      </section>`;
  }
  const status = `
    <div class="wheel-status">
      <span>Your wheel is set up for</span>
      ${seg('wheelSetFor', [{ id: 'forza', label: 'Forza' }, { id: 'f1', label: 'F1 25' }, { id: 'unknown', label: 'Not sure' }], state.wheelSetFor || 'unknown')}
    </div>`;
  view.innerHTML = `
    ${status}
    ${banner}
    ${state.wheelSetFor === g ? `<h2>Wheel is set for ${esc(p.name)}</h2><p class="lede">Your MOZA R3 settings for ${esc(p.name)}. If that's wrong, change it above and the checklist comes back.</p>` : ''}
    <h3>MOZA Racing app on your phone</h3>
    <p class="small">Every base setting, in the order the app shows them. If a setting isn't in your phone app, it's Pit House only: set it once there and it stays saved on the base.</p>
    ${[...new Set(p.moza.map((m) => m.group))].map((gName) => `
      <h4 class="sub">${esc(gName)}</h4>
      <div class="rows">${p.moza.filter((m) => m.group === gName).map((m) => row(m.label, m.value, m.why)).join('')}</div>`).join('')}
    <h3>In ${esc(p.name)}</h3>
    ${p.game.groups.map((gr) => `
      <h4 class="sub">${esc(gr.where)}</h4>
      <div class="rows">${gr.items.map((m) => row(m.label, m.value, m.why)).join('')}</div>`).join('')}
    <p class="hint">${esc(p.game.after)}</p>
    <h3>When you switch games</h3>
    <ul class="notes">${SWITCH_TIPS.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>

    <h3>Phone app or Pit House?</h3>
    <div class="app-guide">
      <div><h4>MOZA Racing app on your phone</h4><p class="small">Use it for everyday changes. It connects over Bluetooth while the base stays plugged into the Xbox.</p>
        <ul>${APP_GUIDE.phone.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
      <div><h4>Pit House on the laptop</h4><p class="small">Only now and then. It needs the base plugged into the laptop by USB, in PC mode.</p>
        <ul>${APP_GUIDE.pc.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
    </div>
    <details class="pc-steps">
      <summary>How to use Pit House, then go back to the Xbox</summary>
      <ol>${APP_GUIDE.steps.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
      <p class="small">A USB switch box can save swapping cables between the Xbox and laptop, but plug straight into the laptop for firmware updates. MOZA advises against hubs, which can cause the power dips that interrupt updates.</p>
    </details>`;
}

// ---------------------------------------------------------------------------
// Setup tab: Forza
// ---------------------------------------------------------------------------
const nowKey = () => state.forza.carId || '_any';
let lastTune = null; // the tune on screen, for live comparisons while typing

function cmpHtml(c) {
  return c ? esc(c.text) : '';
}

function tuneRow(r) {
  if (!state.forza.compare || !r.cmp) return row(r.label, r.value, r.why, { rel: r.rel });
  const cur = (state.current[nowKey()] || {})[r.key];
  const c = compareValue(r.cmp, cur);
  return `
  <div class="row has-now">
    <span class="k">${esc(r.label)}</span>
    <span class="v${r.rel ? ' rel' : ''}">${esc(r.value)}</span>
    <label class="now"><span>Now</span><input type="number" step="any" data-now="${esc(r.key)}" value="${esc(cur ?? '')}" aria-label="${esc(r.label)} in the game now"></label>
    <span class="cmp${c ? (c.ok ? ' ok' : ' chg') : ''}" data-cmp="${esc(r.key)}">${cmpHtml(c)}</span>
    ${r.why ? `<span class="why">${esc(r.why)}</span>` : ''}
  </div>`;
}

function renderForza() {
  const f = state.forza;
  const car = currentCar();
  const res = forzaTune({ ...f, car });
  lastTune = res;
  const hasNow = Object.keys(state.current[nowKey()] || {}).length > 0;
  const cls = FORZA_CLASSES.map((c) => ({ id: c.id, label: c.label }));
  const carPI = car && classFromPi(car.pi);
  const carOptions = `<option value="">Any car (set class below)</option>${state.garage.map((c) =>
    `<option value="${esc(c.id)}"${c.id === f.carId ? ' selected' : ''}>${esc(c.name)}${classFromPi(c.pi) ? ` (${classFromPi(c.pi)} ${c.pi})` : ''}</option>`).join('')}`;
  view.innerHTML = `
    <h2>Forza tune</h2>
    <p class="lede">Starting values for your car on this track. Load the car's default tune, then apply these. Turn on "Enter my current values" to see exactly what to change.</p>
    <div class="form">
      ${field('Car', `<select data-field="carId">${carOptions}</select>`, true)}
      ${car ? `<p class="small wide car-line">${carPI ? `${esc(carPI)} class, PI ${esc(car.pi)}` : 'No PI yet'}, ${dtLabel(res.drivetrain)}${car.hp ? `, ${esc(car.hp)} hp` : ''}${car.weight ? `, ${esc(car.weight)} lb` : ''}. <button type="button" class="link" data-action="edit-car" data-id="${esc(car.id)}">Update in Garage</button></p>` : ''}
      ${field('Track', `<select data-field="track">${FORZA_TRACKS.map((t) => `<option value="${t.id}"${t.id === f.track ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`, true)}
      ${carPI ? '' : field(`Class (${FORZA_CLASSES.find((c) => c.id === f.cls).range} PI)`, seg('cls', cls, f.cls), true)}
      ${car ? '' : field('Drivetrain', seg('drivetrain', DRIVETRAINS, f.drivetrain))}
      ${field('Weather', seg('weather', [{ id: 'dry', label: 'Dry' }, { id: 'wet', label: 'Wet' }], f.weather))}
      ${field('Time of day', seg('time', [{ id: 'day', label: 'Day' }, { id: 'night', label: 'Night' }], f.time))}
      ${field('Temperature', seg('temp', [{ id: 'cool', label: 'Cool' }, { id: 'mild', label: 'Mild' }, { id: 'hot', label: 'Hot' }], f.temp))}
      ${field('Race length', seg('length', [{ id: 'sprint', label: 'Under 15 min' }, { id: 'medium', label: '15–35 min' }, { id: 'long', label: '35+ min' }], f.length), true)}
      <div class="toggles wide">
        <label class="toggle">Tyre wear on <input type="checkbox" data-check="tyreWear"${f.tyreWear ? ' checked' : ''}></label>
        <label class="toggle">Fuel use on <input type="checkbox" data-check="fuel"${f.fuel ? ' checked' : ''}></label>
        ${car ? '' : `<label class="toggle">Car has adjustable aero <input type="checkbox" data-check="aero"${f.aero ? ' checked' : ''}></label>`}
        <label class="toggle">Enter my current values <input type="checkbox" data-check="compare"${f.compare ? ' checked' : ''}></label>
      </div>
    </div>
    ${f.compare ? `<p class="small now-help">Type in what the car has now and each setting shows what to change it to. For springs, final drive and suspension geometry, enter the numbers from the car's default tune, because those are changes from default. Values are saved ${car ? `for ${esc(car.name)}` : 'on this device'}.${hasNow ? ' <button type="button" class="link" data-action="clear-now">Clear my values</button>' : ''}</p>` : ''}
    ${res.sections.map((s) => `
      <h3>${esc(s.title)}</h3>
      ${s.locked ? `<p class="locked-note">${esc(s.locked)}</p>` : ''}
      <div class="rows${s.locked ? ' locked' : ''}">${s.rows.map(tuneRow).join('')}</div>
      ${s.hint ? `<p class="hint">${esc(s.hint)}</p>` : ''}`).join('')}
    <p class="hint">Amber values are changes from the car's default tune, because Forza scales those sliders per car.</p>
    <ul class="notes">${res.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
    <div class="actions"><button type="button" class="btn" data-action="save">Save this tune</button></div>`;
}

// ---------------------------------------------------------------------------
// Setup tab: F1 25
// ---------------------------------------------------------------------------
function renderF1() {
  const f = state.f1;
  const tracks = F1_TRACKS.filter((t) => !t.only || t.only === Number(f.era));
  if (!tracks.find((t) => t.id === f.track)) f.track = tracks[0].id;
  const res = f1Setup(f);
  view.innerHTML = `
    <h2>F1 25 setup</h2>
    <p class="lede">Full setup-screen values. Enter them in Car Setup before the session.</p>
    <div class="form">
      ${field('Cars', seg('era', [{ id: 2025, label: '2025 cars' }, { id: 2026, label: '2026 Season Pack' }], f.era), true)}
      ${field('Track', `<select data-field="track">${tracks.map((t) => `<option value="${t.id}"${t.id === f.track ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`, true)}
      ${field('Session', seg('session', [{ id: 'quali', label: 'Quali / Time Trial' }, { id: 'race', label: 'Race' }], f.session), true)}
      ${field('Weather', seg('weather', [{ id: 'dry', label: 'Dry' }, { id: 'wet', label: 'Wet' }], f.weather))}
      ${field('Feel', seg('style', F1_STYLES, f.style))}
      <p class="small wide">${esc(F1_STYLES.find((s) => s.id === f.style).hint)}</p>
    </div>
    ${F1_ROWS.map((g) => `
      <h3>${esc(g.group)}</h3>
      <div class="rows">${g.items.map(([k, label, unit = '', dp = 0]) => {
        const r = F1_RANGES[k];
        const fmt = (n) => (dp ? Number(n).toFixed(dp) : String(n));
        return row(label, `${fmt(res.v[k])}${unit}`, res.why[k], { range: `${fmt(r[0])} to ${fmt(r[1])}` });
      }).join('')}</div>`).join('')}
    <ul class="notes">${res.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
    <div class="actions"><button type="button" class="btn" data-action="save">Save this setup</button></div>`;
}

// ---------------------------------------------------------------------------
// Fix it tab
// ---------------------------------------------------------------------------
let openIssue = null;
function renderFix() {
  const forza = state.game === 'forza';
  const issues = forza ? FORZA_ISSUES : F1_ISSUES;
  const car = currentCar();
  const dt = car ? car.drivetrain : state.forza.drivetrain;
  view.innerHTML = `
    <h2>Fix the handling</h2>
    <p class="lede">${forza ? `Pick what the car is doing. Steps are for ${car ? `your ${esc(car.name)} (${dtLabel(dt)})` : `a ${dtLabel(dt)} car`}; change the car on the Setup tab. Make one change, drive a lap, then try the next.` : 'Pick what the car is doing. Make one change, drive a lap, then try the next.'}</p>
    <div class="issues">${issues.map((i) => {
      const open = openIssue === i.id;
      const steps = forza ? forzaFix(i.id, dt) : f1Fix(i.id);
      return `<button type="button" class="issue" data-issue="${i.id}" aria-expanded="${open}">${esc(i.label)}</button>
        ${open ? `<ol class="steps">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}`;
    }).join('')}</div>`;
}

// ---------------------------------------------------------------------------
// Saved tab
// ---------------------------------------------------------------------------
function renderSaved() {
  const list = state.saved.filter((s) => s.game === state.game);
  view.innerHTML = `
    <h2>Saved ${esc(gameName(state.game))} setups</h2>
    <p class="lede">Stored on this device only.</p>
    ${list.length ? `<div class="saved">${list.map((s) => `
      <details class="${s.game}">
        <summary>${esc(s.name)}<span class="small">${esc(s.sub)}</span></summary>
        <table>${s.rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
        <div class="actions">
          <button type="button" class="btn ghost" data-action="load" data-id="${s.id}">Open in Setup</button>
          <button type="button" class="btn ghost" data-action="delete" data-id="${s.id}">Delete</button>
        </div>
      </details>`).join('')}</div>`
    : `<div class="empty">Nothing saved for ${esc(gameName(state.game))} yet. Build one on the Setup tab and tap Save.</div>`}`;
}

function saveCurrent() {
  const id = Date.now().toString(36);
  if (state.game === 'forza') {
    const car = currentCar();
    const res = forzaTune({ ...state.forza, car });
    const def = car ? `${car.name}, ${res.track.name}` : `${res.cls.id} class, ${res.track.name}`;
    const name = prompt('Name this tune', def);
    if (name === null) return;
    const f = state.forza;
    state.saved.unshift({
      id, game: 'forza', name: name.trim() || def,
      sub: `${res.track.name}, ${car ? `${car.name}, ` : ''}${res.cls.id} class ${dtLabel(res.drivetrain)}, ${f.weather}, ${f.time}`,
      inputs: { ...f },
      rows: res.sections.flatMap((s) => s.rows.map((r) => [`${s.title}: ${r.label}`, r.value])),
    });
  } else {
    const res = f1Setup(state.f1);
    const def = `${res.track.name} ${state.f1.session === 'quali' ? 'quali' : 'race'}`;
    const name = prompt('Name this setup', def);
    if (name === null) return;
    state.saved.unshift({
      id, game: 'f1', name: name.trim() || def,
      sub: `${res.era} cars, ${res.track.name}, ${state.f1.session}, ${state.f1.weather}`,
      inputs: { ...state.f1 },
      rows: F1_ROWS.flatMap((g) => g.items.map(([k, label, unit = '', dp = 0]) => [label, `${dp ? Number(res.v[k]).toFixed(dp) : res.v[k]}${unit}`])),
    });
  }
  persist();
  toast('Saved');
}

// ---------------------------------------------------------------------------
// Garage tab (Forza only)
// ---------------------------------------------------------------------------
const fmtDate = (iso) => {
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return ''; }
};
const n0 = (v) => (v === null || v === undefined ? null : Number(v).toLocaleString());

function carCard(c) {
  const cl = classFromPi(c.pi);
  const specs = [dtLabel(c.drivetrain), c.hp && `${n0(c.hp)} hp`, c.torque && `${n0(c.torque)} lb-ft`, c.weight && `${n0(c.weight)} lb`, c.frontPct && `${c.frontPct}% front`].filter(Boolean).join(', ');
  const tunable = PARTS.filter(([k]) => hasPart(c, k)).map(([, label]) => label.replace(/^Race /, '').replace(/^Adjustable /, ''));
  const anyStats = STATS.some(([k]) => c.stats[k] !== null);
  return `
    <article class="car">
      <div class="car-head">
        <span class="plate" aria-label="${cl ? `${cl} class, PI ${c.pi}` : 'No PI yet'}"><b>${cl || '?'}</b><span>${c.pi ?? '---'}</span></span>
        <div>
          <h4>${esc(c.name)}</h4>
          <p class="small">${esc(specs)}${c.level ? `. Car level ${esc(c.level)}` : ''}</p>
        </div>
      </div>
      ${anyStats ? `<div class="bars">${STATS.map(([k, label]) => `
        <div class="bar"><span>${label}</span><i style="--v:${(c.stats[k] ?? 0) * 10}%"></i><b>${c.stats[k] ?? '–'}</b></div>`).join('')}</div>`
      : '<p class="small">No stats yet. Tap Update and copy them from the car\'s page in Forza.</p>'}
      <p class="small">${c.raceCar ? 'Factory race car. ' : ''}${tunable.length ? `Tunable: ${esc(tunable.join(', ').toLowerCase())}.` : 'No tuning parts fitted yet.'} Tyres: ${esc(TYRES.find((t) => t.id === c.tyre).label.toLowerCase())}.</p>
      ${c.notes ? `<p class="car-notes">${esc(c.notes)}</p>` : ''}
      <div class="actions">
        <button type="button" class="btn" data-action="tune-car" data-id="${esc(c.id)}">Tune for a race</button>
        <button type="button" class="btn ghost" data-action="edit-car" data-id="${esc(c.id)}">Update</button>
      </div>
      ${c.history.length ? `<details class="history"><summary>Upgrade history (${c.history.length})</summary>
        <ol>${c.history.map((h) => `<li><span class="small">${esc(fmtDate(h.date))}</span> ${esc(h.changes.join('. '))}</li>`).join('')}</ol></details>` : ''}
    </article>`;
}

function renderGarage() {
  if (editingId) { renderCarForm(); return; }
  view.innerHTML = `
    <h2>Garage</h2>
    <p class="lede">Your Forza cars and their current stats. Update a car after you upgrade it, and its history keeps track of what changed.</p>
    <div class="actions"><button type="button" class="btn" data-action="add-car">Add a car</button></div>
    ${state.garage.length ? `<div class="cars">${state.garage.map(carCard).join('')}</div>`
      : '<div class="empty">No cars yet. Add the cars you race with.</div>'}
    <div class="actions">
      <button type="button" class="btn ghost" data-action="export">Back up garage</button>
      <label class="btn ghost file">Restore backup<input type="file" accept="application/json,.json" data-import></label>
    </div>
    <p class="hint">Stored on this device only. Back up to move your garage to another phone.</p>`;
}

const numInput = (name, label, value, attrs) => `
  <label class="field"><span>${esc(label)}</span><input type="number" name="${name}" value="${value ?? ''}" inputmode="decimal" ${attrs}></label>`;

function renderCarForm() {
  const isNew = editingId === 'new';
  const c = isNew ? normalizeCar({ name: '' }) : state.garage.find((x) => x.id === editingId);
  if (!c) { editingId = null; renderGarage(); return; }
  const cl = classFromPi(c.pi);
  view.innerHTML = `
    <h2>${isNew ? 'Add a car' : 'Update car'}</h2>
    <p class="lede">Copy the numbers from the car's page in Forza. Leave anything you don't know blank.</p>
    <form id="car-form" class="form" data-id="${esc(c.id)}" novalidate>
      <label class="field wide"><span>Car</span><input type="text" name="name" value="${isNew ? '' : esc(c.name)}" placeholder="For example 2020 Honda Civic Type R TCR" required maxlength="80" autocomplete="off"></label>
      <label class="field"><span>PI <output class="pi-class">${cl ? `${cl} class` : ''}</output></span><input type="number" name="pi" value="${c.pi ?? ''}" min="100" max="999" inputmode="numeric" placeholder="100–999"></label>
      <label class="field"><span>Drivetrain</span><select name="drivetrain">${DRIVETRAINS.map((d) => `<option value="${d.id}"${d.id === c.drivetrain ? ' selected' : ''}>${d.label}</option>`).join('')}</select></label>
      <label class="field"><span>Tyre compound</span><select name="tyre">${TYRES.map((t) => `<option value="${t.id}"${t.id === c.tyre ? ' selected' : ''}>${t.label}</option>`).join('')}</select></label>
      ${numInput('level', 'Car level', c.level, 'min="1" max="50" placeholder="1–50"')}

      <fieldset class="wide group"><legend>Stats (0–10)</legend>
        <div class="grid-5">${STATS.map(([k, label]) => numInput(`stat_${k}`, label, c.stats[k], 'min="0" max="10" step="0.1"')).join('')}</div>
      </fieldset>

      <fieldset class="wide group"><legend>Specs</legend>
        <div class="grid-2">${SPECS.filter(([k]) => k !== 'level').map(([k, label, unit]) => numInput(k, `${label}${unit ? ` (${unit})` : ''}`, c[k], k === 'frontPct' ? 'min="20" max="80" step="1"' : 'min="0"')).join('')}</div>
      </fieldset>

      <fieldset class="wide group toggles"><legend>Tuning parts fitted</legend>
        <label class="toggle">Factory race car <input type="checkbox" name="raceCar"${c.raceCar ? ' checked' : ''}></label>
        <p class="small">Race cars come with race suspension, anti-roll bars, differential and transmission. Tick aero separately.</p>
        ${PARTS.map(([k, label]) => `<label class="toggle">${esc(label)} <input type="checkbox" name="part_${k}"${c.parts[k] ? ' checked' : ''}></label>`).join('')}
      </fieldset>

      <label class="field wide"><span>Notes</span><textarea name="notes" rows="3" maxlength="500" placeholder="Upgrades, what it likes, favourite tracks">${esc(c.notes)}</textarea></label>
      <p class="form-error wide" role="alert" hidden></p>
      <div class="actions wide">
        <button type="submit" class="btn">${isNew ? 'Add to garage' : 'Save changes'}</button>
        <button type="button" class="btn ghost" data-action="cancel-car">Cancel</button>
      </div>
      ${isNew ? '' : `<button type="button" class="btn ghost danger wide" data-action="delete-car" data-id="${esc(c.id)}">Remove from garage</button>`}
    </form>`;
  $('#car-form [name=name]').focus({ preventScroll: true });
}

function readCarForm(form) {
  const d = new FormData(form);
  const id = form.dataset.id;
  const prev = state.garage.find((c) => c.id === id);
  return {
    ...(prev || {}), id,
    name: d.get('name'), pi: d.get('pi'), drivetrain: d.get('drivetrain'), tyre: d.get('tyre'), level: d.get('level'),
    hp: d.get('hp'), torque: d.get('torque'), weight: d.get('weight'), frontPct: d.get('frontPct'), notes: d.get('notes'),
    raceCar: d.get('raceCar') === 'on',
    stats: Object.fromEntries(STATS.map(([k]) => [k, d.get(`stat_${k}`)])),
    parts: Object.fromEntries(PARTS.map(([k]) => [k, d.get(`part_${k}`) === 'on'])),
  };
}

function exportGarage() {
  const blob = new Blob([JSON.stringify({ app: 'morris-racing', version: 1, garage: state.garage }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `morris-racing-garage-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importGarage(file) {
  try {
    const data = JSON.parse(await file.text());
    const cars = Array.isArray(data) ? data : data.garage;
    if (!Array.isArray(cars)) throw new Error('no cars');
    const incoming = cars.map(normalizeCar);
    const byId = new Map(state.garage.map((c) => [c.id, c]));
    incoming.forEach((c) => byId.set(c.id, c));
    state.garage = [...byId.values()];
    persist(); render(); toast(`Restored ${incoming.length} car${incoming.length === 1 ? '' : 's'}`);
  } catch {
    toast('That file is not a Morris Racing garage backup');
  }
}

// ---------------------------------------------------------------------------
// Data tab: telemetry from the bridge
// ---------------------------------------------------------------------------
const trackName = (lap) => {
  if (lap.game === 'f1') return F1_TRACKS.find((t) => t.id === lap.track?.name)?.name || (lap.track?.id != null ? `Track ${lap.track.id}` : 'Unknown track');
  const id = lap.context?.trackId || state.links.forzaTracks[lap.track?.ordinal];
  return FORZA_TRACKS.find((t) => t.id === id)?.name || (lap.track?.ordinal != null ? `Track #${lap.track.ordinal}` : 'Unknown track');
};
const lapCar = (lap) => {
  if (lap.game !== 'forza') return null;
  const id = lap.context?.carId || state.links.forzaCars[lap.car?.ordinal];
  return state.garage.find((c) => c.id === id) || null;
};
const carLabel = (lap) => {
  if (lap.game === 'f1') return lap.car?.format >= 2026 ? '2026 car' : '2025 car';
  const car = lapCar(lap);
  return car ? car.name : `PI ${lap.car?.pi ?? '?'} ${dtLabel(lap.car?.drivetrain || 'rwd')} car`;
};

const GAME_SETUP = {
  forza: [
    ['Where', 'Settings, then Gameplay & HUD, then UDP Race Telemetry'],
    ['Data Out', 'On'],
    ['Data Out IP address', 'Your laptop address'],
    ['Data Out IP port', '5300'],
    ['Data Out packet format', 'Car Dash'],
  ],
  f1: [
    ['Where', 'Settings, then Telemetry Settings'],
    ['UDP Telemetry', 'On'],
    ['UDP Broadcast Mode', 'Off'],
    ['UDP IP Address', 'Your laptop address'],
    ['UDP Port', '20777'],
    ['UDP Send Rate', '60Hz'],
    ['UDP Format', '2025 or 2026 (either works)'],
  ],
};

function renderDataSetup() {
  const g = state.game;
  view.innerHTML = `
    <h2>Live data</h2>
    <p class="lede">Send telemetry from the Xbox to your laptop. You get setting changes worked out from your own laps, and a log of every lap with the car and tune you used.</p>
    <h3>Set it up once</h3>
    <ol class="setup-steps">
      <li><b>Download the bridge to your Windows laptop</b> and unzip it.
        <a class="btn inline" href="dist/MorrisRacingBridge.zip" download>Download for Windows</a></li>
      <li><b>Run MorrisRacingBridge.exe.</b> Windows may warn that the app isn't recognised, because it isn't from a big publisher. Choose More info, then Run anyway. If Windows asks about network access, allow Private networks.</li>
      <li><b>Open the address the bridge shows on your phone</b>, for example http://192.168.1.20:8080. Use that address while racing. This copy of the app can't receive data.</li>
      <li><b>Point ${esc(gameName(g))} at your laptop</b> with these settings:</li>
    </ol>
    <p class="small">${esc(GAME_SETUP[g][0][1])}</p>
    <div class="rows">${GAME_SETUP[g].slice(1).map(([k, v]) => row(k, v)).join('')}</div>
    <p class="hint">The laptop and Xbox must be on the same network, and the bridge window must stay open while you race.</p>
    <h3>Bring your garage across</h3>
    <p class="small">The laptop address is a separate copy of the app. On the Garage tab here, tap Back up garage, then Restore backup on the laptop address.</p>`;
}

function liveLine(g) {
  const s = live.status?.[g];
  const l = s?.live;
  const on = live.connected && s?.receiving;
  const text = !live.connected ? 'Lost connection to the bridge. Check the laptop.'
    : on ? `Receiving ${gameName(g)} data` : `Waiting for ${gameName(g)} data`;
  const detail = on && l ? `Lap ${l.lap ?? '–'}, ${l.currentLap != null ? fmtLap(l.currentLap * 1000) : '–'}, ${l.speedKmh ?? 0} km/h, gear ${l.gear ?? '–'}` : on ? '' : 'Start a session with telemetry turned on in the game.';
  return `<span class="dot${on ? ' on' : ''}" aria-hidden="true"></span><span><b>${esc(text)}</b><br><span class="small">${esc(detail)}</span></span>`;
}

function renderData() {
  if (!live.bridge) { renderDataSetup(); return; }
  const g = state.game;
  const ctx = live.status?.context?.[g] || {};
  const liveCar = live.status?.forza?.live;
  const gameLaps = live.laps.filter((l) => l.game === g);
  const sess = sessions(gameLaps);
  const latest = sess[0];
  const n = state.dataLaps === 'all' ? Infinity : Number(state.dataLaps);
  const pick = latest ? latest.laps.filter((l) => l.valid !== false).slice(-n) : [];
  const car = latest ? lapCar(latest.laps.at(-1)) : null;
  const adv = lapAdvice(pick, { drivetrain: car?.drivetrain });
  const savedForGame = state.saved.filter((x) => x.game === g);

  const contextForm = g === 'forza' ? `
      ${field('Car on track', `<select data-ctx="carId"><option value="">Not set</option>${state.garage.map((c) => `<option value="${esc(c.id)}"${c.id === ctx.carId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`, true)}
      ${liveCar?.pi ? `<p class="small wide car-line">The game reports PI ${esc(liveCar.pi)}, ${dtLabel(liveCar.drivetrain || 'rwd')}.</p>` : ''}
      ${field('Track', `<select data-ctx="trackId"><option value="">Not set</option>${FORZA_TRACKS.map((t) => `<option value="${t.id}"${t.id === ctx.trackId ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`, true)}
      ${field('Tune in use', `<select data-ctx="tune"><option value="">Not set</option>${savedForGame.map((x) => `<option${x.name === ctx.tune ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`, true)}`
    : `${field('Setup in use', `<select data-ctx="tune"><option value="">Not set</option>${savedForGame.map((x) => `<option${x.name === ctx.tune ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`, true)}`;

  view.innerHTML = `
    <h2>Live data</h2>
    <div class="live-card" id="live-line">${liveLine(g)}</div>

    <h3>What you're driving</h3>
    <div class="form">${contextForm}
      <p class="small wide">New laps are logged with these.${g === 'forza' ? ' The game only reports a number for the car and track, so set them once and they are remembered.' : ''}</p>
    </div>

    <h3>Setting changes from your laps</h3>
    ${latest ? `<div class="small using">${esc(trackName(latest.laps.at(-1)))}, ${esc(carLabel(latest.laps.at(-1)))}. Using the last ${seg('dataLaps', [{ id: '3', label: '3' }, { id: '5', label: '5' }, { id: 'all', label: 'All' }], state.dataLaps)} laps of this session.</div>` : ''}
    ${!latest ? '<div class="empty">No laps yet. Drive a couple of laps and the advice appears here.</div>'
      : pick.length < 2 ? '<div class="empty">Drive at least 2 clean laps in this session for advice.</div>'
        : adv.findings.length ? `<div class="findings">${adv.findings.map((f) => `
          <article class="finding ${f.severity}">
            <h4>${esc(f.title)}</h4>
            <p class="small">${esc(f.evidence)}</p>
            <ul>${f.changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
          </article>`).join('')}</div>
          <p class="hint">Make one change, drive 2–3 laps, then check here again.</p>`
          : '<div class="empty">Nothing stood out over these laps. The car looks balanced, so work on consistency.</div>'}

    <h3>Lap log</h3>
    ${sess.length ? sess.slice(0, 15).map((ss) => {
      const st = lapStats(ss.laps);
      const last = ss.laps.at(-1);
      const tune = last.context?.tune;
      return `<details class="session"${ss === latest ? ' open' : ''}>
        <summary><b>${esc(trackName(last))}</b><span class="small">${esc(carLabel(last))}${tune ? `, tune: ${esc(tune)}` : ''}. ${esc(new Date(ss.laps[0].at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}${st ? `. Best ${fmtLap(st.best)}` : ''}</span></summary>
        <table class="laps"><thead><tr><th>Lap</th><th>Time</th><th>Gap</th></tr></thead><tbody>
        ${ss.laps.map((l) => `<tr class="${st && l.timeMs === st.best && l.valid !== false ? 'best' : ''}${l.valid === false ? ' invalid' : ''}">
          <td>${esc(l.lap)}</td><td>${fmtLap(l.timeMs)}${l.valid === false ? ' (invalid)' : ''}</td><td>${st && l.valid !== false ? (l.timeMs === st.best ? 'Best' : `+${((l.timeMs - st.best) / 1000).toFixed(3)}`) : ''}</td></tr>`).join('')}
        </tbody></table>
        ${st && st.count > 1 ? `<p class="small">Average ${fmtLap(Math.round(st.avg))}. Consistency: laps within ${(st.spread / 1000).toFixed(2)} s of each other on average.</p>` : ''}
        <button type="button" class="btn ghost" data-action="delete-session" data-id="${esc(ss.id)}">Delete this session</button>
      </details>`;
    }).join('') : '<div class="empty">Completed laps show up here.</div>'}
    <p class="hint">Laps are saved on the laptop, so nothing is lost if your phone screen locks.</p>`;
}

async function setContext(key, value) {
  const g = state.game;
  const cur = { ...(live.status?.context?.[g] || {}) };
  cur[key] = value;
  if (g === 'forza') {
    const l = live.status?.forza?.live;
    if (key === 'carId' && value && l?.carOrdinal != null) state.links.forzaCars[l.carOrdinal] = value;
    if (key === 'trackId' && value && l?.trackOrdinal != null) state.links.forzaTracks[l.trackOrdinal] = value;
    persist();
  }
  const res = await putContext({ [g]: cur });
  if (res && live.status) live.status.context = res.context;
  render();
}

// When Forza reports a car or track that's already linked, set it automatically.
let autoBusy = false;
async function autoContext() {
  const l = live.status?.forza?.live;
  if (!l || autoBusy) return;
  const ctx = live.status.context?.forza || {};
  const carId = state.links.forzaCars[l.carOrdinal];
  const trackId = state.links.forzaTracks[l.trackOrdinal];
  if ((carId && carId !== ctx.carId) || (trackId && trackId !== ctx.trackId)) {
    autoBusy = true;
    const res = await putContext({ forza: { ...ctx, ...(carId ? { carId } : {}), ...(trackId ? { trackId } : {}) } });
    if (res && live.status) live.status.context = res.context;
    autoBusy = false;
    if (state.tab === 'data') render();
  }
}

// ---------------------------------------------------------------------------
// Render + events
// ---------------------------------------------------------------------------
function render() {
  document.body.dataset.game = state.game;
  document.querySelectorAll('.game-switch button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.game === state.game)));
  document.querySelectorAll('.tabs button').forEach((b) => (b.dataset.tab === state.tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  if (state.tab === 'wheel') renderWheel();
  else if (state.tab === 'setup') (state.game === 'forza' ? renderForza : renderF1)();
  else if (state.tab === 'fix') renderFix();
  else if (state.tab === 'garage') renderGarage();
  else if (state.tab === 'data') renderData();
  else renderSaved();
}

document.querySelector('.game-switch').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.dataset.game === state.game) return;
  state.game = b.dataset.game;
  openIssue = null;
  if (state.game === 'f1' && state.tab === 'garage') state.tab = 'wheel';
  persist(); render(); sweepLeds();
});

document.querySelector('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.tab = b.dataset.tab;
  if (state.tab !== 'garage') editingId = null;
  persist(); render();
  window.scrollTo({ top: 0 });
});

view.addEventListener('click', (e) => {
  const segBtn = e.target.closest('.seg button');
  if (segBtn) {
    const key = segBtn.parentElement.dataset.seg;
    if (key === 'dataLaps') { state.dataLaps = segBtn.dataset.value; persist(); render(); return; }
    if (key === 'wheelSetFor') {
      const v = segBtn.dataset.value;
      state.wheelSetFor = v === 'unknown' ? null : v;
      persist(); render(); return;
    }
    const target = state.game === 'forza' ? state.forza : state.f1;
    target[key] = key === 'era' ? Number(segBtn.dataset.value) : segBtn.dataset.value;
    persist(); render();
    return;
  }
  const issue = e.target.closest('[data-issue]');
  if (issue) { openIssue = openIssue === issue.dataset.issue ? null : issue.dataset.issue; render(); return; }
  const act = e.target.closest('[data-action]');
  if (!act) return;
  const a = act.dataset.action;
  if (a === 'add-car') { editingId = 'new'; render(); window.scrollTo({ top: 0 }); return; }
  if (a === 'edit-car') { editingId = act.dataset.id; state.tab = 'garage'; persist(); render(); window.scrollTo({ top: 0 }); return; }
  if (a === 'cancel-car') { editingId = null; render(); window.scrollTo({ top: 0 }); return; }
  if (a === 'delete-car') {
    const car = state.garage.find((c) => c.id === act.dataset.id);
    if (!car || !confirm(`Remove ${car.name} from your garage?`)) return;
    state.garage = state.garage.filter((c) => c.id !== car.id);
    if (state.forza.carId === car.id) state.forza.carId = '';
    editingId = null; persist(); render(); toast('Removed'); return;
  }
  if (a === 'tune-car') { selectCar(act.dataset.id); state.tab = 'setup'; persist(); render(); window.scrollTo({ top: 0 }); return; }
  if (a === 'export') { exportGarage(); return; }
  if (a === 'delete-session') {
    if (!confirm('Delete this session and its laps?')) return;
    deleteSession(act.dataset.id).then(() => { render(); toast('Deleted'); });
    return;
  }
  if (a === 'wheel-done') { state.wheelSetFor = state.game; persist(); render(); toast(`Wheel set for ${gameName(state.game)}`); window.scrollTo({ top: 0 }); }
  if (a === 'save') saveCurrent();
  if (a === 'clear-now') {
    if (!confirm('Clear the values you entered?')) return;
    delete state.current[nowKey()];
    persist(); render(); toast('Cleared');
  }
  if (a === 'delete') {
    if (!confirm('Delete this saved setup?')) return;
    state.saved = state.saved.filter((s) => s.id !== act.dataset.id);
    persist(); render(); toast('Deleted');
  }
  if (a === 'load') {
    const s = state.saved.find((x) => x.id === act.dataset.id);
    if (!s) return;
    state[s.game] = { ...state[s.game], ...s.inputs };
    state.tab = 'setup';
    persist(); render(); window.scrollTo({ top: 0 });
  }
});

// Choosing a garage car also sets class, drivetrain and aero for the Fix it tab.
function selectCar(id) {
  state.forza.carId = id || '';
  const car = currentCar();
  if (!car) return;
  const cl = classFromPi(car.pi);
  if (cl) state.forza.cls = cl;
  state.forza.drivetrain = car.drivetrain;
  state.forza.aero = hasPart(car, 'aero');
}

view.addEventListener('change', (e) => {
  const el = e.target;
  if (el.matches('[data-import]')) { if (el.files[0]) importGarage(el.files[0]); el.value = ''; return; }
  if (el.closest('#car-form')) return;
  if (el.dataset.ctx) { setContext(el.dataset.ctx, el.value); return; }
  if (el.dataset.now) return;
  const target = state.game === 'forza' ? state.forza : state.f1;
  if (el.dataset.field === 'carId') { selectCar(el.value); persist(); render(); return; }
  if (el.dataset.field) { target[el.dataset.field] = el.value; persist(); render(); }
  if (el.dataset.check) { target[el.dataset.check] = el.checked; persist(); render(); }
});

let nowSave;
view.addEventListener('input', (e) => {
  const now = e.target.dataset.now;
  if (now) {
    const k = nowKey();
    const vals = { ...state.current[k] };
    if (e.target.value === '') delete vals[now]; else vals[now] = e.target.value;
    state.current[k] = vals;
    const r = lastTune?.sections.flatMap((s) => s.rows).find((x) => x.key === now);
    const c = r && compareValue(r.cmp, vals[now]);
    const out = view.querySelector(`[data-cmp="${now}"]`);
    if (out) { out.innerHTML = cmpHtml(c); out.className = `cmp${c ? (c.ok ? ' ok' : ' chg') : ''}`; }
    clearTimeout(nowSave); nowSave = setTimeout(persist, 400);
    return;
  }
  if (e.target.matches('#car-form [name=pi]')) {
    const cl = classFromPi(e.target.value);
    $('#car-form .pi-class').textContent = cl ? `${cl} class` : '';
  }
});

view.addEventListener('submit', (e) => {
  if (e.target.id !== 'car-form') return;
  e.preventDefault();
  const form = e.target;
  const err = $('.form-error', form);
  const name = form.elements.name.value.trim();
  const pi = form.elements.pi.value;
  const msg = !name ? 'Enter the car name.' : pi && !classFromPi(pi) ? 'PI must be between 100 and 999.' : '';
  if (msg) { err.textContent = msg; err.hidden = false; (name ? form.elements.pi : form.elements.name).focus(); return; }
  const isNew = editingId === 'new';
  const data = readCarForm(form);
  const before = state.garage.find((c) => c.id === data.id);
  state.garage = upsertCar(state.garage, data);
  if (state.forza.carId === data.id) selectCar(data.id);
  const after = state.garage.find((c) => c.id === data.id);
  editingId = null; persist(); render(); window.scrollTo({ top: 0 });
  toast(isNew ? 'Added to garage' : after.history[0] && after.history !== before?.history ? 'Saved and logged the changes' : 'No changes');
});

render();
sweepLeds();

// If this copy of the app was opened from the laptop bridge, switch on live data.
detectBridge().then(async (isBridge) => {
  if (!isBridge) return;
  document.body.classList.add('bridge');
  if (!hadLocal) {
    const remote = await getRemoteState();
    if (remote && typeof remote === 'object') {
      Object.assign(state, load(remote));
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
    }
  }
  connect((what) => {
    if (what === 'status') {
      autoContext();
      const el = document.getElementById('live-line');
      if (state.tab === 'data' && el) el.innerHTML = liveLine(state.game);
      return;
    }
    if (what === 'lap') toast('Lap logged');
    // Re-render the Data tab unless you're mid-way through picking something.
    if (state.tab === 'data' && !view.contains(document.activeElement)) render();
  });
  render();
});
