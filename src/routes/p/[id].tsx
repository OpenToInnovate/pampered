/**
 * The venue page. Everything known about one place, on one screen, with no map
 * to load first — which also makes it the page search engines see.
 *
 * Data comes from `getPlace` on the server via a cached query, so the HTML
 * arrives complete. The "back to the map" link carries the search string the
 * visitor arrived with, so Back restores the exact viewport they left.
 */
import { Meta, Title } from "@solidjs/meta";
import { A, createAsync, query, useLocation, useParams } from "@solidjs/router";
import { Match, Show, Switch } from "solid-js";
import { SourceBadge } from "~/components/PlaceCard";
import { dogPolicyLabel, dogPolicyTone, selection } from "~/content/selections";
import { formatAddress, joinList, openState } from "~/lib/format";

const getPlaceData = query(async (id: string) => {
  "use server";
  const { getPlace } = await import("~/server/places");
  return getPlace(id);
}, "place");

function toneClass(tone: string): string {
  return tone === "good" ? "pill-good" : tone === "warn" ? "pill-warn" : tone === "bad" ? "pill-bad" : "pill-unknown";
}

export default function PlacePage() {
  const params = useParams();
  const location = useLocation();
  const place = createAsync(() => getPlaceData(decodeURIComponent(params["id"] ?? "")));

  const backHref = () => `/${location.search}`;
  const displayName = () => {
    const p = place();
    if (!p) return "Place";
    if (p.name) return p.name;
    const primary = p.primary ?? p.selections[0];
    return selection(primary ?? "")?.label ?? "Place";
  };

  return (
    <main class="page place-page">
      <nav aria-label="Back">
        <A href={backHref()} class="btn btn-quiet">
          ← Back to the map
        </A>
      </nav>

      <Switch>
        <Match when={place() === undefined}>
          <p class="muted">Loading…</p>
        </Match>
        <Match when={place() === null}>
          <h1>Not found</h1>
          <p class="muted">
            This place is not in the directory. It may have been removed, or the link is old.
          </p>
        </Match>
        <Match when={place()}>
          {(p) => {
            const open = () => openState(p().openingHours);
            const shownAs = () =>
              p()
                .selections.map((id) => selection(id)?.short)
                .filter(Boolean) as string[];
            return (
              <>
                <Title>{`${displayName()} — Pampered`}</Title>
                <Meta
                  name="description"
                  content={`${displayName()}: ${dogPolicyLabel(p().dogPolicy)}. ${formatAddress({ street: p().street, city: p().city, postcode: p().postcode })}`}
                />

                <header class="stack">
                  <h1>{displayName()}</h1>
                  <div class="row place-card-pills">
                    <span class={`pill ${toneClass(dogPolicyTone(p().dogPolicy))}`}>
                      {dogPolicyLabel(p().dogPolicy)}
                    </span>
                    {open() && <span class={`pill ${toneClass(open()!.tone)}`}>{open()!.label}</span>}
                    <SourceBadge source={p().source} verified={p().verified} />
                  </div>
                  {(p().street || p().city || p().postcode) && (
                    <p class="muted">
                      {formatAddress({ street: p().street, city: p().city, postcode: p().postcode })}
                    </p>
                  )}
                </header>

                {p().notes && (
                  <section aria-label="What to know">
                    <h2>What to know</h2>
                    <p>{p().notes}</p>
                  </section>
                )}

                <section aria-label="Details">
                  <h2>Details</h2>
                  <dl class="facts">
                    {p().openingHours && (
                      <>
                        <dt>Hours</dt>
                        <dd>{p().openingHours}</dd>
                      </>
                    )}
                    {p().phone && (
                      <>
                        <dt>Phone</dt>
                        <dd>
                          <a href={`tel:${p().phone!.replace(/\s+/g, "")}`}>{p().phone}</a>
                        </dd>
                      </>
                    )}
                    {p().website && (
                      <>
                        <dt>Website</dt>
                        <dd>
                          <a href={p().website!} rel="noopener" target="_blank">
                            {p().website!.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                          </a>
                        </dd>
                      </>
                    )}
                    {p().cuisine && (
                      <>
                        <dt>Food</dt>
                        <dd>{p().cuisine}</dd>
                      </>
                    )}
                    {shownAs().length > 0 && (
                      <>
                        <dt>Shown as</dt>
                        <dd>{joinList(shownAs())}</dd>
                      </>
                    )}
                  </dl>
                </section>

                {p().booking && (
                  <section aria-label="Booking">
                    <a
                      href={p().booking!.url}
                      class="btn btn-primary"
                      rel="noopener"
                      target="_blank"
                    >
                      {p().booking!.label} ↗
                    </a>
                    <p class="tiny muted">
                      Booking happens on {p().booking!.label === "Book" ? "the venue's site" : "their site"}. Pampered
                      never takes a booking or holds a payment.
                    </p>
                  </section>
                )}

                <footer class="tiny muted stack">
                  <p>Source: {p().source === "osm" ? "OpenStreetMap" : p().source === "curated" ? "checked by us" : "reported, not yet checked"}. {p().provenance}</p>
                  <Show when={p().source === "osm"}>
                    <p>
                      Something wrong?{" "}
                      <a href="https://www.openstreetmap.org/" rel="noopener">
                        Correct it on OpenStreetMap
                      </a>{" "}
                      and it will flow through on the next refresh — or{" "}
                      <A href="/about">tell us</A> and we will check it by hand.
                    </p>
                  </Show>
                </footer>
              </>
            );
          }}
        </Match>
      </Switch>
    </main>
  );
}