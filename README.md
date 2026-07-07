# syv-map

Sandbox de mapas para probar polígonos rápido. Astro + Svelte + MapLibre GL JS,
sin backend, sin auth, sin deploy config. Un solo propósito: dibujar polígonos
sobre un mapa y poder intercambiarlos sin tocar código.

## Cómo correr

```bash
npm install
npm run dev
```

Abre `http://localhost:4321`. El mapa centra en Ciudad Dársena
(`-34.6050, -58.3760`, zoom 14) sobre tiles raster de CartoDB Voyager
(gratis, sin API key).

Alternativa (recomendada por el harness de este repo): correr el server en
background con `npx astro dev --background`, y gestionarlo con
`astro dev stop` / `astro dev status` / `astro dev logs`.

## Cómo agregar un polígono

1. Poné el `.geojson` en `public/polygons/`. Formato `FeatureCollection`
   estándar; cada `Feature` puede llevar en `properties`: `name`, `color`
   (hex o nombre CSS) y `fillOpacity` (0–1). Si falta alguna, cae a un color
   naranja por defecto y opacidad 0.3.
2. Registrá la capa en `src/lib/layers.ts` — `id`, `label`, `path` (la ruta
   pública, ej. `/polygons/mi-archivo.geojson`) y `defaultVisible`.
3. Recargá. Aparece en el panel lateral con su checkbox de visibilidad.

No hace falta tocar `MapView.svelte`: itera sobre `polygonLayers` y agrega
fuente + capas de relleno/borde por cada entrada.

### Capas de ejemplo incluidas

- `sample.geojson` — un cuadrado sintético cerca de Dársena, para probar el
  flujo sin depender de datos reales.
- `ciudad-darsena.geojson` — copia de los polígonos reales de barrios de
  Ciudad Dársena (`syv-docs/2_atlas/ciudades/darsena/mapa/ciudad-darsena.map.json`).
  Es una copia congelada — actualizala a mano si el original cambia; este
  repo no la sincroniza automáticamente ni escribe de vuelta a `syv-docs`.

## Cómo cambiar el basemap

El estilo del mapa está inline en `src/components/MapView.svelte`, en el
`style` que se le pasa a `new maplibregl.Map(...)`. Es un estilo MapLibre
mínimo con una sola fuente raster (CartoDB Voyager). Para cambiar de basemap:

- Otro raster gratis: reemplazá las URLs de `tiles` (ej. tiles de OSM directo).
- Un estilo vectorial completo: cambiá el objeto `style` por una URL a un
  `style.json` (ej. un estilo demo de MapLibre o uno propio hosteado).

## Stack (versiones resueltas al scaffoldear)

| Paquete | Versión |
|---|---|
| astro | ^7.0.6 |
| @astrojs/svelte | ^9.0.1 |
| svelte | ^5.56.4 (runes) |
| @tailwindcss/vite + tailwindcss | ^4.3.2 |
| maplibre-gl | ^5.24.0 |

El panel lateral (toggle de capas) está escrito a mano con Tailwind — no se
usó el CLI de `shadcn-svelte` porque su flujo `init` (v1.3.0) quedó atado a
un prompt interactivo de selección de preset que no acepta input no-interactivo
limpio. Para un solo panel de checkboxes no valía la pena pelear el flujo;
si más adelante hace falta un design system completo, correr
`npx shadcn-svelte@latest init` a mano (interactivo) y migrar el panel.
