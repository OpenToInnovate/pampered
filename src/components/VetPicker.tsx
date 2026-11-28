/**
 * "Which vet are you with?"
 *
 * A collapsed button that expands into the provider list. The registry is
 * fetched only when it is needed — on a first visit with nothing stored, the
 * page still makes no data request, which is the promise the map keeps.
 *
 * Choosing a provider is stored in this browser only (see content/vets.ts) and
 * narrows the vet layer to that provider's practices. It never reorders results
 * and never changes what the other layers show.
 */
import { createResource, createSignal, For, Show } from "solid-js";
import { loadVets } from "~/content/vets";
import { textOn } from "~/lib/colour";
import type { VetProvider, VetRegistry } from "~/content/vets";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function ProviderMark(props: { provider: VetProvider; size?: number }) {
  return (
    <Show
      when={props.provider.logo}
      fallback={
        <span
          class="vet-mark"
          style={{
            "--vet-colour": props.provider.colour,
            "--vet-ink": textOn(props.provider.colour),
            width: `${props.size ?? 28}px`,
            height: `${props.size ?? 28}px`,
          }}
          aria-hidden="true"
        >
          {initials(props.provider.name)}
        </span>
      }
    >
      <img
        class="vet-logo"
        src={props.provider.logo ?? ""}
        alt=""
        width={props.size ?? 28}
        height={props.size ?? 28}
        loading="lazy"
        decoding="async"
      />
    </Show>
  );
}

export default function VetPicker(props: {
  registry: VetRegistry | undefined;
  loading: boolean;
  failed: boolean;
  selected: string | null;
  onChoose: (id: string | null) => void;
  onOpen: () => void;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const current = () => props.registry?.providers.find((p) => p.id === props.selected);

  const toggle = () => {
    const next = !expanded();
    setExpanded(next);
    if (next) props.onOpen();
  };

  return (
    <section class="vet-picker" aria-label="Your vet">
      <button
        type="button"
        class="vet-picker-toggle"
        aria-expanded={expanded()}
        onClick={toggle}
      >
        <Show when={current()} fallback={<span>Which vet are you with?</span>}>
          {(p) => (
            <span class="row vet-picker-current">
              <ProviderMark provider={p()} size={22} />
              <span class="vet-picker-name">{p().name}</span>
            </span>
          )}
        </Show>
        <span class="spacer" />
        <span aria-hidden="true">{expanded() ? "▴" : "▾"}</span>
      </button>

      <Show when={expanded()}>
        <div class="vet-picker-body">
          <Show
            when={!props.failed}
            fallback={
              <p class="tiny" role="alert">
                Could not load the vet list. This is on our side — the map still works.
              </p>
            }
          >
            <Show
              when={!props.loading && props.registry}
              fallback={<p class="tiny muted">Loading vets…</p>}
            >
              <ul class="vet-list">
                <For each={props.registry?.providers ?? []}>
                  {(p) => (
                    <li>
                      <button
                        type="button"
                        class="vet-option"
                        classList={{ "vet-option-active": p.id === props.selected }}
                        aria-pressed={p.id === props.selected}
                        onClick={() => {
                          props.onChoose(p.id === props.selected ? null : p.id);
                          setExpanded(false);
                        }}
                      >
                        <ProviderMark provider={p} size={24} />
                        <span class="vet-option-name">{p.name}</span>
                        <span class="spacer" />
                        <span class="muted tiny">{p.count.toLocaleString("en-GB")}</span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
              <p class="tiny muted vet-picker-note">
                Saved in this browser only. It filters the vet layer; nothing else changes, and
                no provider is ever ranked above another.
              </p>
            </Show>
          </Show>
        </div>
      </Show>
    </section>
  );
}

/** Fetches the registry lazily; returns the resource plus a way to open it. */
export function createVetRegistry(needed: () => boolean) {
  const [opened, setOpened] = createSignal(false);
  const [registry] = createResource(
    () => (needed() || opened() ? "vets" : undefined),
    () => loadVets(),
  );
  return { registry, open: () => setOpened(true) };
}
