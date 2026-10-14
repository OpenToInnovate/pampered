/**
 * The server's copy of the directory.
 *
 * This imports `data/published.json`, which `scripts/build-data.mjs` writes at
 * build time and Vite bundles into the Worker. That matters twice over:
 *
 *   - Cloudflare's `workerd` has no filesystem, so reading the files off disk
 *     would work during a build and fail on every request in production;
 *   - bundling the data means a server-rendered venue page costs a Map lookup
 *     and no database row, which is the entire point of the static-first
 *     change.
 *
 * It is only ever reached through a dynamic import inside an `import.meta.env.SSR`
 * branch in `dataset.ts`, so it is dropped from the client bundle entirely.
 * `scripts/guard-no-request-db.mjs` fails the build if it leaks into browser code.
 */
import published from "../../data/published.json";
import type { PlaceRecord } from "./search";

const ALL = (published as { places: PlaceRecord[] }).places;

/** A prebuilt index, so filtering seven thousand records per selection is cheap. */
const BY_SELECTION = new Map<string, PlaceRecord[]>();
for (const place of ALL) {
  for (const id of place.selections ?? []) {
    const bucket = BY_SELECTION.get(id);
    if (bucket) bucket.push(place);
    else BY_SELECTION.set(id, [place]);
  }
}

export function readManifest(): unknown {
  return {
    builtAt: (published as { builtAt?: string }).builtAt ?? null,
    total: ALL.length,
    counts: Object.fromEntries([...BY_SELECTION].map(([id, list]) => [id, list.length])),
    fields: [],
  };
}

export function readSelection(id: string): unknown {
  return { selection: id, places: BY_SELECTION.get(id) ?? [] };
}
