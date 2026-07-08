// Dev-only persistence endpoint (OPTION B). Writes each layer's GeoJSON to
// public/polygons/<id>.geojson and keeps public/polygons/index.json (the
// manifest) in sync. Runs under `bun dev`; not meant for the static build.

import type { APIRoute } from 'astro';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const prerender = false;

const DIR = path.join(process.cwd(), 'public', 'polygons');
const INDEX = path.join(DIR, 'index.json');

async function readIndex(): Promise<any[]> {
  try {
    return JSON.parse(await fs.readFile(INDEX, 'utf-8'));
  } catch {
    return [];
  }
}

async function writeIndex(idx: any[]): Promise<void> {
  await fs.writeFile(INDEX, JSON.stringify(idx, null, 2));
}

const ok = () =>
  new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json' },
  });

export const POST: APIRoute = async ({ params, request }) => {
  const id = params.id!;
  const { meta, data } = await request.json();

  await fs.writeFile(path.join(DIR, `${id}.geojson`), JSON.stringify(data, null, 2));

  const idx = await readIndex();
  const entry = {
    id: meta.id,
    label: meta.label,
    path: meta.path,
    color: meta.color,
    defaultVisible: meta.defaultVisible,
  };
  const i = idx.findIndex((e) => e.id === id);
  if (i >= 0) idx[i] = entry;
  else idx.push(entry);
  await writeIndex(idx);

  return ok();
};

export const DELETE: APIRoute = async ({ params }) => {
  const id = params.id!;
  await fs.rm(path.join(DIR, `${id}.geojson`), { force: true });
  await writeIndex((await readIndex()).filter((e) => e.id !== id));
  return ok();
};
