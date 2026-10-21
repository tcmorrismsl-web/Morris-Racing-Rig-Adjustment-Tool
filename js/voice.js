// Race engineer voice: turns the bridge's radio calls into speech.
// Styles: "fiery" (upbeat, flirty, keeps a playful tab of your mistakes), "sultry" (slow and smooth)
// and "straight" (just the facts). Speaks with the device's voices, or OpenAI's realistic voices
// when a key is set (falls back to the device voice if OpenAI can't be reached).

const STORE = 'mr-engineer';
const defaults = { v: 2, on: false, style: 'fiery', chat: 'normal', voice: '', name: '', rate: 1, volume: 1, radio: true,
  engine: 'device', okey: '', ovoice: 'marin', sound: '', usage: { month: '', chars: 0 } };
export const settings = (() => {
  let s;
  try { s = { ...defaults, ...JSON.parse(localStorage.getItem(STORE) || '{}') }; } catch { s = { ...defaults }; }
  // Older settings: move to the new default style and speed, keep everything else.
  if (s.v !== 2) Object.assign(s, { v: 2, style: s.style === 'straight' ? 'straight' : 'fiery', rate: 1 });
  return s;
})();
export function saveSettings() { try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch { /* storage unavailable */ } }

export const STYLES = [
  { id: 'fiery', label: 'Fiery and flirty (upbeat, keeps a playful tab of your mistakes)' },
  { id: 'sultry', label: 'Smooth and sultry (slow, low, playful)' },
  { id: 'straight', label: 'Straight to the point' },
];
// Delivery per style. The speed slider scales the rate.
const PROSODY = { fiery: { rate: 1.06, pitch: 1.15 }, sultry: { rate: 0.9, pitch: 0.95 }, straight: { rate: 1.02, pitch: 1.0 } };

// ---------------------------------------------------------------------------
// Voices: prefer natural-sounding female voices the device already has.
// ---------------------------------------------------------------------------
const PREFERRED = [
  /Microsoft (Ava|Emma|Jenny|Aria|Michelle|Sonia|Libby).*(Natural|Online)/i,
  /Google UK English Female/i,
  /Ava.*(Premium|Enhanced)/i, /Zoe.*(Premium|Enhanced)/i, /Samantha.*(Premium|Enhanced)/i, /Allison.*(Premium|Enhanced)/i, /Serena.*(Premium|Enhanced)/i, /Evan.*Enhanced/i,
  /Google US English/i,
  /\bAva\b/i, /\bZoe\b/i, /\bSamantha\b/i, /\bAllison\b/i, /\bSerena\b/i, /\bKaren\b/i, /\bMoira\b/i, /\bTessa\b/i, /\bVictoria\b/i, /\bSusan\b/i, /\bZira\b/i, /female/i,
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
const titleCase = (s) => (s && s === s.toUpperCase() && /[A-Z]/.test(s) ? s.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase()) : s);
const name = (n) => titleCase(n || '');
// Uppercase game names read better as "Gasly" than "G-A-S-L-Y".
const tidy = (text) => text.replace(/\b[A-Z][A-Z'-]{2,}\b/g, (w) => (['DRS', 'MFD', 'ERS', 'VSC'].includes(w) ? w : titleCase(w)));
const pet = () => (settings.name ? settings.name : pick(['handsome', 'babe', 'gorgeous', 'superstar', 'trouble']));

// Mistakes this session. She keeps count, but as flirting: a reminder of what a clean
// drive earns after the race, never a telling-off.
let mistakes = 0;
const strike = () => { mistakes += 1; return mistakes; };
const tally = () => (mistakes === 0 ? ''
  : mistakes === 1 ? pick([" That's one on your tab. Keep it clean and there's something nice waiting for you after the race.", ' One little slip. Stay tidy and you still get your reward.'])
    : mistakes === 2 ? pick([" That's two. You're making me wait for that reward, babe.", ' Two now. Win me back with a clean lap.'])
      : pick([` That's ${mistakes}. You're going to have to work a lot harder to impress me tonight.`, ` ${mistakes} on your tab. Clean laps from here and I'll forget all about it.`]));
const reward = () => pick([' Keep driving like that and you know what you get.', " That's how you earn it.", ' Mm, keep that up for me.']);

const FIERY = {
  session: () => pick([`Hey ${pet()}! Radio check, I've got you loud and clear. Let's go have some fun.`, `There you are, ${pet()}. I'm on the radio all session. Make me proud.`]),
  splits: (c) => `${pick(['Okay! ', 'Right, ', `Listen up, ${pet()}. `, ''])}${c.text} ${c.data?.ahead?.changeMs < -50 ? pick(['Reel him in!', 'Hunt him down!', "He's yours."]) : c.data?.behind?.changeMs < -50 ? pick(["Don't you dare let him by.", 'He is coming. Push!']) : pick(['Keep it smooth.', 'Love the pace.', ''])}`,
  'losing-time': (c) => { const n = c.data?.fix === 'lockup' ? strike() : mistakes; return `${pick(['I saw that. ', 'Hey. Focus. ', `Oh ${pet()}. `])}${c.text}${c.data?.fix === 'lockup' && n >= 2 ? tally() : ''}`; },
  'lap-done': (c) => {
    if (c.data?.invalid) { strike(); return `${pick(['Lap deleted, track limits!', 'Track limits. Deleted.'])}${tally()}`; }
    if (c.data?.delta < 0) return `${pick(['Yes! Personal best!', 'Oh, purple! Personal best!', 'That is a personal best!'])} ${c.text.replace(/, personal best by.*?\./, '.')} ${pick(['More of that, please.', 'I could kiss you.', "That's my driver."])}${reward()}`;
    return `${c.text} ${pick(['Good lap.', 'Keep stacking them.', ''])}`;
  },
  'pos-gain': (c) => `${pick(['Yes!', 'Oh yes!', 'Beautiful!'])} P${c.data.pos}${c.data.name ? `, goodbye ${name(c.data.name)}` : ''}! ${pick(["That's my driver.", 'I love it.', 'Do it again.'])}${reward()}`,
  'pos-lost': (c) => { strike(); return `${c.data.name ? `Did you just let ${name(c.data.name)} through?` : 'We just lost a place.'} P${c.data.pos}. ${pick(['Go get it back if you want my attention.', 'Get it back for me. Now.'])}${tally()}`; },
  'leave-go': () => pick([`Go, go, go! Gap's yours, ${pet()}!`, 'Now! Out you go, clean air, go!']),
  'leave-wait': (c) => `${c.text} ${pick(['Patience, babe.', "Sit tight, I've got you."])}`,
  'leave-by': (c) => `${c.text} Do not keep me waiting.`,
  'box-now': (c) => `Box, box! ${pick(['Come to me.', 'Bring it in.'])} ${c.text.replace(/^Box this lap, box this lap\.\s*/, '')}`,
  'box-ask': (c) => `${c.text} Your call, ${pet()}.`,
  sc: (c) => (c.data?.deployed ? `${c.data.type} out! ${c.ask ? "Free pit stop, babe. Want it? Yes or no." : 'Keep your delta, keep the tyres warm.'}` : `${c.data?.type || 'Safety car'} in this lap. Get ready to fight!`),
  'rain-coming': (c) => `${c.text} ${c.ask ? 'Yes or no, babe.' : 'Keep an eye on the sky.'}`,
  'weather-now': (c) => `${c.text}${c.data?.wetter ? ' Gentle on the throttle. Keep it on the road for me.' : ''}`,
  attack: (c) => `Within a second of ${name(c.data.name)}! ${c.data.era >= 2026 ? 'Overtake mode is yours.' : 'DRS!'} ${pick(['Go get him!', 'Hunt him down!', 'Send it!'])}`,
  defend: (c) => `${name(c.data.name)} is right on you. ${pick(['Hold that line!', 'Do not let him by.', 'Make yourself wide!'])}`,
  adjust: (c) => { const lock = /Brake bias/.test(c.text); if (lock) strike(); return `${c.text} ${lock && mistakes >= 2 ? tally().trim() : pick(['Trust me.', "You'll feel it.", ''])}`; },
  'final-lap': (c) => `Last lap! P${c.data?.pos ?? ''}! ${pick(['Bring it home clean and I might be very nice to you later.', 'Everything you have got. Make it worth my while.'])}`,
  finish: (c) => {
    const p = c.data.pos;
    const verdict = p === 1 ? 'You won! You absolute legend!' : p <= 3 ? `P${p}! Podium! I am so proud of you!` : p <= 10 ? `P${p}. Points! Good job.` : `P${p}. Debrief. My office.`;
    const tab = mistakes === 0 ? ` Not a single mistake. Come find me, ${pet()}. You've earned it.`
      : mistakes <= 2 ? ` ${mistakes === 1 ? 'One little slip' : 'Two slips'}, but I'll let it go. This time.`
        : ` ${mistakes} mistakes on your tab though. Drive me a clean one next time and I'll make it worth your while.`;
    mistakes = 0;
    return `Chequered flag! ${verdict}${tab}`;
  },
  'fastest-lap': (c) => (c.data?.me ? `Fastest lap! ${pick(['Show-off. I love it.', 'Purple everywhere. Gorgeous.'])}` : c.text),
  'blue-flag': () => "Blue flag. Let him by, and don't make it weird.",
  'yellow-flag': () => 'Yellow flag! Easy, easy. No heroics.',
  penalty: (c) => { strike(); return `${c.text} ${pick(["Seriously? You're lucky I like you.", 'Naughty.'])}${tally()}`; },
  'tyre-wear': (c) => `${c.text} Look after them for me.`,
  'fuel-short': (c) => `${c.text} Don't make me wait at the finish.`,
  'pit-soon': (c) => `${c.text} Get ready for me.`,
  'pit-estimate': (c) => c.text,
  answer: (c) => (/^Copy/.test(c.text) ? c.text.replace(/^Copy[,.]?\s*/, `Copy, ${pet()}! `) : c.text),
};

const SULTRY = {
  session: (c) => `Hey ${pet()}. It's me on the radio. ${c.text.replace(/^Radio check\.\s*/, '')} Let's have some fun.`,
  splits: (c) => `${pick(['', 'Mm, ', `Okay ${pet()}, `])}${c.text} ${pick(['Keep it smooth for me.', 'Looking good out there.', ''])}`,
  'losing-time': (c) => `${pick([`Little secret, ${pet()}. `, 'Just between us. ', ''])}${c.text}`,
  'lap-done': (c) => (c.data?.delta < 0 ? `Ooh, personal best. ${c.text} I felt that one.` : `${c.text}${c.data?.invalid ? '' : pick([' Nice.', ' Smooth.', ''])}`),
  'pos-gain': (c) => `P${c.data.pos}. ${pick(['Oh, that was lovely', 'Mm, I liked that move'])}${c.data.name ? ` on ${name(c.data.name)}` : ''}.`,
  'pos-lost': (c) => `${c.data.name ? `${name(c.data.name)} got by` : 'We lost one'}. P${c.data.pos}. Go get it back for me, ${pet()}.`,
  'leave-go': () => `Now, ${pet()}. Gap at pit exit. Go.`,
  'box-now': (c) => `Box, box, ${pet()}. ${c.text.replace(/^Box this lap, box this lap\.\s*/, '')}`,
  'final-lap': (c) => `Last lap, ${pet()}. P${c.data?.pos ?? ''}. Bring it home to me.`,
  finish: (c) => `Chequered flag. P${c.data.pos}. ${c.data.pos <= 3 ? 'You were incredible out there.' : 'Come back to me in one piece.'}`,
  answer: (c) => (/^Copy/.test(c.text) ? c.text.replace(/^Copy[,.]?\s*/, `Copy, ${pet()}. `) : c.text),
};

export function phrase(call) {
  const table = settings.style === 'fiery' ? FIERY : settings.style === 'sultry' ? SULTRY : null;
  const f = table && table[call.kind];
  try { return tidy(f ? f(call) : call.text).replace(/\s+/g, ' ').trim(); } catch { return tidy(call.text); }
}

// ---------------------------------------------------------------------------
// Say numbers the way an engineer would, so the voice flows.
// ---------------------------------------------------------------------------
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
export function speechify(text) {
  return text
    // Lap times: 1:17.873 -> "1 17 point 8"
    .replace(/\b(\d):(\d{2})\.(\d)\d*\b/g, (_, m, s, t) => `${m} ${s.replace(/^0/, 'oh ')} point ${t}`)
    // Gaps under a second: 0.75 -> "8 tenths", 0.05 -> "half a tenth"
    .replace(/(^|[^\d.])0\.(\d+)\b/g, (_, pre, d) => {
      const tenths = Math.round(Number(`0.${d}`) * 10);
      return `${pre}${tenths === 0 ? 'half a tenth' : tenths === 10 ? 'a second' : `${tenths === 1 ? 'a' : ONES[tenths]} tenth${tenths === 1 ? '' : 's'}`}`;
    })
    // Lap-time gaps over a second keep one decimal: 1.234 -> 1.2
    .replace(/\b(\d+)\.(\d)\d+\b/g, '$1.$2')
    .replace(/\bP(\d+)\b/g, 'P $1')
    .replace(/°C/g, ' degrees').replace(/°F/g, ' degrees')
    .replace(/\bkm\b/g, 'kilometres')
    .replace(/\bDRS\b/g, 'D R S').replace(/\bMFD\b/g, 'M F D').replace(/\bERS\b/g, 'E R S')
    .replace(/\s*\(to (\d+)%\)/g, ', to $1 percent')
    .replace(/(\d)%/g, '$1 percent')
    .replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Radio click: a short burst of static and a chirp before each call.
// ---------------------------------------------------------------------------
let ctx = null;
// One audio player, unlocked by a tap, so phones let it play later without one.
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
let player = null;
export function unlockAudio() {
  try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); } catch { ctx = null; }
  try { if (!player) { player = new Audio(); player.preload = 'auto'; } if (!player.dataset?.unlocked) { player.src = SILENT; player.play().catch(() => {}); if (player.dataset) player.dataset.unlocked = '1'; } } catch { /* no audio element */ }
}
function radioClick() {
  if (!settings.radio || !ctx) return 0;
  try {
    const t = ctx.currentTime;
    const out = ctx.createGain(); out.gain.value = 0.16 * settings.volume; out.connect(ctx.destination);
    // Static
    const len = Math.floor(ctx.sampleRate * 0.09);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const noise = ctx.createBufferSource(); noise.buffer = buf;
    const band = ctx.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = 1800; band.Q.value = 0.8;
    noise.connect(band); band.connect(out); noise.start(t);
    // Chirp
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(1250, t + 0.07); osc.frequency.linearRampToValueAtTime(1650, t + 0.13);
    g.gain.setValueAtTime(0, t + 0.07); g.gain.linearRampToValueAtTime(0.5, t + 0.08); g.gain.linearRampToValueAtTime(0, t + 0.15);
    osc.connect(g); g.connect(out); osc.start(t + 0.07); osc.stop(t + 0.16);
    return 220;
  } catch { return 0; }
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
    if (c.kind === 'session') mistakes = 0;
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
  for (let i = queue.length - 1; i >= 0; i--) if (queue[i].priority !== 'high' && Date.now() - queue[i].queued > 20000) queue.splice(i, 1);
  queue.sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.id - b.id);
  const next = queue[0];
  if (!next) return;
  if (speaking) {
    if (RANK[next.priority] < RANK[speaking.priority]) { halt(); speaking = null; } else return;
  }
  queue.shift();
  speak(next.text, next);
  // Fetch the next call's audio while this one plays.
  if (useOpenAI() && queue[0]) openaiAudio(queue[0].text, queue[0]).catch(() => {});
}
function halt() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (player) { player.onended = null; player.pause(); }
}

let speakingListener = () => {};
export function onSpeaking(fn) { speakingListener = fn; }

// ---------------------------------------------------------------------------
// OpenAI voices: realistic speech, told how to sound for each style.
// The key stays on this device and is only sent to OpenAI.
// ---------------------------------------------------------------------------
export const OPENAI_VOICES = [
  { id: 'marin', label: 'Marin (most natural)' },
  { id: 'coral', label: 'Coral (warm, bright)' },
  { id: 'nova', label: 'Nova (energetic)' },
  { id: 'shimmer', label: 'Shimmer (soft)' },
  { id: 'sage', label: 'Sage (calm)' },
];
const INSTRUCTIONS = {
  fiery: 'You are a young woman working as a Formula 1 race engineer, talking to your driver over team radio during a session. Sound upbeat, energetic and happy, playfully flirty and confident, with a teasing smile in your voice. Keep a quick, lively live-radio pace and say numbers crisply.',
  sultry: 'You are a woman race engineer talking to your driver over team radio. Sound smooth, low and sultry, relaxed and playful, with an unhurried, intimate pace and a warm smile.',
  straight: 'You are a calm, professional race engineer on team radio. Speak clearly and concisely at a steady pace.',
};
const URGENT = ' This call is urgent: say it sharp, punchy and with real energy.';
// The chosen style, plus anything the driver wrote in "How she sounds" (that wins if they clash).
export function instructionsFor(call = {}) {
  const own = (settings.sound || '').trim().slice(0, 600);
  return (INSTRUCTIONS[settings.style] || INSTRUCTIONS.straight)
    + (own ? ` Most importantly, follow this description of how to sound, even where it differs from the above: ${own}` : '')
    + (call.priority === 'high' ? URGENT : '');
}
const useOpenAI = () => settings.engine === 'openai' && !!settings.okey;
const audioCache = new Map(); // text -> Promise<blob URL>
// Rough cost guide: about 1.5 cents per minute of speech, about 15 characters a second.
export const costEstimate = (chars) => (chars / 15 / 60) * 0.015;

export function openaiAudio(text, call = {}) {
  const spoken = speechify(text);
  const key = `${settings.ovoice}|${settings.style}|${settings.sound}|${call.priority === 'high'}|${spoken}`;
  if (audioCache.has(key)) return audioCache.get(key);
  const job = (async () => {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.okey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        voice: settings.ovoice || 'marin',
        input: spoken.slice(0, 4000),
        instructions: instructionsFor(call),
        response_format: 'mp3',
        speed: Math.max(0.5, Math.min(1.5, settings.rate)),
      }),
    });
    if (!res.ok) {
      const msg = res.status === 401 ? 'OpenAI key not accepted' : res.status === 429 ? 'OpenAI limit reached or out of credit' : `OpenAI error ${res.status}`;
      throw Object.assign(new Error(msg), { status: res.status });
    }
    const url = URL.createObjectURL(await res.blob());
    // Count what this month's speech has cost (cached lines are free).
    const month = new Date().toISOString().slice(0, 7);
    if (settings.usage.month !== month) settings.usage = { month, chars: 0 };
    settings.usage.chars += spoken.length;
    saveSettings();
    return url;
  })();
  audioCache.set(key, job);
  job.catch(() => audioCache.delete(key));
  if (audioCache.size > 200) audioCache.delete(audioCache.keys().next().value);
  return job;
}

let lastError = '';
let errorListener = () => {};
export const engineError = () => lastError;
export function onEngineError(fn) { errorListener = fn; }
function setError(msg) { if (msg !== lastError) { lastError = msg; errorListener(msg); } }

export function speak(text, call = { priority: 'high' }) {
  speaking = call;
  speakingListener(true);
  const done = () => { speaking = null; speakingListener(false); setTimeout(pump, 350); };
  if (useOpenAI()) {
    openaiAudio(text, call).then((url) => {
      if (speaking !== call) return; // cut off by something more urgent
      if (!player) player = new Audio();
      player.src = url;
      player.volume = settings.volume;
      player.onended = done;
      const delay = radioClick();
      setTimeout(() => player.play().then(() => setError('')).catch(() => { setError('Tap the screen once so the phone lets her speak.'); deviceSpeak(text, done); }), delay);
    }).catch((e) => {
      setError(`${e.message}. Using the phone's voice for now.`);
      if (speaking === call) deviceSpeak(text, done);
    });
    return;
  }
  deviceSpeak(text, done);
}

function deviceSpeak(text, done) {
  if (!('speechSynthesis' in window)) { done(); return; }
  const u = new SpeechSynthesisUtterance(speechify(text));
  const v = pickVoice();
  if (v) { u.voice = v; u.lang = v.lang; }
  const p = PROSODY[settings.style] || PROSODY.straight;
  u.rate = Math.max(0.5, Math.min(2, p.rate * settings.rate));
  u.pitch = p.pitch;
  u.volume = settings.volume;
  u.onend = u.onerror = done;
  const delay = radioClick();
  setTimeout(() => speechSynthesis.speak(u), delay);
}

export function stop() { queue.length = 0; halt(); speaking = null; speakingListener(false); }

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
