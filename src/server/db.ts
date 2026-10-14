/**
 * The D1 binding, found without assuming one particular runtime shape.
 *
 * SolidStart runs on h3, h3 runs on srvx, and srvx reaches workerd through
 * `event.runtime.cloudflare.env`. That is the path that works today. The others
 * are here because the failure mode when this guesses wrong is a 500 on every
 * request rather than a build error, and a directory that 500s is worse than a
 * few lines of defensive code.
 *
 * If you ever change this and `npm run check` still passes, prove it: the
 * `db-binding` test in `test/server.test.ts` fails when no binding can be found.
 */
import { getRequestEvent } from "solid-js/web";

interface MaybeBinding {
  DB?: unknown;
}

function candidateEnvs(): MaybeBinding[] {
  const found: MaybeBinding[] = [];
  try {
    const event = getRequestEvent() as unknown as Record<string, unknown> | undefined;
    if (event) {
      const native = (event["nativeEvent"] ?? event) as Record<string, unknown>;
      // Nitro on Cloudflare puts bindings at event.context.cloudflare.env, and
      // srvx-style runtimes at event.runtime / .platform / .req.runtime. Every
      // shape is tried because the failure mode for guessing wrong is a 500 on
      // every request rather than a build error.
      const holders: unknown[] = [
        native,
        native["platform"],
        native["runtime"],
        native["context"],
      ];
      const req = native["req"];
      if (req && typeof req === "object") {
        holders.push(
          (req as Record<string, unknown>)["runtime"],
          (req as Record<string, unknown>)["context"],
        );
      }
      for (const holder of holders) {
        if (!holder || typeof holder !== "object") continue;
        const cf = (holder as Record<string, unknown>)["cloudflare"];
        if (cf && typeof cf === "object" && "env" in cf) {
          found.push((cf as { env: MaybeBinding }).env);
        }
      }
    }
  } catch {
    // No request in scope — this happens during prerender and in unit tests.
  }
  const proc = (globalThis as { process?: { env?: MaybeBinding } }).process?.env;
  if (proc) found.push(proc);
  return found;
}

export function db(): D1Database {
  for (const env of candidateEnvs()) {
    const binding = env?.DB;
    if (binding && typeof (binding as D1Database).prepare === "function") return binding as D1Database;
  }
  throw new Error(
    "No D1 binding named DB. Check wrangler.jsonc has the d1_databases entry and that " +
      "`npm run db:schema:remote` has been run at least once.",
  );
}

/** Whether a binding is reachable. Used by /api/health, which must not itself throw. */
export function dbAvailable(): boolean {
  try {
    db();
    return true;
  } catch {
    return false;
  }
}