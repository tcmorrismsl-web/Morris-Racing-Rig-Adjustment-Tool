// Engineer voice wording: spoken numbers and the flirty mistake tab.
// Run with: node tests/voice.mjs
import assert from 'node:assert/strict';
globalThis.window = {};
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const v = await import('../js/voice.js');

// Numbers the way an engineer says them
assert.equal(v.speechify('0.75 slower than Stroll'), 'eight tenths slower than Stroll');
assert.equal(v.speechify('Norris 0.1 ahead'), 'Norris a tenth ahead');
assert.equal(v.speechify('you took 0.04 off him'), 'you took half a tenth off him');
assert.equal(v.speechify('1:17.873. P20.'), '1 17 point 8. P 20.');
assert.equal(v.speechify('1:07.5'), '1 oh 7 point 5');
assert.equal(v.speechify('Stroll 1.234 ahead'), 'Stroll 1.2 ahead');
assert.equal(v.speechify('Brake bias back 1% (to 55%).'), 'Brake bias back 1 percent, to 55 percent.');
assert.equal(v.speechify('track 32°C, DRS'), 'track 32 degrees, D R S');
assert.equal(v.speechify('1.9 to 2.1 km'), '1.9 to 2.1 kilometres');

// Fiery style keeps a flirty tab, never threats
v.settings.style = 'fiery';
const all = [];
for (let i = 0; i < 30; i++) {
  all.push(v.phrase({ kind: 'pos-lost', priority: 'normal', text: '', data: { pos: 9, name: 'GASLY' } }));
  all.push(v.phrase({ kind: 'lap-done', priority: 'normal', text: '1:17.9.', data: { invalid: true } }));
  all.push(v.phrase({ kind: 'penalty', priority: 'high', text: "You've got a 5 second penalty.", data: {} }));
}
const text = all.join(' ');
assert.ok(!/hunt|coming for you|trouble|walking home|deal with you/i.test(text), 'no threats');
assert.ok(/reward|tab|worth your while|impress me|win me back/i.test(text), 'flirty tab');
assert.ok(/Gasly/.test(text) && !/GASLY/.test(text), 'names in title case');
const fin = v.phrase({ kind: 'finish', priority: 'high', text: '', data: { pos: 4 } });
assert.ok(/mistakes on your tab|worth your while/.test(fin), fin);
const clean = v.phrase({ kind: 'finish', priority: 'high', text: '', data: { pos: 2 } });
assert.ok(/Podium/.test(clean) && /earned it/.test(clean), clean);
v.settings.style = 'straight';
assert.equal(v.phrase({ kind: 'pos-lost', priority: 'normal', text: 'Lost one to GASLY. P9.', data: { pos: 9, name: 'GASLY' } }), 'Lost one to Gasly. P9.');
console.log('OK: voice checks passed');
console.log('Sample:', all.slice(0, 3).join(' | '));
console.log('Finish:', fin);
