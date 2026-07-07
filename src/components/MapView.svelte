<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import maplibregl from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { polygonLayers, type PolygonLayer } from '../lib/layers';

  let mapContainer: HTMLDivElement;
  let map: maplibregl.Map | undefined;

  // Visibility state per layer id, seeded from each layer's defaultVisible.
  let visibility = $state<Record<string, boolean>>(
    Object.fromEntries(polygonLayers.map((l) => [l.id, l.defaultVisible]))
  );

  function sourceId(layer: PolygonLayer) {
    return `src-${layer.id}`;
  }
  function fillId(layer: PolygonLayer) {
    return `fill-${layer.id}`;
  }
  function lineId(layer: PolygonLayer) {
    return `line-${layer.id}`;
  }

  async function addLayer(m: maplibregl.Map, layer: PolygonLayer) {
    const res = await fetch(layer.path);
    const data = await res.json();

    m.addSource(sourceId(layer), { type: 'geojson', data });

    m.addLayer({
      id: fillId(layer),
      type: 'fill',
      source: sourceId(layer),
      paint: {
        'fill-color': ['coalesce', ['get', 'color'], '#ff8c42'],
        'fill-opacity': ['coalesce', ['get', 'fillOpacity'], 0.3],
      },
      layout: { visibility: visibility[layer.id] ? 'visible' : 'none' },
    });

    m.addLayer({
      id: lineId(layer),
      type: 'line',
      source: sourceId(layer),
      paint: {
        'line-color': ['coalesce', ['get', 'color'], '#ff8c42'],
        'line-width': 2,
      },
      layout: { visibility: visibility[layer.id] ? 'visible' : 'none' },
    });
  }

  function toggleLayer(id: string) {
    visibility[id] = !visibility[id];
    if (!map) return;
    const vis = visibility[id] ? 'visible' : 'none';
    const layer = polygonLayers.find((l) => l.id === id);
    if (!layer) return;
    if (map.getLayer(fillId(layer))) map.setLayoutProperty(fillId(layer), 'visibility', vis);
    if (map.getLayer(lineId(layer))) map.setLayoutProperty(lineId(layer), 'visibility', vis);
  }

  onMount(() => {
    map = new maplibregl.Map({
      container: mapContainer,
      // CartoCDN Voyager raster tiles — free, no API key required.
      style: {
        version: 8,
        sources: {
          carto: {
            type: 'raster',
            tiles: [
              'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
              'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
              'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
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

    map.on('load', async () => {
      for (const layer of polygonLayers) {
        await addLayer(map!, layer);
      }
    });
  });

  onDestroy(() => {
    map?.remove();
  });
</script>

<div class="relative h-screen w-screen">
  <div bind:this={mapContainer} class="h-full w-full"></div>

  <aside
    class="absolute top-4 left-4 z-10 w-64 rounded-(--radius-lg) border border-border bg-card/95 p-4 shadow-lg backdrop-blur-sm"
  >
    <h1 class="mb-1 text-sm font-extrabold text-foreground">syv-map</h1>
    <p class="mb-3 text-xs font-mono text-muted-foreground">Capas de polígonos</p>
    <ul class="space-y-2">
      {#each polygonLayers as layer (layer.id)}
        <li class="flex items-center gap-2">
          <input
            type="checkbox"
            id={layer.id}
            checked={visibility[layer.id]}
            onchange={() => toggleLayer(layer.id)}
            class="h-4 w-4 rounded border-border accent-primary"
          />
          <label for={layer.id} class="text-sm text-foreground">{layer.label}</label>
        </li>
      {/each}
    </ul>
  </aside>
</div>
