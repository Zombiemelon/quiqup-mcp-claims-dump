/**
 * `list_order_audit_events` — fetch an order's field-level audit-event
 * timeline from the Quiqup Audit service (Phase 3 / ORDS-05).
 *
 * Endpoint: GET {AUDIT_BASE_URL}/events?resourceID.eq={orderUuid} on the
 *   Audit service host (audit.quiqup.com / audit.staging.quiqup.com).
 *
 * AUTH EXCEPTION: This tool's upstream client (`AuditClient` in
 * lib/clients/audit.ts) sends NO Authorization header by upstream design
 * (source-doc §19 B line 4258 — "no auth header — public read or
 * service-internal"). The MCP boundary STILL requires a signed-in user —
 * see the auth.userId check below — but no JWT is minted. This is the
 * SECOND auth-exception tool in the project after `lookup_google_place`.
 *
 * Disambiguation: this tool returns the FIELD-LEVEL audit log (who edited
 * the address, when, before/after values, etc). For the STATE-TRANSITION
 * timeline (state changes over time with associated operator/reasons), use
 * `get_order_history` — those are two different upstream services
 * (Audit vs Quiqup REST) with different payload shapes.
 */

import { z } from "zod";
import type { ToolSpec } from "./register";
import { AuditClient } from "@/lib/clients/audit";
import { environmentField } from "@/lib/clients/quiqup-env";

const inputSchema = z.object({
  order_uuid: z
    .string()
    .uuid()
    .describe(
      "The order UUID (NOT the clientOrderID — these are different). " +
        "Get it from the order details payload's `uuid` field (e.g. " +
        "`get_lastmile_order` response, or `bulk_orders_lookup[].uuid`).",
    ),
  environment: environmentField,
});

const outputSchema = z.object({}).passthrough();

export const spec: ToolSpec<typeof inputSchema, typeof outputSchema> = {
  name: "list_order_audit_events",
  description:
    "Fetch the field-level audit-event timeline for a Quiqup order. " +
    "Endpoint: GET {AUDIT_BASE_URL}/events?resourceID.eq={orderUuid} " +
    "(Audit service host — audit.quiqup.com). " +
    "Returns `{ events: [{ eventID, resourceID, occurredAt, actor, action, changes }] }`. " +
    "The frontend stores this whole response without parsing — fields beyond " +
    "the documented set may appear. " +
    "When to use which: for the FIELD-LEVEL audit log (who edited the " +
    "address, when, before/after diff), use this tool. For the " +
    "STATE-TRANSITION timeline (state changes over time with associated " +
    "operator/reasons), use `get_order_history` instead. These are " +
    "different upstream services (Audit vs Quiqup REST) with different " +
    "payload shapes. " +
    "PII warning: Audit records contain `actor.email`. Surfacing them is " +
    "expected; M6 audit-log redaction handles the at-rest layer. " +
    "Auth posture: This tool reaches an upstream that sends NO Authorization " +
    "header (Audit service is no-auth by upstream design). The MCP transport " +
    "still requires a signed-in user — the Clerk gate at route.ts is what " +
    "restricts who can call this tool. Do not pass any `token`, `bearer`, or " +
    "`jwt` fields — the tool surface deliberately has none. " +
    "Error modes: 4xx from Audit → upstream config issue (wrong base URL? " +
    "AUDIT_BASE_URL env var unset in this environment?); 5xx → upstream " +
    "temporarily unavailable. " +
    'Example: `{ "order_uuid": "6d0c2ad3-4dcf-4e3a-aa72-89e6f6c2a9b5", "environment": "production" }`.',
  inputSchema,
  outputSchema,
  handler: async (auth, args) => {
    // MCP-boundary auth gate. Even though the Audit upstream is no-auth by
    // upstream design (see lib/clients/audit.ts file header), the MCP itself
    // still requires a Clerk-authenticated user. The Audit service's no-auth
    // posture is a server-internal artefact; the MCP enforces tenant isolation
    // at the Clerk boundary.
    if (!auth.userId) {
      throw new Error(
        "list_order_audit_events requires an authenticated user",
      );
    }

    // We intentionally do NOT mint a Clerk → Quiqup session-JWT here — the
    // Audit upstream sends no Authorization header (see file header AUTH
    // EXCEPTION). The auth.userId check above is the only auth gate; a JWT
    // we then throw away would be wasteful and misleading.
    const client = new AuditClient({ environment: args.environment });

    // Dotted query-key (resourceID.eq) per source-doc §19 B line 4259.
    // URLSearchParams round-trips the literal `.` intact.
    const data = await client.request("GET", "/events", {
      query: { "resourceID.eq": args.order_uuid },
    });

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(data, null, 2) },
      ],
    };
  },
};
