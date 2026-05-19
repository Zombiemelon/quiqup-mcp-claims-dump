# platformApiFetch helper — extraction follow-up

**Source:** 02-REVIEW WR-07 (deferred during rapid-fix mode)
**Status:** deferred — 50-file refactor across Phase 1 + Phase 2 tools
**Owner:** TBD (next phase that touches the integration surface)

## Why

Every Platform-API tool currently inlines the same five-line block:

```ts
const jwt = await getQuiqupReadyJwt(auth.userId);
const platformApiBase = getPlatformApiBaseUrl(args.environment);
const res = await fetch(`${platformApiBase}/...`, {
  method: "GET",
  headers: { Authorization: `Bearer ${jwt}`, Accept: "application/json" },
});
if (!res.ok) throw new QuiqupHttpError(res.status, await res.text());
const data = await res.json();
```

Grep confirms ~50 tool files repeat this. Each is an opportunity to
forget the `if (!res.ok)` line, pass the wrong `Accept` header, build a
URL without `encodeURIComponent`, or accidentally include a body on a
DELETE. WR-07 was originally raised in the Phase-1 review (then
deferred); Phase-2 added another ~22 inlinings.

Crucially, the BL-03 fix (source-check pre-flight on
`delete_salla_connection`) needed exactly the same fetch-with-auth
pattern — but had to be hand-written again because no shared helper
exists.

## What to extract

`lib/clients/platform-api.ts` (new file):

```ts
import { getQuiqupReadyJwt } from "@/lib/quiqup";
import { QuiqupHttpError } from "@/lib/clients/quiqup-lastmile";
import { getPlatformApiBaseUrl, type QuiqupEnvironment } from "@/lib/clients/quiqup-env";

export interface PlatformApiFetchOpts {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;                            // serialized as JSON when present
  searchParams?: Record<string, string>;
}

export async function platformApiFetch(
  userId: string,
  environment: QuiqupEnvironment | undefined,
  path: string,                              // must start with "/"; caller responsible for encodeURIComponent
  opts: PlatformApiFetchOpts = {},
): Promise<unknown> {
  const jwt = await getQuiqupReadyJwt(userId);
  const base = getPlatformApiBaseUrl(environment);
  const url = new URL(`${base}${path}`);
  for (const [k, v] of Object.entries(opts.searchParams ?? {})) url.searchParams.set(k, v);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${jwt}`,
    Accept: "application/json",
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(url.toString(), {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new QuiqupHttpError(res.status, await res.text());
  if (res.status === 204) return null;
  return res.json();
}
```

## Migration plan

Don't do this in a single PR — keep diffs reviewable.

1. **PR 1:** land the helper module + unit tests (MSW-mocked). NO tool
   migrations in this PR.
2. **PR 2:** migrate the four destructive tools first
   (`delete_integration_source`, `delete_salla_connection`,
   `cancel_lastmile_orders_batch`, `confirm_ff_export`). These are
   short, well-tested, and the gate-pattern is what the helper most
   needs to support cleanly.
3. **PR 3..N:** migrate the read tools in batches of 5–8. Each batch
   should keep the test suite green and not change any external
   behaviour (the existing MSW tests pin the wire shape).

## Bonus: scope pre-flight

Once the helper exists, the BL-03 source-check pattern can move into
it as a generic option:

```ts
await platformApiFetch(userId, env, "/integrations/connections/{id}", {
  method: "DELETE",
  scope: { sourceMustBe: "salla" },
});
```

— meaning future "delete only if family X" tools become a one-line
configuration instead of a 30-line pre-flight reimplementation. Not
required for the first migration PR but worth keeping in the helper
shape from day one so the API doesn't have to break later.
