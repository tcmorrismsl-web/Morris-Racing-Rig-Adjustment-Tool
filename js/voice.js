// Race engineer voice: turns the bridge's radio calls into speech.
// Two styles: "flirty" (smooth, playful) and "straight" (just the facts).
// Uses the browser's built-in speech, so the voice depends on the device.

const STORE = 'mr-engineer';
const defaults = { on: false, style: 'flirty', chat: 'normal', voice: '', name: '', rate: 0.95, pitch: 1.0, volume: 1 };
export const settings = (() => {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(STORE) || '{}') }; } catch { return { ...defaults }; }
})();
export function saveSettings() { try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch { /* storage unavailable */ } }

// ---------------------------------------------------------------------------
// Voices: prefer natural-sounding female voices the device already has.
// ---------------------------------------------------------------------------
const PREFERRED = [
  /Ava.*(Premium|Enhanced)/i, /Zoe.*(Premium|Enhanced)/i, /Samantha.*(Premium|Enhanced)/i, /Allison.*(Premium|Enhanced)/i, /Serena.*(Premium|Enhanced)/i,
  /Microsoft (Aria|Jenny|Ava|Emma|Michelle|Sonia|Libby).*Natural/i,
  /Google UK English Female/i, /Google US English/i,
  /\bAva\b/i, /\bSamantha\b/i, /\bAllison\b/i, /\bSerena\b/i, /\bKaren\b/i, /\bMoira\b/i, /\bTessa\b/i, /\bVictoria\b/i, /\bSusan\b/i, /\bZira\b/i, /female/i,
];
export function voices() {
  if (!('speechSynthesis' in window)) return [];
  return speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
}
export function pickVoice() {
  const list = voices();
  if (settings.voice) { const v = list.find((x) => x.name === settings.voice); if (v) return v; }
  for (const re of PREFERRED) { const v = list.find((x) => re.test(x.name)); if (v) return v; }
  return list[0] || null;
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const title = (s) => (s && s === s.toUpperCase() && /[A-Z]/.test(s) ? s.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase()) : s);
// Uppercase game names read better as "Gasly" than "G-A-S-L-Y".
const tidy = (text) => text.replace(/\b[A-Z][A-Z'-]{2,}\b/g, (w) => (['DRS', 'MFD', 'ERS', 'VSC'].includes(w) ? w : title(w)));
const pet = () => (settings.name ? settings.name : pick(['handsome', 'love', 'darling', 'gorgeous']));

const FLIRTY = {
  session: (c) => `Hey ${pet()}, it's me on the radio. ${c.text.replace(/^Radio check\.\s*/, '')} Let's have some fun.`,
  splits: (c) => `${pick(['', 'Mm, ', `Okay ${pet()}, `])}${c.text} ${pick(['Keep it smooth for me.', 'Looking good out there.', '', "I'm watching you."])}`,
  'losing-time': (c) => `${pick([`Little secret, ${pet()}. `, 'Just between us. ', ''])}${c.text}`,
  'lap-done': (c) => (c.data?.delta < 0 ? `Ooh, personal best. ${c.text} I felt that one.` : `${c.text}${c.data?.invalid ? '' : pick([' Nice.', ' Smooth.', ''])}`),
  'pos-gain': (c) => `P${c.data.pos}. ${pick(['Oh, that was lovely', 'Mm, I liked that move', 'Beautiful'])}${c.data.name ? ` on ${title(c.data.name)}` : ''}.`,
  'pos-lost': (c) => `${c.data.name ? `${title(c.data.name)} got by` : 'We lost one'}. P${c.data.pos}. Go get it back for me, ${pet()}.`,
  'leave-go': () => `Now, ${pet()}. Gap at pit exit. Go, go, go.`,
  'leave-wait': (c) => `${c.text} Patience, ${pet()}.`,
  'leave-by': (c) => `${c.text} Don't keep me waiting.`,
  'box-now': (c) => `Box, box, ${pet()}. ${c.text.replace(/^Box this lap, box this lap\.\s*/, '')}`,
  'box-ask': (c) => `${c.text} Your call, ${pet()}.`,
  sc: (c) => c.text,
  'rain-coming': (c) => `${c.text}${c.ask ? '' : ' Stay sharp for me.'}`,
  'weather-now': (c) => c.text,
  attack: (c) => `Within a second of ${title(c.data.name)}. ${c.data.era >= 2026 ? 'Overtake is yours.' : 'DRS.'} Go get him, ${pet()}.`,
  defend: (c) => `${title(c.data.name)} is right behind you. Hold your line for me.`,
  adjust: (c) => `${c.text} ${pick(['Trust me.', "You'll feel it.", ''])}`,
  'final-lap': (c) => `Last lap, ${pet()}. P${c.data?.pos ?? ''}. Bring it home to me.`,
  finish: (c) => `Chequered flag. P${c.data.pos}. ${c.data.pos <= 3 ? 'You were incredible out there.' : 'Come back to me in one piece.'}`,
  'fastest-lap': (c) => (c.data?.me ? `Fastest lap. ${c.text.replace(/^Fastest lap of the race,\s*/, '')}. Show-off. I love it.` : c.text),
  'blue-flag': () => 'Blue flag, let the leader through, nice and easy.',
  'yellow-flag': () => 'Yellow flag ahead. Careful for me.',
  penalty: (c) => `${c.text} Let's keep it clean.`,
  'tyre-wear': (c) => c.text,
  'fuel-short': (c) => c.text,
  'pit-soon': (c) => c.text,
  'pit-estimate': (c) => c.text,
  answer: (c) => (/^Copy/.test(c.text) ? c.text.replace(/^Copy[,.]?\s*/, `Copy, ${pet()}. `) : c.text),
};

export function phrase(call) {
  if (settings.style === 'straight') return tidy(call.text);
  const f = FLIRTY[call.kind];
  try { return tidy(f ? f(call) : call.text).replace(/\s+/g, ' ').trim(); } catch { return tidy(call.text); }
}

// ---------------------------------------------------------------------------
// Speech queue: urgent calls cut in; stale chatter is dropped.
// ---------------------------------------------------------------------------
const RANK = { high: 0, normal: 1, low: 2 };
const queue = [];
let speaking = null;
const heard = new Set();
export const transcript = [];
let onChange = () => {};
export function onTranscript(fn) { onChange = fn; }

function allowed(call) {
  if (settings.chat === 'key') return call.priority === 'high';
  if (settings.chat === 'normal') return call.priority !== 'low';
  return true;
}

export function receive(calls) {
  for (const c of calls || []) {
    if (heard.has(c.id)) continue;
    heard.add(c.id);
    const text = phrase(c);
    transcript.unshift({ id: c.id, text, kind: c.kind, priority: c.priority, ask: c.ask });
    transcript.length = Math.min(transcript.length, 12);
    if (!settings.on || !allowed(c)) continue;
    queue.push({ ...c, text, queued: Date.now() });
  }
  onChange();
  pump();
}

// Mark everything already on the radio as heard, so opening the dashboard mid-race doesn't replay it.
export function catchUp(calls) { for (const c of calls || []) heard.add(c.id); }

function pump() {
  if (!('speechSynthesis' in window)) return;
  // Drop chatter that has gone stale (over 20 s), keep urgent calls.
  for (let i = queue.length - 1; i >= 0; i--) if (queue[i].priority !== 'high' && Date.now() - queue[i].queued > 20000) queue.splice(i, 1);
  queue.sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.id - b.id);
  const next = queue[0];
  if (!next) return;
  if (speaking) {
    if (RANK[next.priority] < RANK[speaking.priority]) { speechSynthesis.cancel(); speaking = null; } else return;
  }
  queue.shift();
  speak(next.text, next);
}

export function speak(text, call = { priority: 'high' }) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) { u.voice = v; u.lang = v.lang; }
  u.rate = settings.style === 'flirty' ? Math.min(settings.rate, 0.95) : settings.rate;
  u.pitch = settings.pitch;
  u.volume = settings.volume;
  speaking = call;
  u.onend = u.onerror = () => { speaking = null; setTimeout(pump, 250); };
  speechSynthesis.speak(u);
}

export function stop() { queue.length = 0; if ('speechSynthesis' in window) speechSynthesis.cancel(); speaking = null; }

// ---------------------------------------------------------------------------
// Voice replies. Browsers only allow the microphone on a secure page, which the
// bridge's Wi-Fi address isn't, so this works on the laptop itself (localhost)
// and wherever the browser allows it. Wheel buttons and taps work everywhere.
// ---------------------------------------------------------------------------
const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = !!Rec && window.isSecureContext;
const COMMANDS = [
  ['yes', /\b(yes|yeah|yep|affirm|copy|do it|box box|okay box)\b/i],
  ['no', /\b(no|nope|negative|stay out)\b/i],
  ['gaps', /\b(gap|gaps|ahead|behind|position|split)/i],
  ['pit', /\b(pit|box|strategy|window|leave|go now|traffic)\b/i],
  ['time', /\b(losing|lose|lost|time|where|slow|sector)\b/i],
  ['weather', /\b(weather|rain|wet|forecast|track temp)/i],
  ['tyres', /\b(tyre|tire|tyres|tires|fuel|battery|ers|wear)\b/i],
  ['repeat', /\b(repeat|say again|again|what)\b/i],
];
export function listen(onCommand, onState) {
  if (!canListen) return null;
  const r = new Rec();
  r.lang = 'en-US'; r.interimResults = false; r.maxAlternatives = 3;
  r.onstart = () => onState('listening');
  r.onend = () => onState('idle');
  r.onerror = () => onState('idle');
  r.onresult = (e) => {
    const said = [...e.results[0]].map((a) => a.transcript).join(' ');
    const hit = COMMANDS.find(([, re]) => re.test(said));
    onCommand(hit ? hit[0] : null, said);
  };
  r.start();
  return r;
}
