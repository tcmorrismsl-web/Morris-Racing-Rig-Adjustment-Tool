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

// OpenAI voice: request shape, caching, cost tally, and fallback to the device voice
{
  const calls = [];
  let fail = false;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts, body: JSON.parse(opts.body) });
    if (fail) return { ok: false, status: 401 };
    return { ok: true, blob: async () => new Blob(['mp3']) };
  };
  globalThis.URL.createObjectURL = () => 'blob:audio';
  const played = [];
  globalThis.Audio = class { play() { played.push(this.src); setTimeout(() => this.onended?.(), 1); return Promise.resolve(); } pause() {} };
  const spoken = [];
  globalThis.window.speechSynthesis = { speak: (u) => { spoken.push(u.text); setTimeout(() => u.onend?.(), 1); }, cancel() {}, getVoices: () => [] };
  globalThis.speechSynthesis = globalThis.window.speechSynthesis;
  globalThis.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  Object.assign(v.settings, { engine: 'openai', okey: 'sk-test', ovoice: 'marin', style: 'fiery', radio: false, usage: { month: '', chars: 0 } });

  v.speak('Box box. 0.75 to Norris.', { priority: 'high' });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.url, 'https://api.openai.com/v1/audio/speech');
  assert.equal(c.opts.headers.Authorization, 'Bearer sk-test');
  assert.equal(c.body.model, 'gpt-4o-mini-tts');
  assert.equal(c.body.voice, 'marin');
  assert.equal(c.body.input, 'Box box. eight tenths to Norris.');
  assert.ok(/flirty/.test(c.body.instructions) && /urgent/.test(c.body.instructions));
  assert.deepEqual(played, ['blob:audio']);
  assert.ok(v.settings.usage.chars > 0);

  // Same line again: from the cache, no second charge
  v.speak('Box box. 0.75 to Norris.', { priority: 'high' });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls.length, 1, 'cached');
  assert.equal(played.length, 2);

  // Bad key: says it on the phone's voice instead and reports why
  fail = true;
  let err = '';
  v.onEngineError((m) => { err = m; });
  v.speak('Weather is dry.', { priority: 'normal' });
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(spoken, ['Weather is dry.']);
  assert.ok(/key not accepted/.test(err), err);
  assert.ok(v.costEstimate(7000) < 0.15, 'a race costs pennies');
  // Driver's own description goes to OpenAI and changes the cached line
  fail = false;
  v.settings.sound = 'Southern accent, laid-back.';
  v.speak('Box box. 0.75 to Norris.', { priority: 'high' });
  await new Promise((r) => setTimeout(r, 30));
  const last = calls.at(-1).body.instructions;
  assert.ok(/Southern accent, laid-back\./.test(last) && /urgent/.test(last), last);
  assert.equal(calls.filter((x) => x.body.input.startsWith('Box box')).length, 2, 'new description, new audio');
  v.settings.sound = '';
  console.log('OK: OpenAI voice checks passed; 7,000 characters ≈ $' + v.costEstimate(7000).toFixed(3));
}
console.log('OK: voice checks passed');
console.log('Sample:', all.slice(0, 3).join(' | '));
console.log('Finish:', fin);
