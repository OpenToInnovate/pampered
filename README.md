# Pampered

A dog-friendly business finder with a map, at
[pampered.korg-e.com](https://pampered.korg-e.com).

Find cafés, pubs and restaurants that welcome dogs, plus groomers, vets, pet
shops, dog parks, off-lead areas and water bowls — on a fast mobile-first map
with no sign-in, no cookies and no tracking.

## Run it

```bash
npm install
npm run dev                  # local dev (Nitro + Miniflare, local D1)
npm run check                # types + content validation. Must pass.
npm run test                 # unit tests
```

## Content

The map is driven by `content/` — see [AGENTS.md](AGENTS.md) for the
maintenance contract. In short:

```bash
npm run refresh              # OpenStreetMap -> data/osm/
npm run build:index          # data/osm + content/places -> data/index.json
npm run sync                 # data/index.json -> D1 (add --local for local)
```

## Deploy

Push to `main` deploys via GitHub Actions. Content-only changes go live with
`npm run sync` and need no code deploy.

## Stack

SolidStart v2 · Solid 1.9 · Vite 8 · Nitro (cloudflare_module) · Cloudflare
Workers + D1 · MapLibre GL + OpenFreeMap · TypeScript strict.

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)
(ODbL). Tiles by [OpenFreeMap](https://openfreemap.org) (© OpenMapTiles).
