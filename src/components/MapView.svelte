<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import maplibregl from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode } from 'terra-draw';
  import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
  import type { Layer } from '../lib/types';
  import {
    store,
    loadLayers,
    createArea,
    renameLayer,
    recolorLayer,
    setGeometry,
    toggleVisible,
    removeLayer,
    isEditableArea,
  } from '../lib/mapStore.svelte';

  let mapContainer: HTMLDivElement;
  let map: maplibregl.Map | undefined;
  let draw: TerraDraw | undefined;
  let mapLoaded = $state(false);

  // ui session state: 'idle' | 'create' | 'edit'
  let uiMode = $state<'idle' | 'create' | 'edit'>('idle');
  let editingId = $state<string | null>(null);

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
      if (!map.getSource(srcId(layer.id))) {
        map.addSource(srcId(layer.id), { type: 'geojson', data: snapshot(layer.data) });
        map.addLayer({
          id: fillId(layer.id),
          type: 'fill',
          source: srcId(layer.id),
          paint: {
            'fill-color': ['coalesce', ['get', 'color'], '#ff8c42'],
            'fill-opacity': ['coalesce', ['get', 'fillOpacity'], 0.3],
          },
        });
        map.addLayer({
          id: lineId(layer.id),
          type: 'line',
          source: srcId(layer.id),
          paint: {
            'line-color': ['coalesce', ['get', 'color'], '#ff8c42'],
            'line-width': ['coalesce', ['get', 'weight'], 2],
          },
        });
        rendered.add(layer.id);
      } else {
        (map.getSource(srcId(layer.id)) as maplibregl.GeoJSONSource).setData(snapshot(layer.data));
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
    if (!draw || uiMode !== 'idle' || !isEditableArea(layer)) return;
    uiMode = 'edit';
    editingId = layer.id;
    draw.start();
    draw.setMode('select');
    const f = snapshot(layer.data.features[0]);
    f.id = crypto.randomUUID();
    f.properties = { ...f.properties, mode: 'polygon' };
    draw.addFeatures([f]);
  }

  function saveEdit() {
    if (!draw || uiMode !== 'edit' || !editingId) return;
    const poly = draw.getSnapshot().find((f: any) => f.geometry?.type === 'Polygon');
    if (poly) setGeometry(editingId, poly.geometry);
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
    if (window.confirm(`¿Eliminar "${layer.label}"?`)) removeLayer(layer.id);
  }

  onMount(async () => {
    map = new maplibregl.Map({
      container: mapContainer,
      style: {
        version: 8,
        sources: {
          carto: {
            type: 'raster',
            tiles: [
              'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
              'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
              'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
            ],
            tileSize: 256,
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributments">CARTO</a>',
          },
        },
        layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
      },
      center: [-58.376, -34.605],
      zoom: 14,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map, maplibregl }),
      modes: [
        new TerraDrawPolygonMode(),
        new TerraDrawSelectMode({
          flags: {
            polygon: {
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
    <p class="mb-3 text-xs font-mono text-muted-foreground">Áreas · regiones</p>

    {#if uiMode === 'idle'}
      <button
        onclick={beginCreate}
        class="mb-3 w-full rounded-md border border-primary/60 bg-primary/10 px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-primary/20"
      >
        ＋ Nueva área
      </button>
    {:else if uiMode === 'create'}
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
      {#each store.layers as layer (layer.id)}
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
          <span class="flex-1 truncate text-sm text-foreground">{layer.label}</span>
          <span class="flex items-center gap-1 opacity-0 group-hover:opacity-100">
            <button title="Renombrar" onclick={() => doRename(layer)} disabled={uiMode !== 'idle'} class="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30">✎</button>
            {#if isEditableArea(layer)}
              <button title="Editar forma" onclick={() => beginEdit(layer)} disabled={uiMode !== 'idle'} class="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30">⬡</button>
            {/if}
            <button title="Eliminar" onclick={() => doDelete(layer)} disabled={uiMode !== 'idle'} class="text-xs text-muted-foreground hover:text-red-400 disabled:opacity-30">🗑</button>
          </span>
        </li>
      {/each}
    </ul>
  </aside>
</div>
