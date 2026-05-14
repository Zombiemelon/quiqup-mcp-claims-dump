# API design: fixing `get_lastmile_order_label` result shape

## Summary

Replace the single `text` content block that today wraps a 28KB base64 JSON
blob (`lib/tools/get-lastmile-order-label.ts:34-36`) with a **hybrid two-item
result**: one `text` block carrying a short human-readable summary (order id,
content type, byte size) and one `resource` (EmbeddedResource) block carrying
the PDF as `blob` with `mimeType: "application/pdf"`. The `resource` variant
is part of the MCP spec implemented by `@modelcontextprotocol/sdk@1.29.0`
(`EmbeddedResourceSchema` at
`node_modules/@modelcontextprotocol/sdk/dist/esm/types.d.ts:1979-2001`, with
`BlobResourceContentsSchema` at lines 1361-1366). Hosts that understand
`resource`+`blob` (Claude Desktop, mcp-inspector, ChatGPT desktop) extract the
bytes and save/preview the PDF without ever flowing the base64 string into the
model's text context. The LLM only sees the summary block. We stay inline (no
new HTTP endpoint, no signed URL, no auth duplication) which matches the
"thin pass-through" posture of M3 and keeps the V3b same-IdP auth model
intact (`lib/clients/quiqup-lastmile.ts:7-15`). `resource_link` is rejected
for now because it requires hosting an authenticated PDF endpoint — out of
scope for the bugfix.

## Code diff sketch — `lib/tools/get-lastmile-order-label.ts`

The handler return-type in `ToolSpec` is too narrow today
(`lib/tools/register.ts:46-49` only allows `{ type: "text"; text: string }`).
That must widen to the SDK's `ContentBlock` union, or at minimum to a typed
union of `text | resource`. With that done, the handler becomes:

```ts
// inputSchema unchanged.
// outputSchema: keep the passthrough shape but add `bytes` for size hint.

handler: async (auth, args) => {
  if (!auth.userId) throw new Error("get_lastmile_order_label requires an authenticated user");
  const jwt = await getQuiqupReadyJwt(auth.userId);
  const client = new QuiqupLastmileClient({ jwt });
  const data = await client.request(
    "GET",
    `/order_label/${encodeURIComponent(args.order_id)}`,
  ) as { contentType?: string; base64?: string };

  if (!data?.base64) {
    return {
      content: [{ type: "text" as const, text: "Label unavailable: upstream returned no PDF body." }],
      isError: true,
    };
  }

  const mimeType = data.contentType?.split(";")[0]?.trim() || "application/pdf";
  const bytes = Math.floor((data.base64.length * 3) / 4);
  const uri = `quiqup-lastmile://order_label/${encodeURIComponent(args.order_id)}.pdf`;

  return {
    content: [
      {
        type: "text" as const,
        text: `Retrieved AWB label PDF for order_id=${args.order_id} (${mimeType}, ~${bytes} bytes). Bytes attached as a resource block; do not attempt to decode them yourself.`,
      },
      {
        type: "resource" as const,
        resource: { uri, mimeType, blob: data.base64 },
      },
    ],
  };
},
```

The `quiqup-lastmile://` URI is a synthetic identifier — clients use it as a
stable key for caching/saving; we are NOT obliged to also serve it via
`resources/read` (the SDK note at `types.d.ts:2003-2006` explicitly permits
tool-returned resources that aren't listed).

## Helper changes — `lib/clients/quiqup-lastmile.ts`

Optional, not required for the fix. The existing non-JSON branch
(`lib/clients/quiqup-lastmile.ts:74-83`) already returns
`{ contentType, base64 }`, which is exactly what the new handler consumes. A
nice-to-have refactor: return `{ contentType, bytes: ArrayBuffer }` and
base64-encode at the call site, so other future binary tools can choose
their own encoding (or pipe raw bytes to a `Blob`). Defer to a follow-up;
not needed to ship this fix.

The bigger required change is `ToolSpec.handler` in
`lib/tools/register.ts:43-50` — widen the return `content` type to allow
`resource` items, or use the SDK's `CallToolResult` type directly.

## Considered alternatives

- **Keep single `text` block, just JSON.stringify.** Status quo. Loses 8+
  turns burning tokens; this is the bug we're fixing.
- **`image` content variant.** SDK requires `mimeType: "application/pdf"`
  would be invalid; `image/*` only. PDF is not an image. Rejected.
- **`resource_link` only (host an authenticated `/api/label/[id]`).**
  Cleanest — bytes never enter LLM transport at all. But requires (a) a new
  Next.js route, (b) re-implementing Clerk OAuth + JWT-exchange on that
  route, (c) deciding signing/TTL strategy, (d) CORS for browser hosts.
  Out of scope for the bugfix; revisit when label PDFs grow beyond ~1MB or
  when other binary endpoints (invoices, proof-of-delivery) land.
- **`resource` blob only, no text summary.** Works but leaves the LLM with
  zero acknowledgement that the call succeeded; some hosts render an empty
  message. Hybrid is strictly better.
- **Multi-part: `text` + `resource` + a second `text` of OCR'd contents.**
  Out of scope; OCR belongs in a separate tool.

## Other tools with the same bug class

Audited `lib/tools/` (grep for `contentType|base64|arrayBuffer`):
**`get_lastmile_order_label` is the only outbound binary tool.**
`bulk-validate-products` takes base64 *inbound* (CSV upload), and
`claims-dump` decodes JWTs — neither flows binary outward. No other
tools need the same fix today. When `bulk_commit_products` or a future
proof-of-delivery tool returns binary, reuse this pattern.

## Open questions for the user

1. **Authenticated PDF endpoint, yes or no?** Confirm we should stay inline
   with `resource`+`blob` for now and defer `resource_link`. If yes,
   capture the size threshold at which we'd revisit (proposed: > 1MB
   payloads or > 5 binary tools).
2. **Synthetic URI scheme.** Is `quiqup-lastmile://order_label/{id}.pdf`
   acceptable, or do you want `mcp+quiqup://...` to namespace explicitly?
   Hosts treat it as opaque; we just need to be consistent across future
   binary tools.
3. **Should the text summary include the upstream `contentType` verbatim,
   or normalize to `application/pdf`?** Quiqup may return
   `application/pdf; charset=binary` or similar; normalizing is safer for
   host MIME dispatch but loses fidelity for debugging.
4. **`ToolSpec.handler` return-type widening.** Confirm we should widen
   here (`lib/tools/register.ts:46-49`) rather than `as any`-cast in this
   one tool — the wider type is the right call but it touches every M3
   tool's TS surface area.
