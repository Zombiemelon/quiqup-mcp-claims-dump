/**
 * Quiqup outbound auth — V3b (Clerk session-JWT exchange).
 *
 * Why this file exists, V3b edition:
 * The MCP receives an OAuth `at+jwt` token from Claude.ai (validated in
 * route.ts via `auth({ acceptsToken: 'oauth_token' })`). Quiqup's API gateway
 * speaks Clerk JWTs natively (see `quiqupltd/quiqup-platform`
 * /auth/auth_api/domain/service.go → `getUserFromClerkJWT`) — but ONLY the
 * session-JWT shape with the "default" template's custom claims
 * (`salesforceID`, `email`, `orgID`, `coreID`, `orgRole`, `firstName`, `lastName`,
 * `courierSalesforceID`). Our inbound `at+jwt` doesn't have those claims.
 *
 * So this module is a token translator: take the inbound user's Clerk `userId`,
 * use Clerk's backend SDK to mint a fresh session-shaped JWT for that user
 * with the "default" template, then forward THAT to Quiqup. No Quiqup-side
 * partner credentials are stored. The only stored secret is `CLERK_SECRET_KEY` —
 * the MCP server's identity at the IdP, used both here and for any future
 * actor-token / impersonation flows.
 *
 * Why not the previous V1 (`client_credentials` flow): V1 stored a Quiqup
 * partner OAuth2 client_id/secret in env. The user identity never crossed the
 * outbound boundary, so the BFF held credentials for *both* trust domains.
 * V3b eliminates the outbound credential entirely — the user's Clerk identity
 * is the credential, after a same-IdP shape conversion.
 */

import { createClerkClient } from "@clerk/backend";

const QUIQUP_LASTMILE_BASE = "https://api-ae.quiqup.com";

// Matches what Quiqdash sends (verified empirically in Clerk dashboard:
// Sessions → JWT templates → "default" — claims include salesforceID etc.).
// Quiqup's auth handler expects exactly this template's output.
const SESSION_JWT_TEMPLATE = "default";

const clerk = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

type CachedAuth = {
  // The Clerk-managed session row we created (or reused) for this user.
  // Sessions live for hours/days; we reuse them across token rotations.
  sessionId: string;
  // The minted templated JWT. Lifetime ~60s real (per Clerk's session JWT
  // behaviour — the dashboard says longer, but observed real lifetime is short).
  jwt: string;
  // Absolute epoch-ms when we'll re-mint. 50s gives a 10s safety margin.
  expiresAt: number;
};

// Module-scoped cache keyed by Clerk userId. Lost on cold start — that's fine,
// re-creating a session + minting a token is ~one round-trip.
const cache = new Map<string, CachedAuth>();

/**
 * Mints (or returns cached) a Clerk session JWT for the given userId, using
 * the "default" template — i.e. the same shape Quiqup's gateway accepts from
 * Quiqdash. Reuses sessions across token rotations to avoid piling up
 * server-managed sessions at Clerk.
 */
async function getQuiqupReadyJwt(userId: string): Promise<string> {
  const cached = cache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.jwt;

  // Reuse an existing session if we have one cached; otherwise create one.
  let sessionId = cached?.sessionId;
  if (!sessionId) {
    const session = await clerk.sessions.createSession({ userId });
    sessionId = session.id;
  }

  // Mint a fresh JWT for this session with the templated claims.
  let jwt: string;
  try {
    const result = await clerk.sessions.getToken(sessionId, SESSION_JWT_TEMPLATE);
    jwt = result.jwt;
  } catch {
    // The cached session may have expired or been revoked server-side. Make
    // a fresh one and try again. If that fails, the error bubbles up.
    const session = await clerk.sessions.createSession({ userId });
    sessionId = session.id;
    const result = await clerk.sessions.getToken(sessionId, SESSION_JWT_TEMPLATE);
    jwt = result.jwt;
  }

  cache.set(userId, {
    sessionId,
    jwt,
    expiresAt: Date.now() + 50_000,
  });
  return jwt;
}

/**
 * Authenticated GET against the Quiqup last-mile API on behalf of the given
 * Clerk userId. The user's identity (via the minted session JWT) IS the
 * outbound credential — no separate Quiqup OAuth client involved.
 *
 * Pass query keys verbatim (e.g. `filters[state]`); URLSearchParams
 * percent-encodes the brackets that fetch otherwise rejects.
 */
export async function quiqupLastmileGet<T = unknown>(
  path: string,
  query: Record<string, string | number>,
  userId: string,
): Promise<T> {
  if (!userId) {
    throw new Error(
      "quiqupLastmileGet requires the authenticated Clerk userId — pass clerkAuth.subject from the inbound AuthInfo.",
    );
  }
  if (!process.env.CLERK_SECRET_KEY) {
    throw new Error(
      "Missing CLERK_SECRET_KEY — required for backend session minting. Set it in Vercel env.",
    );
  }

  const jwt = await getQuiqupReadyJwt(userId);

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) qs.append(k, String(v));
  const url = `${QUIQUP_LASTMILE_BASE}${path}${qs.size ? `?${qs.toString()}` : ""}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Quiqup ${path} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}
