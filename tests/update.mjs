// Bridge self-update: newer app files are fetched from the website; files that need a newer
// bridge are left alone. Run with: node tests/update.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const local = JSON.parse(readFileSync('app-files.json', 'utf8'));
const newer = (parseInt(local.version, 36) + 1000).toString(36);
const site = mkdtempSync(join(tmpdir(), 'mr-site-'));
const build = (bridgeMin, marker) => {
  mkdirSync(join(site, 'js'), { recursive: true });
  for (const f of local.files) {
    let body = readFileSync(f);
    if (f === 'index.html') body = Buffer.from(body.toString().replace('<title>Morris Racing</title>', `<title>Morris Racing ${marker}</title>`));
    writeFileSync(join(site, f), body);
  }
  writeFileSync(join(site, 'app-files.json'), JSON.stringify({ ...local, version: newer, label: marker, bridgeMin }));
};
const server = http.createServer((req, res) => {
  const f = join(site, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  try { res.end(readFileSync(f)); } catch { res.writeHead(404); res.end(); }
}).listen(0);
const sitePort = server.address().port;

async function run(bridgeMin, marker, port) {
  build(bridgeMin, marker);
  const data = mkdtempSync(join(tmpdir(), 'mr-data-'));
  const p = spawn(process.execPath, ['bridge/bridge.js', '--http', String(port), '--forza', String(port + 1), '--f1', String(port + 2)], { env: { ...process.env, MR_DATA: data, MR_UPDATE_URL: `http://127.0.0.1:${sitePort}/` } });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  await new Promise((r) => setTimeout(r, 4500));
  const page = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  const status = await (await fetch(`http://127.0.0.1:${port}/api/status`)).json();
  p.kill();
  return { page, status, out };
}

const ok = await run(local.bridgeMin, 'UPDATED-OK', 18301);
assert.ok(ok.page.includes('Morris Racing UPDATED-OK'), 'bridge serves the newer app files');
assert.equal(ok.status.app.version, 'UPDATED-OK');
assert.ok(/Updated the app/.test(ok.out), ok.out);

const tooNew = await run('99.0.0', 'NEEDS-NEW-BRIDGE', 18311);
assert.ok(!tooNew.page.includes('NEEDS-NEW-BRIDGE'), 'files for a newer bridge are not used');
assert.equal(tooNew.status.app.bridgeUpdate, true, 'tells you a new bridge is available');

// Bridge code self-update through the launcher: download, verify, switch over when idle.
async function runLauncher(bridgeJs, port, marker) {
  const ver = '9.9.9';
  rmSync(join(site, 'bridge'), { recursive: true, force: true });
  mkdirSync(join(site, 'bridge'), { recursive: true });
  for (const f of ['bridge.js', 'parsers.js', 'laps.js', 'race.js', 'engineer.js', 'coach.js', 'corners.js']) writeFileSync(join(site, 'bridge', f), readFileSync(join('bridge', f)));
  writeFileSync(join(site, 'bridge', 'bridge.js'), bridgeJs(readFileSync('bridge/bridge.js', 'utf8').replace(/const VERSION = '[\d.]+'/, `const VERSION = '${ver}'`)));
  writeFileSync(join(site, 'app-files.json'), JSON.stringify({ ...local, version: (parseInt(local.version, 36) + 2000).toString(36), label: marker, bridgeMin: local.bridgeMin, bridge: { version: ver, files: local.bridge.files } }));
  const data = mkdtempSync(join(tmpdir(), 'mr-data-'));
  const p = spawn(process.execPath, ['bridge/launch.js', '--http', String(port), '--forza', String(port + 1), '--f1', String(port + 2)], { env: { ...process.env, MR_DATA: data, MR_UPDATE_URL: `http://127.0.0.1:${sitePort}/`, MR_IDLE_S: '1' } });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  let status = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { status = await (await fetch(`http://127.0.0.1:${port}/api/status`)).json(); } catch { status = null; }
    if (status && status.version === ver) break;
  }
  await new Promise((r) => setTimeout(r, 1500));
  try { status = await (await fetch(`http://127.0.0.1:${port}/api/status`)).json(); } catch { /* keep last */ }
  const page = await (await fetch(`http://127.0.0.1:${port}/`)).text().catch(() => '');
  p.kill('SIGTERM');
  return { status, out, page, data };
}

const good = await runLauncher((code) => code, 18321, 'BRIDGE-OK');
assert.equal(good.status?.version, '9.9.9', `switched to the new bridge code: ${good.out}`);
assert.ok(/Downloaded bridge update 9\.9\.9/.test(good.out) && /Switching to the updated bridge/.test(good.out), good.out);
assert.ok(good.page.includes('<title>Morris Racing'), 'updated bridge still serves the app from the download folder');

const broken = await runLauncher((code) => code.replace("'use strict';", "'use strict';\nthrow new Error('boom');"), 18331, 'BRIDGE-BROKEN');
assert.equal(broken.status?.version, local.bridgeMin, `went back to the downloaded version: ${broken.out}`);
assert.ok(/had a problem starting/.test(broken.out), broken.out);
assert.ok(JSON.parse(readFileSync(join(broken.data, 'bridge-update', 'bad.json'), 'utf8')).includes('9.9.9'), 'bad version remembered');
assert.ok(!/Downloaded bridge update 9\.9\.9[\s\S]*Downloaded bridge update 9\.9\.9/.test(broken.out), 'no download loop');

const syntax = await runLauncher((code) => `${code}\n}}}`, 18341, 'BRIDGE-SYNTAX');
assert.equal(syntax.status?.version, local.bridgeMin, 'invalid code is never used');
assert.ok(/Couldn't update the bridge/.test(syntax.out), syntax.out);

server.close();
console.log('OK: self-update checks passed (app files and bridge code)');
