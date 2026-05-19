/**
 * Typed client for the Google Places (New) API at https://places.googleapis.com.
 *
 * AUTH EXCEPTION — read carefully:
 *   This client deliberately BYPASSES the Clerk → Quiqup actor-token bridge
 *   (`getQuiqupReadyJwt` in lib/quiqup.ts). Google Places is NOT a Quiqup
 *   service: Quiqup never sees these requests, and Google does not understand
 *   the Clerk session-JWT we mint for the Quiqup gateway. Instead, this
 *   client uses a server-side API key (`GOOGLE_PLACES_API_KEY` env var) sent
 *   on the `X-Goog-Api-Key` header, as required by the Places (New) API.
 *
 *   The API key is loaded server-side and MUST NEVER be:
 *     - returned to the MCP agent in any tool result,
 *     - logged or echoed in any error message,
 *     - included in any tool input/output schema.
 *
 *   This is the ONLY non-Quiqup-auth client in the MCP server. Every other
 *   upstream HTTP path runs through `getQuiqupReadyJwt` + Bearer; this one
 *   intentionally does not. The exception is locked in by tests
 *   (tests/tools/google-places.test.ts) and documented here so future
 *   reviewers do not "fix" the missing Bearer header by mistake.
 *
 * Error model: HTTP non-2xx maps to `GooglePlacesError` (status + raw body).
 * The lookup_google_place handler translates this to `QuiqupHttpError` at
 * the tool boundary so the registerTool wrapper produces the same MCP
 * isError shape that every other tool emits — agents see one error contract.
 */

export class GooglePlacesError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Google Places ${status}`);
    this.name = "GooglePlacesError";
  }
}

export interface GooglePlacesClientOptions {
  /**
   * Server-side API key from `process.env.GOOGLE_PLACES_API_KEY`. Sent on
   * the `X-Goog-Api-Key` request header. NEVER echo back to the agent.
   */
  apiKey: string;
  /**
   * Optional base-URL override. Defaults to
   * `process.env.GOOGLE_PLACES_BASE_URL` if set, else the canonical
   * `https://places.googleapis.com`. Used by tests to point MSW at a
   * stable host.
   */
  baseUrl?: string;
  /**
   * Optional default `X-Goog-FieldMask` value. The Places (New) API
   * REQUIRES a field mask on every request. Default covers the fields the
   * MCP agent typically needs to feed into create_partner_address /
   * order-creation waypoints.
   */
  defaultFieldMask?: string;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface GooglePlacesRequestInit {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Per-call override for the X-Goog-FieldMask header. */
  fieldMask?: string;
}

const DEFAULT_FIELD_MASK =
  "id,displayName,formattedAddress,location,addressComponents,types";

const DEFAULT_BASE_URL = "https://places.googleapis.com";

export class GooglePlacesClient {
  constructor(private readonly opts: GooglePlacesClientOptions) {}

  /**
   * Issue a request against the Places (New) API.
   *
   * Headers sent:
   *   - X-Goog-Api-Key: <apiKey>          (the API-key header — replaces Bearer)
   *   - X-Goog-FieldMask: <fieldMask>      (Places (New) requires this)
   *   - Accept: application/json
   *   - Content-Type: application/json     (only when body is present)
   *
   * Note: this client deliberately sends no bearer-style auth header — it
   * does not participate in the Clerk → Quiqup actor-token bridge by design.
   */
  async request(
    method: HttpMethod,
    path: string,
    init: GooglePlacesRequestInit = {},
  ): Promise<unknown> {
    const base =
      this.opts.baseUrl ??
      process.env.GOOGLE_PLACES_BASE_URL ??
      DEFAULT_BASE_URL;
    const url = new URL(`${base}${path}`);
    if (init.query) {
      for (const [k, v] of Object.entries(init.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    const fieldMask =
      init.fieldMask ?? this.opts.defaultFieldMask ?? DEFAULT_FIELD_MASK;

    const headers: Record<string, string> = {
      "X-Goog-Api-Key": this.opts.apiKey,
      "X-Goog-FieldMask": fieldMask,
      Accept: "application/json",
    };
    if (init.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(url.toString(), {
      method,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

    if (!res.ok) {
      // IMPORTANT: do not include `this.opts.apiKey` in the error body or
      // any wrapping message. The raw upstream body from Google Places
      // does not echo the key, so passing it through verbatim is safe.
      throw new GooglePlacesError(res.status, await res.text());
    }
    if (res.status === 204) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return res.json();
    }
    return res.text();
  }
}

// Re-export DEFAULT_FIELD_MASK so the tool layer can use it as the default
// when no per-call override is supplied. Exported from this module (not the
// tool file) because it is a property of the client's wire contract.
export const GOOGLE_PLACES_DEFAULT_FIELD_MASK = DEFAULT_FIELD_MASK;
