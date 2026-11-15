// GeoJSON-style export.
// Local meter coordinates are reprojected to lon/lat around a Shanghai anchor
// using an equirectangular approximation valid for city-scale data.

export const GEO_ORIGIN = { lon: 121.4737, lat: 31.2304 };
const METERS_PER_DEG_LAT = 111320;

export function toLonLat(point) {
  const latRad = GEO_ORIGIN.lat * Math.PI / 180;
  return [
    +(GEO_ORIGIN.lon + point.x / (METERS_PER_DEG_LAT * Math.cos(latRad))).toFixed(7),
    +(GEO_ORIGIN.lat + point.y / METERS_PER_DEG_LAT).toFixed(7),
  ];
}

export function buildGeoJson(city, labels) {
  return {
    type: 'FeatureCollection',
    name: 'procedural-city-map',
    crs: {
      type: 'name',
      properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' },
    },
    features: [
      {
        type: 'Feature',
        id: 'route',
        properties: {
          kind: 'route',
          lengthMeters: Math.round(city.route.reduce((sum, p, i) => {
            if (i === 0) return 0;
            const prev = city.route[i - 1];
            return sum + Math.hypot(p.x - prev.x, p.y - prev.y);
          }, 0)),
          nodeCount: city.route.length,
        },
        geometry: {
          type: 'LineString',
          coordinates: city.route.map(toLonLat),
        },
      },
      ...labels.map((label) => ({
        type: 'Feature',
        id: label.id,
        properties: {
          kind: 'annotation',
          name: label.name,
          pinned: label.pinned,
          worldAnchor: { x: label.anchor.x, y: label.anchor.y },
        },
        geometry: {
          type: 'Point',
          coordinates: toLonLat(label.anchor),
        },
      })),
    ],
  };
}

export function downloadJson(data, filename = 'city-map.json') {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/geo+json',
  });
  triggerDownload(URL.createObjectURL(blob), filename);
}

export { renderHighResolutionPng } from './pngexport.js';

export function downloadCanvas(canvas, filename = 'city-map.png', pixelRatio = 3) {
  const exported = renderHighResolutionPng(canvas, pixelRatio);
  triggerDownload(exported.toDataURL('image/png'), filename);
}

function triggerDownload(href, filename) {
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.click();
}
