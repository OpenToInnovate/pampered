/**
 * The footer. Small, honest, and legally necessary: the OpenStreetMap data
 * this site runs on is under the ODbL, which requires attribution, so the
 * credit to OpenStreetMap contributors is not decorative and is not removable.
 *
 * The count comes from `data/manifest.json`, a build artefact, rather than from
 * asking the database. That is not a style choice. This footer used to call an
 * endpoint that ran two full-table row counts on every single page view — about
 * 14,500 rows per visitor on a 7,000-row table — which exhausted the account's
 * daily D1 row-read quota and took an unrelated site down with it. The count in
 * the manifest is written once at build time and costs nothing to read.
 */
import { A } from "@solidjs/router";
import { createResource } from "solid-js";
import { loadManifest } from "~/lib/dataset";

export default function SiteFooter() {
  const [manifest] = createResource(loadManifest);
  const total = () => {
    const value = manifest()?.total;
    return typeof value === "number" ? value.toLocaleString("en-GB") : null;
  };

  return (
    <footer class="site-footer">
      <p>
        <strong>Pampered</strong>
        {total() && <> — {total()} dog-friendly places</>}
      </p>
      <p class="tiny muted">
        Map data ©{" "}
        <a href="https://www.openstreetmap.org/copyright" rel="noopener">
          OpenStreetMap contributors
        </a>{" "}
        (ODbL) · Tiles by{" "}
        <a href="https://openfreemap.org" rel="noopener">
          OpenFreeMap
        </a>{" "}
        (© OpenMapTiles) ·{" "}
        <A href="/about">About, sources and how to add a place</A>
      </p>
    </footer>
  );
}
