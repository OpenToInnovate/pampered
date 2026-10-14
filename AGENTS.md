# AGENTS.md — how to maintain Pampered

Pampered is a dog-friendly business finder with a map, at
`pampered.korg-e.com`. This file is the contract for keeping it correct. Read it
before touching `content/`, and re-read the section you need before running a
command that writes to the database.

## The shape of the thing

- `content/selections.yaml` — every visible map layer. One entry produces the
  filter chip, the map colour, the legend count, the D1 filter, the Overpass
  query and the sitemap entry. **Adding a selection is a file edit, not code.**
- `content/regions.yaml` — the city jump list. A convenience, not a limit.
- `content/places/*.yaml` — venues checked or reported by hand. Files starting
  with `_` are documentation and never load.
- `data/osm/` — raw OpenStreetMap responses. Gitignored, regenerable, never
  edited by hand.
- `data/index.json` — the merged build input. Gitignored, regenerated.
- D1 (`pampered`) — what the site actually reads. Written only by `npm run sync`.

The rule that governs all of it: **every row says where it came from.** An OSM
row carries its element id and timestamp; a curated row carries its file. A row
that cannot say where it came from is not allowed into the database, and
`scripts/validate.mjs` fails the build on rows that try.

## Adding a venue

Copy `content/places/_example.yaml` if you need the shape. Minimal real entry:

```yaml
version: 1
places:
  - id: the-marquess-of-granby
    name: The Marquess of Granby
    source: manual          # "manual" until somebody checks it, then "curated"
    selections: [pubs]
    lat: 51.5238
    lon: -0.1586
    city: London
    postcode: NW1 3DT
    dog_policy: outside
    notes: Reported by a visitor. Needs a phone call before we say anything more.
```

Then:

```
npm run check     # schema, ids, colours, the verified rule. Must pass.
```

`source: manual` rows appear on the map marked **Not checked yet**. To mark one
checked, change `source` to `curated`, add `verified: true`, and write `notes`
that say what is actually true about dogs there — bowls, menu, where they may
sit. A curated row with no notes passes the build with a warning, and the
warning is right: a name on a pin is not information.

Getting it live: curated rows do **not** go live on merge. They go live when
somebody runs `npm run build:index && npm run sync`, which rebuilds
`data/index.json` from the OSM cache plus `content/places/` and upserts D1.
OSM rows refresh weekly by the same command after `npm run refresh`.

## Adding a selection

1. Add an entry to `content/selections.yaml` with a unique `id`, a `short` label
   under 12 characters, an `icon` from `src/map/icons.tsx`, a `colour`, a
   `group`, a `blurb` that says where the data comes from, and either an `osm`
   block or nothing (curated-only).
2. Pick the colour with the script, not your eyes:
   `node scripts/palette.mjs 11` lists eleven hues at 4.6:1 against the map. The
   build enforces 4.5:1 and warns under 15 ΔE from any other selection.
3. `npm run check`, then `npm run refresh -- <id>` to pull OSM, then
   `build:index` and `sync` as above. Nothing else. The chip, legend, layer,
   filter and query generate themselves.

## The pipeline, in order

```
npm run refresh        # Overpass -> data/osm/. Sequential, polite, resumable.
npm run build:index    # data/osm + content/places -> data/index.json
npm run sync           # data/index.json -> remote D1 (add --local for local)
```

`refresh` subdivides an area Overpass refuses and resumes tile by tile; killing
it loses nothing. `sync` is idempotent — running it twice changes nothing the
second time — and it **deletes** OSM rows the new index no longer contains (a
venue deleted or un-tagged upstream should leave the map). It never deletes
curated or manual rows. Removing a curated venue is an edit in
`content/places/`, not a side effect.

## Non-negotiables

- **Never invent a venue.** No lat/lon you did not get from OSM, a reporter, or
  a visit. No opening hours from a photo of a door. No "probably".
- **Never mark a row verified that nobody checked.** `validate.mjs` enforces
  the `manual`-cannot-be-verified half; the other half is on you.
- **Attribution stays.** Footer credit to OpenStreetMap contributors (ODbL) and
  the map's own attribution control are legal requirements, not decoration.
- **No analytics, no cookies, no sign-in wall, no redirect partners.** The site
  has none of wagit.uk's machinery on purpose. Do not add any without a design
  discussion first.
- **This repo is not korg-e.** It lives next to `../korg-e` and shares
  conventions (lowercase commit subjects, `check.mjs`-style static checks,
  explanatory comments), but no code and no deploys. Never commit here from
  there or vice versa.
- **Mobile first.** Every UI change is reviewed at 390×844 before desktop. No
  hover-only affordance, no target under 44px, no layout that needs a mouse.

## Verification

```
npm run check     # tsc + content validation. Must pass before anything else.
npm run test      # vitest unit tests.
npm run test:e2e  # playwright, needs a preview server with local D1.
```

CI runs check, test and a build on every push to `main`, then deploys. Content
PRs that only touch `content/places/` still run the full check — a typo'd
selection id must fail in CI, not on the live map.

## When the data looks wrong

- A venue that closed or stopped welcoming dogs: if it came from OSM, fix or
  remove the tag on openstreetmap.org and it leaves on the next refresh. If it
  is curated, edit or delete the row and re-run `build:index` + `sync`.
- An OSM row suppressing wrongly: `build:index` logs every suppression
  (`X <- Y`). Loosen the name or distance rule only with a test proving why.
- Overpass refusing everything: normal at busy hours. Wait and re-run; the
  manifest resumes. `--endpoint=mail.ru` skips a downed primary.
