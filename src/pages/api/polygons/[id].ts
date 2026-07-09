// Per-layer endpoint for the SQLite-backed store (bun:sqlite, dev/bun runtime).
//   GET    /api/polygons/<id>     → that layer's GeoJSON FeatureCollection
//   POST   /api/polygons/<id>     → upsert { meta, data }
//   DELETE /api/polygons/<id>     → delete the layer
//   PUT    /api/polygons/_order   → persist stack order { ids: [...] }
//
// Replaces the previous filesystem backend (public/polygons/*.geojson + index.json).
// The canon on disk is now just the seed source; the DB is the source of truth.

import type { APIRoute } from 'astro';
import { getData, upsert, remove, setOrder } from '../../../lib/db';

export const prerender = false;

const ok = () =>
  new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });

export const GET: APIRoute = ({ params }) => {
  const data = getData(params.id!);
  if (!data) return new Response('not found', { status: 404 });
  return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
};

export const POST: APIRoute = async ({ params, request }) => {
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
  remove(params.id!);
  return ok();
};
