/**
 * The header. On a phone it is a logo and a region jump; on a desktop it also
 * gets the about link and the count. Nothing here navigates away from the map
 * except About, because there is nowhere else to go.
 */
import { A } from "@solidjs/router";
import FurryPaw from "~/components/FurryPaw";
import { regions } from "~/content/selections";

export default function SiteHeader() {
  const jump = (id: string) => {
    const region = regions.find((r) => r.id === id);
    if (!region) return;
    // The finder route listens for this. A CustomEvent rather than a prop
    // because the header is mounted by App, two levels above the route.
    window.dispatchEvent(
      new CustomEvent("pampered:jump", {
        detail: { lon: region.centre[0], lat: region.centre[1], zoom: region.zoom },
      }),
    );
  };

  return (
    <header class="site-header">
      <A href="/" class="brand" aria-label="Pampered home">
        <FurryPaw size={26} class="brand-mark" circle="#9a4a16" paw="#faf8f5" />
        <span class="brand-word">Pampered</span>
      </A>
      <div class="spacer" />
      {/* On a phone the search pill replaces the region jump: the thumb needs
          search, and the cities move into the overlay where there is room for
          all of them plus a search box. The header is mounted by App, so the
          route listens for the event (see index.tsx). */}
      <button
        type="button"
        class="btn header-search"
        aria-label="Search places"
        onClick={() => window.dispatchEvent(new CustomEvent("pampered:search"))}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M16.5 16.5L21 21" />
        </svg>
        <span>Search places…</span>
      </button>
      <label class="region-jump">
        <span class="sr-only">Jump to a city</span>
        <select
          aria-label="Jump to a city"
          onChange={(e) => {
            jump(e.currentTarget.value);
            e.currentTarget.value = "";
            e.currentTarget.blur();
          }}
        >
          <option value="">Cities…</option>
          {regions.map((r) => (
            <option value={r.id}>{r.label}</option>
          ))}
        </select>
      </label>
      <A href="/about" class="btn btn-quiet btn-icon about-link" aria-label="About Pampered">
        ?
      </A>
    </header>
  );
}