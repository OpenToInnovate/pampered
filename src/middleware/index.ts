/**
 * There is no API. This makes sure that stays true.
 *
 * Without this, the single-page-app fallback answers `/api/anything` with the
 * HTML shell and a 200, so a client expecting JSON gets `<!DOCTYPE html>` and
 * a success status. That is the same family of mistake as the outage this
 * project had: a route that fails quietly, returning something that looks fine
 * and is not. A 404 is the honest answer, and it fails loudly in the test suite
 * if an API route ever reappears.
 *
 * It runs inside the Worker only. The pre-rendered homepage, the venue pages
 * and every `/data/*.json` file are served by Workers Assets without invoking
 * the Worker at all, so this costs nothing on the hot path.
 */
import { createMiddleware } from "@solidjs/start/middleware";

export default createMiddleware({
  onRequest(event) {
    const { pathname } = new URL(event.request.url);
    if (!pathname.startsWith("/api/")) return;
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  },
});
