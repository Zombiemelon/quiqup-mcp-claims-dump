/**
 * Typed client for the Quiqup Orders Core REST API at
 * orders-api.quiqup.com (production) and orders-api.staging.quiqup.com
 * (staging). Sibling of orders-core-graphql.ts: SAME upstream BE service,
 * different protocol/route (GraphQL POSTs to `/graph`; REST hits per-
 * resource paths like `/orders-by-client-id/{clientOrderID}/documents`).
 *
 * Auth model: V3b same-IdP exchange — IDENTICAL to quiqup-lastmile.ts,
 * quiqup-fulfilment.ts, orders-core-graphql.ts, and ex-core.ts. The
 * handler resolves the user's Clerk session JWT via getQuiqupReadyJwt
 * and forwards it as the bearer token. NOT an auth-exception client.
 *
 * Error model: reuses `QuiqupHttpError` from `./quiqup-lastmile` —
 * Orders Core is a Quiqup-prefixed service so reusing the type keeps
 * the registerTool wrapper's QuiqupHttpError → MCP-error mapping
 * working without per-client branching. (Compare ex-core.ts which uses
 * a distinct ExCoreError because Ex-core is a separate operational
 * backstop with its own conventions even though the auth bridge is
 * shared.)
 *
 * Fallback chain (CRITICAL — preserves FE ergonomics): the Quiqdash
 * frontend derives this REST host from `VITE_ORDERS_API_BASE_URL` with
 * fallback to `ORDERS_API_GRAPH_URL` minus the `/graph` suffix
 * (source-doc §1 line 21). We mirror that on the server:
 *   1. staging:  ORDERS_API_STAGING_BASE_URL
 *             → QUIQUP_ORDERS_GRAPH_STAGING_URL with /graph stripped
 *             → canonical staging URL
 *   2. production: ORDERS_API_BASE_URL
 *             → QUIQUP_ORDERS_GRAPH_URL with /graph stripped
 *             → canonical production URL
 * Rationale: in dev a single env var (`QUIQUP_ORDERS_GRAPH_URL=
 * https://localhost.test/graph`) redirects BOTH the 03-01 GraphQL
 * client AND this REST client to the same dev host. One env var, two
 * surfaces, matching the FE.
 *
 * Multipart: `requestMultipart` builds a multipart/form-data POST.
 * CRITICAL: we DO NOT set the `Content-Type` header manually. The
 * runtime sets `multipart/form-data; boundary=<random>` automatically
 * when given a FormData body. Setting it manually clobbers the boundary
 * and the upstream rejects the body. This is locked in by the runtime
 * test in tests/clients/orders-core-rest.test.ts (and the source-level
 * grep gate in the plan's acceptance criteria).
 */

import { QuiqupHttpError, type HttpMethod } from "./quiqup-lastmile";
import type { QuiqupEnvironment } from "./quiqup-env";

/** Canonical Orders Core REST base URLs by environment. */
export const ORDERS_REST_BASE_URLS = {
  production: "https://orders-api.quiqup.com",
  staging: "https://orders-api.staging.quiqup.com",
} as const;

/**
 * Strip a trailing `/graph` segment from a URL (case-sensitive — the
 * canonical FE constant is lower-case). Used by the fallback chain to
 * derive the REST host from the GraphQL host env var. Mirrors the FE's
 * VITE_ORDERS_API_BASE_URL ?? VITE_ORDERS_API_GRAPH_URL.replace(/\/graph$/, '').
 */
function stripGraphSuffix(url: string): string {
  return url.replace(/\/graph$/, "");
}

/**
 * Env-var-overridable base-URL resolver implementing the documented
 * fallback chain (see file header). Overrides are per-environment:
 * setting prod does not affect staging.
 */
export function getOrdersRestBaseUrl(
  env: QuiqupEnvironment = "production",
): string {
  if (env === "staging") {
    if (process.env.ORDERS_API_STAGING_BASE_URL) {
      return process.env.ORDERS_API_STAGING_BASE_URL;
    }
    if (process.env.QUIQUP_ORDERS_GRAPH_STAGING_URL) {
      return stripGraphSuffix(process.env.QUIQUP_ORDERS_GRAPH_STAGING_URL);
    }
    return ORDERS_REST_BASE_URLS.staging;
  }
  if (process.env.ORDERS_API_BASE_URL) {
    return process.env.ORDERS_API_BASE_URL;
  }
  if (process.env.QUIQUP_ORDERS_GRAPH_URL) {
    return stripGraphSuffix(process.env.QUIQUP_ORDERS_GRAPH_URL);
  }
  return ORDERS_REST_BASE_URLS.production;
}

export interface OrdersCoreRestClientOptions {
  jwt: string;
  /** Explicit base URL override (e.g. for tests). Wins over `environment`. */
  baseUrl?: string;
  /** Selects the cluster when `baseUrl` is not provided. Defaults to production. */
  environment?: QuiqupEnvironment;
}

export class OrdersCoreRestClient {
  constructor(private readonly opts: OrdersCoreRestClientOptions) {}

  /**
   * Generic JSON request. Mirrors quiqup-lastmile.ts's `request` shape.
   *
   * Wire shape: `${method} ${baseUrl}${path}?<query>` with JSON body
   * when supplied. Headers: Authorization Bearer, Accept JSON, Content-
   * Type JSON (when body present).
   */
  async request(
    method: HttpMethod,
    path: string,
    init: {
      body?: unknown;
      query?: Record<string, string | number | undefined>;
    } = {},
  ): Promise<unknown> {
    const base = this.opts.baseUrl ?? getOrdersRestBaseUrl(this.opts.environment);
    const url = new URL(`${base}${path}`);
    if (init.query) {
      for (const [k, v] of Object.entries(init.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }
    const res = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${this.opts.jwt}`,
        Accept: "application/json",
        ...(init.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) {
      throw new QuiqupHttpError(res.status, await res.text());
    }
    if (res.status === 204) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return res.json();
    }
    return null;
  }

  /**
   * Multipart POST. Used for document uploads (ORDS-08 → POST
   * /orders-by-client-id/{clientOrderID}/documents).
   *
   * CRITICAL: do NOT set Content-Type manually. The runtime sets
   * `multipart/form-data; boundary=<random>` automatically when given a
   * FormData body. Manual override clobbers the boundary and the
   * upstream rejects the body.
   *
   * Return contract:
   *   - HTTP non-2xx → throws QuiqupHttpError(status, body).
   *   - HTTP 200 with JSON content-type → parsed JSON.
   *   - HTTP 200 otherwise → null (matches the FE which only checks
   *     `response.ok` for this endpoint per source-doc line 4674).
   */
  async requestMultipart(
    method: HttpMethod,
    path: string,
    formData: FormData,
  ): Promise<unknown> {
    const base = this.opts.baseUrl ?? getOrdersRestBaseUrl(this.opts.environment);
    const url = `${base}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.opts.jwt}`,
        Accept: "application/json",
        // INTENTIONALLY no Content-Type — the runtime sets
        // `multipart/form-data; boundary=...` from the FormData body.
      },
      body: formData,
    });
    if (!res.ok) {
      throw new QuiqupHttpError(res.status, await res.text());
    }
    if (res.status === 204) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return res.json();
    }
    return null;
  }
}
