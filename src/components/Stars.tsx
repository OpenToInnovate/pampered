/**
 * A 1–5 star readout for vet practices.
 *
 * It is built from the facts we can prove about a practice — an address, a
 * phone number, a website, opening hours, step-free access, a named operator, a
 * description, a recorded survey date — never from reviews. Calling it a review
 * score would be a claim we cannot back, so the label says what it is.
 */
export default function Stars(props: { value: number; class?: string }) {
  const n = () => Math.max(1, Math.min(5, Math.round(props.value || 1)));
  return (
    <span
      class={`stars ${props.class ?? ""}`}
      role="img"
      aria-label={`${n()} out of 5 for verified details`}
      title="Built from the verified details we hold — not a review score"
    >
      <span aria-hidden="true">
        {"★".repeat(n())}
        {"☆".repeat(5 - n())}
      </span>
    </span>
  );
}
