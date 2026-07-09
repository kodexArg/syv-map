// One-shot migration: load the on-disk polygon canon (public/polygons/*.geojson)
// into SQLite via the running dev server's bulk-sync endpoint.
//
// Why over HTTP instead of importing the DB directly: the SQLite driver
// (better-sqlite3) is a Node-ABI native addon and only loads inside the Node
// dev server, not under Bun. So this script (run by Bun) does the file IO + the
// HTTP PUT, and the Node server does the actual SQLite write. Clean separation,
// no driver runs in the wrong runtime.
//
//   1. bunx astro dev --background      # server must be up
//   2. bun run scripts/seed-db.ts
//
// Each file's first feature carries `name`/`color` in its properties (label/
// color). Order honours index.json where present, then the rest alphabetically.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.cwd(), 'public', 'polygons');
const ENDPOINT = process.env.SYV_MAP_URL ?? 'http://localhost:4321/api/polygons';

function indexOrder(): string[] {
  try {
    const idx = JSON.parse(readFileSync(path.join(DIR, 'index.json'), 'utf8'));
    return Array.isArray(idx) ? idx.map((e: any) => e.id) : [];
  } catch {
    return [];
  }
}

const order = indexOrder();

const layers = readdirSync(DIR)
  .filter((f) => f.endsWith('.geojson'))
  .map((f) => {
    const id = f.replace(/\.geojson$/, '');
    const data = JSON.parse(readFileSync(path.join(DIR, f), 'utf8'));
    const props = data.features?.[0]?.properties ?? {};
    return { id, label: props.name || id, color: props.color || '#ff8c42', defaultVisible: true, data };
  })
  .sort((a, b) => {
    const ra = order.indexOf(a.id);
    const rb = order.indexOf(b.id);
    return (ra === -1 ? 1e6 : ra) - (rb === -1 ? 1e6 : rb) || a.id.localeCompare(b.id);
  });

const res = await fetch(ENDPOINT, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(layers),
});

if (!res.ok) {
  console.error(`seed failed: ${res.status} ${res.statusText} — is the dev server up?`);
  process.exit(1);
}

console.log(`seeded ${layers.length} layers:`);
for (const l of layers) console.log(`  ${l.id.padEnd(24)} ${l.label}  (${l.color})`);
