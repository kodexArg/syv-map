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
    openAsWall,
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

  // ui session state: 'idle' | 'create' | 'edit' | 'open'
  let uiMode = $state<'idle' | 'create' | 'edit' | 'open'>('idle');
  let editingId = $state<string | null>(null);
  // región whose border is being opened into a muro (uiMode === 'open')
  let openingId = $state<string | null>(null);
  // maps each Terra Draw feature back to its original index in the layer
  let editFeatureIds: { origIndex: number; terraId: string }[] = [];

  const rendered = new Set<string>();
  const srcId = (id: string) => `src-${id}`;
  const fillId = (id: string) => `fill-${id}`;
  const lineId = (id: string) => `line-${id}`;
  // overlay que muestra los vértices mientras se abre una región en un muro
  const OPEN_VTX_SRC = 'open-vtx';
  const OPEN_VTX_LAYER = 'open-vtx-dots';

  function snapshot(v: any) {
    return JSON.parse(JSON.stringify(v));
  }

  // --- el Cuerpo de Hielo: impacto hardcodeado -------------------------------
  // Punto y zonas de efecto del meteorito de 2039 (el Cuerpo de Hielo),
  // transcriptos de ~/Documents/maps/mapa_impacto_buenos_aires.html. Coordenadas
  // reales de Buenos Aires. Es contexto fijo del universo: no vive en el store
  // ni en localStorage, no se edita ni se borra — siempre está, debajo de las
  // regiones de Dársena. El centro cae ~14 km al NO de Dársena, que por eso
  // queda justo sobre el borde de la zona amarilla.
  const IMPACT_CENTER: [number, number] = [-58.5168464, -34.5554235];
  const IMPACT_ZONES = [
    { radius: 35000, color: '#008000', fillOpacity: 0.2, label: '35 km' }, // verde
    { radius: 14000, color: '#ffd700', fillOpacity: 0.3, label: '14 km' }, // amarillo
    { radius: 6400, color: '#ff8c00', fillOpacity: 0.4, label: '6,4 km' }, // naranja
    { radius: 1400, color: '#ff0000', fillOpacity: 0.5, label: '1,4 km' }, // rojo
    { radius: 800, color: '#333333', fillOpacity: 0.8, label: 'Cráter · 800 m' }, // cráter
  ];

  // El impacto es un GRUPO toggleable aparte de las regiones: su botón prende y
  // apaga las cinco zonas juntas. Sigue siendo contexto fijo (no editable, no en
  // el store) — sólo se le agrega visibilidad conmutable. Arranca APAGADO: es el
  // estado canónico elegido (el mapa se lee limpio; se enciende bajo demanda).
  let impactVisible = $state(false);
  function toggleImpact() {
    impactVisible = !impactVisible;
  }
  function applyImpactVisibility() {
    if (!map || !mapLoaded) return;
    const vis = impactVisible ? 'visible' : 'none';
    for (const id of ['impacto-meteorito-fill', 'impacto-meteorito-line']) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
    }
  }
  // Re-aplica cuando cambia el toggle o cuando el mapa termina de cargar (las
  // capas del impacto se agregan recién en addImpactOverlay, tras mapLoaded).
  $effect(() => {
    impactVisible;
    mapLoaded;
    applyImpactVisibility();
  });

  // Aproxima un círculo geodésico como anillo poligonal de `steps` puntos.
  // Suficiente (<0.5% de error a escala urbana) para las cinco zonas sin
  // depender de turf. Radio en metros; devuelve coords GeoJSON [lon, lat].
  function circlePolygon(lon: number, lat: number, radiusM: number, steps = 96): number[][][] {
    const R = 6378137; // radio terrestre (m)
    const latR = (lat * Math.PI) / 180;
    const lonR = (lon * Math.PI) / 180;
    const d = radiusM / R; // distancia angular
    const ring: number[][] = [];
    for (let i = 0; i <= steps; i++) {
      const brng = (i / steps) * 2 * Math.PI;
      const lat2 = Math.asin(
        Math.sin(latR) * Math.cos(d) + Math.cos(latR) * Math.sin(d) * Math.cos(brng),
      );
      const lon2 =
        lonR +
        Math.atan2(
          Math.sin(brng) * Math.sin(d) * Math.cos(latR),
          Math.cos(d) - Math.sin(latR) * Math.sin(lat2),
        );
      ring.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
    }
    return [ring];
  }

  // Dibuja las zonas de impacto como una capa fija. Un solo source con las cinco
  // features en orden mayor→menor: dentro de la capa, la última (el cráter) queda
  // arriba. Color/opacidad data-driven por feature, igual que las regiones. Las
  // regiones del store se moveLayer() al tope en cada sync, así que esto queda
  // siempre de fondo.
  function addImpactOverlay(m: maplibregl.Map) {
    if (m.getSource('impacto-meteorito')) return;
    const features = IMPACT_ZONES.map((z) => ({
      type: 'Feature' as const,
      properties: { color: z.color, fillOpacity: z.fillOpacity },
      geometry: {
        type: 'Polygon' as const,
        coordinates: circlePolygon(IMPACT_CENTER[0], IMPACT_CENTER[1], z.radius),
      },
    }));
    m.addSource('impacto-meteorito', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
    });
    m.addLayer({
      id: 'impacto-meteorito-fill',
      type: 'fill',
      source: 'impacto-meteorito',
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'fillOpacity'] },
    });
    m.addLayer({
      id: 'impacto-meteorito-line',
      type: 'line',
      source: 'impacto-meteorito',
      paint: { 'line-color': ['get', 'color'], 'line-width': 1, 'line-opacity': 0.6 },
    });
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
            // dotted/dashed via properties.lineStyle (default solid)
            'line-dasharray': [
              'match',
              ['coalesce', ['get', 'lineStyle'], 'solid'],
              'dotted',
              ['literal', [0.8, 1.6]],
              'dashed',
              ['literal', [2, 2]],
              ['literal', [1, 0]],
            ],
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

  // --- abrir región → muro ---------------------------------------------------
  // Enter "open" mode for a closed región: the next click on a vertex cuts the
  // ring there and the área becomes an open-line muro. Terra Draw stays off; we
  // use a raw MapLibre click + nearest-vertex hit test (in pixels).
  function beginOpen(layer: Layer) {
    if (uiMode !== 'idle' || !hasArea(layer)) return;
    uiMode = 'open';
    openingId = layer.id;
    if (map) map.getCanvas().style.cursor = 'crosshair';
    showOpenVertices(layer);
  }

  function endOpenSession() {
    uiMode = 'idle';
    openingId = null;
    if (map) map.getCanvas().style.cursor = '';
    hideOpenVertices();
  }

  // draw every outer-ring vertex of the opening región as a clickable dot, so
  // the user can see exactly where the ring can be cut. Same vertex set the
  // hit test uses, so what you see is what you can click.
  function showOpenVertices(layer: Layer) {
    if (!map) return;
    const feats: any[] = [];
    for (const f of layer.data.features ?? []) {
      const g = f?.geometry;
      const ring: number[][] | undefined =
        g?.type === 'Polygon' ? g.coordinates?.[0] : g?.type === 'MultiPolygon' ? g.coordinates?.[0]?.[0] : undefined;
      if (!ring || ring.length < 4) continue;
      const n = ring.length;
      const closed = ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1];
      const v = closed ? ring.slice(0, -1) : ring;
      for (const c of v) feats.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [c[0], c[1]] } });
    }
    const data = { type: 'FeatureCollection', features: feats };
    if (!map.getSource(OPEN_VTX_SRC)) {
      map.addSource(OPEN_VTX_SRC, { type: 'geojson', data } as any);
    } else {
      (map.getSource(OPEN_VTX_SRC) as maplibregl.GeoJSONSource).setData(data as any);
    }
    if (!map.getLayer(OPEN_VTX_LAYER)) {
      map.addLayer({
        id: OPEN_VTX_LAYER,
        type: 'circle',
        source: OPEN_VTX_SRC,
        paint: {
          'circle-radius': 5,
          'circle-color': '#ff8c42',
          'circle-stroke-color': '#0d0d0d',
          'circle-stroke-width': 2,
        },
      });
    } else {
      map.setLayoutProperty(OPEN_VTX_LAYER, 'visibility', 'visible');
    }
    map.moveLayer(OPEN_VTX_LAYER); // always on top of the regions
  }

  function hideOpenVertices() {
    if (!map) return;
    if (map.getLayer(OPEN_VTX_LAYER)) map.setLayoutProperty(OPEN_VTX_LAYER, 'visibility', 'none');
    if (map.getSource(OPEN_VTX_SRC))
      (map.getSource(OPEN_VTX_SRC) as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: [] } as any);
  }

  // find the polygon vertex of the opening layer nearest to the click (≤ 18px)
  // and open the ring there; otherwise ignore the click and stay in the mode.
  function onOpenClick(e: maplibregl.MapMouseEvent) {
    if (uiMode !== 'open' || !openingId || !map) return;
    const layer = store.layers.find((l) => l.id === openingId);
    if (!layer) return;
    const feats = layer.data.features ?? [];
    let best = { d: Infinity, fi: -1, vi: -1 };
    for (let fi = 0; fi < feats.length; fi++) {
      const g = feats[fi]?.geometry;
      const ring: number[][] | undefined =
        g?.type === 'Polygon' ? g.coordinates?.[0] : g?.type === 'MultiPolygon' ? g.coordinates?.[0]?.[0] : undefined;
      if (!ring || ring.length < 4) continue;
      const n = ring.length;
      const closed = ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1];
      const v = closed ? ring.slice(0, -1) : ring;
      for (let vi = 0; vi < v.length; vi++) {
        const p = map.project([v[vi][0], v[vi][1]] as [number, number]);
        const d = Math.hypot(p.x - e.point.x, p.y - e.point.y);
        if (d < best.d) best = { d, fi, vi };
      }
    }
    if (best.fi < 0 || best.d > 18) return; // missed every vertex — keep waiting
    const id = openingId;
    endOpenSession();
    openAsWall(id, best.fi, best.vi).then(() => syncMap());
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
    if (
      window.confirm(
        '¿Reimportar public/polygons a SQLite y descartar el estado actual de la base?',
      )
    )
      resetToCanon();
  }

  onMount(async () => {
    // One-shot: drop legacy localStorage so it never shadows SQLite again.
    try {
      localStorage.removeItem('syv-map:layers:v1');
    } catch {
      /* ignore */
    }

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
    map.on('click', onOpenClick);

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
    // fondo fijo del universo, antes de sembrar las regiones editables
    addImpactOverlay(map);
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
        {store.savedAt ? 'SQLite ✓' : 'Áreas · regiones'}
      </p>
      <button
        onclick={doReset}
        title="Reimportar public/polygons → SQLite"
        disabled={uiMode !== 'idle'}
        class="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
      >↺ Restaurar</button>
    </div>
    {#if store.error}
      <p class="mb-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-200">
        {store.error}
      </p>
    {/if}

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
    {:else if uiMode === 'open'}
      <div class="mb-3 rounded-md border border-primary/60 bg-primary/10 p-2">
        <p class="mb-2 text-xs text-foreground">Hacé clic en un vértice del polígono para <strong>abrir el muro</strong> ahí. La zona pierde el relleno y pasa a ser un muro (línea), con la abertura en ese punto.</p>
        <button onclick={endOpenSession} class="w-full rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-muted/40">Cancelar</button>
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
            {#if hasArea(layer)}
              <button title="Abrir en un vértice → muro" onclick={() => beginOpen(layer)} disabled={uiMode !== 'idle'} class="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30">✂</button>
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

    <!-- Grupo fijo del universo: el impacto del Cuerpo de Hielo (2039). Un solo
         toggle prende/apaga sus cinco zonas juntas; no se edita ni se guarda. -->
    <div class="mt-3 border-t border-border pt-3">
      <div class="flex items-center gap-2">
        <input
          type="checkbox"
          checked={impactVisible}
          onchange={toggleImpact}
          class="h-4 w-4 rounded border-border accent-primary"
        />
        <span class="flex-1 truncate text-sm font-semibold text-foreground">Cuerpo de Hielo · 2039</span>
        <span class="text-[10px] font-mono text-muted-foreground">impacto</span>
      </div>
      <ul class="mt-1.5 space-y-0.5 pl-6 transition-opacity {impactVisible ? '' : 'opacity-40'}">
        <li class="mb-0.5 text-[10px] font-mono uppercase tracking-wide text-muted-foreground/70">Zonas de efecto</li>
        {#each IMPACT_ZONES as z (z.radius)}
          <li class="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span class="h-2.5 w-2.5 shrink-0 rounded-full border border-border" style={`background:${z.color}`}></span>
            <span>{z.label}</span>
          </li>
        {/each}
      </ul>
    </div>
  </aside>
</div>
