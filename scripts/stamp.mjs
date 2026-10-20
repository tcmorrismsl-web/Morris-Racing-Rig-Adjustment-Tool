// Adds a version to every app file reference (?v=...) so phones load fresh files
// after each update instead of a cached copy. Run before committing: npm run stamp
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const v = Date.now().toString(36);
const label = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const files = ['index.html', 'dash.html', ...readdirSync('js').filter((f) => f.endsWith('.js')).map((f) => `js/${f}`)];
for (const f of files) {
  const before = readFileSync(f, 'utf8');
  const after = before
    // ES module imports: from './x.js' or './x.js?v=old'
    .replace(/(from\s+'\.\/[\w-]+\.js)(\?v=[\w]+)?'/g, `$1?v=${v}'`)
    // index.html: app script and stylesheet
    .replace(/((?:src|href)="(?:js\/app\.js|js\/dash\.js|styles\.css|dash\.css))(\?v=[\w]+)?"/g, `$1?v=${v}"`)
    // Visible version on the Wheel tab
    .replace(/const APP_VERSION = '[^']*';/, `const APP_VERSION = '${label}';`);
  if (after !== before) writeFileSync(f, after);
}
console.log(`Stamped version ${v}`);
