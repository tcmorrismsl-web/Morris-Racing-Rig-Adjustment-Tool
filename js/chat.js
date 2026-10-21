// Talking to the race engineer: type, or use the phone keyboard's microphone.
//
// Clear radio requests ("gaps", "box", "I'll wait"…) go straight to the bridge, which answers
// with the real race data. Anything else is conversation. With an OpenAI key she answers in
// character, with the race in mind: the better you drive (and the more you flirt), the warmer
// she gets; flirt at a busy moment and she'll brush you off and send you back to driving.
// Without a key she has a set of replies. The key stays on this device and only goes to OpenAI.

import * as voice from './voice.js?v=mvi7diek';

const MODELS = ['gpt-4.1-mini', 'gpt-4o-mini', 'gpt-4.1-nano']; // tried in order if one isn't available
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ---------------------------------------------------------------------------
// Radio requests the bridge can answer from the game's data.
// ---------------------------------------------------------------------------
const COMMANDS = [
  ['wait', /^(ok(ay)?,? )?(i'?ll |i will |let'?s |gonna |going to )?(wait|hold( on| here)?|not yet|stay( here| put| in)?|hang on|give me a (sec|second|minute))\b|\b(i'?ll wait|not yet|hold on|staying in|stay in the garage)\b/i],
  ['repeat', /^(repeat|say (that|it) again|come again|what\??|sorry\??|pardon\??)$/i],
  ['time', /\b(losing (the )?time|where (am i|do i) (slow|losing|lose)|where.*los(e|ing)|how (do|can) i (go|get) faster|time loss)\b/i],
  ['gaps', /\b(gaps?|splits?|interval|who'?s (ahead|behind)|how far (ahead|behind|back)|what position|where am i)\b/i],
  ['pit', /\b(pit|box|strategy|pit window|stop plan|when (do|should|can) i (leave|go)|clean (gap|air)|traffic|leave the garage)\b/i],
  ['weather', /\b(weather|rain|forecast|track temp|is it (going to|gonna) rain)\b/i],
  ['tyres', /\b(tyres?|tires?|fuel|battery|ers|wear)\b/i],
  ['plan', /\b(plan|briefing|race notes|run plan|what'?s the plan)\b/i],
];
const YES = /^(yes|yeah|yep|yup|sure|ok(ay)?|copy|do it|go|going|i'?m going|let'?s go|send it|box( box)?|affirm(ative)?)\b/i;
const NO = /^(no|nope|nah|negative|stay out|not now|don'?t)\b/i;

// The radio request in a message, if it's clearly one. pending: the question she asked, if any.
export function matchCommand(text, pending) {
  const t = text.trim().replace(/[.!]+$/, '');
  if (!t) return null;
  if (pending && YES.test(t)) return 'yes';
  if (pending && NO.test(t)) return pending.ask === 'leave' ? 'wait' : 'no';
  const words = t.split(/\s+/).length;
  for (const [topic, re] of COMMANDS) {
    if (!re.test(t)) continue;
    // Long chatty messages that only mention a word in passing are conversation.
    if (words > 12 && topic !== 'wait') return null;
    return topic;
  }
  return null;
}

// ---------------------------------------------------------------------------
// What she knows about the race right now, from the dashboard's live data.
// ---------------------------------------------------------------------------
const fmtLap = (ms) => { if (!ms || ms <= 0) return null; const m = Math.floor(ms / 60000); const s = (ms % 60000) / 1000; return m ? `${m}:${s.toFixed(3).padStart(6, '0')}` : s.toFixed(3); };
export function raceContext(d) {
  if (!d) return { status: 'no data from the game yet' };
  const e = d.engineer || {};
  const s = d.session || {};
  const sb = voice.scoreboard();
  const ctx = { game: d.game === 'forza' ? 'Forza Motorsport' : 'F1 25', session: s.type || (d.game === 'forza' ? 'race' : ''), phase: e.phase || null, lap: s.lap ?? null, totalLaps: s.totalLaps ?? null, position: s.position ?? null, mistakesThisSession: sb.mistakes, goodMomentsThisSession: sb.wins };
  if (s.safetyCar) ctx.safetyCar = s.safetyCar;
  if (s.weather) ctx.weather = `${s.weather}${s.trackTemp !== null && s.trackTemp !== undefined ? `, track ${s.trackTemp}°C` : ''}`;
  if (d.game === 'f1') {
    const me = (d.tower || []).find((r) => r.me);
    if (me) {
      ctx.lastLap = fmtLap(me.lastMs); ctx.bestLap = fmtLap(me.bestMs); ctx.tyre = me.tyre ? `${me.tyre}, ${me.tyreAge ?? 0} laps old` : null;
      const ahead = (d.tower || []).find((r) => r.pos === me.pos - 1), behind = (d.tower || []).find((r) => r.pos === me.pos + 1);
      if (s.race) { ctx.carAhead = ahead ? `${ahead.name}, ${(me.gapAheadMs / 1000).toFixed(1)} s` : null; ctx.carBehind = behind ? `${behind.name}, ${((behind.gapAheadMs || 0) / 1000).toFixed(1)} s` : null; }
    }
    if (e.leave && !e.leave.out) ctx.garage = { nextCleanGapS: e.leave.waitS, mustLeaveWithinS: e.leave.leaveByS, holding: !!e.leave.muted };
    // Parc fermé locks the setup screen, not the wheel: be explicit so she never refuses wheel changes.
    if (d.parcFerme?.on) ctx.parcFerme = 'ON. Setup screen locked except the front wing. Still allowed on track from the wheel/MFD: brake bias, on-throttle differential, ERS mode. Give those suggestions freely.';
    else ctx.parcFerme = 'off';
    const items = (d.adjust?.items || []).map((x) => `${x.title}: ${x.text}`);
    if (items.length) ctx.wheelChangesNow = items;
    if (wheelTargets) ctx.setupSheetForThisTrack = wheelTargets;
    if (e.lossText) ctx.lastLapCoaching = e.lossText;
  } else if (d.timing) {
    ctx.lastLap = d.timing.lastS ? fmtLap(d.timing.lastS * 1000) : null; ctx.bestLap = d.timing.bestS ? fmtLap(d.timing.bestS * 1000) : null;
  }
  if (e.pending) ctx.yourQuestionWaitingForAnswer = e.pending.ask;
  ctx.recentRadio = voice.transcript.slice(0, 4).map((t) => t.text).reverse();
  return ctx;
}

// The app's suggested brake bias and diff for this session (set by the dashboard).
let wheelTargets = null;
export function setWheelTargets(t) { wheelTargets = t; }

// How warm she is: good driving and flirting raise it, mistakes cool it. 0 to 5.
let flirts = 0;
export function heat() {
  const sb = voice.scoreboard();
  return Math.max(0, Math.min(5, Math.round(1 + sb.wins * 0.7 - sb.mistakes * 0.7 + flirts * 0.4)));
}
const busyNow = (ctx) => ctx.phase === 'race' && !ctx.safetyCar;

// ---------------------------------------------------------------------------
// Conversation with OpenAI
// ---------------------------------------------------------------------------
const history = []; // last few exchanges
let sessionKey = null;
const STYLE_TEXT = {
  fiery: 'upbeat, happy, quick-witted and flirty; you keep a playful tab of his mistakes as a reminder of what a clean drive earns him later',
  sultry: 'smooth, low and sultry, relaxed and teasing',
  straight: 'calm and professional, dry humour, only lightly flirty if he flirts first',
};

function systemPrompt(ctx) {
  const name = voice.settings.name ? `You call him ${voice.settings.name} or pet names.` : 'You call him pet names like handsome, babe or trouble.';
  return [
    `You are his race engineer: a woman on team radio from the pit wall, talking with your driver during ${ctx.game}. Personality: ${STYLE_TEXT[voice.settings.style] || STYLE_TEXT.fiery}. ${name}`,
    'Reply like a real radio call: one or two short sentences, under 35 words. Plain spoken English, no emojis, no stage directions, no markdown.',
    'Flirting: playful, teasing and confident. Suggestive innuendo is fine; never explicit or graphic sexual content.',
    `Escalation: heat is ${heat()} out of 5 (it rises when he drives well and flirts, falls with mistakes). At 0 to 1 make him earn it and tease his mistakes. At 2 to 3 be warm and playful. At 4 to 5 be bold and hint at a reward after the race.`,
    'Dismissals: when he flirts during green-flag racing or right after a mistake, often give a flirtatious brush-off that sends him back to driving, and vary it. On the grid, in the garage, under a safety car or after the flag you can play along more.',
    'Mistakes: you keep score only as flirting, a reminder of what he gets later by driving well. Never threaten or scold harshly.',
    'Facts: use only the race data below. Never invent gaps, positions, lap times or weather. If he asks for something a topic covers, set "ask" to it and keep "say" to a few words or empty; the data answer follows on the radio.',
    'Wheel changes: brake bias, on-throttle diff and ERS mode can always be changed from the wheel while driving, parc fermé or not. When he asks what to change, use wheelChangesNow, setupSheetForThisTrack and lastLapCoaching, naming corners (Turn 4) rather than sectors.',
    'Topics: gaps, pit (pit plan, or the gap to leave the garage), time (where he is losing time), weather, tyres (tyres and fuel), plan (race plan), wait (he will hold in the garage), yes and no (answers to your waiting question), repeat.',
    'Answer as JSON only: {"say": "...", "ask": null or a topic, "flirt": true if he was flirting}.',
    `Race data now: ${JSON.stringify(ctx)}${busyNow(ctx) ? ' (green-flag racing: keep it short)' : ''}`,
  ].join('\n');
}

let workingModel = null;
async function askOpenAI(text, ctx) {
  const models = workingModel ? [workingModel, ...MODELS.filter((m) => m !== workingModel)] : MODELS;
  let lastErr = null;
  for (const model of models) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${voice.settings.okey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, temperature: 0.9, max_tokens: 110, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: systemPrompt(ctx) }, ...history.slice(-12), { role: 'user', content: text }],
      }),
    });
    if (res.ok) {
      workingModel = model;
      const j = await res.json();
      const out = JSON.parse(j.choices?.[0]?.message?.content || '{}');
      return { say: String(out.say || '').trim(), ask: typeof out.ask === 'string' ? out.ask : null, flirt: !!out.flirt };
    }
    lastErr = res.status;
    if (res.status === 401 || res.status === 429) break; // a key or credit problem, not the model
  }
  throw Object.assign(new Error(lastErr === 401 ? 'OpenAI key not accepted' : lastErr === 429 ? 'OpenAI limit reached or out of credit' : `OpenAI error ${lastErr}`), { status: lastErr });
}

// ---------------------------------------------------------------------------
// Without a key: a few set replies, warmer as heat rises.
// ---------------------------------------------------------------------------
const FLIRT = /\b(love|babe|baby|beautiful|gorgeous|sexy|cute|miss(ed)? you|kiss|date|dinner|tonight|after the race|later|hot|darling|sweetheart|pretty|amazing|marry|want you|your voice)\b/i;
export function offlineReply(text, ctx) {
  const pet = voice.settings.name || pick(['handsome', 'babe', 'trouble']);
  const h = heat();
  if (/\b(thanks|thank you|cheers|ty)\b/i.test(text)) return pick([`Anytime, ${pet}.`, "That's what I'm here for."]);
  if (FLIRT.test(text)) {
    flirts += 1;
    if (busyNow(ctx) && Math.random() < 0.5) return pick([`Eyes on the road, ${pet}. Sweet-talk me after the flag.`, "Flattery won't find you a tenth. Drive.", `Mm, nice try. Win me something first, ${pet}.`, 'Save it for the cool-down lap. Push now.']);
    if (h <= 1) return voice.scoreboard().mistakes > 0
      ? pick([`Cute. Clean up those mistakes and maybe I'll listen, ${pet}.`, 'Big talk for someone with a tab that long.', 'Earn it, then we can talk.'])
      : pick([`Cute. Show me a clean lap and maybe I'll listen, ${pet}.`, "Smooth talker. Let's see if you drive as well as you flirt.", 'Earn it, then we can talk.']);
    if (h <= 3) return pick([`You're sweet. Keep driving like that and you might get lucky, ${pet}.`, "Careful, you're making me smile on an open channel.", 'Keep it clean and I might just be waiting for you after the race.']);
    return pick([`Keep that up and I'm all yours after the flag, ${pet}.`, "Drive like this and you won't need to ask twice tonight.", "Mm. Bring it home and you'll find out exactly how proud I am."]);
  }
  if (/\b(how am i doing|how'?s it going|how am i)\b/i.test(text)) return `${ctx.position ? `P${ctx.position}` : 'Looking good'}${ctx.lastLap ? `, last lap ${ctx.lastLap}` : ''}. ${h >= 3 ? "I like what I'm seeing." : 'More to come, I know it.'}`;
  return pick([`Copy, ${pet}. Ask me for gaps, pit, weather or tyres any time.`, 'Copy. I\'m right here.']);
}

// ---------------------------------------------------------------------------
// Send a message. Returns what happened, for the dashboard.
// ---------------------------------------------------------------------------
export async function talk(text, d, ask) {
  const msg = String(text || '').trim().slice(0, 300);
  if (!msg) return null;
  if (d?.sessionId !== sessionKey) { sessionKey = d?.sessionId || null; history.length = 0; flirts = 0; }
  voice.youSaid(msg);
  const pending = d?.engineer?.pending || null;
  const cmd = matchCommand(msg, pending);
  if (cmd) { await ask(cmd); return { command: cmd }; }
  const ctx = raceContext(d);
  if (voice.settings.okey) {
    try {
      const r = await askOpenAI(msg, ctx);
      if (r.flirt) flirts += 1;
      history.push({ role: 'user', content: msg }, { role: 'assistant', content: JSON.stringify(r) });
      if (history.length > 16) history.splice(0, history.length - 16);
      if (r.say) voice.say(r.say);
      if (r.ask && ['gaps', 'pit', 'time', 'weather', 'tyres', 'plan', 'wait', 'yes', 'no', 'repeat'].includes(r.ask)) await ask(r.ask);
      return { reply: r.say, command: r.ask || null, ai: true };
    } catch (e) {
      const reply = offlineReply(msg, ctx);
      voice.say(reply);
      return { reply, error: e.message };
    }
  }
  const reply = offlineReply(msg, ctx);
  voice.say(reply);
  return { reply };
}
