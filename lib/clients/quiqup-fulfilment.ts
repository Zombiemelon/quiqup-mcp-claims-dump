/**
 * Typed client for the Quiqup Fulfilment API at platform-api.quiqup.com.
 *
 * Auth model: V3b same-IdP exchange. The handler resolves the user's
 * Clerk session JWT via getQuiqupReadyJwt and forwards it as the bearer
 * token. No Quiqup-side partner secret is stored on this server.
 *
 * Error model: HTTP non-2xx maps to QuiqupHttpError carrying status +
 * raw body. Tools translate these into MCP errors at the handler layer.
 *
 * Method shape: generic request() for M3 thin-pass-through tools. M4 will
 * add typed wrappers for tools that get hardened with cassettes + tests.
 *
 * Cross-border note (per references/endpoints.md): the fulfilment PATCH
 * endpoint /api/fulfilment/orders/{id} only routes domestic orders. For
 * service_kind in {partner_export, partner_next_day} with non-AE
 * destinations, use api-ae.quiqup.com PUT /orders/export/{id} via the
 * lastmile client instead. The update_fulfilment_order tool delegates that
 * routing decision to the LLM via tool description.
 */

import { QuiqupHttpError, type HttpMethod } from "./quiqup-lastmile";
import { getFulfilmentBaseUrl, type QuiqupEnvironment } from "./quiqup-env";

export interface QuiqupFulfilmentClientOptions {
  jwt: string;
  /** Explicit base URL override (e.g. for tests). Wins over `environment`. */
  baseUrl?: string;
  /** Selects the cluster when `baseUrl` is not provided. Defaults to production. */
  environment?: QuiqupEnvironment;
}

export class QuiqupFulfilmentClient {
  constructor(private readonly opts: QuiqupFulfilmentClientOptions) {}

  async request(
    method: HttpMethod,
    path: string,
    init: { body?: unknown; query?: Record<string, string | number | undefined> } = {},
  ): Promise<unknown> {
    const base = this.opts.baseUrl ?? getFulfilmentBaseUrl(this.opts.environment);
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
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) {
      throw new QuiqupHttpError(res.status, await res.text());
    }
    if (res.status === 204) return null;
    return res.json();
  }
}

export { QuiqupHttpError };
