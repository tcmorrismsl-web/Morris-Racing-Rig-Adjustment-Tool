'use strict';
// Starts the Morris Racing bridge and keeps it up to date.
//
// Runs the newest bridge code available: the copy in this folder, or a newer copy the bridge
// downloaded from the app's website (saved in MorrisRacing/bridge-update). When the bridge has
// downloaded an update it asks to be restarted while you're not driving, and this starts the new
// code. If downloaded code fails to start, it goes back to this folder's copy and remembers not
// to use that version again.

const { fork } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = process.env.MR_DATA || path.join(os.homedir(), 'MorrisRacing');
const UPDATE_DIR = path.join(DATA_DIR, 'bridge-update');
const BUNDLED = __dirname;
const RESTART = 75; // exit code the bridge uses to ask for a restart with new code

const versionOf = (dir) => {
  try { return (fs.readFileSync(path.join(dir, 'bridge.js'), 'utf8').match(/const VERSION = '([\d.]+)'/) || [])[1] || null; } catch { return null; }
};
const parts = (v) => String(v || '0').split('.').map((n) => Number(n) || 0);
const newer = (a, b) => { const x = parts(a), y = parts(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
const badList = () => { try { return JSON.parse(fs.readFileSync(path.join(UPDATE_DIR, 'bad.json'), 'utf8')); } catch { return []; } };
const markBad = (v) => { try { fs.mkdirSync(UPDATE_DIR, { recursive: true }); fs.writeFileSync(path.join(UPDATE_DIR, 'bad.json'), JSON.stringify([...new Set([...badList(), v])])); } catch { /* ignore */ } };

function choose() {
  const cur = path.join(UPDATE_DIR, 'current');
  const mine = versionOf(BUNDLED), got = versionOf(cur);
  if (got && newer(got, mine) && !badList().includes(got)) return { dir: cur, version: got, downloaded: true };
  return { dir: BUNDLED, version: mine, downloaded: false };
}

let stopping = false;
let crashes = [];
let child = null;

function run() {
  const pick = choose();
  const started = Date.now();
  if (pick.downloaded) console.log(`  Using the updated bridge (${pick.version}).`);
  child = fork(path.join(pick.dir, 'bridge.js'), process.argv.slice(2), {
    env: { ...process.env, MR_APP_ROOT: path.join(BUNDLED, '..'), MR_SUPERVISED: '1', MR_BRIDGE_DIR: pick.dir },
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  });
  child.on('exit', (code) => {
    child = null;
    if (stopping) return process.exit(0);
    if (code === RESTART) { console.log('\n  Restarting the bridge to finish updating...\n'); return run(); }
    if (code === 0) return process.exit(0);
    if (pick.downloaded && Date.now() - started < 120000) {
      markBad(pick.version);
      console.log(`\n  The updated bridge (${pick.version}) had a problem starting, so I'm going back to the version you downloaded.\n`);
      return run();
    }
    // Keep going after a one-off crash, but don't loop forever.
    crashes = crashes.filter((t) => Date.now() - t < 10 * 60 * 1000).concat(Date.now());
    if (crashes.length <= 3) { console.log('\n  The bridge stopped unexpectedly. Starting it again in 3 seconds...\n'); return setTimeout(run, 3000); }
    console.error('\n  The bridge keeps stopping. Take a photo of the message above and share it.');
    if (process.stdin.isTTY) { console.error('  Press Enter to close this window.'); process.stdin.resume(); process.stdin.once('data', () => process.exit(1)); } else process.exit(1);
  });
}

// Ctrl+C reaches the bridge too; it saves your laps and exits, then this window closes.
const stop = () => { stopping = true; if (!child) process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', () => { stopping = true; if (child) child.kill('SIGTERM'); else process.exit(0); });

if (require.main === module) run();
module.exports = { choose, versionOf, newer };
