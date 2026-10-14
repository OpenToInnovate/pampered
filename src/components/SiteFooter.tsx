/**
 * The footer. Small, honest, and legally necessary: the OpenStreetMap data
 * this site runs on is under the ODbL, which requires attribution, so the
 * credit to OpenStreetMap contributors is not decorative and is not removable.
 */
import { A } from "@solidjs/router";
import { createResource } from "solid-js";

interface Health {
  ok: boolean;
  total: number;
  sources: Record<string, number>;
}

async function fetchHealth(): Promise<Health | null> {
  try {
    const res = await fetch("/api/health");
    if (!res.ok) return null;
    return (await res.json()) as Health;
  } catch {
    return null;
  }
}

export default function SiteFooter() {
  const [health] = createResource(fetchHealth);
  return (
    <footer class="site-footer">
      <p>
        <strong>Pampered</strong>
        {health()?.total != null && (
          <>
            {" — "}
            {health()!.total.toLocaleString("en-GB")} dog-friendly places
          </>
        )}
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