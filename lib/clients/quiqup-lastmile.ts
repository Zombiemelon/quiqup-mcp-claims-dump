/**
 * Typed client for the Quiqup Last-Mile API at api-ae.quiqup.com.
 *
 * Auth model: V3b same-IdP exchange. The handler resolves the user's
 * Clerk session JWT via getQuiqupReadyJwt and forwards it as the bearer
 * token. No Quiqup-side partner secret is stored on this server.
 *
 * Error model: HTTP non-2xx maps to QuiqupHttpError carrying status +
 * raw body. Tools translate these into MCP errors at the handler layer.
 *
 * Method shape: typed wrappers for tools that have hardened tests
 * (e.g. getOrder), plus a generic request() for the M3 thin-pass-through
 * tools that share the same auth + error model. The thin tools land
 * without cassettes/error-mapping per Slava's hybrid speed call
 * (2026-05-03); M4 will retroactively harden them.
 */

const BASE_URL = process.env.QUIQUP_LASTMILE_BASE_URL ?? "https://api-ae.quiqup.com";

export class QuiqupHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Quiqup ${status}`);
    this.name = "QuiqupHttpError";
  }
}

export interface QuiqupLastmileClientOptions {
  jwt: string;
  baseUrl?: string;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export class QuiqupLastmileClient {
  constructor(private readonly opts: QuiqupLastmileClientOptions) {}

  async getOrder(orderId: string): Promise<unknown> {
    return this.request("GET", `/orders/${encodeURIComponent(orderId)}`);
  }

  /**
   * Generic typed-pass-through. Used by M3 thin tools that don't (yet) have
   * dedicated typed methods. Body is JSON-serialized when present.
   * Query is appended as ?key=value.
   */
  async request(
    method: HttpMethod,
    path: string,
    init: { body?: unknown; query?: Record<string, string | number | undefined> } = {},
  ): Promise<unknown> {
    const url = new URL(`${this.opts.baseUrl ?? BASE_URL}${path}`);
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
    // 204 No Content path: no body to parse.
    if (res.status === 204) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return res.json();
    }
    // Binary or other non-JSON (e.g. PDF labels): return base64.
    const buf = await res.arrayBuffer();
    return {
      contentType,
      base64: Buffer.from(buf).toString("base64"),
    };
  }
}
