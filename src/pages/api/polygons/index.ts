// Collection endpoint for the SQLite-backed layer store.
//   GET  /api/polygons        → the manifest (LayerMeta[], ordered)
//   PUT  /api/polygons        → bulk replace (seed-db.ts / admin tools only)
//
// The map UI does not use localStorage; it always loads from this GET.

import type { APIRoute } from 'astro';
import { listMeta, replaceAll, type SeedLayer } from '../../../lib/db';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const GET: APIRoute = () => json(listMeta());

export const PUT: APIRoute = async ({ request }) => {
  const layers = await request.json();
  if (!Array.isArray(layers)) return json({ error: 'expected an array of layers' }, 400);

  const clean: SeedLayer[] = layers
    .filter((l: any) => l && typeof l.id === 'string' && l.data)
    .map((l: any) => ({
      id: l.id,
      label: l.label ?? l.id,
      color: l.color ?? '#ff8c42',
      defaultVisible: l.defaultVisible ?? true,
      data: l.data,
    }));

  if (clean.length === 0) return json({ ok: true, count: 0, skipped: 'empty snapshot' });

  replaceAll(clean);
  return json({ ok: true, count: clean.length });
};
