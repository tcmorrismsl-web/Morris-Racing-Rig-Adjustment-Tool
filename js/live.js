// Connection to the Morris Racing bridge running on the laptop.
// Only works when the app is opened from the bridge's own address.

export const live = { bridge: false, connected: false, status: null, laps: [] };

async function getJson(url, opts) {
  const r = await fetch(url, { cache: 'no-store', ...opts });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

export async function detectBridge() {
  // The online copy (GitHub Pages) can never reach the bridge, so don't try.
  if (!/^https?:$/.test(location.protocol) || location.hostname.endsWith('github.io')) return false;
  try {
    const s = await getJson('api/status');
    if (!s || !s.bridge) return false;
    live.bridge = true; live.status = s;
    return true;
  } catch { return false; }
}

export async function loadLaps() {
  try { live.laps = await getJson('api/laps'); } catch { /* keep what we have */ }
}

export function connect(onChange) {
  const es = new EventSource('events');
  es.addEventListener('open', async () => { live.connected = true; await loadLaps(); onChange('laps'); });
  es.addEventListener('error', () => { live.connected = false; onChange('status'); });
  es.addEventListener('status', (e) => { live.status = JSON.parse(e.data); live.connected = true; onChange('status'); });
  es.addEventListener('lap', (e) => {
    const lap = JSON.parse(e.data);
    if (!live.laps.some((l) => l.id === lap.id)) live.laps.push(lap);
    onChange('lap', lap);
  });
  es.addEventListener('laps', async () => { await loadLaps(); onChange('laps'); });
  // Phones pause the stream when the screen locks; catch up when it comes back.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') { await loadLaps(); onChange('laps'); }
  });
}

export const putContext = (ctx) => getJson('api/context', { method: 'PUT', body: JSON.stringify(ctx) }).catch(() => null);
export const getRemoteState = () => getJson('api/state').catch(() => null);

let stateTimer;
export function putState(state) {
  clearTimeout(stateTimer);
  stateTimer = setTimeout(() => { fetch('api/state', { method: 'PUT', body: JSON.stringify(state) }).catch(() => {}); }, 800);
}

export async function deleteSession(id) {
  await fetch(`api/laps?session=${encodeURIComponent(id)}`, { method: 'DELETE' });
  live.laps = live.laps.filter((l) => l.session !== id);
}
