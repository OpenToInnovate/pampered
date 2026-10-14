/**
 * The Vite plugin in vite.config.ts turns `content/*.yaml` into modules at
 * build time. TypeScript never sees the plugin, so without this it refuses the
 * imports. The type is deliberately `unknown`: every importer casts to the
 * shape it expects, and `scripts/validate.mjs` checks the file is that shape.
 */
declare module "*.yaml" {
  const value: unknown;
  export default value;
}

declare module "*.yml" {
  const value: unknown;
  export default value;
}