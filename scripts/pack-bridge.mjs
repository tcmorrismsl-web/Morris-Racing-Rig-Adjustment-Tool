// Builds dist/MorrisRacingBridge.zip: the bridge as plain code plus a start file.
// No bundled .exe, so there is nothing for antivirus to guess about. Runs on Node.js from nodejs.org.
import { cpSync, mkdirSync, rmSync, mkdtempSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve('.');
const stage = mkdtempSync(join(tmpdir(), 'mr-bridge-'));
const dir = join(stage, 'MorrisRacingBridge');
mkdirSync(join(dir, 'bridge'), { recursive: true });
mkdirSync(join(dir, 'js'), { recursive: true });

for (const f of ['index.html', 'styles.css', 'dash.html', 'dash.css', 'icon.svg', 'manifest.webmanifest', 'app-files.json']) cpSync(join(root, f), join(dir, f));
for (const f of readdirSync('js').filter((n) => n.endsWith('.js'))) cpSync(join(root, 'js', f), join(dir, 'js', f));
for (const f of ['bridge.js', 'parsers.js', 'laps.js', 'race.js', 'engineer.js', 'package.json']) cpSync(join(root, 'bridge', f), join(dir, 'bridge', f));
cpSync(join(root, 'bridge/windows/Start Morris Racing Bridge.cmd'), join(dir, 'Start Morris Racing Bridge.cmd'));
cpSync(join(root, 'bridge/windows/READ ME.txt'), join(dir, 'READ ME.txt'));

mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist', 'MorrisRacingBridge.zip');
rmSync(out, { force: true });
execFileSync('zip', ['-qr', out, 'MorrisRacingBridge'], { cwd: stage });
rmSync(stage, { recursive: true, force: true });
console.log(`Built ${out}`);
