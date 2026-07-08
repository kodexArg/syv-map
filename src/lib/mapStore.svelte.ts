// Runtime layer store (Svelte 5 runes). This replaces the old static
// `polygonLayers` array as the source of truth. The map and the panel both
// read `store.layers`; every mutation also persists via the adapter.

import type { Layer } from './types';
import { loadManifest, fetchGeojson, saveLayer, deleteLayer } from './persistence';

export const store = $state<{ layers: Layer[]; ready: boolean }>({
  layers: [],
  ready: false,
});

// --- load ------------------------------------------------------------------

export async function loadLayers(): Promise<void> {
  const metas = await loadManifest();
  const layers: Layer[] = [];
  for (const m of metas) {
    const data = await fetchGeojson(m.path);
    layers.push({ ...m, visible: m.defaultVisible, data });
  }
  store.layers = layers;
  store.ready = true;
}

// --- helpers ---------------------------------------------------------------

function find(id: string): Layer | undefined {
  return store.layers.find((l) => l.id === id);
}

// snapshot: strip Svelte proxies before handing GeoJSON to MapLibre / persistence
function plain<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

// a single-Polygon area is the only kind whose geometry we let Terra Draw edit
export function isEditableArea(l: Layer): boolean {
  const f = l.data?.features;
  return Array.isArray(f) && f.length === 1 && f[0]?.geometry?.type === 'Polygon';
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

export async function setGeometry(id: string, geometry: any): Promise<void> {
  const l = find(id);
  if (!l || !l.data?.features?.[0]) return;
  l.data.features[0].geometry = plain(geometry);
  await persist(l);
}

export function toggleVisible(id: string): void {
  const l = find(id);
  if (l) l.visible = !l.visible;
}

export async function removeLayer(id: string): Promise<void> {
  store.layers = store.layers.filter((l) => l.id !== id);
  await deleteLayer(id);
}

async function persist(l: Layer): Promise<void> {
  await saveLayer(
    { id: l.id, label: l.label, path: l.path, color: l.color, defaultVisible: l.defaultVisible },
    plain(l.data),
  );
}
