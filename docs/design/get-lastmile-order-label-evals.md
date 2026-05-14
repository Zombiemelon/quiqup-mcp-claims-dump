# Eval design — `get_lastmile_order_label`

## Why this tool is different

Existing evals score JSON args (`evals/score-tool-call.ts:1`). This tool's *deliverable* is a binary PDF (`lib/tools/get-lastmile-order-label.ts:30`), so args-overlap alone is insufficient. The production failure mode is also new: clients receive a 28KB base64 blob and burn turns piping it through bash. The eval surface must cover (a) does the LLM call the tool correctly, (b) does the *server* return a usable PDF, and (c) does the *client* handle the new result shape without spiralling.

## Three eval shapes — ship 1+2, defer 3

### v1 offline — tool-call quality (SHIP)

Mirror `evals/lastmile-order-creation.ts:1`. New runner `evals/get-lastmile-label-call.ts` + dataset `evals/datasets/get-lastmile-label-call-v1.ts`. Schema is derived via `z.toJSONSchema` from the live spec (precedent: `evals/lastmile-order-creation.ts:53`), so a regression like the empty-`inputSchema` bug surfaces here too.

Reuse `toolNameMatch`, `requiredFieldsPresent` (single field: `order_id`), and `argsOverlap` from `evals/score-tool-call.ts:108`. The required-fields list becomes `["order_id"]`.

### v2 online roundtrip — server returns valid PDF (SHIP)

Extend `evals/lastmile-order-roundtrip.ts:126`: between create and cancel, invoke the MCP `get_lastmile_order_label` tool through the same MCP HTTP path the deployed server uses (NOT direct REST — we want to catch result-shape regressions in the MCP envelope). New runner `evals/get-lastmile-label-roundtrip.ts`, dataset `evals/datasets/get-lastmile-label-roundtrip-v1.ts` (1 item, parallel to `evals/datasets/lastmile-order-roundtrip-v1.ts:24`).

Three scorers, run on whatever shape the API specialist lands (`resource` block with `blob`, or `resource_link`):

- `pdf-magic-bytes` (0/1): decode `blob` (base64) or fetch `resource_link.uri`, assert first 5 bytes are `%PDF-`.
- `mime-type-pdf` (0/1): assert `mimeType === "application/pdf"`.
- `size-in-range` (0/1): 1024 ≤ bytes ≤ 512000. Matches today's ~28KB observation with 20x headroom.

Cleanup: piggyback on the existing `try/finally` cancel (`evals/lastmile-order-roundtrip.ts:172`).

### v3 client-behavior eval (DEFER to M5)

Whether the post-tool-call assistant turn says "label retrieved" vs. spirals into `base64`/`heredoc`/`Buffer.from` gymnastics. Defer because: (a) scoring requires a second LLM turn (cost + flakiness), (b) the right shape (`resource` with `mimeType`) is enforced by an MCP-spec-compliant client out of the box — the failure is mostly client-side and we don't own those clients, (c) v2's magic-byte/mime checks already gate the server contract. Track as M5 follow-up; if v2 passes and prod still spirals, that's evidence the eval is needed.

## v1 dataset — 6 items

1. **Direct**: "Give me the AWB label for order 12345." → `{ order_id: "12345" }`
2. **Embedded ID**: "Can you pull the shipping label PDF for QQ order #98765432?" → `{ order_id: "98765432" }`
3. **Verbose**: "I need to print the airway bill for the parcel I just created — it's order id 42." → `{ order_id: "42" }`
4. **Adversarial typo**: "fetch label for oder 7777" → `{ order_id: "7777" }` (test ID extraction despite typo)
5. **Adversarial ambiguous**: "the label from yesterday's order to Sharjah" → expected `tool: null` (no order_id in context; correct behavior is to refuse or ask, NOT hallucinate an ID). Scored by `tool-name-match` returning 0 when LLM fabricates a call.
6. **Adversarial partial**: "label for order ending in 4567" → expected `tool: null`. Same rationale.

Items 5–6 require a tweak to `toolNameMatch` semantics — currently it scores 0 on `<no tool call>` (`evals/score-tool-call.ts:25`). Add a sibling scorer `refuses-when-ambiguous` (0/1, 1 when expected `tool: null` AND actual is null/clarifying-text). Keeps existing scorers backwards-compatible.

## CI gates

Pin in `.github/workflows/evals.yml` alongside existing jobs:

| Runner | Score | Min |
|---|---|---|
| `eval:get-lastmile-label-call` (v1) | `args-overlap` | `0.90` (single field, easier than create) |
| `eval:get-lastmile-label-call` (v1) | `refuses-when-ambiguous` | `1.0` (items 5–6 only) |
| `eval:get-lastmile-label-roundtrip` (v2) | `pdf-magic-bytes` | `1.0` |
| `eval:get-lastmile-label-roundtrip` (v2) | `mime-type-pdf` | `1.0` |

Path filter additions: `lib/tools/get-lastmile-order-label.ts`, the two new eval files, the two new dataset files.

## What is MEASURED vs. ASSUMED

**Measured:** the JSON-Schema actually exposed to the LLM (via `z.toJSONSchema`); the tool name + `order_id` shape; that the live MCP envelope contains valid PDF bytes with the right MIME type and plausible size; refusal on ambiguous prompts.

**Assumed (risk):** that real client LLMs render `resource`/`resource_link` blocks the same way our test client does — this is the v3 deferral and the residual risk. Mitigation: v2 hits the *MCP* path (not raw REST), so server-side shape regressions are caught; client spirals are not. Re-evaluate after one week of prod telemetry on the new shape.
