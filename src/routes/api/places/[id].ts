/**
 * GET /api/places/:id — the full record for a venue page.
 *
 * The id is `osm:node/12345` or a curated slug. It arrives URL-encoded, because
 * a colon and a slash in a path segment are legal but unfriendly.
 */
import type { APIEvent } from "@solidjs/start/server";
import { getPlace } from "~/server/places";

export async function GET(event: APIEvent): Promise<Response> {
  const id = event.params["id"];
  if (!id || typeof id !== "string" || id.length > 200) {
    return Response.json({ error: "missing id" }, { status: 400 });
  }

  try {
    const place = await getPlace(decodeURIComponent(id));
    if (!place) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json(place, {
      headers: {
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    console.error("/api/places/:id:", error instanceof Error ? error.message : error);
    return Response.json({ error: "temporarily unavailable" }, { status: 503 });
  }
}