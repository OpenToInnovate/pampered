/**
 * London's railway stations as landmark symbols: one roundel colour per
 * network — red for the Underground, orange for the Overground, purple for the
 * Elizabeth line, teal for the DLR — and the National Rail double arrow for the
 * central termini.
 *
 * One colour per network, not one per Underground line. Eleven line colours at
 * 20–48 px read as noise, and the roundel's job is "a Tube station is here",
 * not "the Piccadilly line is here". The data still records each station's
 * lines; only the drawing collapses them.
 *
 * These are landmarks, not venues. They never appear in the chips or the
 * published directory; they are context, so the reader can say "the pub is by
 * Angel" and see where Angel is. The data is a small static file built by
 * `npm run refresh:tube`, not a request-time query.
 *
 * The marks are simplified likenesses, not reproductions: the roundel has no
 * lettering and the double arrow no serif, because at 20–48 px the text is
 * unreadable noise. What carries the identity is the silhouette and the
 * official colour.
 *
 * One mark per station, in its first line's colour. A segmented ring for
 * multi-line interchanges was tried and rejected: at phone size the segments
 * became mush, and every combination is another image to bake. The station
 * name underneath carries the rest.
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

/** The National Rail double arrow, simplified: two arrows in opposite
    directions, the shape station signage uses for heavy rail. Drawn in the
    network red on the same white disc as the roundels, so a terminus and a
    tube station read as the same kind of thing from the same distance. */
export function railIconSvg(colour: string): string {
  const fill = HEX.test(colour) ? colour : "#6B7280";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <circle cx="24" cy="24" r="22" fill="#fffaf0" stroke="rgba(60,45,20,0.18)" stroke-width="1"/>
  <g fill="${fill}">
    <rect x="17" y="15" width="20" height="5" rx="1"/>
    <polygon points="17,11 17,24 8,17.5"/>
    <rect x="11" y="28" width="20" height="5" rx="1"/>
    <polygon points="31,24 31,37 40,30.5"/>
  </g>
  <circle cx="24" cy="24" r="22" fill="none" stroke="rgba(40,30,10,0.32)" stroke-width="0.8"/>
</svg>`;
}

/** One icon per network: roundels for the Underground and the roundel
    networks, the double arrow for National Rail. */
export function iconSvgFor(type: string): string {
  const colour = TYPE_COLOUR[type] ?? "#6B7280";
  return type === "rail" ? railIconSvg(colour) : roundelSvg(colour);
}

const UNDERGROUND_LINES = new Set([
  "bakerloo",
  "central",
  "circle",
  "district",
  "hammersmith-city",
  "jubilee",
  "metropolitan",
  "northern",
  "piccadilly",
  "victoria",
  "waterloo-city",
]);

/** The colours the marks are drawn in. Underground red is the roundel's own
    red, not any one line's; National Rail keeps its double-arrow red. */
const TYPE_COLOUR: Record<string, string> = {
  tube: "#DC241F",
  overground: "#EE7C0E",
  elizabeth: "#6950A1",
  dlr: "#00AFAD",
  rail: "#DC241F",
};

/** Collapse a line id to the network whose mark it shares. */
export function typeOf(lineId: string): string {
  return UNDERGROUND_LINES.has(lineId) ? "tube" : lineId;
}

/** Landmarks paint last. Because the icons and names allow overlap, style
    order no longer decides whether they survive the placement pass — it only
    decides what covers what. Placed on top, a roundel is never hidden by a
    basemap shop icon or a street label when the reader has zoomed in to find
    the station. */
function raiseLandmarks(map: MLMap): void {
  if (map.getLayer(ICONS)) map.moveLayer(ICONS);
  if (map.getLayer(LABELS)) map.moveLayer(LABELS);
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
    raiseLandmarks(map);
    return;
  }

  // The grey fallback goes in first, so the layer can appear after a single
  // rasterised image; a mark with no colour is worse than a grey one.
  if (!map.hasImage(UNKNOWN)) {
    try {
      map.addImage(UNKNOWN, await svgToImage(roundelSvg("#6B7280"), 48), { pixelRatio: 2 });
    } catch {
      return;
    }
  }

  map.addSource(SOURCE, { type: "geojson", data: collection });

  // Five marks, one per network — not eleven Underground line colours.
  const types = new Set<string>(["tube", "overground", "elizabeth", "dlr", "rail"]);
  for (const line of data.lines) types.add(typeOf(line.id));
  for (const type of types) {
    const id = `tube-${type}`;
    if (map.hasImage(id)) continue;
    try {
      map.addImage(id, await svgToImage(iconSvgFor(type), 48), { pixelRatio: 2 });
    } catch {
      // Leave that network on the grey fallback.
    }
  }

  // A match expression needs at least one label/value pair; with none it is
  // invalid and MapLibre silently declines to add the layer. Every line id
  // needs its own pair, even though they share a type image: the expression
  // keys on the station's primary line, not on its network.
  const iconImage = (): unknown => {
    const expr: unknown[] = ["match", ["get", "primary"]];
    const seen = new Set<string>();
    for (const line of data.lines) {
      const image = `tube-${typeOf(line.id)}`;
      if (seen.has(line.id) || !map.hasImage(image)) continue;
      seen.add(line.id);
      expr.push(line.id, image);
    }
    if (expr.length === 3) return UNKNOWN;
    expr.push(UNKNOWN);
    return expr;
  };

  const icons: SymbolLayerSpecification = {
    id: ICONS,
    type: "symbol",
    source: SOURCE,
    // Hidden at the city overview so the pins own it; landmarks surface as the
    // reader zooms in.
    //
    // allow-overlap is on and that is deliberate: MapLibre places symbols in a
    // single global pass (viewport y-order, every layer together), so with
    // collision on the basemap's shop icons and street labels cull our
    // roundels first — in the Docklands run, twelve DLR stations rendered as
    // zero roundels. Two neighbouring roundels touching is the honest
    // condition (the stations really are that close); a landmark that vanishes
    // is not.
    minzoom: 11.5,
    layout: {
      "icon-image": iconImage() as never,
      // A touch larger than a basemap POI: the roundel is a landmark and the
      // station name sits under it.
      "icon-size": ["interpolate", ["linear"], ["zoom"], 11.5, 0.7, 14, 0.95, 17, 1.25],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  };
  map.addLayer(icons);

  const labels: SymbolLayerSpecification = {
    id: LABELS,
    type: "symbol",
    source: SOURCE,
    minzoom: 13,
    layout: {
      "text-field": ["get", "name"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 13, 12, 17, 15],
      "text-offset": [0, 1.35],
      "text-anchor": "top",
      // The name is the point of the mark, so it always draws, even when two
      // stations are close. The halo keeps overlapping names legible.
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "text-padding": 2,
    },
    paint: {
      "text-color": "#3b2f1d",
      "text-halo-color": "#fff7e8",
      "text-halo-width": 2,
    },
  };
  map.addLayer(labels);

  // Paint above every basemap layer: zoomed in, the station mark and its name
  // are the thing the reader is looking for.
  raiseLandmarks(map);
}
