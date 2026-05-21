/**
 * Shared multipart/form-data fetch helper.
 *
 * Used by:
 *   - `lib/clients/orders-core-rest.ts` → `requestMultipart` (ORDS-08, Phase 3)
 *   - `lib/clients/platform-api.ts`     → `requestMultipart` (ORDC-05, Phase 4)
 *
 * Why hoisted (decision recorded by 04-04 Task 2):
 *   Phase 3 added the multipart codec inline to `orders-core-rest.ts` for
 *   `upload_order_document` (ORDS-08). Phase 4 Wave 4 needs the same codec
 *   on the Platform host for `bulk_create_orders` (ORDC-05). Phase 6 will
 *   add a THIRD multipart consumer for the Fulfilment bulk-validate /
 *   bulk-commit product CSV uploads (also on the Platform host). With
 *   three callers in flight, the lift-and-shift to a shared helper avoids
 *   the "two copies of the same Content-Type-omission lockup" drift risk
 *   that 03-REVIEW explicitly called out.
 *
 * CRITICAL: this helper does NOT set the `Content-Type` header. The
 * runtime sets `multipart/form-data; boundary=<random>` automatically
 * when given a FormData body. Manually setting Content-Type clobbers the
 * boundary and the upstream rejects the body. This is the canonical
 * 03-04 lockup — re-tested at every multipart-consumer call site AND
 * grep-gated at the per-tool source level.
 */

import { QuiqupHttpError, type HttpMethod } from "./quiqup-lastmile";

/**
 * Fire a multipart/form-data fetch and return the parsed response.
 *
 * Behavior:
 *   - HTTP non-2xx → throws `QuiqupHttpError(status, body)`.
 *   - HTTP 204 → null.
 *   - HTTP 2xx with `application/json` content-type → parsed JSON.
 *   - HTTP 2xx otherwise → null (the Phase-3 upstream contract — clients
 *     only check `response.ok` per source-doc line 4674 for documents,
 *     and the bulk_orders endpoint per line 4669 is similarly opaque).
 *
 * Auth model: the caller supplies the bearer JWT directly (the typed
 * clients each maintain their own JWT in their constructor; this helper
 * stays auth-agnostic so it works for both Orders Core REST and Platform
 * API without leaking client-shape concerns).
 */
export async function fetchMultipart(
  method: HttpMethod,
  url: string,
  jwt: string,
  formData: FormData,
): Promise<unknown> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${jwt}`,
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
