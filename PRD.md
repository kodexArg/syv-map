# PRD — SyV Map

> Documento vivo. Fija la visión y el modelo de dominio de **SyV Map**.
> Playground editable; se revisa a medida que el mapa crece.

## Visión

**SyV Map es el mapa en creación de _Subordinación y Valor_.** Empieza — y por
ahora se concentra — en **Ciudad Dársena**. Es, de hecho, el mapa de Dársena.

Acá empezamos a contar la historia de este universo: el mapa no ilustra el lore,
lo **origina**. Por eso arrancamos por acá. Lo que se dibuje y se nombre en este
mapa es materia prima del corpus, no decoración.

El objetivo no es un visor estático sino una **aplicación completa de
visualización y edición continua**: abrir el mapa, verlo, y editarlo todo el
tiempo como quien escribe.

## Estado actual → objetivo

| Hoy | Objetivo |
|---|---|
| Sandbox de polígonos: GeoJSON estáticos + toggles de visibilidad | Editor cartográfico completo, siempre editable |
| Una sola primitiva de facto (regiones/muros como polígonos y líneas) | Tres primitivas con mecánicas propias |
| Sin persistencia (se edita el archivo a mano) | Los cambios persisten como parte del flujo |
| Copia congelada de Dársena desde `syv-docs` | Superficie primaria donde nace la geografía del universo |

## Modelo de dominio — tres primitivas

Todo lo que vive en el mapa es una de **tres entidades**. No se distinguen por su
geometría sino por su **mecánica**: qué significan y qué se puede hacer con ellas.
Dos primitivas pueden compartir forma (una línea) y ser cosas distintas.

### 1 · Región (área · zona)

Una **porción de territorio**: delimita, pertenece, contiene. Su mecánica es la
**pertenencia** — algo está *dentro* o *fuera* de ella, y puede anidar
(barrios dentro de la ciudad) o solaparse.

- **Geometría:** normalmente un polígono cerrado; **también una línea abierta**
  cuando la región es una frontera o un muro (ver «El caso del Muro»).
- **Estilo:** relleno + borde (`color`, `fillOpacity`, `weight`).
- **Ejemplos en Dársena:** Centro, Zona Militar Norte, Barrio de la Armada,
  Barrio de Pescadores, Isla Oriental, y la **Muralla**.

### 2 · Lugar (punto)

Un **punto singular** con nombre: un edificio, un hito, un acceso. Su mecánica es
la **ubicación puntual** — no tiene interior ni recorrido, es un *dónde*.

- **Geometría:** un punto.
- **Estilo:** ícono + etiqueta; pertenece a una región.
- **Ejemplos:** la Iglesia de la Isla Oriental, un puerto, un cuartel, una taberna.
- **Estado:** primitiva **nueva** (aún no existe en la fuente).

### 3 · Ruta (camino · recorrido)

Una **conexión** entre lugares o a través del territorio: una calle, una vía
marítima, una ronda. Su mecánica es el **recorrido** — une, se transita, tiene
largo y (opcional) sentido.

- **Geometría:** una línea (con waypoints).
- **Estilo:** trazo, sin relleno; posibles flechas de sentido.
- **Ejemplos:** una avenida, una línea de patrulla, una ruta de contrabando.
- **Estado:** primitiva **nueva** (aún no existe en la fuente).

### Tabla-resumen

| Primitiva | Geometría | Mecánica | Estilo | Edición |
|---|---|---|---|---|
| **Región** | polígono · o línea-frontera | pertenencia / delimitar | relleno + borde | dibujar área, arrastrar vértices, cerrar o dejar abierta |
| **Lugar** | punto | ubicación puntual | ícono + etiqueta | soltar pin, arrastrar para mover |
| **Ruta** | línea + waypoints | recorrido / conexión | trazo | trazar polilínea, agregar/quitar/mover waypoints |

## El caso del Muro

El Muro **es una región** — entra en la primitiva Región, no en Ruta — aunque
geométricamente sea una **línea abierta**. Se usa para fronteras y para muros
reales. Esto fuerza dos reglas del modelo:

1. **Región no implica polígono cerrado.** Una región puede tener geometría
   lineal cuando su rol es delimitar/separar (una «región abierta»: frontera).
2. **Mecánica sobre geometría.** Muro (línea) y Ruta (línea) comparten forma pero
   son primitivas distintas: el Muro **divide** territorio (pertenencia), la Ruta
   **conecta** (recorrido). El editor las trata como cosas separadas.

## Capacidades de la app

- **Visualizar:** capas por entidad, toggles de visibilidad, base map oscuro,
  centrado en Dársena.
- **Editar (siempre activo):** crear / mover / borrar cada primitiva con sus
  mecánicas propias — motor de dibujo sobre MapLibre (candidato: **Terra Draw**,
  adapter nativo para MapLibre 5, GeoJSON-nativo).
- **Persistir:** los cambios sobreviven a la recarga (ver abajo).

## Persistencia — decisión abierta

La app es estática (sin backend); los GeoJSON viven en `public/polygons/`. Editar
en el navegador es fácil; **guardar es el trabajo real.** Dos caminos:

- **A — exportar:** botón que descarga el GeoJSON editado; el archivo se reemplaza
  a mano. Cero infraestructura, portable.
- **B — endpoint de dev:** un route que escribe directo a disco durante `bun dev`;
  los cambios **persisten solos**. Sólo local, agrega superficie de escritura.

Dado el objetivo de «editar todo el tiempo», **B** encaja mejor para el flujo de
autoría local, con **A** como salida portable / puente al corpus. _Pendiente de
confirmar._

## Relación con syv-docs (SSOT) — pregunta abierta

Hoy Dársena en este repo es **copia congelada** de
`syv-docs/2_atlas/ciudades/darsena/mapa/`. Si SyV Map pasa a ser la superficie
donde **nace** la geografía, hay que definir cómo devuelve al corpus (que es la
SSOT del lore). Opciones a decidir: sincronización manual con permiso, exportación
que un agente ingiere al vault, o que el `.map.json` del corpus sea el destino
directo. **No se decide unilateralmente: toca la SSOT.**

## No-objetivos (por ahora)

- Backend, auth, multiusuario, edición colaborativa en vivo.
- Tiles propios / pagos (seguimos con raster gratis de CartoDB).
- Publicación/deploy del editor (el editor es local; el visor podrá publicarse).

## Stack

Astro 7 (islas) · Svelte 5 (runes) · MapLibre GL 5 · Tailwind 4 · bun. Detalle y
versiones en `README.md`. Convención de capas: un GeoJSON en `public/polygons/`
registrado en `src/lib/layers.ts`.

## Fases

1. **Taxonomía de datos** — separar el modelo en las tres primitivas; hoy todo es
   «capa de polígono». Región primero (ya existe), luego Lugar y Ruta.
2. **Motor de edición** — integrar Terra Draw; editar Regiones (incl. muros).
3. **Lugares y Rutas** — agregar las dos primitivas nuevas con sus mecánicas.
4. **Persistencia** — resolver A/B y cablear el guardado.
5. **Puente al corpus** — definir y construir el flujo hacia `syv-docs`.
