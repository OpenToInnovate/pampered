import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { solidStart } from "@solidjs/start/config";
import { nitro } from "nitro/vite";
import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import { parse as parseYaml } from "yaml";

/**
 * `content/*.yaml` is the source of truth for what appears on the map, and this
 * plugin is the only thing that lets the browser read it directly. Without it
 * `content/` would have to be duplicated into TypeScript by a codegen step, and
 * two copies of the same list of selections is two lists that will disagree.
 *
 * Scripts under `scripts/` read the same files with the `yaml` package directly,
 * so the app and the pipeline cannot see different content.
 */
function contentYaml(): Plugin {
  const fileOf = (id: string) => id.replace(/\?.*$/, "");

  return {
    name: "pampered:content-yaml",
    enforce: "pre",

    resolveId(source, importer) {
      if (!/\.ya?ml$/.test(source)) return null;
      const base = importer ? dirname(fileOf(importer)) : process.cwd();
      const absolute = resolve(base, source);
      return existsSync(absolute) ? `${absolute}?pampered-yaml` : null;
    },

    load(id) {
      if (!id.endsWith("?pampered-yaml")) return null;
      const file = fileOf(id);
      return `export default ${JSON.stringify(parseYaml(readFileSync(file, "utf8")))};`;
    },
  };
}

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
    // Pre-rendering puts the homepage, the about page and every curated venue
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
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    // DOM tests opt in per-file with `// @vitest-environment jsdom` at the top.
  },
});
