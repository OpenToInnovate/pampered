/**
 * The sepia map treatment, applied on top of the OpenFreeMap style.
 *
 * The base style is OpenFreeMap's `liberty` variant: unlike the old `positron`
 * it carries a `poi` source-layer, which is where railway stations, bus stops
 * and airports live. Without it, landmarks simply do not exist in the tiles and
 * no amount of styling summons them.
 *
 * Two things happen here, both safe by construction: every override is wrapped
 * so a missing layer id can never fail the map, and every colour that should
 * feel "more alive up close" is a zoom interpolation — muted sepia for the
 * country overview, saturated for the street. Selection pin colours are data
 * from selections.yaml and are deliberately not touched.
 */
import type { Map as MLMap } from "maplibre-gl";

/** A zoom ramp: muted at z0, vibrant at z1 — "more colourful as you zoom in". */
const ramp = (low: string, high: string, z0 = 10.5, z1 = 15): unknown => [
  "interpolate",
  ["linear"],
  ["zoom"],
  z0,
  low,
  z1,
  high,
];

type Paints = Record<string, unknown>;

/** Land layers. Parks and woods are green at every zoom — soft on the
    overview, bright up close — because a park that reads as sand is a park
    nobody can find. Water goes blue the same way. */
const FILLS: Record<string, Paints> = {
  background: { "background-color": ramp("#f1e8d8", "#f6ecd9") },
  park: {
    "fill-color": ramp("#d7e8b5", "#a8d568"),
    "fill-outline-color": "#8fb84e",
  },
  park_outline: { "line-color": "#8fb84e" },
  landuse_residential: { "fill-color": ramp("#ece2cd", "#f0e3c6") },
  landcover_wood: { "fill-color": ramp("#dbe7c0", "#7fb757") },
  landcover_grass: { "fill-color": ramp("#d7e8b5", "#9ccd63") },
  landcover_sand: { "fill-color": ramp("#ead9b8", "#e8c88f") },
  water: { "fill-color": ramp("#b5ccda", "#58a7d8") },
  waterway_river: { "line-color": ramp("#a9c6d8", "#4f97d8") },
  waterway_other: { "line-color": ramp("#a9c6d8", "#4f97d8") },
  waterway_tunnel: { "line-color": ramp("#b3cadb", "#6aa8d4") },
  building: {
    "fill-color": ramp("#e7d9bd", "#dcc39a"),
    "fill-outline-color": ramp("#d6c3a0", "#c2a97e"),
  },
  aeroway_fill: { "fill-color": "#f3ecd9" },
  aeroway_runway: { "line-color": "#e9dfc6" },
  aeroway_taxiway: { "line-color": "#eee4cd" },
};

/** Roads and rails: casings warm brown, arteries going amber up close. */
const LINES: Record<string, Paints> = {
  road_minor_casing: { "line-color": ramp("#d9cbae", "#cdbb98") },
  road_minor: { "line-color": ramp("#efe7d4", "#f2e4c8") },
  road_link_casing: { "line-color": ramp("#d3c3a4", "#c9b18b") },
  road_link: { "line-color": ramp("#f4ead3", "#f7dfae") },
  road_secondary_tertiary_casing: { "line-color": ramp("#cfc0a0", "#c4ae86") },
  road_secondary_tertiary: { "line-color": ramp("#f8efda", "#ffdba6") },
  road_trunk_primary_casing: { "line-color": ramp("#c9b795", "#bd9f74") },
  road_trunk_primary: { "line-color": ramp("#fdf6e7", "#ffd9a3") },
  road_motorway_casing: { "line-color": ramp("#c9b795", "#b8946a") },
  road_motorway: { "line-color": ramp("#f3e3c2", "#f2a95c") },
  road_motorway_link_casing: { "line-color": ramp("#c9b795", "#b8946a") },
  road_motorway_link: { "line-color": ramp("#f3e3c2", "#f2a95c") },
  road_service_track_casing: { "line-color": ramp("#dccfb2", "#d0bd9b") },
  road_service_track: { "line-color": ramp("#efe7d4", "#efe2c4") },
  road_path_pedestrian: { "line-color": ramp("#e4d9c0", "#e0d3b2") },
  // Rail gets its own hue on purpose: violet is the one colour nothing else
  // on the map claims, so a train line is readable as a train line before the
  // stations' icons even load. Every surface, tunnel and bridge variant needs
  // it, or a railway changes colour the moment it dips underground.
  road_major_rail: { "line-color": ramp("#b4a6cc", "#7a5aa8") },
  road_major_rail_hatching: { "line-color": ramp("#a393bf", "#68498f") },
  road_transit_rail: { "line-color": ramp("#b4a6cc", "#7a5aa8") },
  road_transit_rail_hatching: { "line-color": ramp("#a393bf", "#68498f") },
  tunnel_major_rail: { "line-color": ramp("#b4a6cc", "#7a5aa8") },
  tunnel_major_rail_hatching: { "line-color": ramp("#a393bf", "#68498f") },
  tunnel_transit_rail: { "line-color": ramp("#b4a6cc", "#7a5aa8") },
  tunnel_transit_rail_hatching: { "line-color": ramp("#a393bf", "#68498f") },
  bridge_major_rail: { "line-color": ramp("#b4a6cc", "#7a5aa8") },
  bridge_major_rail_hatching: { "line-color": ramp("#a393bf", "#68498f") },
  bridge_transit_rail: { "line-color": ramp("#b4a6cc", "#7a5aa8") },
  bridge_transit_rail_hatching: { "line-color": ramp("#a393bf", "#68498f") },
  tunnel_motorway_casing: { "line-color": ramp("#cfc0a0", "#c2a67e") },
  tunnel_motorway: { "line-color": ramp("#f0e2c4", "#e9b574") },
  tunnel_trunk_primary_casing: { "line-color": ramp("#cfc0a0", "#c2a67e") },
  tunnel_trunk_primary: { "line-color": ramp("#f6ecd5", "#f2c98c") },
  tunnel_secondary_tertiary: { "line-color": ramp("#f2e7cd", "#f0cf9c") },
  tunnel_minor: { "line-color": ramp("#ece3cc", "#e8dab8") },
  bridge_motorway_casing: { "line-color": ramp("#c9b795", "#b8946a") },
  bridge_motorway: { "line-color": ramp("#f3e3c2", "#f2a95c") },
  bridge_trunk_primary: { "line-color": ramp("#fdf6e7", "#ffd9a3") },
  bridge_secondary_tertiary: { "line-color": ramp("#f8efda", "#ffdba6") },
  boundary_3: { "line-color": ramp("#b3a284", "#a3906f") },
  boundary_2: { "line-color": ramp("#b3a284", "#a3906f") },
};

/** Label ink: sepia text on cream halos, water labels keeping their teal. */
const LABELS: Record<string, Paints> = {
  label_country_1: { "text-color": "#8a6d4b" },
  label_country_2: { "text-color": "#8a6d4b" },
  label_country_3: { "text-color": "#8a6d4b" },
  label_state: { "text-color": "#7d6442" },
  label_city: { "text-color": "#4a3820", "text-halo-color": "#f8f2e2" },
  label_city_capital: { "text-color": "#4a3820", "text-halo-color": "#f8f2e2" },
  label_town: { "text-color": "#544023", "text-halo-color": "#f8f2e2" },
  label_village: { "text-color": "#5f4b2b", "text-halo-color": "#f8f2e2" },
  label_other: { "text-color": "#6b5636", "text-halo-color": "#f8f2e2" },
  "highway-name-major": { "text-color": "#6b5636", "text-halo-color": "#f8f2e2" },
  "highway-name-minor": { "text-color": "#75603e", "text-halo-color": "#f8f2e2" },
  "highway-name-path": { "text-color": "#7d6442", "text-halo-color": "#f8f2e2" },
  water_name_point_label: { "text-color": "#3f7fae", "text-halo-color": "#f4eee0" },
  water_name_line_label: { "text-color": "#3f7fae", "text-halo-color": "#f4eee0" },
  waterway_line_label: { "text-color": "#3f7fae", "text-halo-color": "#f4eee0" },
  airport: { "text-color": "#5a3d1e", "text-halo-color": "#fff8ea" },
};

/** Generic POI labels stay, but quiet and sepia; their icons go, so the pins
    we actually sell — the dog-friendly ones — are never lost in icon soup. */
const POI_QUIET: string[] = ["poi_r20", "poi_r7", "poi_r1"];

const TRANSIT = "poi_transit";
const GLOW = "pampered-transit-glow";

function apply(map: MLMap, id: string, paints: Paints): void {
  for (const [key, value] of Object.entries(paints)) {
    try {
      // One controlled cast, like the pin-colour expression in controller.ts:
      // the keys are typed loosely here so every layer's palette lives in one
      // flat table, and MapLibre rejects a bad name at runtime into the catch.
      map.setPaintProperty(id, key as never, value as never);
    } catch {
      // A layer the style renamed is a missed tint, not a broken map.
    }
  }
}

export function sepiaise(map: MLMap): void {
  for (const [id, paints] of Object.entries(FILLS)) apply(map, id, paints);
  for (const [id, paints] of Object.entries(LINES)) apply(map, id, paints);
  for (const [id, paints] of Object.entries(LABELS)) {
    apply(map, id, paints);
  }

  for (const id of POI_QUIET) {
    apply(map, id, {
      "icon-opacity": 0,
      "text-color": "#8a7350",
      "text-halo-color": "#f8f2e2",
    });
  }

  // Landmarks: bigger transit icons and labels that grow with zoom, over a
  // warm glow disc so a station reads as a place, not a speck.
  try {
    map.setLayerZoomRange(TRANSIT, 10, 22);
    map.setLayoutProperty(TRANSIT, "icon-size", [
      "interpolate",
      ["linear"],
      ["zoom"],
      11,
      0.9,
      16,
      1.25,
    ]);
    map.setLayoutProperty(TRANSIT, "text-size", [
      "interpolate",
      ["linear"],
      ["zoom"],
      11,
      12,
      16,
      14.5,
    ]);
    apply(map, TRANSIT, {
      "text-color": "#5a3d1e",
      "text-halo-color": "#fff8ea",
      "text-halo-width": 1.4,
    });
  } catch {
    // No transit layer in a future style is a plain map, not a failure.
  }

  try {
    if (map.getLayer(TRANSIT) && !map.getLayer(GLOW)) {
      map.addLayer(
        {
          id: GLOW,
          type: "circle",
          source: "openmaptiles",
          "source-layer": "poi",
          filter: ["match", ["get", "class"], ["rail", "bus", "airport"], true, false],
          paint: {
            "circle-color": "#c98a3f",
            "circle-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.26, 16, 0.4],
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4, 16, 10],
            "circle-stroke-color": "#fff6e6",
            "circle-stroke-width": 1.2,
          },
        },
        TRANSIT,
      );
    }
  } catch {
    // The glow is garnish; the icons and labels carry the meaning alone.
  }
}
