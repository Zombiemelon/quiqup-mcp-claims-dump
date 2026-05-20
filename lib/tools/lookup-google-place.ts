/**
 * `lookup_google_place` — resolve a Google Places (New) `place_id` to a
 * place-detail object (Phase 1 / ADDR-08).
 *
 * AUTH EXCEPTION — this is the ONLY tool in the MCP server that does NOT
 * go through the Clerk → Quiqup actor-token bridge:
 *   - Upstream is places.googleapis.com (not platform-api.quiqup.com).
 *   - Auth header is `X-Goog-Api-Key` with the server-side
 *     GOOGLE_PLACES_API_KEY env var — NEVER returned to the agent and
 *     NEVER echoed in any error message.
 *   - The Clerk session is still required at the handler boundary
 *     (`auth.userId` check below). This stops anonymous MCP calls from
 *     burning the shared Google API quota even though Google itself does
 *     not know about Clerk.
 *
 * Error translation: GooglePlacesError is caught at the tool boundary and
 * re-thrown as QuiqupHttpError so the registerTool wrapper produces the
 * same MCP isError result shape every other tool emits. Agents see one
 * error contract regardless of which upstream produced the failure.
 */

import { z } from "zod";
import type { ToolSpec } from "./register";
import { QuiqupHttpError } from "@/lib/clients/quiqup-lastmile";
import {
  GooglePlacesClient,
  GooglePlacesError,
} from "@/lib/clients/google-places";

const inputSchema = z.object({
  place_id: z
    .string()
    .min(1)
    .describe("Google Places (New) place_id, e.g. from Maps autocomplete"),
  field_mask: z
    .string()
    .optional()
    .describe(
      'Optional X-Goog-FieldMask override; default "id,displayName,formattedAddress,location,addressComponents,types".',
    ),
});

const outputSchema = z.object({}).passthrough();

export const spec: ToolSpec<typeof inputSchema, typeof outputSchema> = {
  name: "lookup_google_place",
  description:
    "Resolves a Google Places (New) place_id to a place object. " +
    "Authenticated via the GOOGLE_PLACES_API_KEY server env var — the only " +
    "MCP tool in this server that does NOT use the Clerk → Quiqup " +
    "actor-token bridge. The API key is server-side and never returned to " +
    "the agent. Use this after the address-autocomplete UI yields a " +
    "place_id; the response includes formattedAddress, displayName, " +
    "location {latitude, longitude}, and addressComponents you can feed " +
    "into create_partner_address or order-creation waypoint payloads. " +
    "Endpoint: GET places.googleapis.com/v1/places/{placeId}. " +
    "Error modes: 4xx surfaces as QuiqupHttpError so the agent sees the " +
    "same error contract as every other tool; the key is never echoed in " +
    "the error body. " +
    'Example: `{ "place_id": "ChIJBxxxxxxxxxxxxxx" }`.',
  inputSchema,
  outputSchema,
  handler: async (auth, args) => {
    // Clerk-session binding — enforced even though upstream auth uses an
    // API key. This stops anonymous MCP calls from burning Google API
    // quota (T-01-08 in the plan's threat register).
    if (!auth.userId) {
      throw new Error("lookup_google_place requires an authenticated user");
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      // IMPORTANT: do not include the env var value in this message — only
      // the var NAME. (T-01-10: API key never echoed in error output.)
      throw new Error(
        "GOOGLE_PLACES_API_KEY env var is required for lookup_google_place",
      );
    }

    const client = new GooglePlacesClient({ apiKey });

    try {
      const data = await client.request(
        "GET",
        `/v1/places/${encodeURIComponent(args.place_id)}`,
        { fieldMask: args.field_mask },
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    } catch (err) {
      // Translate the non-Quiqup error type into QuiqupHttpError at the
      // tool boundary so the registerTool wrapper produces the same MCP
      // isError shape as every other tool. The upstream body from Google
      // Places does not echo the API key, so passing it through verbatim
      // is safe (T-01-10).
      if (err instanceof GooglePlacesError) {
        throw new QuiqupHttpError(err.status, err.body);
      }
      throw err;
    }
  },
};
