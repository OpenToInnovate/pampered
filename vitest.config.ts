import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { contentYaml } from "./content-yaml";

// Tests run on their own config so vitest never starts the Nitro dev runner
// that vite.config.ts wires in. They need only two things from the app build:
// the YAML import (src/content reads content/*.yaml directly) and the ~ alias.
export default defineConfig({
  plugins: [contentYaml()],
  resolve: {
    alias: [{ find: /^~\//, replacement: fileURLToPath(new URL("./src/", import.meta.url)) }],
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
});
