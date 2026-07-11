// Persistence — SQLite only (via Astro API).
//
// There is no localStorage. The browser holds an in-memory store; every load
// and every mutation goes through `/api/polygons` → `db/syv-map.db`.
// Without the dev server, the map cannot persist (and load will be empty).

import type { Layer, LayerMeta } from './types';

const API = '/api/polygons';

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

// --- reads (SQLite) --------------------------------------------------------

export async function loadManifest(): Promise<LayerMeta[]> {
  const res = await fetch(API, { cache: 'no-store' });
  if (!res.ok) throw new Error(`loadManifest failed: ${res.status}`);
  return res.json();
}

export async function fetchGeojson(path: string): Promise<any> {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) return { ...EMPTY_FC };
  return res.json();
}

// --- writes (SQLite) -------------------------------------------------------

export async function saveLayer(meta: LayerMeta, data: any): Promise<void> {
  const res = await fetch(`${API}/${meta.id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ meta, data }),
  });
  if (!res.ok) throw new Error(`saveLayer ${meta.id} failed: ${res.status}`);
}

export async function deleteLayer(id: string): Promise<void> {
  const res = await fetch(`${API}/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`deleteLayer ${id} failed: ${res.status}`);
}

export async function saveOrder(ids: string[]): Promise<void> {
  const res = await fetch(`${API}/_order`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`saveOrder failed: ${res.status}`);
}

/** Wipe SQLite and re-seed from public/polygons/*.geojson (disk seed). */
export async function reseedFromDisk(): Promise<void> {
  const res = await fetch(`${API}/_seed`, { method: 'POST' });
  if (!res.ok) throw new Error(`reseedFromDisk failed: ${res.status}`);
}
