// Talking to the engineer: radio requests, conversation with OpenAI (stubbed), set replies.
// Run with: node tests/chat.mjs
import assert from 'node:assert/strict';
globalThis.window = {};
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.Audio = class { play() { setTimeout(() => this.onended?.(), 1); return Promise.resolve(); } pause() {} };
globalThis.URL.createObjectURL = () => 'blob:x';
import { readFileSync } from 'node:fs';
const chat = await import('../js/chat.js');
// Same module instance chat.js uses (its import carries a version stamp).
const stamp = readFileSync(new URL('../js/chat.js', import.meta.url), 'utf8').match(/voice\.js(\?v=\w+)?'/)[1] || '';
const voice = await import(`../js/voice.js${stamp}`);

// Radio requests
const m = (t, p) => chat.matchCommand(t, p);
assert.equal(m("I'll wait"), 'wait');
assert.equal(m('not yet', { ask: 'leave' }), 'wait');
assert.equal(m('nah', { ask: 'leave' }), 'wait');
assert.equal(m('yeah going', { ask: 'leave' }), 'yes');
assert.equal(m('box box', { ask: 'box-window' }), 'yes');
assert.equal(m('no', { ask: 'box-sc' }), 'no');
assert.equal(m('Where am I losing time?'), 'time');
assert.equal(m("what's the gap to Norris"), 'gaps');
assert.equal(m("what's the plan"), 'plan');
assert.equal(m('is it going to rain'), 'weather');
assert.equal(m('how are the tyres'), 'tyres');
assert.equal(m('when should I leave'), 'pit');
assert.equal(m('say that again'), 'repeat');
assert.equal(m('yes'), null, 'yes with nothing asked is conversation');
assert.equal(m('you sound gorgeous today'), null);
assert.equal(m('honestly I love the way you talk to me when the race gets tense and the tyres are gone'), null, 'long chat mentioning tyres is conversation');

// Conversation with OpenAI
const d = { game: 'f1', sessionId: 'f1-1', session: { type: 'Race', race: true, lap: 5, totalLaps: 15, position: 4, weather: 'Clear', trackTemp: 32 }, tower: [{ me: true, pos: 4, name: 'MORRIS', lastMs: 78123, bestMs: 77900, tyre: 'M', tyreAge: 5, gapAheadMs: 1200 }, { pos: 3, name: 'NORRIS' }], engineer: { phase: 'race', pending: null } };
const asked = [];
const ask = async (t) => { asked.push(t); };
const sent = [];
let reply = { say: 'Eyes on the road, handsome. Sweet-talk me after the flag.', ask: null, flirt: true };
globalThis.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  sent.push({ url, body });
  if (url.includes('/chat/completions')) {
    if (body.model === 'gpt-4.1-mini' && sent.filter((x) => x.url.includes('chat')).length === 1) return { ok: false, status: 404 }; // first model unavailable
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(reply) } }] }) };
  }
  return { ok: true, blob: async () => new Blob(['mp3']) };
};
Object.assign(voice.settings, { on: true, engine: 'openai', okey: 'sk-test', style: 'fiery', radio: false });

let r = await chat.talk('you sound gorgeous today', d, ask);
assert.equal(r.reply, reply.say);
const chats = sent.filter((x) => x.url.includes('/chat/completions'));
assert.equal(chats.length, 2, 'falls back to the next model when one is unavailable');
assert.equal(chats[1].body.model, 'gpt-4o-mini');
const sys = chats[1].body.messages[0].content;
assert.ok(/never explicit/.test(sys) && /brush-off/.test(sys) && /heat is \d out of 5/.test(sys), 'persona rules');
assert.ok(/"position":4/.test(sys) && /NORRIS, 1\.2 s/.test(sys), 'race data in the prompt');
assert.equal(voice.transcript[0].text, reply.say, 'reply on the radio');
assert.equal(voice.transcript[1].text, 'You: you sound gorgeous today', 'your line shown');

// The AI can hand a request to the bridge
reply = { say: 'Let me look.', ask: 'gaps', flirt: false };
r = await chat.talk('how is Norris doing up there', d, ask);
assert.deepEqual(asked, ['gaps'], 'AI-recognised request goes to the bridge');
const sameModel = sent.filter((x) => x.url.includes('/chat/completions')).at(-1).body.model;
assert.equal(sameModel, 'gpt-4o-mini', 'remembers the model that works');
assert.ok(sent.filter((x) => x.url.includes('/chat/completions')).at(-1).body.messages.length >= 4, 'keeps the conversation');

// Clear requests skip OpenAI entirely
const before = sent.length;
await chat.talk("I'll wait", { ...d, engineer: { phase: 'garage', pending: { ask: 'leave' } } }, ask);
assert.equal(asked.at(-1), 'wait');
assert.equal(sent.length, before, 'no OpenAI call for a radio request');

// Without a key: set replies that warm up with heat
voice.settings.okey = '';
const cold = chat.offlineReply('you look gorgeous', { phase: 'garage' });
assert.ok(cold.length > 5);
assert.ok(chat.heat() >= 0 && chat.heat() <= 5);
const answered = await chat.talk('love you babe', { ...d, engineer: { phase: 'grid' } }, ask);
assert.ok(answered.reply && !/undefined/.test(answered.reply), answered.reply);
console.log('OK: talk-back checks passed');
console.log('Sample set reply:', answered.reply);
