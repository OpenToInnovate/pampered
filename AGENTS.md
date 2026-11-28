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
- `content/vets.yaml` — veterinary providers, their health-plan links, and the
  sponsorship policy. A practice is matched to a provider by the brand, name or
  operator OpenStreetMap records. Every entry is `confirmed: false` until the
  provider signs off the name, colour, links and logo; `check` warns, and the
  sponsor card is labelled a draft until then. The build publishes the registry
  at `public/data/vets.json`; the picker fetches it only when opened.
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

## Why there is no API

**Nothing reads a database while serving a page. Do not add a route that does.**

In August 2026 this site asked D1 for every viewport query, and its footer asked
D1 for two full-table row counts on every page view. That is about 14,500 rows
read per visitor on a 7,000-row table. It exhausted the account's daily D1
row-read quota within hours, every D1 query started failing, and — because the
quota is **per account rather than per database** — it took
[mir-os](https://korg-e.com/mir) down at the same time. Two unrelated sites,
one hobby project, one shared limit.

The directory is now precomputed:

```
data/index.json  ->  public/data/<selection>.json   served as a static asset
                 ->  data/published.json           bundled into the Worker
```

The browser fetches the selections it is showing and filters them itself; a
venue page is server-rendered from the bundled copy. Neither touches D1, so the
quota cannot be spent by browsing at all. A first-time visitor downloads about
104 kB of default data, and the whole directory is about 368 kB, loaded only on
demand.

`npm run build` fails if a database reference, an `/api/` route or `node:fs`
appears in browser code — see `scripts/guard-no-request-db.mjs`. If you find
yourself wanting to add one back, that script is the argument against it.

**Corollary:** the second failure was not the query, it was the silence. The
site returned HTTP 200 with an empty page and nothing said why, so nobody
noticed for hours. Any new failure path has to say what went wrong; an empty
list is never an acceptable error state.

## The paw inbox

Visitor reports are the one deliberate exception to "nothing at request time
touches a database", and it is worth understanding exactly how far the
exception goes. `POST /report` (`src/routes/report.ts`) writes one small JSON
record to Workers KV (the `INBOX` binding) and returns an id. It never reads
anything, never serves a page, and never touches D1 — the incident above was
D1 **reads** per request, and one KV write per human who chose to report
something cannot repeat it. The guard still passes, because the browser bundle
carries no serving-tier strings; the form POSTs to `/report` and the route
only writes.

Abuse budget, in order: a honeypot field, a 5-per-hour per-device cap and a
400-per-day global cap (KV counters, approximate by nature), hard length caps,
text-only storage, 90-day TTL. No cookies, no sign-in, no third-party
challenge widget.

Reports reach two publication channels, both moderated:

- a prefilled **OpenStreetMap note** — OSM volunteers review it, every OSM
  consumer benefits, and the fix arrives here on the weekly refresh;
- the **inbox**, drained by `npm run inbox` into yaml drafts for
  `content/places/`, which then go through the normal check → verify →
  build:index → sync flow. A report is not a check; nothing is published
  unchecked.

Note for the test rig: wrangler dev emulates `cf-connecting-ip`, so the caps
apply locally too, and local KV state persists between runs. Wipe
`.wrangler/state` before serving a preview for e2e, or a rerun within the hour
will rate-limit its own happy path.

## The pipeline, in order

```
npm run refresh        # Overpass -> data/osm/. Sequential, polite, resumable.
npm run build:index    # data/osm + content/places -> data/index.json
npm run build          # runs build:data, then vite build, then the guard
npm run sync           # data/index.json -> remote D1. An audit log, not a
                       # serving tier. Nothing reads it. Optional.
npm run refresh:tube   # Overpass -> public/data/tube.json. Landmark stations
                       # (Underground, Overground, Elizabeth line, DLR and the
                       # National Rail termini), not venues: never in the
                       # chips, the directory or the sync.
```

`refresh` subdivides an area Overpass refuses and resumes tile by tile; killing
it loses nothing. `build` is what goes live: it publishes the static dataset and
pre-renders `/about` and every curated venue page. `sync` writes D1 and is
idempotent; run it when you want a durable record of what is published, not
because the site needs it.

`data/osm/` and `data/index.json` are gitignored. `public/data/` and
`data/published.json` are build outputs of `npm run build:data` and are also
gitignored — CI regenerates them from the OSM cache, so a fresh clone needs
`npm run refresh && npm run build:index` before it can build.

## Sponsorship and vet ratings

Sponsorship is allowed and is disclosed, but it never buys placement. The card
says "Sponsored by {name}", the provider's colour stays inside that card, and a
sponsor's practices are never ranked above anyone else's in search or lists.

The star readout on a vet practice is built only from details we can prove — an
address, a phone number, a website, opening hours, step-free access, a named
operator, a description, a recorded survey date. It is **not** a review score
and must never be presented as one; the UI says "verified details, not a review"
wherever the stars appear. Do not import ratings from review sites.

One exception is allowed, and only this one: a provider we use ourselves may
carry `rating:` in `content/vets.yaml`, which replaces the details score for its
practices and is labelled "Rated by Pampered" in every place the stars appear.
It is our own claim, attributed to us, never dressed up as a review.

The visitor's chosen vet is the only thing the site stores on a device:
`localStorage["pampered.vet"]`, read after hydration, never sent anywhere.
`/about#sponsorship` explains it. Adding a cookie or an account here would
break the "no analytics, no cookies, no sign-in" rule.

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
- **Say what went wrong.** Never return an empty list, an empty map or a bare
  200 to mean "something broke". The reader cannot tell the difference between
  "there is nothing here" and "we are down", and guessing wrong is worse than
  an honest error.
- **Nothing at request time touches a database.** See above. This is the rule
  that keeps the other sites on this account alive.

## Verification

```
npm run check     # tsc + content validation. Must pass before anything else.
npm run test      # vitest unit tests.
npm run build     # also runs the no-request-database guard.
npm run test:e2e  # playwright, needs a preview server. No database required,
                  # which is the point.
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
