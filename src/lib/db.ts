// Server-only SQLite store for map layers. The Astro dev server runs on Node, so
// this uses `better-sqlite3` (synchronous, native, Node ABI). This is the
// ONLY persistence layer for the map UI. The schema is plain SQLite, so it ports
// to Cloudflare D1 later almost verbatim: swap the driver in `db()` — the SQL
// and row shapes stay.
//
// `public/polygons/*.geojson` is seed-only (import via seedFromDisk / seed-db.ts).

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { LayerMeta } from './types';

const DB_DIR = path.join(process.cwd(), 'db');
const DB_PATH = path.join(DB_DIR, 'syv-map.db');

export interface SeedLayer {
  id: string;
  label: string;
  color: string;
  defaultVisible: boolean;
  data: any; // GeoJSON FeatureCollection
}

let _db: Database.Database | null = null;

function db(): Database.Database {
  if (_db) return _db;
  if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
  const d = new Database(DB_PATH);
  d.exec(`CREATE TABLE IF NOT EXISTS layers (
    id              TEXT PRIMARY KEY,
    label           TEXT NOT NULL,
    color           TEXT NOT NULL,
    default_visible INTEGER NOT NULL DEFAULT 1,
    data            TEXT NOT NULL,
    ord             INTEGER NOT NULL DEFAULT 0
  )`);
  _db = d;
  return d;
}

// --- reads -----------------------------------------------------------------

// The manifest: metadata only (no geometry), ordered by the stored stack order.
// `path` points back at this API so the client fetches geometry per layer.
export function listMeta(): LayerMeta[] {
  const rows = db()
    .prepare('SELECT id, label, color, default_visible FROM layers ORDER BY ord ASC, rowid ASC')
    .all() as { id: string; label: string; color: string; default_visible: number }[];
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    path: `/api/polygons/${r.id}`,
    color: r.color,
    defaultVisible: !!r.default_visible,
  }));
}

// One layer's GeoJSON FeatureCollection (or null if it doesn't exist).
export function getData(id: string): any | null {
  const row = db().prepare('SELECT data FROM layers WHERE id = ?').get(id) as
    | { data: string }
    | undefined;
  return row ? JSON.parse(row.data) : null;
}

// --- writes ----------------------------------------------------------------

// Insert or update a single layer. New layers append to the tail of the stack;
// existing layers keep their order untouched.
export function upsert(meta: Omit<LayerMeta, 'path'>, data: any): void {
  const d = db();
  const row = d.prepare('SELECT ord FROM layers WHERE id = ?').get(meta.id) as
    | { ord: number }
    | undefined;
  const ord = row
    ? row.ord
    : (d.prepare('SELECT COALESCE(MAX(ord), -1) + 1 AS n FROM layers').get() as { n: number }).n;
  d.prepare(
    `INSERT INTO layers (id, label, color, default_visible, data, ord)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       label = excluded.label,
       color = excluded.color,
       default_visible = excluded.default_visible,
       data = excluded.data`,
  ).run(meta.id, meta.label, meta.color, meta.defaultVisible ? 1 : 0, JSON.stringify(data), ord);
}

export function remove(id: string): void {
  db().prepare('DELETE FROM layers WHERE id = ?').run(id);
}

// Persist a new stack order by id. Ids not present are ignored.
export function setOrder(ids: string[]): void {
  const d = db();
  const upd = d.prepare('UPDATE layers SET ord = ? WHERE id = ?');
  const tx = d.transaction((list: string[]) => list.forEach((id, i) => upd.run(i, id)));
  tx(ids);
}

// Replace the entire table with an ordered set. Used for seeding from disk.
export function replaceAll(layers: SeedLayer[]): void {
  const d = db();
  const tx = d.transaction((list: SeedLayer[]) => {
    d.exec('DELETE FROM layers');
    const ins = d.prepare(
      `INSERT INTO layers (id, label, color, default_visible, data, ord) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    list.forEach((l, i) =>
      ins.run(l.id, l.label, l.color, l.defaultVisible ? 1 : 0, JSON.stringify(l.data), i),
    );
  });
  tx(layers);
}

/** Load public/polygons/*.geojson (+ index.json order) into SQLite. Returns count. */
export function seedFromDisk(): number {
  const dir = path.join(process.cwd(), 'public', 'polygons');
  if (!existsSync(dir)) return 0;

  let order: string[] = [];
  try {
    const idx = JSON.parse(readFileSync(path.join(dir, 'index.json'), 'utf8'));
    if (Array.isArray(idx)) order = idx.map((e: { id?: string }) => e.id).filter(Boolean) as string[];
  } catch {
    /* no index — alphabetical */
  }

  const layers: SeedLayer[] = readdirSync(dir)
    .filter((f) => f.endsWith('.geojson'))
    .map((f) => {
      const id = f.replace(/\.geojson$/, '');
      const data = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
      const props = data.features?.[0]?.properties ?? {};
      return {
        id,
        label: props.name || id,
        color: props.color || '#ff8c42',
        defaultVisible: true,
        data,
      };
    })
    .sort((a, b) => {
      const ra = order.indexOf(a.id);
      const rb = order.indexOf(b.id);
      return (ra === -1 ? 1e6 : ra) - (rb === -1 ? 1e6 : rb) || a.id.localeCompare(b.id);
    });

  replaceAll(layers);
  return layers.length;
}
