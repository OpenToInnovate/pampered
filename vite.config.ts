import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { solidStart } from "@solidjs/start/config";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import { parse as parseYaml } from "yaml";
import { contentYaml } from "./content-yaml";

/**
 * The venue pages worth pre-rendering are the curated ones — the places somebody
 * has actually checked. OpenStreetMap rows are thousands and change weekly;
 * pre-rendering those would mean uploading thousands of files on every deploy
 * for pages nobody has claimed ownership of.
 *
 * Read at config time so the list is explicit and inspectable, rather than
 * crawled at build time and discovered as a side effect.
 */
function curatedVenueRoutes(): string[] {
  const dir = resolve(process.cwd(), "content/places");
  if (!existsSync(dir)) return [];
  const routes: string[] = [];
  for (const file of readdirSync(dir)) {
    if (file.startsWith("_") || !/\.ya?ml$/i.test(file)) continue;
    const doc = parseYaml(readFileSync(resolve(dir, file), "utf8")) as {
      places?: { id?: string; source?: string; verified?: boolean }[];
    };
    for (const place of doc.places ?? []) {
      if (place.source === "curated" && place.verified && place.id) {
        routes.push(`/p/${encodeURIComponent(place.id)}`);
      }
    }
  }
  return routes;
}

export default defineConfig({
  plugins: [solidStart({ middleware: "./src/middleware/index.ts" }), nitro(), contentYaml()],
  nitro: {
    // The Cloudflare Workers output format. Without it the build produces no
    // wrangler.json for `wrangler deploy` to read.
    preset: "cloudflare_module",
    // Pre-rendering puts the about page and every curated venue
    // into .output/public, where Workers Assets serves them from the edge
    // without invoking the Worker at all. The homepage is the most-requested URL
    // on the site, so this is the single largest saving available.
    prerender: {
      // Deliberately NOT "/". The homepage is driven entirely by its query
      // string — ?sel= and ?at= decide what it renders — and a pre-rendered file
      // is served for every variant of it. The server would draw the default
      // London view while the browser hydrated a different one, and Solid throws
      // on the mismatch. "/" is server-rendered instead, which costs one Worker
      // request and zero database rows.
      routes: ["/about", ...curatedVenueRoutes()],
      failOnError: true,
    },
    // Nitro reads wrangler.jsonc in dev to provide bindings through Miniflare.
    cloudflare: { deployConfig: true },
  },
});
