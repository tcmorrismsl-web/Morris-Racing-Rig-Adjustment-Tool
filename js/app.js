import { WHEEL_PROFILES, SWITCH_TIPS, FORZA_TRACKS, FORZA_CLASSES, F1_TRACKS, F1_RANGES } from './data.js';
import { forzaTune, forzaFix, FORZA_ISSUES, DRIVETRAINS } from './forza.js';
import { f1Setup, f1Fix, F1_ISSUES, F1_ROWS, F1_STYLES } from './f1.js';

// ---------------------------------------------------------------------------
// State (kept in this browser only)
// ---------------------------------------------------------------------------
const KEY = 'morris-racing-v1';
const defaults = {
  game: 'forza',
  tab: 'wheel',
  wheelSetFor: null,
  forza: { track: 'fujimi', cls: 'A', drivetrain: 'fwd', weather: 'dry', time: 'night', temp: 'mild', length: 'medium', tyreWear: true, fuel: false, aero: true },
  f1: { era: 2025, track: 'australia', session: 'race', weather: 'dry', style: 'balanced' },
  saved: [],
};
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!s) return structuredClone(defaults);
    return { ...structuredClone(defaults), ...s, forza: { ...defaults.forza, ...s.forza }, f1: { ...defaults.f1, ...s.f1 } };
  } catch { return structuredClone(defaults); }
}
const state = load();
function persist() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ } }

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = $('#view');
const gameName = (g) => WHEEL_PROFILES[g].name;
const other = (g) => (g === 'forza' ? 'f1' : 'forza');

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
  <div class="row">
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
    const items = p.moza.filter((m) => !/preset default/.test(m.value) && (!from || from.moza.find((x) => x.key === m.key)?.value !== m.value));
    const auto = p.moza.some((m) => /preset default/.test(m.value));
    banner = `
      <section class="switch">
        <h2>Switch the wheel to ${esc(p.name)}</h2>
        <p class="small">${from ? `Your wheel is set up for ${esc(from.name)}. Change these in the MOZA Racing app, in this order.` : 'Set these in the MOZA Racing app, in this order.'}</p>
        <ul class="checklist">
          ${items.map((m, i) => {
            const prev = from?.moza.find((x) => x.key === m.key)?.value;
            return `<li><input type="checkbox" id="c${i}"><label for="c${i}">${esc(m.label)}<br>${prev ? `<span class="from">${esc(prev)}</span>` : ''}<span class="to">${esc(m.value)}</span></label></li>`;
          }).join('')}
          <li><input type="checkbox" id="cg"><label for="cg">Check the in-game wheel settings below</label></li>
        </ul>
        ${auto ? `<p class="small">Choosing the ${esc(p.moza[0].value)} preset resets the other base settings, so you only need the changes above.</p>` : ''}
        <button type="button" class="btn" data-action="wheel-done">Wheel is set for ${esc(p.name)}</button>
      </section>`;
  }
  view.innerHTML = `
    ${banner}
    ${state.wheelSetFor === g ? `<h2>Wheel is set for ${esc(p.name)}</h2><p class="lede">Your MOZA R3 settings for ${esc(p.name)}. Switch games at the top to see what to change.</p>` : ''}
    <h3>MOZA Racing app</h3>
    <div class="rows">${p.moza.map((m) => row(m.label, m.value, m.why)).join('')}</div>
    <h3>In ${esc(p.name)}</h3>
    <p class="small">${esc(p.game.where)}</p>
    <div class="rows">${p.game.items.map((m) => row(m.label, m.value, m.why)).join('')}</div>
    <p class="hint">${esc(p.game.after)}</p>
    <h3>When you switch games</h3>
    <ul class="notes">${SWITCH_TIPS.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
}

// ---------------------------------------------------------------------------
// Setup tab: Forza
// ---------------------------------------------------------------------------
function renderForza() {
  const f = state.forza;
  const res = forzaTune(f);
  const cls = FORZA_CLASSES.map((c) => ({ id: c.id, label: c.label }));
  view.innerHTML = `
    <h2>Forza tune</h2>
    <p class="lede">Starting values for your car on this track. Load the car's default tune, then apply these.</p>
    <div class="form">
      ${field('Track', `<select data-field="track">${FORZA_TRACKS.map((t) => `<option value="${t.id}"${t.id === f.track ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`, true)}
      ${field(`Class (${FORZA_CLASSES.find((c) => c.id === f.cls).range} PI)`, seg('cls', cls, f.cls), true)}
      ${field('Drivetrain', seg('drivetrain', DRIVETRAINS, f.drivetrain))}
      ${field('Weather', seg('weather', [{ id: 'dry', label: 'Dry' }, { id: 'wet', label: 'Wet' }], f.weather))}
      ${field('Time of day', seg('time', [{ id: 'day', label: 'Day' }, { id: 'night', label: 'Night' }], f.time))}
      ${field('Temperature', seg('temp', [{ id: 'cool', label: 'Cool' }, { id: 'mild', label: 'Mild' }, { id: 'hot', label: 'Hot' }], f.temp))}
      ${field('Race length', seg('length', [{ id: 'sprint', label: 'Under 15 min' }, { id: 'medium', label: '15–35 min' }, { id: 'long', label: '35+ min' }], f.length), true)}
      <div class="toggles wide">
        <label class="toggle">Tyre wear on <input type="checkbox" data-check="tyreWear"${f.tyreWear ? ' checked' : ''}></label>
        <label class="toggle">Fuel use on <input type="checkbox" data-check="fuel"${f.fuel ? ' checked' : ''}></label>
        <label class="toggle">Car has adjustable aero <input type="checkbox" data-check="aero"${f.aero ? ' checked' : ''}></label>
      </div>
    </div>
    ${res.sections.map((s) => `
      <h3>${esc(s.title)}</h3>
      <div class="rows">${s.rows.map((r) => row(r.label, r.value, r.why, { rel: r.rel })).join('')}</div>
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
  const dt = state.forza.drivetrain;
  view.innerHTML = `
    <h2>Fix the handling</h2>
    <p class="lede">${forza ? `Pick what the car is doing. Steps are for a ${dt.toUpperCase()} car (change drivetrain on the Setup tab). Make one change, drive a lap, then try the next.` : 'Pick what the car is doing. Make one change, drive a lap, then try the next.'}</p>
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
    const res = forzaTune(state.forza);
    const def = `${res.cls.id} class, ${res.track.name}`;
    const name = prompt('Name this tune (for example the car)', def);
    if (name === null) return;
    const f = state.forza;
    state.saved.unshift({
      id, game: 'forza', name: name.trim() || def,
      sub: `${res.track.name}, ${res.cls.id} class ${f.drivetrain.toUpperCase()}, ${f.weather}, ${f.time}`,
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
// Render + events
// ---------------------------------------------------------------------------
function render() {
  document.body.dataset.game = state.game;
  document.querySelectorAll('.game-switch button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.game === state.game)));
  document.querySelectorAll('.tabs button').forEach((b) => (b.dataset.tab === state.tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  if (state.tab === 'wheel') renderWheel();
  else if (state.tab === 'setup') (state.game === 'forza' ? renderForza : renderF1)();
  else if (state.tab === 'fix') renderFix();
  else renderSaved();
}

document.querySelector('.game-switch').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.dataset.game === state.game) return;
  state.game = b.dataset.game;
  openIssue = null;
  persist(); render(); sweepLeds();
});

document.querySelector('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.tab = b.dataset.tab;
  persist(); render();
  window.scrollTo({ top: 0 });
});

view.addEventListener('click', (e) => {
  const segBtn = e.target.closest('.seg button');
  if (segBtn) {
    const key = segBtn.parentElement.dataset.seg;
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
  if (a === 'wheel-done') { state.wheelSetFor = state.game; persist(); render(); toast(`Wheel set for ${gameName(state.game)}`); window.scrollTo({ top: 0 }); }
  if (a === 'save') saveCurrent();
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

view.addEventListener('change', (e) => {
  const el = e.target;
  const target = state.game === 'forza' ? state.forza : state.f1;
  if (el.dataset.field) { target[el.dataset.field] = el.value; persist(); render(); }
  if (el.dataset.check) { target[el.dataset.check] = el.checked; persist(); render(); }
});

render();
sweepLeds();
