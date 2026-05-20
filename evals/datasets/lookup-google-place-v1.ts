/**
 * lookup-google-place-v1 — first eval dataset for the Google Places family.
 *
 * Each item: a natural-language merchant question + the canonical
 * `lookup_google_place` tool call. Scored by ../score-lookup-google-place.ts.
 *
 * The dataset deliberately keeps every place_id literal — Google place_ids
 * are opaque and a competent agent must surface them verbatim. The
 * field_mask item exercises the optional override path.
 *
 * No real merchant data, no real PII. The single place_id-shaped string
 * (`ChIJN1t_tDeuEmsRUsoyG83frY4`) is Google's own published "Google Sydney"
 * example from the Places (New) docs.
 *
 * Tool-side reference (lib/tools/lookup-google-place.ts):
 *   place_id   — REQUIRED, Google Places (New) place_id string.
 *   field_mask — OPTIONAL X-Goog-FieldMask override.
 */

export const TODAY = "2026-05-19";

export interface LookupGooglePlaceInput {
  request: string;
}

export interface LookupGooglePlaceExpected {
  tool: "lookup_google_place";
  args: Record<string, unknown>;
}

export interface LookupGooglePlaceItem {
  input: LookupGooglePlaceInput;
  expectedOutput: LookupGooglePlaceExpected;
}

export const items: LookupGooglePlaceItem[] = [
  {
    input: {
      request:
        "Resolve Google place_id ChIJN1t_tDeuEmsRUsoyG83frY4 to the full place details.",
    },
    expectedOutput: {
      tool: "lookup_google_place",
      args: { place_id: "ChIJN1t_tDeuEmsRUsoyG83frY4" },
    },
  },
  {
    input: {
      request:
        "Look up place ChIJBxxxxxxxxxxxxxx but I only need the formattedAddress field back.",
    },
    expectedOutput: {
      tool: "lookup_google_place",
      args: {
        place_id: "ChIJBxxxxxxxxxxxxxx",
        field_mask: "formattedAddress",
      },
    },
  },
  {
    input: {
      request:
        "Find the formatted address for Google place_id XYZ12345.",
    },
    expectedOutput: {
      tool: "lookup_google_place",
      args: { place_id: "XYZ12345" },
    },
  },
  {
    input: {
      request:
        "Pull the location coordinates for place_id ChIJabcDEF — just lat/lng, no extras.",
    },
    expectedOutput: {
      tool: "lookup_google_place",
      args: {
        place_id: "ChIJabcDEF",
        field_mask: "location",
      },
    },
  },
  {
    input: {
      request:
        "I have a Google Maps autocomplete result, place_id ChIJpartner-warehouse-1. Give me the displayName and addressComponents.",
    },
    expectedOutput: {
      tool: "lookup_google_place",
      args: {
        place_id: "ChIJpartner-warehouse-1",
        field_mask: "displayName,addressComponents",
      },
    },
  },
];
