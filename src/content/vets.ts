/**
 * The visitor's veterinary provider.
 *
 * Two things live here: the provider registry the build publishes at
 * `/data/vets.json` (the same static-asset model as the venue layers), and the
 * one piece of state the site keeps on the device — which provider the visitor
 * says they are registered with.
 *
 * That preference is stored in `localStorage`, not a cookie and not on a server.
 * It never leaves the browser; clearing site data forgets it. It is the only
 * thing Pampered remembers about a visitor, and /about says so.
 */
import { createSignal } from "solid-js";

export interface VetProvider {
  id: string;
  name: string;
  colour: string;
  logo: string | null;
  planUrl: string | null;
  website: string | null;
  sponsor: boolean;
  confirmed: boolean;
  /** Practices in this build attributed to the provider. */
  count: number;
}

export interface VetRegistry {
  builtAt: string;
  policy: { disclosure?: string; ranking?: string };
  providers: VetProvider[];
  attributed: number;
  total: number;
}

const STORAGE_KEY = "pampered.vet";

/**
 * Null until the browser has hydrated. Reading localStorage during the server
 * render would make the server and the first client render disagree, and Solid
 * throws when a branch appears mid-hydration. `hydrateMyVet()` runs on mount.
 */
export const [myVet, setMyVetSignal] = createSignal<string | null>(null);

/** Read the stored preference once the page is interactive. */
export function hydrateMyVet(): void {
  const stored = readStoredVet();
  if (stored) setMyVetSignal(stored);
}

function readStoredVet(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value && /^[a-z0-9-]+$/.test(value) ? value : null;
  } catch {
    // Private mode or a blocked storage partition: no preference, no crash.
    return null;
  }
}

/** Remember the choice for this browser only. Pass null to forget it. */
export function setMyVet(id: string | null): void {
  setMyVetSignal(id);
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // The in-memory signal still works for this page view.
  }
}

let cached: Promise<VetRegistry> | null = null;

/** Fetch the registry once per tab. A failure is reported, never an empty list. */
export function loadVets(): Promise<VetRegistry> {
  cached ??= fetch("/data/vets.json")
    .then((res) => {
      if (!res.ok) throw new Error(`vets.json: ${res.status}`);
      return res.json() as Promise<VetRegistry>;
    })
    .catch((error: unknown) => {
      cached = null;
      throw error;
    });
  return cached;
}

/** The provider a stored id refers to, or undefined if it is gone or unknown. */
export function providerById(registry: VetRegistry | undefined, id: string | null): VetProvider | undefined {
  if (!registry || !id) return undefined;
  return registry.providers.find((p) => p.id === id);
}
