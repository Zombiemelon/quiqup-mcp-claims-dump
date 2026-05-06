/**
 * Typed client for the Quiqup Last-Mile API at api-ae.quiqup.com.
 *
 * Auth model: V3b same-IdP exchange. The handler resolves the user's
 * Clerk session JWT via getQuiqupReadyJwt and forwards it as the bearer
 * token. No Quiqup-side partner secret is stored on this server.
 *
 * Error model: HTTP non-2xx maps to QuiqupHttpError carrying status +
 * raw body. Tools translate these into MCP errors at the handler layer.
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

export class QuiqupLastmileClient {
  constructor(private readonly opts: QuiqupLastmileClientOptions) {}

  async getOrder(orderId: string): Promise<unknown> {
    return this.get(`/orders/${encodeURIComponent(orderId)}`);
  }

  private async get(path: string): Promise<unknown> {
    const url = `${this.opts.baseUrl ?? BASE_URL}${path}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.opts.jwt}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      throw new QuiqupHttpError(res.status, await res.text());
    }
    return res.json();
  }
}
