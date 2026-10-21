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
  all.push(v.phrase({ kind: 'pos-lost', priority: 'normal', text: 'GASLY is through. P9.', data: { pos: 9, name: 'GASLY' } }));
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

// OpenAI voice: request shape, streaming playback, caching, cost tally, fallback to the device voice
{
  const calls = [];
  let fail = false;
  const pcm = new Uint8Array(24000 * 2 * 0.6); // 0.6 s of audio
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts, body: JSON.parse(opts.body) });
    if (fail) return { ok: false, status: 401 };
    // Arrives in odd-sized pieces, as over Wi-Fi.
    const parts = [pcm.slice(0, 3001), pcm.slice(3001, 15000), pcm.slice(15000)];
    return { ok: true, body: new ReadableStream({ start(c) { parts.forEach((p) => c.enqueue(p)); c.close(); } }) };
  };
  const scheduled = [];
  class Node { connect() {} }
  globalThis.window.AudioContext = class {
    constructor() { this.state = 'running'; this.sampleRate = 48000; this.currentTime = 0; this.destination = {}; }
    resume() {}
    createGain() { return Object.assign(new Node(), { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } }); }
    createBuffer(ch, len, rate) { const d = new Float32Array(len); return { duration: len / rate, getChannelData: () => d, rate }; }
    createBufferSource() { const n = Object.assign(new Node(), { start: (at) => scheduled.push({ at, buf: n.buffer }), stop() {} }); return n; }
    createBiquadFilter() { return Object.assign(new Node(), { frequency: { value: 0 }, Q: { value: 0 } }); }
    createOscillator() { return Object.assign(new Node(), { frequency: { setValueAtTime() {} }, start() {}, stop() {} }); }
  };
  const spoken = [];
  globalThis.window.speechSynthesis = { speak: (u) => { spoken.push(u.text); setTimeout(() => u.onend?.(), 1); }, cancel() {}, getVoices: () => [] };
  globalThis.speechSynthesis = globalThis.window.speechSynthesis;
  globalThis.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  Object.assign(v.settings, { engine: 'openai', okey: 'sk-test', ovoice: 'marin', style: 'fiery', radioSound: 'f1', usage: { month: '', chars: 0 } });
  v.unlockAudio();
  let talking = null;
  v.onSpeaking((x) => { talking = x; });

  v.speak('Box box. 0.75 to Norris.', { priority: 'high' });
  await new Promise((r) => setTimeout(r, 1300));
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.url, 'https://api.openai.com/v1/audio/speech');
  assert.equal(c.opts.headers.Authorization, 'Bearer sk-test');
  assert.equal(c.body.model, 'gpt-4o-mini-tts');
  assert.equal(c.body.response_format, 'pcm', 'raw audio so it can play while downloading');
  assert.equal(c.body.input, 'Box box. eight tenths to Norris.');
  assert.ok(/flirty/.test(c.body.instructions) && /urgent/.test(c.body.instructions));
  const speech = scheduled.filter((x) => x.buf?.rate === 24000);
  assert.equal(speech.reduce((a, x) => a + x.buf.getChannelData().length, 0), 24000 * 0.6, 'every sample played, even split across pieces');
  assert.ok(speech.every((x, k) => k === 0 || x.at >= speech[k - 1].at), 'pieces played back to back');
  assert.ok(speech[0].at >= 0.28, 'speech starts after the radio chime');
  assert.equal(talking, false, 'finished');
  assert.ok(v.settings.usage.chars > 0);

  // Same line again: from memory, no second charge
  v.speak('Box box. 0.75 to Norris.', { priority: 'high' });
  await new Promise((r) => setTimeout(r, 1300));
  assert.equal(calls.length, 1, 'cached');

  // Bad key: says it on the phone's voice instead and reports why
  fail = true;
  let err = '';
  v.onEngineError((m) => { err = m || err; });
  v.speak('Weather is dry.', { priority: 'normal' });
  await new Promise((r) => setTimeout(r, 400));
  assert.deepEqual(spoken, ['Weather is dry.']);
  assert.ok(/key not accepted/.test(err), err);
  assert.ok(v.costEstimate(7000) < 0.15, 'a race costs pennies');
  // Driver's own description goes to OpenAI and changes the stored line
  fail = false;
  v.settings.sound = 'Southern accent, laid-back.';
  v.speak('Box box. 0.75 to Norris.', { priority: 'high' });
  await new Promise((r) => setTimeout(r, 1300));
  const lastI = calls.at(-1).body.instructions;
  assert.ok(/^Accent and character/.test(lastI) && /Southern accent, laid-back\./.test(lastI), lastI);
  v.settings.sound = '';
  console.log('OK: OpenAI voice checks passed (streaming); 7,000 characters ≈ $' + v.costEstimate(7000).toFixed(3));
}

// Wording doesn't repeat back to back
{
  v.settings.style = 'fiery';
  const lines = Array.from({ length: 12 }, () => v.phrase({ kind: 'losing-time', priority: 'normal', text: 'Turn 4: 0.21 to Norris. Brake later.', data: { fix: 'early-brake' } }));
  assert.ok(lines.every((x, k) => k === 0 || x !== lines[k - 1] || x === 'Turn 4: 0.21 to Norris. Brake later.'), lines.join(' | '));
  assert.ok(new Set(lines).size >= 3, 'several different intros');
}

console.log('OK: voice checks passed');
console.log('Sample:', all.slice(0, 3).join(' | '));
console.log('Finish:', fin);
