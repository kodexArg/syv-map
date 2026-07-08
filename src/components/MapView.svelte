<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import maplibregl from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import {
    TerraDraw,
    TerraDrawPolygonMode,
    TerraDrawLineStringMode,
    TerraDrawSelectMode,
  } from 'terra-draw';
  import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
  import type { Layer } from '../lib/types';
  import {
    store,
    loadLayers,
    createArea,
    renameLayer,
    recolorLayer,
    setGeometries,
    toggleVisible,
    removeLayer,
    reorderLayer,
    resetToCanon,
    isEditable,
    isEmpty,
    hasArea,
    roundCoords,
  } from '../lib/mapStore.svelte';

  let mapContainer: HTMLDivElement;
  let map: maplibregl.Map | undefined;
  let draw: TerraDraw | undefined;
  let mapLoaded = $state(false);

  // ui session state: 'idle' | 'create' | 'edit'
  let uiMode = $state<'idle' | 'create' | 'edit'>('idle');
  let editingId = $state<string | null>(null);
  // maps each Terra Draw feature back to its original index in the layer
  let editFeatureIds: { origIndex: number; terraId: string }[] = [];

  const rendered = new Set<string>();
  const srcId = (id: string) => `src-${id}`;
  const fillId = (id: string) => `fill-${id}`;
  const lineId = (id: string) => `line-${id}`;

  function snapshot(v: any) {
    return JSON.parse(JSON.stringify(v));
  }

  // --- reconcile store.layers -> maplibre sources/layers ---------------------
  function syncMap() {
    if (!map || !mapLoaded) return;
    const live = new Set<string>();

    for (const layer of store.layers) {
      live.add(layer.id);
      const area = hasArea(layer);

      if (!map.getSource(srcId(layer.id))) {
        map.addSource(srcId(layer.id), { type: 'geojson', data: snapshot(layer.data) });
        rendered.add(layer.id);
      } else {
        (map.getSource(srcId(layer.id)) as maplibregl.GeoJSONSource).setData(snapshot(layer.data));
      }

      // fill = the área. Only regions that enclose territory get one; an
      // open-line región (la Muralla) delimits without an interior, so it
      // renders as border only. Reconcile presence both ways.
      if (area && !map.getLayer(fillId(layer.id))) {
        const before = map.getLayer(lineId(layer.id)) ? lineId(layer.id) : undefined;
        map.addLayer(
          {
            id: fillId(layer.id),
            type: 'fill',
            source: srcId(layer.id),
            paint: {
              'fill-color': ['coalesce', ['get', 'color'], '#ff8c42'],
              'fill-opacity': ['coalesce', ['get', 'fillOpacity'], 0.3],
            },
          },
          before,
        );
      } else if (!area && map.getLayer(fillId(layer.id))) {
        map.removeLayer(fillId(layer.id));
      }

      // border/trazo: every región has one (polygon outline or open line).
      if (!map.getLayer(lineId(layer.id))) {
        map.addLayer({
          id: lineId(layer.id),
          type: 'line',
          source: srcId(layer.id),
          paint: {
            'line-color': ['coalesce', ['get', 'color'], '#ff8c42'],
            'line-width': ['coalesce', ['get', 'weight'], 2],
          },
        });
      }

      const vis = layer.visible ? 'visible' : 'none';
      if (map.getLayer(fillId(layer.id))) map.setLayoutProperty(fillId(layer.id), 'visibility', vis);
      if (map.getLayer(lineId(layer.id))) map.setLayoutProperty(lineId(layer.id), 'visibility', vis);
    }

    for (const id of [...rendered]) {
      if (live.has(id)) continue;
      if (map.getLayer(fillId(id))) map.removeLayer(fillId(id));
      if (map.getLayer(lineId(id))) map.removeLayer(lineId(id));
      if (map.getSource(srcId(id))) map.removeSource(srcId(id));
      rendered.delete(id);
    }

    // Enforce stack order: top of the panel list = top of the map. Walk the
    // list bottom→top, raising each layer's fill then line to the top, so the
    // first entry ends up on top and the border stays above its own fill.
    for (let i = store.layers.length - 1; i >= 0; i--) {
      const id = store.layers[i].id;
      if (map.getLayer(fillId(id))) map.moveLayer(fillId(id));
      if (map.getLayer(lineId(id))) map.moveLayer(lineId(id));
    }
  }

  // re-run whenever the store changes (deep reactive read below)
  $effect(() => {
    store.layers.map((l) => `${l.id}:${l.visible}:${l.color}:${l.data.features.length}`).join('|');
    syncMap();
  });

  // --- terra draw sessions ---------------------------------------------------
  function beginCreate() {
    if (!draw || uiMode !== 'idle') return;
    uiMode = 'create';
    draw.start();
    draw.setMode('polygon');
  }

  function beginEdit(layer: Layer) {
    if (!draw || uiMode !== 'idle' || !isEditable(layer)) return;
    uiMode = 'edit';
    editingId = layer.id;
    draw.start();
    draw.setMode('select');

    // load every editable feature (polygon or open line), tagging each with the
    // Terra Draw mode that matches its geometry, and remember its original index.
    editFeatureIds = [];
    const feats: any[] = [];
    const src = layer.data.features ?? [];
    for (let i = 0; i < src.length; i++) {
      const t = src[i]?.geometry?.type;
      const mode = t === 'Polygon' ? 'polygon' : t === 'LineString' ? 'linestring' : null;
      if (!mode) continue;
      const f = snapshot(src[i]);
      // Terra Draw rejects >9-decimal coords; clamp legacy/boolean-op geometry.
      f.geometry.coordinates = roundCoords(f.geometry.coordinates);
      const terraId = crypto.randomUUID();
      f.id = terraId;
      f.properties = { ...f.properties, mode };
      feats.push(f);
      editFeatureIds.push({ origIndex: i, terraId });
    }
    draw.addFeatures(feats);
  }

  function saveEdit() {
    if (!draw || uiMode !== 'edit' || !editingId) return;
    const snap = draw.getSnapshot();
    const geoms: { index: number; geometry: any }[] = [];
    for (const { origIndex, terraId } of editFeatureIds) {
      const f = snap.find((x: any) => x.id === terraId);
      if (f?.geometry) geoms.push({ index: origIndex, geometry: f.geometry });
    }
    if (geoms.length) setGeometries(editingId, geoms);
    endSession();
  }

  function cancelSession() {
    endSession();
  }

  function endSession() {
    if (draw) {
      draw.clear();
      draw.stop();
    }
    uiMode = 'idle';
    editingId = null;
    editFeatureIds = [];
  }

  // --- row actions -----------------------------------------------------------
  function doRename(layer: Layer) {
    const name = window.prompt('Nombre del área', layer.label);
    if (name && name.trim()) renameLayer(layer.id, name.trim());
  }
  function doRecolor(layer: Layer, e: Event) {
    recolorLayer(layer.id, (e.target as HTMLInputElement).value);
  }
  function doDelete(layer: Layer) {
    // an empty (undrawn) area is a throwaway placeholder — remove it with no ceremony
    if (isEmpty(layer) || window.confirm(`¿Eliminar "${layer.label}"?`)) removeLayer(layer.id);
  }
  function doReset() {
    if (window.confirm('¿Descartar tus ediciones locales y volver al mapa original?')) resetToCanon();
  }

  onMount(async () => {
    map = new maplibregl.Map({
      container: mapContainer,
      // CartoDB Positron "no labels" — light gray streets, zero place/street text.
      style: {
        version: 8,
        sources: {
          carto: {
            type: 'raster',
            tiles: [
              'https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
              'https://b.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
              'https://c.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
            ],
            tileSize: 256,
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributments">CARTO</a>',
          },
        },
        layers: [
          // warm cream floor under the tiles; the raster is drawn semi-opaque
          // over it so the stark white Positron basemap reads softer, less
          // contrasty — a creamy tint instead of blinding white.
          { id: 'bg', type: 'background', paint: { 'background-color': '#efe4c4' } },
          { id: 'carto', type: 'raster', source: 'carto', paint: { 'raster-opacity': 0.62 } },
        ],
      },
      center: [-58.376, -34.605],
      zoom: 14,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map, maplibregl }),
      modes: [
        new TerraDrawPolygonMode(),
        new TerraDrawLineStringMode(),
        new TerraDrawSelectMode({
          flags: {
            polygon: {
              feature: {
                draggable: true,
                coordinates: { midpoints: true, draggable: true, deletable: true },
              },
            },
            linestring: {
              feature: {
                draggable: true,
                coordinates: { midpoints: true, draggable: true, deletable: true },
              },
            },
          },
        }),
      ],
    });

    // a finished freshly-drawn polygon becomes a new area layer
    draw.on('finish', (id: string) => {
      if (uiMode !== 'create' || !draw) return;
      const feat = draw.getSnapshot().find((f: any) => f.id === id);
      if (feat?.geometry?.type === 'Polygon') createArea(feat.geometry);
      endSession();
    });

    await new Promise<void>((res) => map!.on('load', () => res()));
    mapLoaded = true;
    await loadLayers();
  });

  onDestroy(() => {
    map?.remove();
  });
</script>

<div class="relative h-screen w-screen">
  <div bind:this={mapContainer} class="h-full w-full"></div>

  <aside
    class="absolute top-4 left-4 z-10 w-72 rounded-(--radius-lg) border border-border bg-card/95 p-4 shadow-lg backdrop-blur-sm"
  >
    <h1 class="mb-1 text-sm font-extrabold text-foreground">syv-map</h1>
    <div class="mb-3 flex items-center justify-between">
      <p class="text-xs font-mono text-muted-foreground">
        {store.savedAt ? 'Guardado ✓' : 'Áreas · regiones'}
      </p>
      <button
        onclick={doReset}
        title="Descartar ediciones locales y volver al mapa original"
        disabled={uiMode !== 'idle'}
        class="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
      >↺ Restaurar</button>
    </div>

    {#if uiMode === 'create'}
      <div class="mb-3 rounded-md border border-primary/60 bg-primary/10 p-2">
        <p class="mb-2 text-xs text-foreground">Dibujá el área. Clic por cada vértice, doble clic para cerrar.</p>
        <button onclick={cancelSession} class="w-full rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-muted/40">Cancelar</button>
      </div>
    {:else if uiMode === 'edit'}
      <div class="mb-3 rounded-md border border-primary/60 bg-primary/10 p-2">
        <p class="mb-2 text-xs text-foreground">Editando vértices. Arrastrá puntos; clic en punto medio para agregar.</p>
        <div class="flex gap-2">
          <button onclick={saveEdit} class="flex-1 rounded border border-primary/60 bg-primary/20 px-2 py-1 text-xs font-semibold text-foreground hover:bg-primary/30">Guardar</button>
          <button onclick={cancelSession} class="flex-1 rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-muted/40">Cancelar</button>
        </div>
      </div>
    {/if}

    <ul class="space-y-1.5">
      {#each store.layers as layer, i (layer.id)}
        <li class="group flex items-center gap-2 rounded px-1 py-0.5 hover:bg-muted/30">
          <input
            type="checkbox"
            checked={layer.visible}
            onchange={() => toggleVisible(layer.id)}
            class="h-4 w-4 rounded border-border accent-primary"
            disabled={uiMode !== 'idle'}
          />
          <label class="relative h-3 w-3 shrink-0 rounded-full border border-border" style={`background:${layer.color}`}>
            <input
              type="color"
              value={layer.color}
              oninput={(e) => doRecolor(layer, e)}
              class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              disabled={uiMode !== 'idle'}
            />
          </label>
          <span class="flex-1 truncate text-sm {isEmpty(layer) ? 'italic text-muted-foreground' : 'text-foreground'}">
            {layer.label}{#if isEmpty(layer)}<span class="ml-1 text-[10px] not-italic text-muted-foreground/60">· vacía</span>{/if}
          </span>
          <span class="flex items-center gap-1 {isEmpty(layer) ? '' : 'opacity-0 group-hover:opacity-100'}">
            <button title="Subir" onclick={() => reorderLayer(layer.id, -1)} disabled={uiMode !== 'idle' || i === 0} class="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30">▲</button>
            <button title="Bajar" onclick={() => reorderLayer(layer.id, 1)} disabled={uiMode !== 'idle' || i === store.layers.length - 1} class="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30">▼</button>
            <button title="Renombrar" onclick={() => doRename(layer)} disabled={uiMode !== 'idle'} class="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30">✎</button>
            {#if isEditable(layer)}
              <button title="Editar forma" onclick={() => beginEdit(layer)} disabled={uiMode !== 'idle'} class="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30">⬡</button>
            {/if}
            <button title={isEmpty(layer) ? 'Eliminar (vacía)' : 'Eliminar'} onclick={() => doDelete(layer)} disabled={uiMode !== 'idle'} class="text-xs text-muted-foreground hover:text-red-400 disabled:opacity-30">🗑</button>
          </span>
        </li>
      {/each}

      {#if uiMode === 'idle'}
        <li>
          <button
            onclick={beginCreate}
            class="w-full rounded border border-dashed border-border/70 px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
          >
            ＋ nueva área…
          </button>
        </li>
      {/if}
    </ul>
  </aside>
</div>
