// Per-layer endpoint for the SQLite-backed store.
//   GET    /api/polygons/<id>     → that layer's GeoJSON FeatureCollection
//   POST   /api/polygons/<id>     → upsert { meta, data }
//   DELETE /api/polygons/<id>     → delete the layer
//   PUT    /api/polygons/_order   → persist stack order { ids: [...] }
//   POST   /api/polygons/_seed    → wipe DB and re-import public/polygons/*.geojson
//
// public/polygons is seed-only; SQLite (db/syv-map.db) is the only runtime store.

import type { APIRoute } from 'astro';
import { getData, upsert, remove, setOrder, seedFromDisk } from '../../../lib/db';

export const prerender = false;

const ok = (body: Record<string, unknown> = { ok: true }) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

export const GET: APIRoute = ({ params }) => {
  const data = getData(params.id!);
  if (!data) return new Response('not found', { status: 404 });
  return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
};

export const POST: APIRoute = async ({ params, request }) => {
  // Reserved: re-seed from disk
  if (params.id === '_seed') {
    const count = seedFromDisk();
    return ok({ ok: true, count });
  }

  const { meta, data } = await request.json();
  upsert(
    {
      id: params.id!,
      label: meta.label,
      color: meta.color,
      defaultVisible: meta.defaultVisible ?? true,
    },
    data,
  );
  return ok();
};

// Reorder the whole stack. Addressed as the reserved id `_order` (not a layer).
export const PUT: APIRoute = async ({ params, request }) => {
  if (params.id !== '_order') return new Response('not found', { status: 404 });
  const { ids } = await request.json();
  setOrder(ids);
  return ok();
};

export const DELETE: APIRoute = ({ params }) => {
  if (params.id === '_seed' || params.id === '_order') {
    return new Response('not found', { status: 404 });
  }
  remove(params.id!);
  return ok();
};
