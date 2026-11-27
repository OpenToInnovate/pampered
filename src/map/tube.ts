/**
 * London's railway stations as landmark symbols: Underground roundels in each
 * line's colour, roundels in the network colour for Overground, the Elizabeth
 * line and the DLR, and the National Rail double arrow for the central
 * termini.
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

/** One icon per line: roundels for the Underground lines and the roundel
    networks, the double arrow for National Rail. */
export function iconSvgFor(line: { id: string; colour: string }): string {
  return line.id === "rail" ? railIconSvg(line.colour) : roundelSvg(line.colour);
}

/** Where the landmark layers go: before the basemap's first symbol layer.
    Symbol placement is granted in style order, so a layer added at the end
    loses every collision and, in central London, gets suppressed entirely —
    observed, not guessed. Placed this early, both landmark layers claim
    their space in the global placement pass — the roundels and, at higher
    zooms, the station labels too; the basemap's smaller labels work around
    them. The venue pins are circle layers and never collide anyway. */
function landmarkAnchor(map: MLMap): string | undefined {
  const layers = map.getStyle()?.layers ?? [];
  return layers.find((l) => l.type === "symbol" && !l.id.startsWith("pampered-"))?.id;
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

  const before = landmarkAnchor(map);

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
      "icon-size": ["interpolate", ["linear"], ["zoom"], 11.5, 0.55, 14, 0.8, 17, 1.05],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
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
        map.addImage(id, await svgToImage(iconSvgFor(line), 48), { pixelRatio: 2 });
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
