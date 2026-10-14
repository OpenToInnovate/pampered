/**
 * The map when there is no map.
 *
 * Shown when WebGL2 is missing, when the context is lost, and when MapLibre
 * itself fails to load. It is a scatter of the same pins in the same colours,
 * positioned by the same projector in `src/lib/geo.ts` — which is the reason
 * that file exists as a portable module rather than inline in the controller.
 *
 * It is not a replacement for the map and does not pretend to be one. There is
 * no geography under the pins, because drawing a coastline without tiles means
 * shipping one, and a megabyte of coastline to serve the 1% of devices without
 * WebGL2 is the wrong trade. The list below it is the interface here; this is
 * orientation.
 */
import { createMemo, For } from "solid-js";
import { colourOf, primarySelectionId, selection } from "~/content/selections";
import { bboxOfPoints, makeProjector } from "~/lib/geo";
import type { LonLat } from "~/lib/geo";

interface FallbackPlace {
  id: string;
  name: string | null;
  lat: number;
  lon: number;
  selections: string[];
  primary: string | null;
}

export default function SvgFallback(props: {
  places: FallbackPlace[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const WIDTH = 800;
  const HEIGHT = 600;

  const points = createMemo(() => {
    const pts = props.places.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    if (!pts.length) return { project: null as ReturnType<typeof makeProjector> | null, pts };
    const bbox = bboxOfPoints(pts.map((p) => [p.lon, p.lat] as LonLat));
    // A single pin has no extent; give it a street-sized box so the projector
    // has something to fit instead of dividing by zero.
    const padded: typeof bbox =
      bbox[0] === bbox[2] && bbox[1] === bbox[3]
        ? [bbox[0] - 0.02, bbox[1] - 0.015, bbox[0] + 0.02, bbox[1] + 0.015]
        : bbox;
    return { project: makeProjector(padded, WIDTH, HEIGHT, 48), pts };
  });

  const labelOf = (p: FallbackPlace): string => {
    if (p.name) return p.name;
    const primary = p.primary ?? primarySelectionId(p.selections);
    return selection(primary ?? "")?.short ?? "Place";
  };

  return (
    <div class="map-fallback" role="img" aria-label={`${points().pts.length} places shown as a diagram`}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} class="map-fallback-svg">
        {(() => {
          const { project, pts } = points();
          if (!project) return null;
          const placed = pts.map((p) => {
            const [x, y] = project(p.lon, p.lat);
            return { p, x, y };
          });
          return (
            <g>
              <For each={placed}>
                {({ p, x, y }) => {
                  const primary = p.primary ?? primarySelectionId(p.selections);
                  const colour = colourOf(primary ?? "");
                  const selected = p.id === props.selectedId;
                  return (
                    <g>
                      <circle
                        cx={x}
                        cy={y}
                        r={selected ? 11 : 7}
                        fill={colour}
                        stroke={selected ? "#1c1a17" : "#ffffff"}
                        stroke-width={selected ? 3 : 2}
                        style={{ cursor: "pointer" }}
                        onClick={() => props.onSelect(p.id === props.selectedId ? null : p.id)}
                      >
                        <title>{labelOf(p)}</title>
                      </circle>
                    </g>
                  );
                }}
              </For>
            </g>
          );
        })()}
      </svg>
      <p class="map-fallback-note muted tiny">
        The interactive map needs WebGL2, which this device or browser does not offer. The full list
        below has everything the map would show.
      </p>
    </div>
  );
}
