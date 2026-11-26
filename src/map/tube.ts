/**
 * London Underground stations, drawn as TfL-style roundels in each line's
 * colour.
 *
 * These are landmarks, not venues. They never appear in the chips or the
 * published directory; they are context, so the reader can say "the pub is by
 * Angel" and see where Angel is. The data is a small static file built by
 * `npm run refresh:tube`, not a request-time query.
 *
 * One roundel per station, in its first line's colour. A segmented ring for
 * multi-line interchanges was tried and rejected: at phone size the segments
 * became mush, and every combination is another image to bake. The station name
 * underneath carries the rest.
 */
import type { GeoJSONSource, Map as MLMap, SymbolLayerSpecification } from "maplibre-gl";
import { svgToImage } from "./raster";

export interface TubeLine {
  id: string;
  name: string;
  colour: string;
}

export interface TubeStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  lines: string[];
  primary: string;
}

export interface TubeData {
  builtAt?: string;
  source?: string;
  lines: TubeLine[];
  stations: TubeStation[];
}

const SOURCE = "pampered-tube";
const ICONS = "pampered-tube-icons";
const LABELS = "pampered-tube-labels";
const UNKNOWN = "tube-unknown";
const HEX = /^#[0-9a-f]{6}$/i;

/** A roundel in one colour: white disc, coloured ring, coloured bar. The thin
    dark outlines are not decoration — Circle yellow and Waterloo & City teal
    are close enough to the cream disc that without them the ring disappears. */
export function roundelSvg(colour: string): string {
  const fill = HEX.test(colour) ? colour : "#6B7280";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <circle cx="24" cy="24" r="22" fill="#fffaf0" stroke="rgba(60,45,20,0.18)" stroke-width="1"/>
  <circle cx="24" cy="24" r="14" fill="none" stroke="${fill}" stroke-width="6"/>
  <rect x="5" y="20" width="38" height="8" fill="${fill}"/>
  <circle cx="24" cy="24" r="14" fill="none" stroke="rgba(40,30,10,0.32)" stroke-width="0.8"/>
  <rect x="5" y="20" width="38" height="8" fill="none" stroke="rgba(40,30,10,0.32)" stroke-width="0.8"/>
</svg>`;
}

/** Where our layers go: below the pins, above the basemap. `pampered-clusters`
    is created before the handle is handed out, so it is a reliable anchor. */
function beforePins(map: MLMap): string | undefined {
  return map.getLayer("pampered-clusters") ? "pampered-clusters" : undefined;
}

export async function addTubeLayers(map: MLMap, data: TubeData): Promise<void> {
  const stations = data.stations.filter(
    (s) => Number.isFinite(s.lat) && Number.isFinite(s.lon) && s.name,
  );
  if (!stations.length) return;

  const collection = {
    type: "FeatureCollection" as const,
    features: stations.map((s) => ({
      type: "Feature" as const,
      properties: {
        name: s.name,
        primary: s.primary,
        lines: s.lines.join(","),
        count: s.lines.length,
      },
      geometry: { type: "Point" as const, coordinates: [s.lon, s.lat] as [number, number] },
    })),
  };

  const existing = map.getSource(SOURCE) as GeoJSONSource | undefined;
  if (existing) {
    existing.setData(collection as never);
    return;
  }

  // The grey fallback goes in first, so the layer can appear after a single
  // rasterised image. Each line's colour is then added in turn: on a slow GPU
  // the eleven uploads take seconds, and a blank layer until the last one is
  // worse than grey roundels that gain their colour one line at a time.
  if (!map.hasImage(UNKNOWN)) {
    try {
      map.addImage(UNKNOWN, await svgToImage(roundelSvg("#6B7280"), 48), { pixelRatio: 2 });
    } catch {
      return;
    }
  }

  map.addSource(SOURCE, { type: "geojson", data: collection });

  const coloured = new Set<string>();
  // A match expression needs at least one label/value pair; with none, it is
  // invalid and MapLibre silently declines to add the layer. Start with the
  // plain fallback image and only switch to `match` once a colour exists.
  const iconImage = (): unknown => {
    if (!coloured.size) return UNKNOWN;
    const expr: unknown[] = ["match", ["get", "primary"]];
    for (const line of data.lines) {
      if (coloured.has(line.id)) expr.push(line.id, `tube-${line.id}`);
    }
    expr.push(UNKNOWN);
    return expr;
  };

  const before = beforePins(map);

  const icons: SymbolLayerSpecification = {
    id: ICONS,
    type: "symbol",
    source: SOURCE,
    // Visible at the default London overview (z10.6), where collision leaves a
    // readable subset and interchanges win the placement order. Zooming in
    // reveals the rest.
    minzoom: 10.5,
    layout: {
      "icon-image": iconImage() as never,
      "icon-size": ["interpolate", ["linear"], ["zoom"], 10.5, 0.55, 14, 0.8, 17, 1.05],
      "icon-allow-overlap": false,
      "icon-ignore-placement": false,
      "icon-padding": 2,
      "symbol-sort-key": ["-", ["get", "count"]],
    },
  };
  if (before) map.addLayer(icons, before);
  else map.addLayer(icons);

  const labels: SymbolLayerSpecification = {
    id: LABELS,
    type: "symbol",
    source: SOURCE,
    minzoom: 13,
    layout: {
      "text-field": ["get", "name"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 13, 10, 17, 13],
      "text-offset": [0, 1.35],
      "text-anchor": "top",
      "text-optional": true,
      "text-allow-overlap": false,
      "text-padding": 3,
    },
    paint: {
      "text-color": "#3b2f1d",
      "text-halo-color": "#fff7e8",
      "text-halo-width": 1.5,
    },
  };
  if (before) map.addLayer(labels, before);
  else map.addLayer(labels);

  for (const line of data.lines) {
    const id = `tube-${line.id}`;
    if (!map.hasImage(id)) {
      try {
        map.addImage(id, await svgToImage(roundelSvg(line.colour), 48), { pixelRatio: 2 });
      } catch {
        continue;
      }
    }
    coloured.add(line.id);
    try {
      map.setLayoutProperty(ICONS, "icon-image", iconImage() as never);
    } catch {
      // The layer was removed under us (style reload); the rest is moot.
      return;
    }
  }
}
