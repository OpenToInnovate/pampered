/**
 * The search box. One input, one clear button, no filters hidden inside it.
 *
 * Typing does not search; submitting does, and submitting is Enter or the
 * button. A search that fires on every keystroke is a search that fires twelve
 * database queries for "dog friendly cafe", eleven of which were for prefixes
 * nobody wanted. The 250ms debounce on input only updates the visible text.
 */
import { createEffect, createSignal } from "solid-js";

export default function SearchBar(props: { value: string; onSearch: (q: string) => void }) {
  const [text, setText] = createSignal(props.value);
  let input: HTMLInputElement | undefined;

  // The URL is the source of truth; when back/forward changes it, the box follows.
  createEffect(() => setText(props.value));

  const submit = () => props.onSearch(text().trim());

  return (
    <form
      class="search-bar"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" />
        <path d="M16.5 16.5L21 21" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
      <label class="sr-only" for="site-search">
        Search dog-friendly places
      </label>
      <input
        ref={input}
        id="site-search"
        type="search"
        autocomplete="off"
        autocapitalize="off"
        spellcheck={false}
        enterkeyhint="search"
        placeholder="Search pubs, parks, cafés…"
        value={text()}
        onInput={(e) => setText(e.currentTarget.value)}
      />
      {text() && (
        <button
          type="button"
          class="btn btn-quiet btn-icon search-clear"
          aria-label="Clear search"
          onClick={() => {
            setText("");
            input?.focus();
            props.onSearch("");
          }}
        >
          ×
        </button>
      )}
      <button type="submit" class="btn btn-primary search-go">
        Search
      </button>
    </form>
  );
}