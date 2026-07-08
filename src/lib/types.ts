// Runtime layer model. `LayerMeta` is what lives in the manifest
// (`public/polygons/index.json`); `Layer` adds the in-memory geometry + toggle.

export interface LayerMeta {
  id: string;
  label: string;
  path: string;
  color: string;
  defaultVisible: boolean;
}

export interface Layer extends LayerMeta {
  visible: boolean;
  data: any; // GeoJSON FeatureCollection
}
