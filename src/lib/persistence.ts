// Persistence — two layers, by design:
//
//   1. localStorage (durable, guaranteed): the real source of permanence. Needs
//      no backend, so edits to lines and areas survive between sessions in dev,
//      in a static build, and offline. Writing is synchronous and can't fail
//      silently on the network.
//   2. disk API (canonical, best-effort): under `bun dev` the route
//      (src/pages/api/polygons/[id].ts) writes each .geojson + the manifest, so
//      edits can be promoted into the repo/canon. If it isn't reachable (static
//      deploy, offline), the mutation is NOT lost — localStorage already holds
//      it — so these calls swallow their errors.

import type { Layer, LayerMeta } from './types';

const API = '/api/polygons';
const LS_KEY = 'syv-map:layers:v1';

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

// --- durable client state (localStorage) -----------------------------------

// The full ordered layer snapshot. When present it IS the session state — it
// already encodes shape edits, new/deleted layers, order and visibility.
export function loadLocal(): Layer[] | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch {
    return null;
  }
}

export function saveLocal(layers: Layer[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LS_KEY, JSON.stringify(layers));
  } catch {
    /* quota / private mode — nothing else to do; disk write is best-effort */
  }
}

export function clearLocal(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}

// --- shipped canon (read on first load / after a reset-to-canon) ------------

export async function loadManifest(): Promise<LayerMeta[]> {
  const res = await fetch(API, { cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

export async function fetchGeojson(path: string): Promise<any> {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) return { ...EMPTY_FC };
  return res.json();
}

// --- canonical export (disk API, best-effort) -------------------------------

export async function saveLayer(meta: LayerMeta, data: any): Promise<void> {
  try {
    await fetch(`${API}/${meta.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ meta, data }),
    });
  } catch {
    /* offline / static — localStorage already holds the state */
  }
}

export async function deleteLayer(id: string): Promise<void> {
  try {
    await fetch(`${API}/${id}`, { method: 'DELETE' });
  } catch {
    /* best-effort */
  }
}

// Bulk-mirror the durable localStorage snapshot into SQLite. Called on load
// when a local snapshot exists: it makes the DB an exact copy of the state the
// user sees, closing the localStorage↔canon divergence. Best-effort — if the
// server is down, localStorage already holds everything.
export async function syncAll(layers: Layer[]): Promise<void> {
  try {
    await fetch(API, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(layers),
    });
  } catch {
    /* offline / static — DB is a mirror; localStorage is the durable original */
  }
}

// persist the layer stacking order (panel list + map z-order) to the manifest
export async function saveOrder(ids: string[]): Promise<void> {
  try {
    await fetch(`${API}/_order`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
  } catch {
    /* best-effort */
  }
}
