/**
 * Matching a practice to its provider, and the star readout.
 *
 * Pure functions with no I/O so the tests can import them without running the
 * build. The build step owns the files; this owns the rules.
 */

/**
 * The provider a vet practice belongs to, from the brands the data actually
 * carries. Matching is on OSM's brand, name or operator, and only for rows in
 * the vet selection — a pub called "Blue Cross" is not a veterinary charity.
 * Fragments are checked in vets.yaml order, so specific names win.
 */
export function vetProviderOf(row, vets) {
  if (!row.selections?.includes("vet")) return null;
  for (const provider of vets) {
    // A provider may require a brand or operator match and refuse a bare name:
    // "Creature Comforts" in Blackheath is a veterinary practice, but it is not
    // one of the branches the group publishes, so the name alone is not proof.
    const haystacks = (provider.match_names === false
      ? [row.brand, row.operator]
      : [row.brand, row.name, row.operator]
    )
      .filter(Boolean)
      .map((v) => String(v).toLowerCase());
    if (!haystacks.length) continue;
    for (const fragment of provider.match ?? []) {
      const needle = String(fragment).toLowerCase();
      if (needle && haystacks.some((h) => h.includes(needle))) return provider.id;
    }
  }
  return null;
}

/**
 * A star rating built only from facts we can prove about the practice: an
 * address, a phone number, a website, opening hours, step-free access, a named
 * operator, a description, and a recorded survey date. It is a measure of how
 * much is known — never a review score, and never a claim about care. Rows with
 * nothing but a name get one star rather than zero, because the pin is real.
 */
export function vetRating(row) {
  const signals = [
    Boolean(row.street && row.postcode),
    Boolean(row.phone),
    Boolean(row.website),
    Boolean(row.opening_hours),
    Boolean(row.wheelchair),
    Boolean(row.operator || row.brand),
    Boolean(row.description),
    Boolean(row.checked_on),
  ];
  const score = signals.filter(Boolean).length;
  return Math.min(5, Math.max(1, 1 + Math.round((score / signals.length) * 4)));
}

