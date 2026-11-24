import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Plugin } from "vite";

/**
 * `content/*.yaml` is the source of truth for what appears on the map, and this
 * plugin is the only thing that lets the browser read it directly. Without it
 * `content/` would have to be duplicated into TypeScript by a codegen step, and
 * two copies of the same list of selections is two lists that will disagree.
 *
 * Scripts under `scripts/` read the same files with the `yaml` package directly,
 * so the app and the pipeline cannot see different content.
 */
export function contentYaml(): Plugin {
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
