/**
 * Quiqup environment selector — staging vs production.
 *
 * Every tool that hits Quiqup exposes an optional `environment` arg
 * (`production` | `staging`). Production is the default; staging is opt-in
 * and must be passed explicitly. The resolver picks the matching base URL
 * for the Last-Mile (`api-ae` / `api.staging`) and Fulfilment
 * (`platform-api` / `platform-api.staging`) hosts.
 *
 * The auth path is unchanged: V3b same-IdP exchange via Clerk. The minted
 * session-JWT carries the same identity in either environment — the
 * receiving cluster just decides whether to route to staging or prod
 * backends based on the host hit.
 *
 * Env-var overrides (`QUIQUP_*_BASE_URL` / `QUIQUP_*_STAGING_BASE_URL`)
 * exist for test/dev hooks and continue to take precedence over the
 * hard-coded URLs. They are *per-environment*: setting the prod override
 * does not affect staging calls and vice-versa.
 */
import { z } from "zod";

export const QUIQUP_LASTMILE_BASE_URLS = {
  production: "https://api-ae.quiqup.com",
  staging: "https://api.staging.quiqup.com",
} as const;

export const QUIQUP_FULFILMENT_BASE_URLS = {
  production: "https://platform-api.quiqup.com",
  staging: "https://platform-api.staging.quiqup.com",
} as const;

export const QUIQUP_ENVIRONMENTS = ["production", "staging"] as const;
export type QuiqupEnvironment = (typeof QUIQUP_ENVIRONMENTS)[number];

export const ENVIRONMENT_DESCRIPTION =
  "Quiqup environment to target. Defaults to `production`. Pass `staging` " +
  "explicitly to hit the staging cluster (api.staging.quiqup.com for " +
  "last-mile, platform-api.staging.quiqup.com for fulfilment).";

export const environmentField = z
  .enum(QUIQUP_ENVIRONMENTS)
  .default("production")
  .describe(ENVIRONMENT_DESCRIPTION);

export function getLastmileBaseUrl(env: QuiqupEnvironment = "production"): string {
  if (env === "staging") {
    return (
      process.env.QUIQUP_LASTMILE_STAGING_BASE_URL ??
      QUIQUP_LASTMILE_BASE_URLS.staging
    );
  }
  return (
    process.env.QUIQUP_LASTMILE_BASE_URL ?? QUIQUP_LASTMILE_BASE_URLS.production
  );
}

export function getFulfilmentBaseUrl(env: QuiqupEnvironment = "production"): string {
  if (env === "staging") {
    return (
      process.env.QUIQUP_FULFILMENT_STAGING_BASE_URL ??
      QUIQUP_FULFILMENT_BASE_URLS.staging
    );
  }
  return (
    process.env.QUIQUP_FULFILMENT_BASE_URL ??
    QUIQUP_FULFILMENT_BASE_URLS.production
  );
}

export function getPlatformApiBaseUrl(env: QuiqupEnvironment = "production"): string {
  if (env === "staging") {
    return (
      process.env.QUIQUP_PLATFORM_API_STAGING_BASE_URL ??
      QUIQUP_FULFILMENT_BASE_URLS.staging
    );
  }
  return (
    process.env.QUIQUP_PLATFORM_API_BASE_URL ??
    QUIQUP_FULFILMENT_BASE_URLS.production
  );
}

export function isQuiqupEnvironment(v: unknown): v is QuiqupEnvironment {
  return v === "production" || v === "staging";
}

/**
 * Canonical integration-source enum (Shopify, WooCommerce, Salla).
 *
 * Shared so the read side (`list_integration_connections[].source` doc) and
 * the write/delete side (`delete_integration_source.source`,
 * `repair_integration_orders.source`) move together. Adding a fourth family
 * (Magento, BigCommerce, etc.) is a one-line change here — drift between the
 * read shape and the delete/repair schemas can no longer happen silently
 * (02-REVIEW WR-05).
 */
export const INTEGRATION_SOURCES = ["shopify", "woocommerce", "salla"] as const;
export type IntegrationSource = (typeof INTEGRATION_SOURCES)[number];
export const integrationSourceField = z.enum(INTEGRATION_SOURCES);

/**
 * ISO-3166 alpha-2 country code: exactly two uppercase ASCII letters.
 *
 * Replaces the per-tool `z.string().length(2)` shape that admitted `"12"`,
 * `"  "`, `"\n\n"`, lowercase, etc. (02-REVIEW WR-01 — same pattern as
 * Phase-1 BL-02). Use this anywhere the upstream expects an ISO-3166
 * alpha-2 country code (`country_filter[]` on Salla / WooCommerce config,
 * future address country fields).
 */
export const iso3166Alpha2 = z
  .string()
  .regex(
    /^[A-Z]{2}$/,
    "must be ISO-3166 alpha-2: two uppercase ASCII letters, e.g. AE, SA",
  );
