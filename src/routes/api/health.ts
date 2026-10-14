/**
 * GET /api/health — is the database reachable, and what is in it.
 *
 * Deliberately boring. Uptime monitors and the footer both read this, and
 * neither should have to parse anything clever.
 */
import type { APIEvent } from "@solidjs/start/server";
import { dbAvailable } from "~/server/db";
import { populatedSelections, sourceCounts } from "~/server/places";

export async function GET(_event: APIEvent): Promise<Response> {
  if (!dbAvailable()) {
    return Response.json({ ok: false, error: "database unreachable" }, { status: 503 });
  }
  try {
    const [sources, populated] = await Promise.all([sourceCounts(), populatedSelections()]);
    const total = Object.values(sources).reduce((a, b) => a + b, 0);
    return Response.json(
      { ok: true, total, sources, selections: populated },
      { headers: { "Cache-Control": "public, max-age=300" } },
    );
  } catch (error) {
    console.error("/api/health:", error instanceof Error ? error.message : error);
    return Response.json({ ok: false, error: "query failed" }, { status: 503 });
  }
}