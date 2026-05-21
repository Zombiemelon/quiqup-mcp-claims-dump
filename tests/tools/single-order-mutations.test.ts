/**
 * MSW-mocked Vitest suite for the 4 Phase-4 / Wave-3 single-order
 * mutation tools (ORDS-03/04/06/07):
 *   - export_order                     (PUT  /orders/export/{id})
 *   - update_fulfilment_order_status   (PATCH /api/fulfilment/orders/{id})  DESTRUCTIVE-gated (D-06)
 *   - create_order_charge              (POST /quiqdash/order-charge)        amount cap T-04-13
 *   - update_order_weight              (PATCH /quiqdash/orders/{id}/weight) weight range T-04-14
 *
 * Coverage contract per the plan's Wave-3 Task-2 <behavior> block —
 * one describe block per tool. The `assertOrderBelongsToUser` helper
 * is module-mocked to a no-op resolver so the test can drive both the
 * happy path AND the "denied" path explicitly per tool without needing
 * to wire up a fake Quiqup-lastmile GET-order endpoint for every test.
 *
 * Per WR-05 the `QUIQUP_PLATFORM_API_BASE_URL` + `QUIQUP_REST_*_BASE_URL`
 * env-vars are deleted in beforeEach so a developer with the var set
 * in their shell does not silently route fetches around MSW.
 *
 * Request counting (per the canonical destructive-test pattern, see
 * tests/tools/destructive-integrations.test.ts): each test that
 * asserts "NO upstream call" registers a wide MSW handler that bumps
 * a counter; the assertion is `expect(count).toBe(0)`. This is the
 * bypass-proof lock — it proves the gate runs client-side and no
 * traffic reaches upstream on negative paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../setup/msw";
import { ScopeViolationError } from "../../lib/middleware/scope";

vi.mock("@/lib/quiqup", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getQuiqupReadyJwt: vi.fn(async (_userId: string) => "test-jwt-for-msw"),
  };
});

// Default no-op scope assertion. Per-test overrides via `vi.mocked(...)
// .mockImplementationOnce(...)` drive the deny path.
vi.mock("@/lib/middleware/scope", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    assertOrderBelongsToUser: vi.fn(async (_id: string, _u: string) => undefined),
  };
});

const auth = {
  userId: "user_test",
  orgId: null,
  sessionId: "sess_test",
  scopes: ["write"],
  bearerToken: "inbound_at_jwt_unused_in_v3b",
};

const authAnon = {
  userId: null,
  orgId: null,
  sessionId: null,
  scopes: [],
  bearerToken: null,
};

const PLATFORM = "https://platform-api.quiqup.com";
const QUIQUP_REST = "https://api.quiqup.com";

const originalPlatformUrl = process.env.QUIQUP_PLATFORM_API_BASE_URL;
const originalRestUrl = process.env.QUIQUP_REST_BASE_URL;
const originalRestStaging = process.env.QUIQUP_REST_STAGING_BASE_URL;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.QUIQUP_PLATFORM_API_BASE_URL;
  delete process.env.QUIQUP_REST_BASE_URL;
  delete process.env.QUIQUP_REST_STAGING_BASE_URL;
});

afterEach(() => {
  if (originalPlatformUrl === undefined) {
    delete process.env.QUIQUP_PLATFORM_API_BASE_URL;
  } else {
    process.env.QUIQUP_PLATFORM_API_BASE_URL = originalPlatformUrl;
  }
  if (originalRestUrl === undefined) {
    delete process.env.QUIQUP_REST_BASE_URL;
  } else {
    process.env.QUIQUP_REST_BASE_URL = originalRestUrl;
  }
  if (originalRestStaging === undefined) {
    delete process.env.QUIQUP_REST_STAGING_BASE_URL;
  } else {
    process.env.QUIQUP_REST_STAGING_BASE_URL = originalRestStaging;
  }
});

// ---------------------------------------------------------------------------
// export_order (ORDS-03)
// ---------------------------------------------------------------------------

describe("export_order", () => {
  it("schema: order_id + idempotency_key + environment; NO confirm/dry_run", async () => {
    const mod = await import("../../lib/tools/export-order");
    // Cast to a wide record to test for unwanted destructive-gate fields
    // without TS complaining that they don't exist on the typed shape.
    const shape = mod.spec.inputSchema.shape as Record<string, unknown>;
    expect(shape.order_id).toBeDefined();
    expect(shape.idempotency_key).toBeDefined();
    expect(shape.environment).toBeDefined();
    // Non-destructive — must NOT carry the destructive-gate fields.
    expect(shape.confirm).toBeUndefined();
    expect(shape.dry_run).toBeUndefined();
  });

  it("scope-denied call → ScopeViolationError propagates; ZERO upstream PUT", async () => {
    let putCount = 0;
    server.use(
      http.put(`${QUIQUP_REST}/orders/export/:id`, () => {
        putCount += 1;
        return HttpResponse.json({});
      }),
    );
    const scope = await import("../../lib/middleware/scope");
    vi.mocked(scope.assertOrderBelongsToUser).mockImplementationOnce(
      async () => {
        throw new ScopeViolationError("order", "12345", "user_test");
      },
    );

    const mod = await import("../../lib/tools/export-order");
    await expect(
      mod.spec.handler(auth, { order_id: "12345", environment: "production" }),
    ).rejects.toBeInstanceOf(ScopeViolationError);
    expect(putCount).toBe(0);
  });

  it("happy path: PUT /orders/export/{id} with empty body; returns upstream payload", async () => {
    let capturedUrl: string | null = null;
    let capturedMethod: string | null = null;
    let capturedBody: string | null = null;
    server.use(
      http.put(`${QUIQUP_REST}/orders/export/:id`, async ({ request }) => {
        capturedUrl = request.url;
        capturedMethod = request.method;
        capturedBody = await request.text();
        return HttpResponse.json({ ok: true, exported: "12345" });
      }),
    );

    const mod = await import("../../lib/tools/export-order");
    const result = await mod.spec.handler(auth, {
      order_id: "12345",
      environment: "production",
    });

    expect(capturedMethod).toBe("PUT");
    expect(capturedUrl).toContain("/orders/export/12345");
    // PUT with no body — handler does NOT send `body: undefined` payload.
    expect(capturedBody).toBe("");

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Re-export requested");
    expect(text).toContain('"ok": true');
  });

  it("order_id with `/` is URL-encoded in outbound path", async () => {
    let capturedUrl: string | null = null;
    server.use(
      http.put(`${QUIQUP_REST}/orders/export/:id`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({});
      }),
    );

    const mod = await import("../../lib/tools/export-order");
    await mod.spec.handler(auth, {
      order_id: "abc/def",
      environment: "production",
    });

    expect(capturedUrl).toContain("/orders/export/abc%2Fdef");
    // raw form must NOT appear in the URL path.
    expect((capturedUrl as unknown as string).includes("abc/def")).toBe(false);
  });

  it("missing auth.userId → throws before any work", async () => {
    let putCount = 0;
    server.use(
      http.put(`${QUIQUP_REST}/orders/export/:id`, () => {
        putCount += 1;
        return HttpResponse.json({});
      }),
    );
    const mod = await import("../../lib/tools/export-order");
    await expect(
      mod.spec.handler(authAnon, {
        order_id: "12345",
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
    expect(putCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// update_fulfilment_order_status (ORDS-04) — DESTRUCTIVE-gated (D-06)
// ---------------------------------------------------------------------------

describe("update_fulfilment_order_status", () => {
  it("schema: contains destructive fields (confirm + dry_run) + order_id + status", async () => {
    const mod = await import("../../lib/tools/update-fulfilment-order-status");
    const shape = mod.spec.inputSchema.shape;
    expect(shape.order_id).toBeDefined();
    expect(shape.status).toBeDefined();
    expect(shape.confirm).toBeDefined();
    expect(shape.dry_run).toBeDefined();
    expect(shape.idempotency_key).toBeDefined();
    expect(shape.environment).toBeDefined();
  });

  it("confirm missing → ConfirmationRequiredError result; ZERO upstream PATCH", async () => {
    let patchCount = 0;
    server.use(
      http.patch(`${PLATFORM}/api/fulfilment/orders/:id`, () => {
        patchCount += 1;
        return HttpResponse.json({});
      }),
    );

    const mod = await import("../../lib/tools/update-fulfilment-order-status");
    const result = await mod.spec.handler(auth, {
      order_id: "12345",
      status: "shipped",
      environment: "production",
    });

    expect(patchCount).toBe(0);
    expect((result as { isError?: boolean }).isError).toBe(true);
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("update_fulfilment_order_status");
    expect(first.text).toContain("confirm: true");
    // sanitised resource text includes the order id + the requested status
    expect(first.text).toContain("12345");
    expect(first.text).toContain("shipped");
  });

  it("confirm: true + dry_run: true → preview with dryRun:true + orderId + status; ZERO upstream PATCH", async () => {
    let patchCount = 0;
    server.use(
      http.patch(`${PLATFORM}/api/fulfilment/orders/:id`, () => {
        patchCount += 1;
        return HttpResponse.json({});
      }),
    );

    const mod = await import("../../lib/tools/update-fulfilment-order-status");
    const result = await mod.spec.handler(auth, {
      order_id: "12345",
      status: "shipped",
      confirm: true,
      dry_run: true,
      environment: "production",
    });

    expect(patchCount).toBe(0);
    expect((result as { isError?: boolean }).isError).toBeFalsy();
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    const parsed = JSON.parse(first.text) as {
      dryRun: boolean;
      orderId: string;
      simulated: { status: string; order_id: string };
    };
    expect(parsed.dryRun).toBe(true);
    expect(parsed.orderId).toBe("12345");
    expect(parsed.simulated.status).toBe("shipped");
    expect(parsed.simulated.order_id).toBe("12345");
  });

  it("confirm: true (in-scope) → EXACTLY ONE PATCH to encoded path with body { status }", async () => {
    let patchCount = 0;
    let capturedUrl: string | null = null;
    let capturedBody: string | null = null;
    server.use(
      http.patch(
        `${PLATFORM}/api/fulfilment/orders/:id`,
        async ({ request }) => {
          patchCount += 1;
          capturedUrl = request.url;
          capturedBody = await request.text();
          return HttpResponse.json({
            ok: true,
            id: "12345",
            status: "shipped",
          });
        },
      ),
    );

    const mod = await import("../../lib/tools/update-fulfilment-order-status");
    await mod.spec.handler(auth, {
      order_id: "abc/def",
      status: "shipped",
      confirm: true,
      environment: "production",
    });

    expect(patchCount).toBe(1);
    expect(capturedUrl).toContain("/api/fulfilment/orders/abc%2Fdef");
    expect((capturedUrl as unknown as string).includes("abc/def")).toBe(false);
    expect(JSON.parse(capturedBody as unknown as string)).toEqual({
      status: "shipped",
    });
  });

  it("out-of-scope → ScopeViolationError propagates; ZERO upstream PATCH", async () => {
    let patchCount = 0;
    server.use(
      http.patch(`${PLATFORM}/api/fulfilment/orders/:id`, () => {
        patchCount += 1;
        return HttpResponse.json({});
      }),
    );

    const scope = await import("../../lib/middleware/scope");
    vi.mocked(scope.assertOrderBelongsToUser).mockImplementationOnce(
      async () => {
        throw new ScopeViolationError("order", "12345", "user_test");
      },
    );

    const mod = await import("../../lib/tools/update-fulfilment-order-status");
    await expect(
      mod.spec.handler(auth, {
        order_id: "12345",
        status: "shipped",
        confirm: true,
        environment: "production",
      }),
    ).rejects.toBeInstanceOf(ScopeViolationError);
    expect(patchCount).toBe(0);
  });

  it("missing auth.userId → throws BEFORE confirm gate (T-04-17 ordering)", async () => {
    let patchCount = 0;
    server.use(
      http.patch(`${PLATFORM}/api/fulfilment/orders/:id`, () => {
        patchCount += 1;
        return HttpResponse.json({});
      }),
    );

    const mod = await import("../../lib/tools/update-fulfilment-order-status");
    await expect(
      mod.spec.handler(authAnon, {
        order_id: "12345",
        status: "shipped",
        // confirm INTENTIONALLY OMITTED — verifies auth gate runs first.
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
    expect(patchCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// create_order_charge (ORDS-06)
// ---------------------------------------------------------------------------

describe("create_order_charge", () => {
  it("schema: amount cap (max 100,000), positive; currency, order_id required", async () => {
    const mod = await import("../../lib/tools/create-order-charge");

    // Negative amount rejected.
    const negParsed = mod.spec.inputSchema.safeParse({
      order_id: "12345",
      amount: -10,
      currency: "AED",
      environment: "production",
    });
    expect(negParsed.success).toBe(false);

    // Zero amount rejected (positive() — strictly > 0).
    const zeroParsed = mod.spec.inputSchema.safeParse({
      order_id: "12345",
      amount: 0,
      currency: "AED",
      environment: "production",
    });
    expect(zeroParsed.success).toBe(false);

    // Above-cap (T-04-13 runaway-agent guard) rejected.
    const tooBigParsed = mod.spec.inputSchema.safeParse({
      order_id: "12345",
      amount: 1_000_000,
      currency: "AED",
      environment: "production",
    });
    expect(tooBigParsed.success).toBe(false);

    // Just at cap is accepted.
    const atCapParsed = mod.spec.inputSchema.safeParse({
      order_id: "12345",
      amount: 100_000,
      currency: "AED",
      environment: "production",
    });
    expect(atCapParsed.success).toBe(true);
  });

  it("scope-denied call → ScopeViolationError propagates; ZERO upstream POST", async () => {
    let postCount = 0;
    server.use(
      http.post(`${PLATFORM}/quiqdash/order-charge`, () => {
        postCount += 1;
        return HttpResponse.json({});
      }),
    );

    const scope = await import("../../lib/middleware/scope");
    vi.mocked(scope.assertOrderBelongsToUser).mockImplementationOnce(
      async () => {
        throw new ScopeViolationError("order", "12345", "user_test");
      },
    );

    const mod = await import("../../lib/tools/create-order-charge");
    await expect(
      mod.spec.handler(auth, {
        order_id: "12345",
        amount: 25.5,
        currency: "AED",
        environment: "production",
      }),
    ).rejects.toBeInstanceOf(ScopeViolationError);
    expect(postCount).toBe(0);
  });

  it("happy path: POST /quiqdash/order-charge with body { order_id, amount, currency }", async () => {
    let postCount = 0;
    let capturedBody: string | null = null;
    server.use(
      http.post(`${PLATFORM}/quiqdash/order-charge`, async ({ request }) => {
        postCount += 1;
        capturedBody = await request.text();
        return HttpResponse.json({ ok: true, charge_id: "ch_42" });
      }),
    );

    const mod = await import("../../lib/tools/create-order-charge");
    const result = await mod.spec.handler(auth, {
      order_id: "12345",
      amount: 25.5,
      currency: "AED",
      description: "Extra weight surcharge",
      environment: "production",
    });

    expect(postCount).toBe(1);
    const body = JSON.parse(capturedBody as unknown as string) as Record<
      string,
      unknown
    >;
    expect(body.order_id).toBe("12345");
    expect(body.amount).toBe(25.5);
    expect(body.currency).toBe("AED");
    expect(body.description).toBe("Extra weight surcharge");

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Created charge");
    expect(text).toContain("ch_42");
  });

  it("description omitted → body does NOT carry description key", async () => {
    let capturedBody: string | null = null;
    server.use(
      http.post(`${PLATFORM}/quiqdash/order-charge`, async ({ request }) => {
        capturedBody = await request.text();
        return HttpResponse.json({});
      }),
    );

    const mod = await import("../../lib/tools/create-order-charge");
    await mod.spec.handler(auth, {
      order_id: "12345",
      amount: 5,
      currency: "AED",
      environment: "production",
    });

    const body = JSON.parse(capturedBody as unknown as string) as Record<
      string,
      unknown
    >;
    expect("description" in body).toBe(false);
  });

  it("missing auth.userId → throws; ZERO upstream POST", async () => {
    let postCount = 0;
    server.use(
      http.post(`${PLATFORM}/quiqdash/order-charge`, () => {
        postCount += 1;
        return HttpResponse.json({});
      }),
    );
    const mod = await import("../../lib/tools/create-order-charge");
    await expect(
      mod.spec.handler(authAnon, {
        order_id: "12345",
        amount: 5,
        currency: "AED",
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
    expect(postCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// update_order_weight (ORDS-07)
// ---------------------------------------------------------------------------

describe("update_order_weight", () => {
  it("schema: weight_kg positive + <= 1000 (T-04-14 range)", async () => {
    const mod = await import("../../lib/tools/update-order-weight");

    // Zero rejected.
    expect(
      mod.spec.inputSchema.safeParse({
        order_id: "12345",
        weight_kg: 0,
        environment: "production",
      }).success,
    ).toBe(false);

    // Negative rejected.
    expect(
      mod.spec.inputSchema.safeParse({
        order_id: "12345",
        weight_kg: -5,
        environment: "production",
      }).success,
    ).toBe(false);

    // Above cap rejected.
    expect(
      mod.spec.inputSchema.safeParse({
        order_id: "12345",
        weight_kg: 1001,
        environment: "production",
      }).success,
    ).toBe(false);

    // At cap accepted.
    expect(
      mod.spec.inputSchema.safeParse({
        order_id: "12345",
        weight_kg: 1000,
        environment: "production",
      }).success,
    ).toBe(true);

    // Realistic value accepted.
    expect(
      mod.spec.inputSchema.safeParse({
        order_id: "12345",
        weight_kg: 2.5,
        environment: "production",
      }).success,
    ).toBe(true);
  });

  it("schema: NO confirm field (non-destructive)", async () => {
    const mod = await import("../../lib/tools/update-order-weight");
    // Cast through Record so TS allows the negative-existence assertions.
    const shape = mod.spec.inputSchema.shape as Record<string, unknown>;
    expect(shape.confirm).toBeUndefined();
    expect(shape.dry_run).toBeUndefined();
  });

  it("scope-denied call → ScopeViolationError propagates; ZERO upstream PATCH", async () => {
    let patchCount = 0;
    server.use(
      http.patch(`${PLATFORM}/quiqdash/orders/:id/weight`, () => {
        patchCount += 1;
        return HttpResponse.json({});
      }),
    );

    const scope = await import("../../lib/middleware/scope");
    vi.mocked(scope.assertOrderBelongsToUser).mockImplementationOnce(
      async () => {
        throw new ScopeViolationError("order", "12345", "user_test");
      },
    );

    const mod = await import("../../lib/tools/update-order-weight");
    await expect(
      mod.spec.handler(auth, {
        order_id: "12345",
        weight_kg: 2.5,
        environment: "production",
      }),
    ).rejects.toBeInstanceOf(ScopeViolationError);
    expect(patchCount).toBe(0);
  });

  it("happy path: PATCH /quiqdash/orders/{encoded-id}/weight with body { weight }", async () => {
    let patchCount = 0;
    let capturedUrl: string | null = null;
    let capturedBody: string | null = null;
    server.use(
      http.patch(
        `${PLATFORM}/quiqdash/orders/:id/weight`,
        async ({ request }) => {
          patchCount += 1;
          capturedUrl = request.url;
          capturedBody = await request.text();
          return HttpResponse.json({
            ok: true,
            id: "12345",
            weight: 2.5,
          });
        },
      ),
    );

    const mod = await import("../../lib/tools/update-order-weight");
    const result = await mod.spec.handler(auth, {
      order_id: "abc/def",
      weight_kg: 2.5,
      environment: "production",
    });

    expect(patchCount).toBe(1);
    expect(capturedUrl).toContain("/quiqdash/orders/abc%2Fdef/weight");
    expect((capturedUrl as unknown as string).includes("abc/def")).toBe(false);

    // Wire-format translation: agent-facing `weight_kg` → upstream `weight`.
    const body = JSON.parse(capturedBody as unknown as string) as Record<
      string,
      unknown
    >;
    // Wire-format: upstream key is `weight_kg` (Wave-3 live-staging
    // CALL-LOG confirmed: `{ weight: 2.5 }` returned 400 with
    // "weight_kg: This field is required.").
    expect(body.weight_kg).toBe(2.5);
    expect("weight" in body).toBe(false);

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Updated weight");
    expect(text).toContain("2.5 kg");
  });

  it("missing auth.userId → throws; ZERO upstream PATCH", async () => {
    let patchCount = 0;
    server.use(
      http.patch(`${PLATFORM}/quiqdash/orders/:id/weight`, () => {
        patchCount += 1;
        return HttpResponse.json({});
      }),
    );
    const mod = await import("../../lib/tools/update-order-weight");
    await expect(
      mod.spec.handler(authAnon, {
        order_id: "12345",
        weight_kg: 2.5,
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
    expect(patchCount).toBe(0);
  });
});
