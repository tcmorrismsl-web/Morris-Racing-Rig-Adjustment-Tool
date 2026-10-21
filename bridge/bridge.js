'use strict';
// Morris Racing bridge.
// Receives Forza Motorsport and F1 25 telemetry from the Xbox over UDP, turns it into
// lap summaries, and serves the Morris Racing app to your phone over your Wi-Fi.
// No dependencies. Started by bridge/launch.js ("Start Morris Racing Bridge"), which also
// switches to newer bridge code when this downloads it.

const http = require('http');
const dgram = require('dgram');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseForza, parseF1, parseF1Header } = require('./parsers');
const { ForzaLaps, F1Laps } = require('./laps');
const { F1Race, ForzaRace } = require('./race');

const VERSION = '1.5.0';
const vm = require('vm');
const Module = require('module');
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : Number(process.env[`MR_${name.toUpperCase()}`]) || def;
};
const PORTS = { http: arg('http', 8080), forza: arg('forza', 5300), f1: arg('f1', 20777) };
const APP_ROOT = process.env.MR_APP_ROOT || path.join(__dirname, '..');
const SUPERVISED = process.env.MR_SUPERVISED === '1' && typeof process.send === 'function';
const IDLE_S = Number(process.env.MR_IDLE_S) || 60; // no telemetry for this long = not driving
// The app, the dashboard and (from 1.4.0) the bridge's own code update themselves from the
// app's website, so changes don't need a new download.
const UPDATE_BASE = process.env.MR_UPDATE_URL || 'https://tcmorrismsl-web.github.io/Morris-Racing-Rig-Adjustment-Tool/';
const DATA_DIR = process.env.MR_DATA || path.join(os.homedir(), 'MorrisRacing');
const FILES = { laps: path.join(DATA_DIR, 'laps.json'), state: path.join(DATA_DIR, 'app-state.json'), context: path.join(DATA_DIR, 'context.json') };
const TRACK_DIR = path.join(DATA_DIR, 'tracks');
const MAX_LAPS = 1000;

fs.mkdirSync(TRACK_DIR, { recursive: true });
const readJson = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };
const timers = {};
const writeJson = (f, data) => {
  clearTimeout(timers[f]);
  timers[f] = setTimeout(() => {
    try { fs.writeFileSync(`${f}.tmp`, JSON.stringify(data)); fs.renameSync(`${f}.tmp`, f); } catch (e) { log(`Could not save ${path.basename(f)}: ${e.message}`); }
  }, 300);
};

let laps = readJson(FILES.laps, []);
let context = readJson(FILES.context, { forza: {}, f1: {} });
const stats = { forza: { packets: 0, last: null }, f1: { packets: 0, last: null } };
const clients = new Set();

function log(msg) { console.log(`[${new Date().toLocaleTimeString()}] ${msg}`); }

function send(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

function addLap(lap) {
  const ctx = { ...(context[lap.game] || {}) };
  // F1: record the setup and tyre actually in use, from the game itself.
  if (lap.game === 'f1') {
    const u = f1Race.inUse();
    if (u) { ctx.setup = u.setup; ctx.compound = u.compound; ctx.era = u.era; ctx.session = u.session; ctx.weather = u.weather; }
  }
  const full = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, at: new Date().toISOString(), context: ctx, ...lap };
  laps.push(full);
  if (laps.length > MAX_LAPS) laps = laps.slice(-MAX_LAPS);
  writeJson(FILES.laps, laps);
  send('lap', full);
  const t = (full.timeMs / 1000).toFixed(3);
  log(`${lap.game === 'forza' ? 'Forza' : 'F1 25'} lap ${lap.lap} done: ${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, '0')}`);
}

const forza = new ForzaLaps(addLap);
const f1 = new F1Laps(addLap);

// Live race state for the dashboard. Track outlines are saved so the map appears straight away next time.
const trackStore = {
  file: (key) => path.join(TRACK_DIR, `${String(key).replace(/[^\w-]/g, '')}.json`),
  loadTrack(key) { return key ? readJson(this.file(key), null) : null; },
  saveTrack(key, data) { if (key) { writeJson(this.file(key), data); log(`Saved the track map (${key}).`); } },
};
let appState = readJson(FILES.state, null);
const f1Race = new F1Race(trackStore);
const forzaRace = new ForzaRace(trackStore, () => appState?.forza?.laps);
const dashFor = (game) => (game === 'forza' ? forzaRace : game === 'f1' ? f1Race : (forzaRace.lastSeen > f1Race.lastSeen ? forzaRace : f1Race));

// ---------------------------------------------------------------------------
// UDP: either port accepts either game; the packet itself says which it is.
// ---------------------------------------------------------------------------
function onPacket(buf) {
  const h = parseF1Header(buf);
  if (h) {
    stats.f1.packets++; stats.f1.last = Date.now();
    const m = parseF1(buf);
    f1.push(m);
    f1Race.push(m);
    return;
  }
  const p = parseForza(buf);
  if (p) {
    stats.forza.packets++; stats.forza.last = Date.now();
    if (!p.dash && stats.forza.packets % 600 === 1) log('Forza is sending the "Sled" format. Set Packet Format to "Car Dash" in Forza for lap times and tyre data.');
    forza.push(p);
    forzaRace.push(p);
  }
}

function listenUdp(name, port) {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  sock.on('message', onPacket);
  sock.on('error', (e) => log(`Could not listen for ${name} on port ${port}: ${e.message}. Is another telemetry app using it?`));
  sock.bind(port, '0.0.0.0');
  return sock;
}

// ---------------------------------------------------------------------------
// HTTP: the app, its data, and a live event stream
// ---------------------------------------------------------------------------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  // Home networks first.
  return out.sort((x, y) => Number(!/^192\.168\./.test(x)) - Number(!/^192\.168\./.test(y)));
}

function status() {
  const now = Date.now();
  const flow = (s) => ({ packets: s.packets, receiving: !!s.last && now - s.last < 3000, last: s.last });
  return {
    bridge: true, version: VERSION, ports: PORTS, addresses: lanAddresses(),
    app: { version: appInfo.active?.label || null, bridgeUpdate: appInfo.bridgeUpdate && !bridgeInfo.staged, bridgeStaged: bridgeInfo.staged },
    forza: { ...flow(stats.forza), live: forza.live }, f1: { ...flow(stats.f1), live: f1.live, inUse: f1Race.inUse() },
    laps: laps.length, context,
  };
}

function body(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')); } catch (e) { reject(e); } });
  });
}

const json = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/api/status') return json(res, 200, status());
    if (p === '/api/laps' && req.method === 'GET') return json(res, 200, laps);
    if (p === '/api/laps' && req.method === 'DELETE') {
      const session = url.searchParams.get('session');
      const id = url.searchParams.get('id');
      laps = session ? laps.filter((l) => l.session !== session) : id ? laps.filter((l) => l.id !== id) : [];
      writeJson(FILES.laps, laps);
      send('laps', { count: laps.length });
      return json(res, 200, { ok: true, count: laps.length });
    }
    if (p === '/api/context' && req.method === 'PUT') {
      const c = await body(req, 20_000);
      if (c && typeof c === 'object') {
        for (const g of ['forza', 'f1']) if (c[g] && typeof c[g] === 'object') context[g] = { ...c[g] };
        writeJson(FILES.context, context);
      }
      return json(res, 200, { ok: true, context });
    }
    if (p === '/api/state') {
      if (req.method === 'GET') return json(res, 200, readJson(FILES.state, null));
      if (req.method === 'PUT') { const s = await body(req); appState = s; writeJson(FILES.state, s); return json(res, 200, { ok: true }); }
    }
    if (p === '/api/dash') return json(res, 200, dashFor(url.searchParams.get('game')).state());
    if (p === '/api/engineer' && req.method === 'POST') {
      const q = await body(req, 2000);
      const topics = ['yes', 'no', 'wait', 'gaps', 'pit', 'time', 'weather', 'tyres', 'repeat', 'plan'];
      if (!q || !topics.includes(q.ask)) return json(res, 400, { error: 'unknown question' });
      const call = dashFor(q.game).eng.ask(q.ask);
      return json(res, 200, { ok: true, call });
    }
    // The app's suggested wheel settings (brake bias, diff) for this session, sent by the dashboard.
    if (p === '/api/targets' && req.method === 'POST') {
      const q = await body(req, 2000);
      const num = (v, lo, hi) => (Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi ? Number(v) : null);
      f1Race.eng.targets = q ? { brakeBias: num(q.brakeBias, 50, 70), diffOn: num(q.diffOn, 10, 100), at: Date.now() } : null;
      return json(res, 200, { ok: true });
    }
    if (p === '/api/track') return json(res, 200, dashFor(url.searchParams.get('game')).track());
    if (p === '/dash-events') {
      const game = url.searchParams.get('game');
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      const tick = () => { try { res.write(`event: dash\ndata: ${JSON.stringify(dashFor(game).state())}\n\n`); } catch { /* client gone */ } };
      tick();
      const timer = setInterval(tick, 100);
      req.on('close', () => clearInterval(timer));
      return;
    }
    if (p === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`event: status\ndata: ${JSON.stringify(status())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    // Static app files
    const rel = decodeURIComponent(p === '/' ? '/index.html' : p).replace(/^\/+/, '');
    const root = appRoot();
    const file = path.join(root, rel);
    if (!file.startsWith(root) || rel.startsWith('bridge') || rel.startsWith('.')) { res.writeHead(404); return res.end('Not found'); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  } catch (e) {
    json(res, 400, { error: e.message });
  }
});

setInterval(() => { if (clients.size) send('status', status()); }, 1000);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// App self-update
// ---------------------------------------------------------------------------
const UPDATE_DIR = path.join(DATA_DIR, 'app-update');
const stampNum = (m) => (m && m.version ? parseInt(m.version, 36) || 0 : 0);
const semver = (v) => String(v || '0').split('.').map((n) => Number(n) || 0);
const atLeast = (have, need) => { const a = semver(have), b = semver(need); for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); } return true; };
const SAFE_FILE = /^(?:js\/)?[\w.-]+\.(?:html|js|css|svg|webmanifest)$/;
const appInfo = { local: readJson(path.join(APP_ROOT, 'app-files.json'), null), cached: null, active: null, bridgeUpdate: false };
appInfo.cached = readJson(path.join(UPDATE_DIR, 'current', 'app-files.json'), null);
function pickAppRoot() {
  const c = appInfo.cached;
  const useCache = c && atLeast(VERSION, c.bridgeMin) && stampNum(c) > stampNum(appInfo.local);
  appInfo.active = useCache ? c : appInfo.local;
  return useCache ? path.join(UPDATE_DIR, 'current') : APP_ROOT;
}
let activeRoot = pickAppRoot();
function appRoot() { return activeRoot; }

// ---------------------------------------------------------------------------
// Bridge self-update: newer bridge code is downloaded, checked, and used after a restart.
// Under the launcher the restart happens by itself as soon as you're not driving.
// ---------------------------------------------------------------------------
const BRIDGE_DIR = path.join(DATA_DIR, 'bridge-update');
const SAFE_BRIDGE_FILE = /^bridge\/[\w-]+\.js$/;
const bridgeVersionOf = (dir) => { try { return (fs.readFileSync(path.join(dir, 'bridge.js'), 'utf8').match(/const VERSION = '([\d.]+)'/) || [])[1] || null; } catch { return null; } };
const bridgeInfo = { staged: null };
{ const v = bridgeVersionOf(path.join(BRIDGE_DIR, 'current')); if (v && !atLeastV(VERSION, v)) bridgeInfo.staged = v; }
function atLeastV(have, need) { const a = String(have || '0').split('.').map(Number), b = String(need || '0').split('.').map(Number); for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); } return true; }

async function checkForBridgeUpdate(m) {
  const b = m && m.bridge;
  if (!b || !b.version || atLeastV(VERSION, b.version) || !Array.isArray(b.files) || !b.files.every((f) => SAFE_BRIDGE_FILE.test(f))) return;
  let bad = [];
  try { bad = JSON.parse(fs.readFileSync(path.join(BRIDGE_DIR, 'bad.json'), 'utf8')); } catch { /* none */ }
  if (bad.includes(b.version)) return;
  if (bridgeInfo.staged !== b.version) {
    const tmp = path.join(BRIDGE_DIR, `tmp-${b.version}`);
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    for (const f of b.files) {
      const r = await fetch(`${UPDATE_BASE}${f}?v=${m.version}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`${f}: ${r.status}`);
      const code = await r.text();
      new vm.Script(Module.wrap(code), { filename: f }); // throws if it isn't valid code
      fs.writeFileSync(path.join(tmp, path.basename(f)), code);
    }
    if (bridgeVersionOf(tmp) !== b.version) throw new Error('version mismatch');
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ private: true, type: 'commonjs' }));
    const cur = path.join(BRIDGE_DIR, 'current');
    fs.rmSync(cur, { recursive: true, force: true });
    fs.renameSync(tmp, cur);
    bridgeInfo.staged = b.version;
    log(SUPERVISED ? `Downloaded bridge update ${b.version}. It switches over by itself when you're not driving.` : `Downloaded bridge update ${b.version}. Close this window and start the bridge again to use it.`);
  }
  if (SUPERVISED) restartWhenIdle();
}

let restartTimer = null;
function restartWhenIdle() {
  if (restartTimer) return;
  const tick = () => {
    const last = Math.max(stats.f1.last || 0, stats.forza.last || 0);
    if (Date.now() - last < IDLE_S * 1000) return;
    clearInterval(restartTimer);
    log('Switching to the updated bridge now (you are not driving). This takes a second.');
    try { fs.writeFileSync(FILES.laps, JSON.stringify(laps)); } catch { /* ignore */ }
    process.exit(75);
  };
  restartTimer = setInterval(tick, 5000);
  tick();
}

async function checkForAppUpdate() {
  try {
    const res = await fetch(`${UPDATE_BASE}app-files.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const m = await res.json();
    try { await checkForBridgeUpdate(m); } catch (e) { log(`Couldn't update the bridge right now (${e.message}). Keeping this version.`); }
    if (!m || !Array.isArray(m.files) || stampNum(m) <= stampNum(appInfo.active)) return;
    if (!atLeast(VERSION, m.bridgeMin)) {
      if (!appInfo.bridgeUpdate && !bridgeInfo.staged) log(`A newer bridge (${m.bridgeMin}) is available. Download it from the app's Data tab when you have a moment.`);
      appInfo.bridgeUpdate = true;
      return;
    }
    if (!m.files.every((f) => SAFE_FILE.test(f))) return;
    const tmp = path.join(UPDATE_DIR, `tmp-${m.version}`);
    fs.rmSync(tmp, { recursive: true, force: true });
    for (const f of m.files) {
      const r = await fetch(`${UPDATE_BASE}${f}?v=${m.version}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`${f}: ${r.status}`);
      const data = Buffer.from(await r.arrayBuffer());
      if (!data.length) throw new Error(`${f}: empty`);
      fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
      fs.writeFileSync(path.join(tmp, f), data);
    }
    fs.writeFileSync(path.join(tmp, 'app-files.json'), JSON.stringify(m));
    const cur = path.join(UPDATE_DIR, 'current');
    fs.rmSync(cur, { recursive: true, force: true });
    fs.renameSync(tmp, cur);
    appInfo.cached = m;
    activeRoot = pickAppRoot();
    log(`Updated the app to the latest version (${m.label}). Reload the page on your phone to get it.`);
  } catch (e) {
    log(`Couldn't check for app updates right now (${e.message}). Using the copy you have.`);
  }
}

function start() {
  setTimeout(checkForAppUpdate, 3000);
  setInterval(checkForAppUpdate, 30 * 60 * 1000);
  server.on('error', (e) => { log(`Could not start the app server on port ${PORTS.http}: ${e.message}`); });
  server.listen(PORTS.http, '0.0.0.0', () => {
    const ip = lanAddresses()[0] || 'YOUR-LAPTOP-IP';
    console.log('');
    console.log('  Morris Racing bridge is running.');
    console.log('');
    console.log(`  On your phone, open:   http://${ip}:${PORTS.http}`);
    console.log('');
    console.log('  In Forza Motorsport (Settings > Gameplay & HUD > UDP Race Telemetry):');
    console.log(`    Data Out: On    IP: ${ip}    Port: ${PORTS.forza}    Packet format: Car Dash`);
    console.log('  In F1 25 (Settings > Telemetry Settings):');
    console.log(`    UDP Telemetry: On    Broadcast: Off    IP: ${ip}    Port: ${PORTS.f1}    Send rate: 60Hz`);
    console.log('');
    console.log('  If Windows asks, allow access on Private networks. Keep this window open while racing.');
    console.log(`  Laps are saved in ${DATA_DIR}`);
    console.log('');
  });
  listenUdp('Forza', PORTS.forza);
  if (PORTS.f1 !== PORTS.forza) listenUdp('F1 25', PORTS.f1);
  const save = () => { try { fs.writeFileSync(FILES.laps, JSON.stringify(laps)); } catch { /* ignore */ } process.exit(0); };
  process.on('SIGINT', save);
  process.on('SIGTERM', save);
}

// If something goes wrong when started by double-click, keep the window open so the message can be read.
function fatal(e) {
  console.error('');
  console.error('  The bridge stopped because of an error:');
  console.error(`  ${e && e.stack ? e.stack : e}`);
  console.error('');
  if (process.stdin.isTTY && !SUPERVISED) {
    console.error('  Press Enter to close this window.');
    process.stdin.resume();
    process.stdin.once('data', () => process.exit(1));
  } else {
    process.exit(1);
  }
}

if (require.main === module) {
  process.on('uncaughtException', fatal);
  try { start(); } catch (e) { fatal(e); }
}
module.exports = { onPacket, status, server, start };
