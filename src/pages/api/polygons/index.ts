// Collection endpoint for the SQLite-backed layer store.
//   GET  /api/polygons        → the manifest (LayerMeta[], ordered)
//   PUT  /api/polygons        → bulk sync: mirror the client's full snapshot in
//
// The bulk sync exists to end the localStorage↔disk divergence: the client's
// durable localStorage snapshot IS the live state the user sees, so on load it
// pushes that whole ordered set into SQLite. The DB becomes an exact mirror of
// the browser instead of a stale seed.

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

  // Never let a spurious empty snapshot wipe the canon.
  if (clean.length === 0) return json({ ok: true, count: 0, skipped: 'empty snapshot' });

  replaceAll(clean);
  return json({ ok: true, count: clean.length });
};
