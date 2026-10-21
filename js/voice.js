// Race engineer voice: turns the bridge's radio calls into speech.
// Styles: "fiery" (upbeat, flirty, keeps a playful tab of your mistakes), "sultry" (slow and smooth)
// and "straight" (just the facts). Speaks with the device's voices, or OpenAI's realistic voices
// when a key is set (falls back to the device voice if OpenAI can't be reached).

const STORE = 'mr-engineer';
const defaults = { v: 2, on: false, style: 'fiery', chat: 'normal', voice: '', name: '', rate: 1, volume: 1, radio: true,
  engine: 'device', okey: '', ovoice: 'marin', sound: '', radioSound: 'f1', usage: { month: '', chars: 0 } };
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
let wins = 0; // positions gained, personal bests, fastest laps
const strike = () => { mistakes += 1; return mistakes; };
export const scoreboard = () => ({ mistakes, wins });
const tally = () => (mistakes === 0 ? ''
  : mistakes === 1 ? pick([" That's one on your tab. Keep it clean and there's something nice waiting for you after the race.", ' One little slip. Stay tidy and you still get your reward.'])
    : mistakes === 2 ? pick([" That's two. You're making me wait for that reward, babe.", ' Two now. Win me back with a clean lap.'])
      : pick([` That's ${mistakes}. You're going to have to work a lot harder to impress me tonight.`, ` ${mistakes} on your tab. Clean laps from here and I'll forget all about it.`]));
const reward = () => pick([' Keep driving like that and you know what you get.', " That's how you earn it.", ' Mm, keep that up for me.']);

// Wording picks: never the same one twice until the others have been used, and the little
// extras only some of the time, so the radio doesn't sound like a loop.
const recentPicks = {};
function fresh(key, arr) {
  const used = recentPicks[key] || (recentPicks[key] = []);
  const idx = arr.map((_, i) => i).filter((i) => !used.includes(i));
  const i = (idx.length ? idx : arr.map((_, k) => k))[Math.floor(Math.random() * (idx.length || arr.length))];
  used.push(i);
  while (used.length > Math.max(1, arr.length - 1)) used.shift();
  return arr[i];
}
const maybe = (key, arr, p = 0.5) => (Math.random() < p ? fresh(key, arr) : '');

const FIERY = {
  session: () => fresh('f-session', [`Hey ${pet()}! Radio check, I've got you loud and clear. Let's go have some fun.`, `There you are, ${pet()}. I'm on the radio all session. Make me proud.`, `Radio check. Hi, ${pet()}. Ready when you are.`]),
  splits: (c) => `${maybe('f-si', ['Okay. ', 'Right, ', `Listen, ${pet()}. `, 'Gaps. ', 'Update. '], 0.4)}${c.text}${c.data?.ahead?.changeMs < -200 ? ` ${fresh('f-sa', ['Reel him in!', "He's yours.", 'Keep chipping away.', 'Lovely.'])}` : c.data?.behind?.changeMs < -200 ? ` ${fresh('f-sb', ["Don't you dare let him by.", 'Push, he is coming.', 'Tidy laps now.'])}` : maybe('f-sx', [' Keep it smooth.', ' Love the pace.', ' Looking good.'], 0.3)}`,
  'losing-time': (c) => { const n = c.data?.fix === 'lockup' ? strike() : mistakes; return `${maybe('f-li', ['Quick one. ', `Okay ${pet()}, `, 'Little tip. ', "Here's some time for you. ", 'Listen. '], 0.45)}${c.text}${c.data?.fix === 'lockup' && n >= 2 ? tally() : ''}`; },
  'lap-done': (c) => {
    if (c.data?.invalid) { strike(); return `${fresh('f-inv', ['Track limits, lap deleted!', 'Ooh, deleted. Track limits.', "That one's gone, track limits."])}${tally()}`; }
    if (c.data?.delta < 0) return `${fresh('f-pb', ['Yes! ', 'Oh, nice! ', 'There it is! ', 'Mm, ', 'Beautiful! ', ''])}${c.text} ${maybe('f-pb2', ['More of that, please.', 'I could kiss you.', "That's my driver.", 'Keep going.', 'Gorgeous lap.'], 0.6)}${maybe('f-rw', [' Keep driving like that and you know what you get.', " That's how you earn it.", ' Mm, keep that up for me.'], 0.35)}`;
    return `${c.text}${maybe('f-ld', [' Keep stacking them.', ' Next one.', ' Build on it.'], 0.3)}`;
  },
  'pos-gain': (c) => `${fresh('f-g1', ['Yes! ', 'Oh yes! ', 'Beautiful! ', 'Get in! ', ''])}${c.text}${maybe('f-g2', [" That's my driver.", ' I love it.', ' Do it again.', ' So good.'], 0.6)}${maybe('f-rw', [' Keep driving like that and you know what you get.', " That's how you earn it.", ' Mm, keep that up for me.'], 0.25)}`,
  'pos-lost': (c) => { strike(); return `${c.text}${fresh('f-l2', [' Go get it back if you want my attention.', ' Get it back for me.', ' Not on my watch, get him back.', ''])}${tally()}`; },
  'leave-go': (c) => (c.ask ? `${fresh('f-go', [`Gap at pit exit, ${pet()}!`, 'Clean air at pit exit!', "Gap's opening now!"])}${c.data?.clearForS ? ` Clear for about ${Math.min(60, c.data.clearForS)} seconds.` : ''} Going?` : `Track's clear, ${pet()}. Go whenever you like.`),
  briefing: (c) => `${c.text} ${fresh('f-br', ["Now go make me proud. I'll be right here in your ear.", "Drive it clean and I'll be very, very happy with you.", "Let's have a good one, " + pet() + '.'])}`,
  formation: (c) => `${c.text}${maybe('f-fm', [' Get those tyres nice and hot for me.', ' Warm them up properly.'], 0.6)}`,
  lights: () => fresh('f-lo', ['Lights out! Go, go, go!', 'Lights out, babe! Go!', 'And go! Go, go!']),
  'parc-ferme': (c) => `${c.text} Last chance to fiddle with the car, ${pet()}.`,
  'leave-wait': (c) => `${c.text}${maybe('f-lw', [' Patience, babe.', " Sit tight, I've got you."], 0.5)}`,
  'leave-by': (c) => `${c.text}${maybe('f-lb', [' Do not keep me waiting.', ' Tick tock.'], 0.6)}`,
  'box-now': (c) => `Box, box! ${fresh('f-bx', ['Come to me.', 'Bring it in.', 'In you come.'])} ${c.text.replace(/^Box this lap, box this lap\.\s*/, '')}`,
  'box-ask': (c) => `${c.text} Your call, ${pet()}.`,
  sc: (c) => (c.data?.deployed ? `${c.data.type} out! ${c.ask ? 'Free pit stop, babe. Want it? Yes or no.' : 'Keep your delta, keep the tyres warm.'}` : `${c.data?.type || 'Safety car'} in this lap. Get ready to fight!`),
  'rain-coming': (c) => `${c.text} ${c.ask ? 'Yes or no, babe.' : 'Keep an eye on the sky.'}`,
  'weather-now': (c) => `${c.text}${c.data?.wetter ? ' Gentle on the throttle. Keep it on the road for me.' : ''}`,
  attack: (c) => `${c.text}${maybe('f-at', [' Go get him!', ' Send it!', ' Hunt him down!'], 0.6)}`,
  defend: (c) => `${c.text}${maybe('f-df', [' Hold that line!', ' Make yourself wide.', ''], 0.5)}`,
  adjust: (c) => { const lock = /Brake bias/.test(c.text); if (lock) strike(); return `${c.text}${lock && mistakes >= 2 ? ` ${tally().trim()}` : maybe('f-aj', [' Trust me.', " You'll feel it."], 0.4)}`; },
  'final-lap': (c) => `${c.text} ${fresh('f-fl', ['Bring it home clean and I might be very nice to you later.', 'Everything you have got. Make it worth my while.', "Last one, " + pet() + ". Make it count."])}`,
  finish: (c) => {
    const p = c.data.pos;
    const verdict = p === 1 ? 'You won! You absolute legend!' : p <= 3 ? `P${p}! Podium! I am so proud of you!` : p <= 10 ? `P${p}. Points! Good job.` : `P${p}. Debrief. My office.`;
    const tab = mistakes === 0 ? ` Not a single mistake. Come find me, ${pet()}. You've earned it.`
      : mistakes <= 2 ? ` ${mistakes === 1 ? 'One little slip' : 'Two slips'}, but I'll let it go. This time.`
        : ` ${mistakes} mistakes on your tab though. Drive me a clean one next time and I'll make it worth your while.`;
    mistakes = 0;
    return `Chequered flag! ${verdict}${tab}`;
  },
  'fastest-lap': (c) => (c.data?.me ? `${c.text} ${fresh('f-fs', ['Show-off. I love it.', 'Purple everywhere. Gorgeous.', 'Mm, fastest of all.'])}` : c.text),
  'blue-flag': () => fresh('f-blue', ["Blue flag. Let him by, and don't make it weird.", 'Blue flag, let the leader through.']),
  'yellow-flag': () => fresh('f-yel', ['Yellow flag! Easy, easy. No heroics.', 'Yellows ahead, careful.']),
  penalty: (c) => { strike(); return `${c.text} ${fresh('f-pen', ["Seriously? You're lucky I like you.", 'Naughty.', 'Tut tut.'])}${tally()}`; },
  'tyre-wear': (c) => `${c.text} Look after them for me.`,
  'fuel-short': (c) => `${c.text} Don't make me wait at the finish.`,
  'pit-soon': (c) => `${c.text} Get ready for me.`,
  sector: (c) => `${c.text}${maybe('f-sec', [' Ooh.', ' Love that.', ' Gorgeous.'], 0.6)}`,
  'battle-ahead': (c) => `${c.text}${maybe('f-ba', [' Go play.', " Let's have them."], 0.4)}`,
  teammate: (c) => c.text,
  overview: (c) => `${maybe('f-ov', ['Big picture: ', 'Race update. ', ''], 0.3)}${c.text.replace(/^Race update: /, '')}`,
  'tyres-rival': (c) => c.text,
  ers: (c) => c.text,
  'rival-pit': (c) => c.text,
  'wheel-setup': (c) => `${c.text}${maybe('f-ws', [' Trust me.', ''], 0.4)}`,
  pit: (c) => c.text,
  answer: (c) => (/^Copy/.test(c.text) ? c.text.replace(/^Copy[,.]?\s*/, `Copy, ${pet()}! `) : c.text),
};

const SULTRY = {
  session: (c) => `Hey ${pet()}. It's me on the radio. ${c.text.replace(/^Radio check\.\s*/, '')} Let's have some fun.`,
  splits: (c) => `${maybe('s-si', ['Mm, ', `Okay ${pet()}, `, ''], 0.4)}${c.text}${maybe('s-sx', [' Keep it smooth for me.', ' Looking good out there.'], 0.3)}`,
  'losing-time': (c) => `${maybe('s-li', [`Little secret, ${pet()}. `, 'Just between us. ', 'Listen. '], 0.4)}${c.text}`,
  'lap-done': (c) => (c.data?.delta < 0 ? `${fresh('s-pb', ['Ooh. ', 'Mm. ', ''])}${c.text}${maybe('s-pb2', [' I felt that one.', ' Lovely.'], 0.5)}` : `${c.text}${c.data?.invalid ? '' : maybe('s-ld', [' Nice.', ' Smooth.'], 0.3)}`),
  'pos-gain': (c) => `${c.text}${maybe('s-g', [' Oh, that was lovely.', ' Mm, I liked that.'], 0.6)}`,
  'pos-lost': (c) => `${c.text}${maybe('s-l', [` Go get it back for me, ${pet()}.`, ''], 0.6)}`,
  'leave-go': (c) => (c.ask ? `Gap at pit exit, ${pet()}.${c.data?.clearForS ? ` Clear for about ${Math.min(60, c.data.clearForS)} seconds.` : ''} Going?` : `Track's clear, ${pet()}. Whenever you're ready.`),
  briefing: (c) => `${c.text} Take your time. I'll be with you every lap.`,
  formation: (c) => `${c.text} Nice and warm for me.`,
  'box-now': (c) => `Box, box, ${pet()}. ${c.text.replace(/^Box this lap, box this lap\.\s*/, '')}`,
  'final-lap': (c) => `${c.text} Bring it home to me.`,
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
// Audio: one WebAudio context, unlocked by a tap, plays the radio chime and her voice.
// ---------------------------------------------------------------------------
let ctx = null;
let out = null; // master gain
export function unlockAudio() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    if (!out) { out = ctx.createGain(); out.connect(ctx.destination); }
    // A silent blip inside the tap is what phones need to allow sound later.
    const b = ctx.createBuffer(1, 1, ctx.sampleRate); const n = ctx.createBufferSource(); n.buffer = b; n.connect(out); n.start();
  } catch { ctx = null; }
}
const audioReady = () => !!ctx && ctx.state === 'running';

// Radio sounds. "f1": a broadcast-style team-radio chime, synthesised here (two bright digital
// tones over a hiss of static). "click": the older static and chirp. "custom": your own clip.
export const RADIO_SOUNDS = [
  { id: 'f1', label: 'F1-style team radio chime' },
  { id: 'click', label: 'Static click' },
  { id: 'custom', label: 'Your own sound' },
  { id: 'off', label: 'Off' },
];
const CUSTOM_KEY = 'mr-engineer-sound';
let customBuf = null;
export function setCustomSound(dataUrl) {
  customBuf = null;
  try { if (dataUrl) localStorage.setItem(CUSTOM_KEY, dataUrl); else localStorage.removeItem(CUSTOM_KEY); } catch { return false; }
  return true;
}
async function loadCustom() {
  if (customBuf || !ctx) return customBuf;
  let url = null;
  try { url = localStorage.getItem(CUSTOM_KEY); } catch { /* none */ }
  if (!url) return null;
  try { const bytes = await (await fetch(url)).arrayBuffer(); customBuf = await ctx.decodeAudioData(bytes); } catch { customBuf = null; }
  return customBuf;
}
const soundSetting = () => settings.radioSound || (settings.radio === false ? 'off' : 'f1');

function staticBurst(t, dur, level, freq = 1800) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const n = ctx.createBufferSource(); n.buffer = buf;
  const band = ctx.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = freq; band.Q.value = 0.9;
  const g = ctx.createGain(); g.gain.value = level;
  n.connect(band); band.connect(g); g.connect(out); n.start(t);
}
function tone(t, f, dur, level, type = 'square') {
  const o = ctx.createOscillator(); const g = ctx.createGain();
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200;
  o.type = type; o.frequency.setValueAtTime(f, t);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + 0.006); g.gain.setValueAtTime(level, t + dur * 0.55); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(lp); lp.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.02);
}
// Plays the chime and returns how long until speech should start (ms).
function radioChime() {
  const kind = soundSetting();
  if (kind === 'off' || !audioReady()) return 0;
  try {
    out.gain.value = settings.volume;
    const t = ctx.currentTime + 0.01;
    if (kind === 'custom' && customBuf) {
      const n = ctx.createBufferSource(); n.buffer = customBuf; n.connect(out); n.start(t);
      return Math.min(1500, Math.round(customBuf.duration * 1000) + 30);
    }
    if (kind === 'click') {
      staticBurst(t, 0.09, 0.16);
      tone(t + 0.07, 1450, 0.08, 0.06, 'sine');
      return 200;
    }
    // F1-style: static open, then two quick bright tones, a step down.
    staticBurst(t, 0.07, 0.12, 2400);
    tone(t + 0.05, 1975, 0.075, 0.07);
    tone(t + 0.05, 3950, 0.05, 0.015, 'sine');
    tone(t + 0.15, 1480, 0.12, 0.075);
    tone(t + 0.15, 2960, 0.08, 0.015, 'sine');
    return 290;
  } catch { return 0; }
}
// A breath of static when she lets go of the button.
function radioOut() { if (soundSetting() === 'f1' && audioReady()) try { staticBurst(ctx.currentTime + 0.02, 0.06, 0.07, 2200); } catch { /* ignore */ } }
export function testChime() { unlockAudio(); loadCustom().then(() => radioChime()); }

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
    if (c.kind === 'session' || c.kind === 'briefing') { mistakes = 0; wins = 0; }
    if (c.kind === 'pos-gain' || (c.kind === 'lap-done' && c.data?.delta < 0 && !c.data?.invalid) || (c.kind === 'fastest-lap' && c.data?.me)) wins += 1;
    if (settings.style === 'straight' && (c.kind === 'pos-lost' || c.kind === 'penalty' || (c.kind === 'lap-done' && c.data?.invalid))) strike();
    const text = phrase(c);
    transcript.unshift({ id: c.id, text, kind: c.kind, priority: c.priority, ask: c.ask });
    transcript.length = Math.min(transcript.length, 12);
    if (!settings.on || !allowed(c)) continue;
    queue.push({ ...c, text, queued: Date.now() });
  }
  onChange();
  pump();
}

// Forget queued calls of these kinds (e.g. pit-exit calls once you've left the garage).
export function drop(kindRe) {
  for (let i = queue.length - 1; i >= 0; i--) if (kindRe.test(queue[i].kind)) queue.splice(i, 1);
  if (speaking && kindRe.test(speaking.kind || '')) { halt(); speaking = null; speakingListener(false); setTimeout(pump, 200); }
}

// Something she says that didn't come from the bridge: replies when you talk to her.
export function say(text, kind = 'chat') {
  const id = `local-${Date.now()}`;
  transcript.unshift({ id, text, kind, priority: 'high' });
  transcript.length = Math.min(transcript.length, 12);
  onChange();
  if (!settings.on) return;
  queue.push({ id: Number.MAX_SAFE_INTEGER, kind, priority: 'high', text, queued: Date.now(), ttlS: 30 });
  pump();
}
export function youSaid(text) { transcript.unshift({ id: `you-${Date.now()}`, text: `You: ${text}`, kind: 'you', priority: 'low' }); transcript.length = Math.min(transcript.length, 12); onChange(); }

// Mark everything already on the radio as heard, so opening the dashboard mid-race doesn't replay it.
export function catchUp(calls) { for (const c of calls || []) heard.add(c.id); }

function pump() {
  // Drop calls that are no longer worth saying: their own time limit, or 20 s for chatter.
  for (let i = queue.length - 1; i >= 0; i--) {
    const q = queue[i], age = Date.now() - q.queued;
    if ((q.ttlS && age > q.ttlS * 1000) || (q.priority !== 'high' && age > 20000)) queue.splice(i, 1);
  }
  queue.sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.id - b.id);
  const next = queue[0];
  if (!next) return;
  if (speaking) {
    if (RANK[next.priority] < RANK[speaking.priority]) { halt(); speaking = null; } else return;
  }
  queue.shift();
  speak(next.text, next);
  // Start downloading the next call's audio while this one plays.
  if (useOpenAI() && queue[0]) speechJob(queue[0].text, queue[0]);
}
function halt() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (playing) { playing.stop(); playing = null; }
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
// How she sounds, written the way OpenAI's voice model follows best: one line per quality,
// with the driver's own description (accent, character) first so it takes priority.
const PROFILE = {
  fiery: {
    voice: 'A young woman, a Formula 1 race engineer on team radio from the pit wall.',
    tone: 'Upbeat, happy and confident, playfully flirty, with a teasing smile you can hear.',
    pacing: 'Quick and lively, like live radio. Numbers said crisply.',
    emotion: 'Excited when things go well, cheeky when he slips up, never cold.',
  },
  sultry: {
    voice: 'A woman race engineer on team radio.',
    tone: 'Smooth, low and sultry, relaxed and playful, with a warm smile.',
    pacing: 'Unhurried and intimate, small pauses before the good bits.',
    emotion: 'Calm, affectionate and teasing.',
  },
  straight: {
    voice: 'A race engineer on team radio.',
    tone: 'Calm, clear and professional.',
    pacing: 'Steady and concise.',
    emotion: 'Focused.',
  },
};
export function instructionsFor(call = {}) {
  const own = (settings.sound || '').trim().slice(0, 600);
  const p = PROFILE[settings.style] || PROFILE.straight;
  return [
    own ? `Accent and character (most important; keep it on every word, even where the lines below differ): ${own}` : '',
    `Voice: ${p.voice}`,
    `Tone: ${p.tone}`,
    `Pacing: ${p.pacing}`,
    `Emotion: ${p.emotion}`,
    call.priority === 'high' && call.kind !== 'chat' ? 'Urgency: this call is urgent, say it sharp and punchy with real energy.' : '',
  ].filter(Boolean).join('\n');
}
const useOpenAI = () => settings.engine === 'openai' && !!settings.okey;
// Rough cost guide: about 1.5 cents per minute of speech, about 15 characters a second.
export const costEstimate = (chars) => (chars / 15 / 60) * 0.015;

// Speech arrives as raw 24 kHz audio and starts playing while it's still downloading, so she
// begins talking a fraction of a second after the request instead of after the whole clip.
const RATE = 24000;
const jobs = new Map(); // wording -> download (kept, so repeated lines are instant and free)
export function speechJob(text, call = {}) {
  const spoken = speechify(text);
  const key = `${settings.ovoice}|${settings.style}|${settings.sound}|${call.priority === 'high' && call.kind !== 'chat'}|${settings.rate}|${spoken}`;
  if (jobs.has(key)) return jobs.get(key);
  const job = { chunks: [], samples: 0, done: false, error: null, listeners: new Set() };
  const notify = () => job.listeners.forEach((f) => f());
  job.promise = (async () => {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.okey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        voice: settings.ovoice || 'marin',
        input: spoken.slice(0, 4000),
        instructions: instructionsFor(call),
        response_format: 'pcm',
        speed: Math.max(0.5, Math.min(1.5, settings.rate)),
      }),
    });
    if (!res.ok) {
      const msg = res.status === 401 ? 'OpenAI key not accepted' : res.status === 429 ? 'OpenAI limit reached or out of credit' : `OpenAI error ${res.status}`;
      throw Object.assign(new Error(msg), { status: res.status });
    }
    // Count what this month's speech has cost (repeated lines are free).
    const month = new Date().toISOString().slice(0, 7);
    if (settings.usage.month !== month) settings.usage = { month, chars: 0 };
    settings.usage.chars += spoken.length;
    saveSettings();
    let carry = null;
    const push = (u8) => {
      let bytes = u8;
      if (carry !== null) { const b = new Uint8Array(u8.length + 1); b[0] = carry; b.set(u8, 1); bytes = b; carry = null; }
      const n = Math.floor(bytes.length / 2);
      if (bytes.length % 2) carry = bytes[bytes.length - 1];
      if (!n) return;
      const f = new Float32Array(n);
      const dv = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
      for (let i = 0; i < n; i++) f[i] = dv.getInt16(i * 2, true) / 32768;
      job.chunks.push(f); job.samples += n;
      notify();
    };
    const reader = res.body && res.body.getReader ? res.body.getReader() : null;
    if (reader) { for (;;) { const { done, value } = await reader.read(); if (done) break; if (value?.length) push(value); } }
    else push(new Uint8Array(await res.arrayBuffer()));
  })().then(() => { job.done = true; notify(); }, (e) => { job.error = e; job.done = true; jobs.delete(key); notify(); });
  jobs.set(key, job);
  if (jobs.size > 150) jobs.delete(jobs.keys().next().value);
  return job;
}
// Kept for the settings test button and older callers.
export const openaiAudio = (text, call) => speechJob(text, call).promise;

let lastError = '';
let errorListener = () => {};
export const engineError = () => lastError;
export function onEngineError(fn) { errorListener = fn; }
function setError(msg) { if (msg !== lastError) { lastError = msg; errorListener(msg); } }

let playing = null;
function playJob(job, text, done) {
  const lead = radioChime() / 1000;
  let next = ctx.currentTime + lead, idx = 0, started = false, endTimer = null;
  const sources = [];
  const handle = { stop() { sources.forEach((n) => { try { n.stop(); } catch { /* already done */ } }); clearTimeout(endTimer); job.listeners.delete(feed); } };
  playing = handle;
  function feed() {
    if (playing !== handle) { job.listeners.delete(feed); return; }
    if (job.error && !started) { job.listeners.delete(feed); playing = null; setError(`${job.error.message}. Using the phone's voice for now.`); deviceSpeak(text, done); return; }
    // A quarter of a second in hand before starting avoids stutter on slow Wi-Fi.
    if (!started && !job.done && job.samples < RATE * 0.25) return;
    while (idx < job.chunks.length) {
      const f = job.chunks[idx++];
      const b = ctx.createBuffer(1, f.length, RATE);
      b.getChannelData(0).set(f);
      const n = ctx.createBufferSource(); n.buffer = b; n.connect(out);
      const at = Math.max(next, ctx.currentTime + 0.02);
      n.start(at); next = at + b.duration; sources.push(n); started = true;
    }
    if (job.done) {
      job.listeners.delete(feed);
      if (!started) { playing = null; done(); return; }
      endTimer = setTimeout(() => { if (playing === handle) playing = null; radioOut(); done(); }, Math.max(0, (next - ctx.currentTime) * 1000) + 20);
    }
  }
  job.listeners.add(feed);
  setError('');
  feed();
}

export function speak(text, call = { priority: 'high' }) {
  speaking = call;
  speakingListener(true);
  const done = () => { if (speaking === call) { speaking = null; speakingListener(false); } setTimeout(pump, 150); };
  if (useOpenAI()) {
    if (!audioReady()) unlockAudio();
    if (!audioReady()) { setError('Tap the screen once so the phone lets her speak.'); deviceSpeak(text, done); return; }
    out.gain.value = settings.volume;
    if (soundSetting() === 'custom') loadCustom();
    playJob(speechJob(text, call), text, done);
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
  const delay = radioChime();
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
