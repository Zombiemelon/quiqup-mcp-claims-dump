/**
 * Typed client for the Quiqup Audit service at audit.quiqup.com.
 *
 * AUTH EXCEPTION — read carefully:
 *   This client deliberately sends NO Authorization header. The Audit service
 *   (source-doc §19 B line 4258) is described as "no auth header — public read
 *   or service-internal" on the Quiqdash frontend. From the MCP server's
 *   perspective the audit endpoint is service-internal: only authenticated
 *   MCP callers can reach it (Clerk gates the MCP transport in
 *   `app/[transport]/route.ts` via `withMcpAuth`), and the audit service
 *   trusts its network boundary. Adding a Bearer header here would not just
 *   be redundant — it would fail upstream because the Audit service does
 *   NOT speak Clerk session-JWTs.
 *
 *   This is the SECOND non-Quiqup-auth client in the MCP server after
 *   Google Places (lib/clients/google-places.ts). The exception is locked
 *   in by tests/clients/audit.test.ts (asserts the outbound request has no
 *   Authorization header). Do NOT "fix" the missing Bearer header by
 *   mistake — see the same comment in lib/clients/google-places.ts for the
 *   precedent.
 *
 *   The Clerk gate on the MCP transport (route.ts withMcpAuth) is what
 *   keeps unauthenticated callers out. The Audit client itself is
 *   unauthenticated by design.
 *
 * Error model: HTTP non-2xx maps to `AuditError` (status + raw body). A
 * separate error class — not `QuiqupHttpError` — because Audit is not a
 * Quiqup-prefixed service in our internal nomenclature, and conflating
 * their error contracts would muddle which tool emitted what. Tools that
 * want the unified `isError: true` envelope from the registerTool wrapper
 * can translate AuditError → QuiqupHttpError at the tool boundary (the
 * google-places.ts → lookup-google-place.ts handoff is the precedent).
 *
 * Endpoint shape (per source-doc §19 B lines 4258-4263):
 *   GET {AUDIT_BASE_URL}/events?resourceID.eq=<orderUuid>
 *     → { events: [{ eventID, resourceID, occurredAt, actor, action, changes }] }
 */

import type { QuiqupEnvironment } from "./quiqup-env";

/**
 * Canonical Audit service host URLs. Env-var overrides
 * (`AUDIT_BASE_URL` / `AUDIT_STAGING_BASE_URL`) take precedence —
 * see `getAuditBaseUrl`.
 */
export const AUDIT_BASE_URLS = {
  production: "https://audit.quiqup.com",
  staging: "https://audit.staging.quiqup.com",
} as const;

/**
 * Env-var-overridable base-URL resolver. Mirrors the prod/staging
 * convention used by `getLastmileBaseUrl` / `getPlatformApiBaseUrl` /
 * `getQuiqupRestBaseUrl`. Overrides are per-environment: setting prod
 * does not affect staging, and vice-versa.
 */
export function getAuditBaseUrl(
  env: QuiqupEnvironment = "production",
): string {
  if (env === "staging") {
    return (
      process.env.AUDIT_STAGING_BASE_URL ?? AUDIT_BASE_URLS.staging
    );
  }
  return process.env.AUDIT_BASE_URL ?? AUDIT_BASE_URLS.production;
}

export class AuditError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Audit ${status}`);
    this.name = "AuditError";
  }
}

export interface AuditClientOptions {
  /** Explicit base URL override (e.g. for tests). Wins over `environment`. */
  baseUrl?: string;
  /** Selects the cluster when `baseUrl` is not provided. Defaults to production. */
  environment?: QuiqupEnvironment;
  // NOTE: no `jwt` field. The Audit service is no-auth by upstream design
  // (see file header). Adding a JWT would be both useless and a structural
  // violation of the auth-exception contract.
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface AuditRequestInit {
  query?: Record<string, string | number | undefined>;
}

export class AuditClient {
  constructor(private readonly opts: AuditClientOptions = {}) {}

  /**
   * Issue a request against the Audit service. Query parameters are
   * appended via URLSearchParams — dotted keys (e.g. `resourceID.eq`)
   * round-trip intact, which is critical for the documented
   * resourceID.eq=<uuid> filter shape.
   *
   * Headers sent:
   *   - Accept: application/json
   *   No other headers. Specifically: no auth-style header of any kind.
   *   See the AUTH EXCEPTION block in the file header for why.
   */
  async request(
    method: HttpMethod,
    path: string,
    init: AuditRequestInit = {},
  ): Promise<unknown> {
    const base = this.opts.baseUrl ?? getAuditBaseUrl(this.opts.environment);
    const url = new URL(`${base}${path}`);
    if (init.query) {
      for (const [k, v] of Object.entries(init.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    const res = await fetch(url.toString(), {
      method,
      headers: {
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new AuditError(res.status, await res.text());
    }
    if (res.status === 204) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return res.json();
    }
    return res.text();
  }
}
