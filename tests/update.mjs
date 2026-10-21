// Bridge self-update: newer app files are fetched from the website; files that need a newer
// bridge are left alone. Run with: node tests/update.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
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

server.close();
console.log('OK: self-update checks passed');
