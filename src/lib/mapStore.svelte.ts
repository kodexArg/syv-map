// Runtime layer store (Svelte 5 runes). Source of truth for the UI is this
// in-memory store; durable persistence is SQLite only (via /api/polygons).

import type { Layer } from './types';
import {
  loadManifest,
  fetchGeojson,
  saveLayer,
  deleteLayer,
  saveOrder,
  reseedFromDisk,
} from './persistence';

export const store = $state<{ layers: Layer[]; ready: boolean; savedAt: number | null; error: string | null }>({
  layers: [],
  ready: false,
  savedAt: null,
  error: null,
});

// --- load ------------------------------------------------------------------

export async function loadLayers(): Promise<void> {
  store.error = null;
  try {
    const metas = await loadManifest();
    const layers: Layer[] = [];
    for (const m of metas) {
      const data = await fetchGeojson(m.path);
      layers.push({ ...m, visible: m.defaultVisible, data });
    }
    store.layers = layers;
    store.ready = true;
    store.savedAt = Date.now();
  } catch (e) {
    store.ready = true;
    store.error = e instanceof Error ? e.message : String(e);
    store.layers = [];
  }
}

/** Re-seed SQLite from public/polygons, then reload. */
export async function resetToCanon(): Promise<void> {
  store.error = null;
  try {
    await reseedFromDisk();
    await loadLayers();
  } catch (e) {
    store.error = e instanceof Error ? e.message : String(e);
  }
}

// --- helpers ---------------------------------------------------------------

function find(id: string): Layer | undefined {
  return store.layers.find((l) => l.id === id);
}

function plain<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

// Terra Draw rejects features whose coordinates carry >9 decimals ("excessive
// precision") — boolean ops / snapping can yield 14+. Clamp all geometry to 8
// decimals (~1 mm) so every shape stays editable. Recurses any nesting depth.
export function roundCoords(coords: any): any {
  return typeof coords[0] === 'number'
    ? [Math.round(coords[0] * 1e8) / 1e8, Math.round(coords[1] * 1e8) / 1e8]
    : coords.map(roundCoords);
}

export function isEditable(l: Layer): boolean {
  const f = l.data?.features;
  return (
    Array.isArray(f) &&
    f.some((x) => x?.geometry?.type === 'Polygon' || x?.geometry?.type === 'LineString')
  );
}

export function isEmpty(l: Layer): boolean {
  const count = (a: any): number => (Array.isArray(a) ? a.reduce((n, x) => n + count(x), 0) : 1);
  const f = l.data?.features;
  return !Array.isArray(f) || f.length === 0 || !f.some((x) => count(x?.geometry?.coordinates ?? []) > 0);
}

export function hasArea(l: Layer): boolean {
  const f = l.data?.features;
  return (
    Array.isArray(f) &&
    f.some((x) => x?.geometry?.type === 'Polygon' || x?.geometry?.type === 'MultiPolygon')
  );
}

// --- create ----------------------------------------------------------------

export async function createArea(geometry: any): Promise<Layer> {
  const n = store.layers.length + 1;
  const label = `Área ${n}`;
  const id = `area-${Date.now()}`;
  const color = '#ff8c42';
  const data = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: label, color, fill: true, fillOpacity: 0.3, weight: 3 },
        geometry: { ...plain(geometry), coordinates: roundCoords(plain(geometry).coordinates) },
      },
    ],
  };
  const layer: Layer = {
    id,
    label,
    path: `/api/polygons/${id}`,
    color,
    defaultVisible: true,
    visible: true,
    data,
  };
  store.layers.push(layer);
  await persist(layer);
  return layer;
}

// --- edits -----------------------------------------------------------------

export async function renameLayer(id: string, label: string): Promise<void> {
  const l = find(id);
  if (!l) return;
  l.label = label;
  if (l.data?.features?.[0]) l.data.features[0].properties.name = label;
  await persist(l);
}

export async function recolorLayer(id: string, color: string): Promise<void> {
  const l = find(id);
  if (!l) return;
  l.color = color;
  for (const f of l.data?.features ?? []) f.properties.color = color;
  await persist(l);
}

export async function setGeometries(
  id: string,
  geoms: { index: number; geometry: any }[],
): Promise<void> {
  const l = find(id);
  if (!l?.data?.features) return;
  for (const { index, geometry } of geoms) {
    if (!l.data.features[index]) continue;
    const g = plain(geometry);
    g.coordinates = roundCoords(g.coordinates);
    l.data.features[index].geometry = g;
  }
  await persist(l);
}

export async function openAsWall(
  id: string,
  featureIndex: number,
  vertexIndex: number,
): Promise<void> {
  const l = find(id);
  const f = l?.data?.features?.[featureIndex];
  const g = f?.geometry;
  const ring: number[][] | undefined =
    g?.type === 'Polygon' ? g.coordinates?.[0] : g?.type === 'MultiPolygon' ? g.coordinates?.[0]?.[0] : undefined;
  if (!l || !f || !ring || ring.length < 4) return;

  const n = ring.length;
  const closed = ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1];
  const v = closed ? ring.slice(0, -1) : ring.slice();
  const m = v.length;
  const k = ((vertexIndex % m) + m) % m;

  const line = v.slice(k).concat(v.slice(0, k));
  f.geometry = { type: 'LineString', coordinates: roundCoords(line) };
  f.properties = { ...f.properties, fill: false };
  await persist(l);
}

export async function reorderLayer(id: string, dir: -1 | 1): Promise<void> {
  const i = store.layers.findIndex((l) => l.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= store.layers.length) return;
  const arr = [...store.layers];
  [arr[i], arr[j]] = [arr[j], arr[i]];
  store.layers = arr;
  try {
    await saveOrder(store.layers.map((l) => l.id));
    store.savedAt = Date.now();
    store.error = null;
  } catch (e) {
    store.error = e instanceof Error ? e.message : String(e);
  }
}

export async function toggleVisible(id: string): Promise<void> {
  const l = find(id);
  if (!l) return;
  l.visible = !l.visible;
  l.defaultVisible = l.visible;
  await persist(l);
}

export async function removeLayer(id: string): Promise<void> {
  store.layers = store.layers.filter((l) => l.id !== id);
  try {
    await deleteLayer(id);
    store.savedAt = Date.now();
    store.error = null;
  } catch (e) {
    store.error = e instanceof Error ? e.message : String(e);
  }
}

/** Write one layer to SQLite. */
async function persist(l: Layer): Promise<void> {
  try {
    await saveLayer(
      { id: l.id, label: l.label, path: l.path, color: l.color, defaultVisible: l.defaultVisible },
      plain(l.data),
    );
    store.savedAt = Date.now();
    store.error = null;
  } catch (e) {
    store.error = e instanceof Error ? e.message : String(e);
  }
}
