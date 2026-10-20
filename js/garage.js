// Forza Motorsport garage: the cars you own, their current stats and upgrade history.

import { findCar } from './cars.js?v=mvg5074w';
import { FORZA_CLASSES } from './data.js?v=mvg5074w';

// Stat bars shown on a car's page in Forza Motorsport (0.0–10.0).
export const STATS = [
  ['speed', 'Speed'],
  ['handling', 'Handling'],
  ['accel', 'Acceleration'],
  ['braking', 'Braking'],
];

export const SPECS = [
  ['hp', 'Power', 'hp'],
  ['torque', 'Torque', 'lb-ft'],
  ['weight', 'Weight', 'lb'],
  ['frontPct', 'Front weight', '%'],
  ['level', 'Car level', ''],
];

// Parts that unlock tuning sliders. Factory race cars have them all.
export const PARTS = [
  ['aero', 'Adjustable aero (wings)', 'aero'],
  ['suspension', 'Race springs and dampers', 'springs, ride height and damping'],
  ['arb', 'Race anti-roll bars', 'anti-roll bars'],
  ['diff', 'Race differential', 'differential'],
  ['gearing', 'Race transmission', 'gearing'],
];

export const TYRES = [
  { id: 'stock', label: 'Stock' },
  { id: 'street', label: 'Street' },
  { id: 'sport', label: 'Sport' },
  { id: 'semi', label: 'Semi-slick' },
  { id: 'slick', label: 'Race slick' },
  { id: 'vintage', label: 'Vintage' },
];

export function classFromPi(pi) {
  const n = Number(pi);
  if (!Number.isFinite(n) || n < 100 || n > 999) return null;
  if (n === 999) return 'X';
  if (n <= 300) return 'E';
  if (n <= 400) return 'D';
  if (n <= 500) return 'C';
  if (n <= 600) return 'B';
  if (n <= 700) return 'A';
  if (n <= 800) return 'S';
  if (n <= 900) return 'R';
  return 'P';
}

const num = (v, lo, hi) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(hi, Math.max(lo, n));
};

// Cleans any car-shaped object (from the form or an imported file).
export function normalizeCar(c = {}) {
  const parts = {};
  for (const [k] of PARTS) parts[k] = !!c.parts?.[k];
  const stats = {};
  for (const [k] of STATS) {
    const v = num(c.stats?.[k], 0, 10);
    stats[k] = v === null ? null : Math.round(v * 10) / 10;
  }
  const pi = num(c.pi, 100, 999);
  return {
    id: String(c.id || `car${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`),
    name: String(c.name || '').trim().slice(0, 80) || 'Unnamed car',
    division: findCar(c.name)?.division || String(c.division || '').slice(0, 60),
    pi: pi === null ? null : Math.round(pi),
    drivetrain: ['fwd', 'rwd', 'awd'].includes(c.drivetrain) ? c.drivetrain : 'rwd',
    raceCar: !!c.raceCar,
    tyre: TYRES.some((t) => t.id === c.tyre) ? c.tyre : 'stock',
    parts,
    stats,
    hp: num(c.hp, 0, 3000),
    torque: num(c.torque, 0, 3000),
    weight: num(c.weight, 500, 10000),
    frontPct: num(c.frontPct, 20, 80),
    level: num(c.level, 1, 50),
    notes: String(c.notes || '').slice(0, 500),
    history: Array.isArray(c.history) ? c.history.slice(0, 50) : [],
    updated: c.updated || null,
  };
}

export const carClass = (car) => classFromPi(car.pi);
// Factory race cars come with race suspension, bars, diff and gearbox. Aero is ticked separately,
// since not every race car has wing sliders.
export const hasPart = (car, key) => !!car && ((car.raceCar && key !== 'aero') || !!car.parts?.[key]);

// Lists what changed between two versions of a car, for the upgrade history.
export function diffCar(before, after) {
  const out = [];
  const change = (label, b, a, unit = '') => {
    const u = (v) => `${v}${unit === '%' ? '%' : unit ? ` ${unit}` : ''}`;
    if (b === a) return;
    if (b === null || b === undefined) out.push(`${label} set to ${u(a)}`);
    else if (a === null || a === undefined) out.push(`${label} cleared`);
    else out.push(`${label} ${u(b)} to ${u(a)}`);
  };
  if (before.pi !== after.pi) {
    const was = classFromPi(before.pi), now = classFromPi(after.pi);
    change('PI', before.pi, after.pi);
    if (now && was !== now) out[out.length - 1] += ` (now ${now} class)`;
  }
  if (before.drivetrain !== after.drivetrain) out.push(`Drivetrain ${before.drivetrain.toUpperCase()} to ${after.drivetrain.toUpperCase()}`);
  for (const [k, label, unit] of SPECS) change(label, before[k], after[k], unit);
  for (const [k, label] of STATS) change(label, before.stats[k], after.stats[k]);
  if (before.tyre !== after.tyre) {
    const t = (id) => TYRES.find((x) => x.id === id)?.label;
    out.push(`Tyres ${t(before.tyre)} to ${t(after.tyre)}`);
  }
  for (const [k, label] of PARTS) {
    if (before.parts[k] !== after.parts[k]) out.push(`${after.parts[k] ? 'Fitted' : 'Removed'} ${label.toLowerCase()}`);
  }
  if (before.raceCar !== after.raceCar) out.push(after.raceCar ? 'Marked as a factory race car' : 'No longer marked as a factory race car');
  return out;
}

// Saves an edited car into the list, recording an upgrade-history entry if anything changed.
export function upsertCar(garage, input, now = new Date().toISOString()) {
  const next = normalizeCar(input);
  const i = garage.findIndex((c) => c.id === next.id);
  if (i === -1) {
    next.history = [{ date: now, changes: ['Added to garage'] }];
    next.updated = now;
    return [next, ...garage];
  }
  const prev = garage[i];
  const changes = diffCar(prev, next);
  next.history = changes.length ? [{ date: now, changes }, ...prev.history].slice(0, 50) : prev.history;
  next.updated = changes.length ? now : prev.updated;
  const copy = garage.slice();
  copy[i] = next;
  return copy;
}

export function classInfo(id) {
  return FORZA_CLASSES.find((c) => c.id === id) || null;
}
