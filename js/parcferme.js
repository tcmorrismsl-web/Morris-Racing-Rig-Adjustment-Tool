// Parc fermé in F1 25. With the game's parc fermé rules on, the setup locks the first time you
// drive out in qualifying and stays locked until the race is over (on sprint weekends it opens
// again after the sprint). Locked means the setup screen only lets you change the front wing,
// which is also what a race pit stop can change. Brake bias and the on-throttle differential can
// still be changed from the wheel / MFD while you drive.

export const PF_GARAGE = ['frontWing'];
export const PF_WHEEL = ['brakeBias', 'diffOn'];
export const PF_NOTE = 'Parc fermé: only the front wing can change in the garage or at a stop. Brake bias and the on-throttle diff still change from the wheel on track. Everything else is locked until the race is over.';

// Is the car locked? pref is the app setting: 'auto' (follow the game), 'on' or 'off'.
export function pfState(pref, fromGame) {
  if (pref === 'on') return { on: true, source: 'you', reason: 'You set parc fermé to Locked.' };
  if (pref === 'off') return { on: false, source: 'you', reason: null };
  if (fromGame) return { ...fromGame, source: 'game' };
  return { on: false, source: 'none', reason: null };
}

const WHEEL = /brake bias|diff on throttle|on-throttle diff/i;
const WING = /front wing/i;
const DRIVING = /short-shift|smoother|brake (a touch |a little |a fraction )?(earlier|later|lighter)|squeeze|patient|carry|line|kerb/i;

// Sort setup changes into what you can still do and what's locked.
export function pfSplit(changes) {
  const ok = [], locked = [];
  for (const text of changes) {
    if (WHEEL.test(text)) ok.push({ text, how: 'From the wheel on track' });
    else if (WING.test(text)) ok.push({ text, how: 'In the garage or at a stop' });
    else if (DRIVING.test(text)) ok.push({ text, how: 'Driving' });
    else locked.push(text);
  }
  return { ok, locked };
}

// What to do instead when every setup fix for a handling problem is locked.
export const PF_DRIVING = {
  'us-entry': 'Brake a touch earlier and release the brake gradually as you turn in, so the fronts keep grip.',
  'us-mid': 'Carry a little less speed into the fast corners and be patient before full throttle.',
  'os-entry': 'Brake in a straighter line and come off the brake smoothly as you turn.',
  'os-exit': 'Short-shift and squeeze the throttle on until the wheel is nearly straight.',
  kerbs: 'Stay off the high and sausage kerbs; use the flat part of the kerb only.',
  lockup: 'Brake a touch earlier and ease off the pedal as you turn in.',
  wear: 'Smoother throttle on exit, avoid sliding the rear, and lift and coast a little before big stops.',
  speed: 'Focus on the exit onto each straight, and use DRS or Overtake whenever you have it.',
};
