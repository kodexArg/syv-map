// Convention: every polygon layer is a GeoJSON file dropped in `public/polygons/`.
// Register it here (id, display label, file path, default visibility) and it
// shows up in the sidebar with a visibility toggle. No other wiring needed.

export interface PolygonLayer {
  id: string;
  label: string;
  path: string;
  defaultVisible: boolean;
}

export const polygonLayers: PolygonLayer[] = [
  {
    id: 'sample',
    label: 'Ejemplo (cuadrado)',
    path: '/polygons/sample.geojson',
    defaultVisible: true,
  },
  {
    id: 'ciudad-darsena',
    label: 'Ciudad Dársena (barrios)',
    path: '/polygons/ciudad-darsena.geojson',
    defaultVisible: true,
  },
];
