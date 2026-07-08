// Runtime layer store (Svelte 5 runes). This replaces the old static
// `polygonLayers` array as the source of truth. The map and the panel both
// read `store.layers`; every mutation also persists via the adapter.

import type { Layer } from './types';
import {
  loadManifest,
  fetchGeojson,
  saveLayer,
  deleteLayer,
  saveOrder,
  loadLocal,
  saveLocal,
  clearLocal,
} from './persistence';

export const store = $state<{ layers: Layer[]; ready: boolean; savedAt: number | null }>({
  layers: [],
  ready: false,
  savedAt: null,
});

// --- load ------------------------------------------------------------------

export async function loadLayers(): Promise<void> {
  // Durable state wins: if localStorage has a snapshot it already carries every
  // edit (shapes, order, visibility, new/deleted layers) from prior sessions.
  const local = loadLocal();
  if (local) {
    store.layers = local;
    store.ready = true;
    store.savedAt = Date.now(); // state came from the durable snapshot
    return;
  }

  // First ever load (or after «Restaurar canon»): seed from the shipped files.
  const metas = await loadManifest();
  const layers: Layer[] = [];
  for (const m of metas) {
    const data = await fetchGeojson(m.path);
    layers.push({ ...m, visible: m.defaultVisible, data });
  }
  store.layers = layers;
  store.ready = true;
  commit();
}

// Wipe the local snapshot and reload from the shipped canon on disk. The escape
// hatch out of a stale local overlay (e.g. after pulling new canon).
export async function resetToCanon(): Promise<void> {
  clearLocal();
  await loadLayers();
}

// --- helpers ---------------------------------------------------------------

function find(id: string): Layer | undefined {
  return store.layers.find((l) => l.id === id);
}

// snapshot: strip Svelte proxies before handing GeoJSON to MapLibre / persistence
function plain<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

// Persist the whole state to the durable layer (localStorage). Synchronous and
// can't fail on the network — this is what makes edits survive between sessions
// regardless of whether the disk API is reachable. Call after every mutation.
function commit(): void {
  saveLocal(plain(store.layers));
  store.savedAt = Date.now();
}

// Any región whose features are polygons and/or open lines can have its shape
// edited in Terra Draw. This covers filled areas AND open-line regions like la
// Muralla (several LineStrings) — every element gets the vertex editor.
export function isEditable(l: Layer): boolean {
  const f = l.data?.features;
  return (
    Array.isArray(f) &&
    f.some((x) => x?.geometry?.type === 'Polygon' || x?.geometry?.type === 'LineString')
  );
}

// A layer is empty when nothing has been drawn yet: no features, or no feature
// carries any coordinate. Empty layers are placeholders — trivially deletable.
export function isEmpty(l: Layer): boolean {
  const count = (a: any): number => (Array.isArray(a) ? a.reduce((n, x) => n + count(x), 0) : 1);
  const f = l.data?.features;
  return !Array.isArray(f) || f.length === 0 || !f.some((x) => count(x?.geometry?.coordinates ?? []) > 0);
}

// A región "has area" (a fill) only if it encloses territory — some feature is a
// closed polygon. Open-line regions (a wall/frontier, e.g. la Muralla) delimit
// but hold no interior: they render as border only, never as a filled area.
// (PRD «El caso del Muro»: Región no implica polígono cerrado.)
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
        geometry: plain(geometry),
      },
    ],
  };
  const layer: Layer = {
    id,
    label,
    path: `/polygons/${id}.geojson`,
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

// Write back edited geometries by their original feature index. A single-area
// región updates one feature; an open-line región (la Muralla) updates each of
// its line features independently.
export async function setGeometries(
  id: string,
  geoms: { index: number; geometry: any }[],
): Promise<void> {
  const l = find(id);
  if (!l?.data?.features) return;
  for (const { index, geometry } of geoms) {
    if (l.data.features[index]) l.data.features[index].geometry = plain(geometry);
  }
  await persist(l);
}

// move a layer up (dir -1) or down (dir +1) in the stack; order is the list
// order in the panel AND the map z-order, and it is persisted to the manifest.
export async function reorderLayer(id: string, dir: -1 | 1): Promise<void> {
  const i = store.layers.findIndex((l) => l.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= store.layers.length) return;
  const arr = [...store.layers];
  [arr[i], arr[j]] = [arr[j], arr[i]];
  store.layers = arr;
  commit();
  await saveOrder(store.layers.map((l) => l.id));
}

export function toggleVisible(id: string): void {
  const l = find(id);
  if (!l) return;
  l.visible = !l.visible;
  commit();
}

export async function removeLayer(id: string): Promise<void> {
  store.layers = store.layers.filter((l) => l.id !== id);
  commit();
  await deleteLayer(id);
}

// durable local write first (guaranteed), then the best-effort canonical export
async function persist(l: Layer): Promise<void> {
  commit();
  await saveLayer(
    { id: l.id, label: l.label, path: l.path, color: l.color, defaultVisible: l.defaultVisible },
    plain(l.data),
  );
}
