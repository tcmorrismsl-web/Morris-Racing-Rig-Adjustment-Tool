'use strict';
// Morris Racing bridge.
// Receives Forza Motorsport and F1 25 telemetry from the Xbox over UDP, turns it into
// lap summaries, and serves the Morris Racing app to your phone over your Wi-Fi.
// No dependencies: run with `node bridge/bridge.js`, or the packaged Windows .exe.

const http = require('http');
const dgram = require('dgram');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseForza, parseF1, parseF1Header } = require('./parsers');
const { ForzaLaps, F1Laps } = require('./laps');
const { F1Race, ForzaRace } = require('./race');

const VERSION = '1.0.0';
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : Number(process.env[`MR_${name.toUpperCase()}`]) || def;
};
const PORTS = { http: arg('http', 8080), forza: arg('forza', 5300), f1: arg('f1', 20777) };
const APP_ROOT = path.join(__dirname, '..');
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
      const topics = ['yes', 'no', 'gaps', 'pit', 'time', 'weather', 'tyres', 'repeat'];
      if (!q || !topics.includes(q.ask)) return json(res, 400, { error: 'unknown question' });
      const call = dashFor(q.game).eng.ask(q.ask);
      return json(res, 200, { ok: true, call });
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
    const file = path.join(APP_ROOT, rel);
    if (!file.startsWith(APP_ROOT) || rel.startsWith('bridge') || rel.startsWith('.')) { res.writeHead(404); return res.end('Not found'); }
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
function start() {
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
  if (process.stdin.isTTY) {
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
