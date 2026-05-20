/**
 * Typed client for the Quiqup Orders Core GraphQL API at
 * orders-api.quiqup.com/graph (production) and
 * orders-api.staging.quiqup.com/graph (staging).
 *
 * Service-host distinctness: this is a NEW egress host for the project
 * (Phase 3 / Wave 1) — separate from `api-ae.quiqup.com` (last-mile REST)
 * and `platform-api.quiqup.com` (fulfilment / account / reference data).
 * Orders Core hosts the GraphQL surface that powers Quiqdash's
 * bulk-orders flows (select-all pre-flight, bulk weight update, mission
 * re-fetch). Anything in this project that needs the GraphQL surface MUST
 * import from this module — do not roll a parallel client.
 *
 * Auth model: V3b same-IdP exchange — IDENTICAL to quiqup-lastmile.ts and
 * quiqup-fulfilment.ts. The handler resolves the user's Clerk session
 * JWT via getQuiqupReadyJwt and forwards it as the bearer token. No
 * Quiqup-side partner secret is stored on this server.
 *
 * Explicit non-pattern: this client does NOT replicate the
 * google-places.ts API-key auth exception. Google Places is a third-party
 * Google-hosted endpoint that doesn't speak our Clerk JWT shape; Orders
 * Core is a first-party Quiqup service that accepts the same session-JWT
 * as every other Quiqup egress in this project. Auth uniformity is what
 * lets the audit / pii-redact / withMcpAuth pipeline cover this host
 * without any per-tool branching.
 *
 * Error model:
 *   - HTTP non-2xx maps to QuiqupHttpError (imported from quiqup-lastmile)
 *     carrying status + raw body. The registerTool wrapper recognises this
 *     error type and turns it into the standard `isError: true` MCP result.
 *   - HTTP 200 with populated `errors[]` is NOT auto-thrown. GraphQL
 *     partial-success is a documented pattern (per GraphQL spec §7.1) —
 *     Quiqdash (Relay) renders both `data` and `errors` on the same
 *     response, and auto-throwing here would silently discard data the
 *     caller may still want. Instead, the client returns the full
 *     `{ data, errors }` envelope verbatim; the tool layer surfaces
 *     errors[] in its text output so the LLM sees them and can decide
 *     whether the response is actionable.
 *
 * Method shape: a single generic `query<T>(query, variables?)` covering
 * both ordersListingIdsQuery (ORDL-02) and bulkOrdersLookupQuery
 * (ORDL-03), and any future GraphQL-host tool. The endpoint is the host
 * itself — there are no path parameters; the operation is selected by
 * the `query` string in the POST body.
 *
 * The `query` string is ALWAYS an inline constant in the calling tool —
 * NEVER built from caller-supplied data (threat T-03-08). Variables go
 * on the `variables` envelope, JSON-serialised by `JSON.stringify`; no
 * string concatenation reaches the wire.
 */

import { QuiqupHttpError } from "./quiqup-lastmile";
import type { QuiqupEnvironment } from "./quiqup-env";

/**
 * Canonical Orders Core GraphQL endpoint URLs. The `/graph` suffix is
 * part of the canonical host string — per the Quiqdash frontend extract
 * (docs/quiqup-api-full-frontend-extract.md §1, VITE_ORDERS_API_BASE_URL
 * falls back to `ORDERS_API_GRAPH_URL` minus the `/graph` suffix). Tools
 * MUST hit this URL exactly; there is no path-parameter variant.
 */
export const ORDERS_GRAPH_URLS = {
  production: "https://orders-api.quiqup.com/graph",
  staging: "https://orders-api.staging.quiqup.com/graph",
} as const;

/**
 * Env-var-overridable base-URL resolver, mirroring the prod/staging
 * convention used by `getLastmileBaseUrl` and `getPlatformApiBaseUrl`.
 * The overrides exist for test/dev hooks (MSW binds to the override
 * host when set) and take precedence over the canonical URLs. They are
 * per-environment: setting prod does not affect staging.
 */
export function getOrdersGraphUrl(
  env: QuiqupEnvironment = "production",
): string {
  if (env === "staging") {
    return (
      process.env.QUIQUP_ORDERS_GRAPH_STAGING_URL ?? ORDERS_GRAPH_URLS.staging
    );
  }
  return (
    process.env.QUIQUP_ORDERS_GRAPH_URL ?? ORDERS_GRAPH_URLS.production
  );
}

export interface OrdersCoreGraphQLClientOptions {
  jwt: string;
  /** Explicit base URL override (e.g. for tests). Wins over `environment`. */
  baseUrl?: string;
  /** Selects the cluster when `baseUrl` is not provided. Defaults to production. */
  environment?: QuiqupEnvironment;
}

/**
 * Standard GraphQL response envelope. `data` is `T | null` (null on
 * total failure); `errors` is optional and may be populated even when
 * `data` is present (partial-success). The tool layer is responsible
 * for surfacing `errors` to the LLM.
 */
export interface GraphQLResponse<T = unknown> {
  data: T | null;
  errors?: unknown[];
}

export class OrdersCoreGraphQLClient {
  constructor(private readonly opts: OrdersCoreGraphQLClientOptions) {}

  /**
   * POST a GraphQL operation to the Orders Core endpoint.
   *
   * Wire shape: `POST {baseUrl}` with JSON body `{ query, variables }`.
   * Headers: `Authorization: Bearer <jwt>`, `Accept: application/json`,
   * `Content-Type: application/json`.
   *
   * Return contract:
   *   - HTTP non-2xx → throws QuiqupHttpError(status, body).
   *   - HTTP 200 → returns `{ data, errors? }` as-is. `errors[]` is
   *     surfaced; never auto-thrown (see file header for rationale).
   */
  async query<T = unknown>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<GraphQLResponse<T>> {
    const url = this.opts.baseUrl ?? getOrdersGraphUrl(this.opts.environment);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.opts.jwt}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      throw new QuiqupHttpError(res.status, await res.text());
    }

    // 200 path: parse the standard GraphQL envelope and return verbatim.
    // We DO NOT throw on populated `errors[]` — partial-success is a
    // documented GraphQL pattern; the tool layer surfaces errors so the
    // LLM can see them and decide whether the response is actionable.
    const payload = (await res.json()) as GraphQLResponse<T>;
    return payload;
  }
}
