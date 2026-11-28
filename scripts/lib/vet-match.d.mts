/** Types for the plain-JS matching rules, so TypeScript can test them. */

export interface VetMatchRow {
  selections?: string[];
  brand?: string | null;
  name?: string | null;
  operator?: string | null;
  street?: string | null;
  postcode?: string | null;
  phone?: string | null;
  website?: string | null;
  opening_hours?: string | null;
  wheelchair?: string | null;
  description?: string | null;
  checked_on?: string | null;
}

export interface VetProviderLike {
  id: string;
  match?: string[];
  /** Default true. False refuses a name-only match. */
  match_names?: boolean;
}

export function vetProviderOf(row: VetMatchRow, vets: VetProviderLike[]): string | null;
export function vetRating(row: VetMatchRow): number;
