// Persistence adapter — OPTION B: writes to disk via a dev API route.
// The manifest (`/polygons/index.json`) is the runtime SSOT of layers.
// In `bun dev` the API route (src/pages/api/polygons/[id].ts) writes the
// .geojson + updates the manifest, so edits survive a reload.

import type { LayerMeta } from './types';

const API = '/api/polygons';

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

export async function loadManifest(): Promise<LayerMeta[]> {
  const res = await fetch('/polygons/index.json', { cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

export async function fetchGeojson(path: string): Promise<any> {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) return { ...EMPTY_FC };
  return res.json();
}

export async function saveLayer(meta: LayerMeta, data: any): Promise<void> {
  await fetch(`${API}/${meta.id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ meta, data }),
  });
}

export async function deleteLayer(id: string): Promise<void> {
  await fetch(`${API}/${id}`, { method: 'DELETE' });
}
