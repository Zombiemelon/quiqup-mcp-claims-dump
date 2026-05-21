/**
 * MSW-mocked Vitest suite for Phase-4 Wave-4 order-creation tools:
 *   - create_internal_fulfilment_order  (ORDC-04, Platform POST JSON)
 *   - create_mission                    (MISS-01, Platform POST JSON, non-destructive per D-05)
 *   - bulk_create_orders                (ORDC-05, Platform POST multipart CSV)
 *
 * Contract under test:
 *   create_internal_fulfilment_order:
 *     - Posts to `/internal/fulfilment/orders` on platform-api with the JSON body.
 *     - inputSchema has NO user_id / actor_id / actor_email / partner_id (BL-04).
 *     - guardrails: rateLimit 10/min, idempotency keyArg, audit on.
 *     - !auth.userId throws BEFORE any work.
 *
 *   create_mission:
 *     - Posts to `/quiqdash/missions` on platform-api.
 *     - inputSchema has NO confirm / dry_run (D-05 — NOT destructive-gated).
 *     - guardrails: rateLimit 10/min, idempotency keyArg, audit on (NOT tight 3/min).
 *     - !auth.userId throws.
 *
 *   bulk_create_orders:
 *     - Posts to `/quiqdash/bulk_orders` on platform-api with multipart/form-data.
 *     - Outbound Content-Type starts with multipart/form-data + carries a boundary.
 *     - Body is FormData with a `file` field carrying decoded bytes + filename.
 *     - Per-row upstream errors surface VERBATIM in the response text (D-08).
 *     - csv_base64 over the 10MB cap is rejected at the Zod parse OR pre-flight check.
 *     - inputSchema has NO user_id / actor_id / actor_email (BL-04).
 *     - !auth.userId throws first.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../setup/msw";

vi.mock("@/lib/quiqup", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getQuiqupReadyJwt: vi.fn(async (_userId: string) => "test-jwt-for-msw"),
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

const originalPlatformUrl = process.env.QUIQUP_PLATFORM_API_BASE_URL;
const originalPlatformStagingUrl =
  process.env.QUIQUP_PLATFORM_API_STAGING_BASE_URL;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.QUIQUP_PLATFORM_API_BASE_URL;
  delete process.env.QUIQUP_PLATFORM_API_STAGING_BASE_URL;
});

afterEach(() => {
  if (originalPlatformUrl === undefined) {
    delete process.env.QUIQUP_PLATFORM_API_BASE_URL;
  } else {
    process.env.QUIQUP_PLATFORM_API_BASE_URL = originalPlatformUrl;
  }
  if (originalPlatformStagingUrl === undefined) {
    delete process.env.QUIQUP_PLATFORM_API_STAGING_BASE_URL;
  } else {
    process.env.QUIQUP_PLATFORM_API_STAGING_BASE_URL = originalPlatformStagingUrl;
  }
});

// ---------------------------------------------------------------------------
// create_internal_fulfilment_order (ORDC-04)
// ---------------------------------------------------------------------------

describe("create_internal_fulfilment_order", () => {
  const minimalBody = {
    needs_manual_confirmation: false,
    origin_address: {
      address1: "1 origin st",
      city: "Dubai",
      country_code: "AE",
      email: "from@example.com",
      first_name: "From",
      phone: "+971500000001",
    },
    shipping_address: {
      address1: "2 ship st",
      city: "Dubai",
      country_code: "AE",
      email: "to@example.com",
      first_name: "To",
      phone: "+971500000002",
    },
    partner_order_id: "po-123",
    payment_amount: 0,
    payment_mode: "prepaid",
    service_kind: "same_day",
    source: "api",
  };

  it("happy path POSTs the body to /internal/fulfilment/orders and returns the created order", async () => {
    let capturedBody: unknown = null;
    let capturedAuth: string | null = null;
    server.use(
      http.post(`${PLATFORM}/internal/fulfilment/orders`, async ({ request }) => {
        capturedBody = await request.json();
        capturedAuth = request.headers.get("authorization");
        return HttpResponse.json({ id: "ifo-1", partner_order_id: "po-123" });
      }),
    );
    const mod = await import("../../lib/tools/create-internal-fulfilment-order");
    const result = await mod.spec.handler(auth, {
      ...minimalBody,
      environment: "production",
    });
    expect(capturedAuth).toBe("Bearer test-jwt-for-msw");
    expect(capturedBody).toMatchObject({
      partner_order_id: "po-123",
      service_kind: "same_day",
    });
    expect(result.content).toHaveLength(1);
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain('"id": "ifo-1"');
  });

  it("inputSchema does NOT accept caller-supplied identity fields (BL-04 server-binding)", async () => {
    const mod = await import("../../lib/tools/create-internal-fulfilment-order");
    const keys = Object.keys(mod.spec.inputSchema.shape);
    expect(keys).not.toContain("user_id");
    expect(keys).not.toContain("actor_id");
    expect(keys).not.toContain("actor_email");
    expect(keys).not.toContain("partner_id");
  });

  it("rejects unauthenticated callers BEFORE any upstream work", async () => {
    let networkCalled = false;
    server.use(
      http.post(`${PLATFORM}/internal/fulfilment/orders`, () => {
        networkCalled = true;
        return HttpResponse.json({});
      }),
    );
    const mod = await import("../../lib/tools/create-internal-fulfilment-order");
    await expect(
      mod.spec.handler(authAnon, { ...minimalBody, environment: "production" }),
    ).rejects.toThrow(/authenticated/i);
    expect(networkCalled).toBe(false);
  });

  it("inputSchema does NOT include destructive-gate fields (NOT destructive)", async () => {
    const mod = await import("../../lib/tools/create-internal-fulfilment-order");
    const keys = Object.keys(mod.spec.inputSchema.shape);
    expect(keys).not.toContain("confirm");
    expect(keys).not.toContain("dry_run");
  });

  it("guardrails block matches the canonical non-destructive write shape", async () => {
    const mod = await import("../../lib/tools/create-internal-fulfilment-order");
    const g = mod.spec.guardrails;
    expect(g).toBeDefined();
    expect(g?.audit).toBe(true);
    expect(g?.idempotency?.keyArg).toBe("idempotency_key");
    expect(g?.rateLimit?.capacity).toBe(10);
    // NOT the tight 3/min destructive block.
    expect(g?.rateLimit?.capacity).not.toBe(3);
  });
});

// ---------------------------------------------------------------------------
// create_mission (MISS-01)
// ---------------------------------------------------------------------------

describe("create_mission", () => {
  const minimalMission = {
    depotId: "depot-1",
    orderIds: ["o-1", "o-2"],
    type: "delivery",
    zone: "DXB-1",
  };

  it("happy path POSTs to /quiqdash/missions and returns the created mission", async () => {
    let capturedBody: unknown = null;
    server.use(
      http.post(`${PLATFORM}/quiqdash/missions`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ id: "mission-1", body: { ok: true } });
      }),
    );
    const mod = await import("../../lib/tools/create-mission");
    const result = await mod.spec.handler(auth, {
      ...minimalMission,
      environment: "production",
    });
    expect(capturedBody).toMatchObject({
      depotId: "depot-1",
      orderIds: ["o-1", "o-2"],
      type: "delivery",
      zone: "DXB-1",
    });
    expect(result.content).toHaveLength(1);
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain('"id": "mission-1"');
  });

  it("inputSchema does NOT include destructive-gate fields (D-05 non-destructive)", async () => {
    const mod = await import("../../lib/tools/create-mission");
    const keys = Object.keys(mod.spec.inputSchema.shape);
    expect(keys).not.toContain("confirm");
    expect(keys).not.toContain("dry_run");
  });

  it("guardrails block is the canonical non-destructive write shape (not 3/min)", async () => {
    const mod = await import("../../lib/tools/create-mission");
    const g = mod.spec.guardrails;
    expect(g).toBeDefined();
    expect(g?.audit).toBe(true);
    expect(g?.idempotency?.keyArg).toBe("idempotency_key");
    expect(g?.rateLimit?.capacity).toBe(10);
    expect(g?.rateLimit?.capacity).not.toBe(3);
  });

  it("rejects unauthenticated callers BEFORE any upstream work", async () => {
    let networkCalled = false;
    server.use(
      http.post(`${PLATFORM}/quiqdash/missions`, () => {
        networkCalled = true;
        return HttpResponse.json({});
      }),
    );
    const mod = await import("../../lib/tools/create-mission");
    await expect(
      mod.spec.handler(authAnon, {
        ...minimalMission,
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated/i);
    expect(networkCalled).toBe(false);
  });

  it("inputSchema does NOT accept caller-supplied identity fields (BL-04)", async () => {
    const mod = await import("../../lib/tools/create-mission");
    const keys = Object.keys(mod.spec.inputSchema.shape);
    expect(keys).not.toContain("user_id");
    expect(keys).not.toContain("actor_id");
    expect(keys).not.toContain("actor_email");
    expect(keys).not.toContain("partner_id");
  });
});

// ---------------------------------------------------------------------------
// bulk_create_orders (ORDC-05)
// ---------------------------------------------------------------------------

describe("bulk_create_orders", () => {
  const tinyCsv = "partner_order_id,sku,quantity\npo-1,SKU-A,1\n";
  const tinyCsvBase64 = Buffer.from(tinyCsv, "utf-8").toString("base64");

  it("happy path POSTs multipart to /quiqdash/bulk_orders and returns upstream payload", async () => {
    let captured: {
      contentType: string | null;
      fileFilename: string;
      fileText: string;
    } | null = null;
    server.use(
      http.post(`${PLATFORM}/quiqdash/bulk_orders`, async ({ request }) => {
        const ct = request.headers.get("content-type");
        const form = await request.formData();
        const fileEntry = form.get("file");
        if (!(fileEntry instanceof File)) {
          throw new Error("file field not a File");
        }
        captured = {
          contentType: ct,
          fileFilename: fileEntry.name,
          fileText: await fileEntry.text(),
        };
        return HttpResponse.json({ created: [{ id: "o-100" }] });
      }),
    );
    const mod = await import("../../lib/tools/bulk-create-orders");
    const result = await mod.spec.handler(auth, {
      csv_base64: tinyCsvBase64,
      filename: "orders.csv",
      environment: "production",
    });
    expect(captured).not.toBeNull();
    const c = captured as unknown as {
      contentType: string;
      fileFilename: string;
      fileText: string;
    };
    expect(c.contentType.startsWith("multipart/form-data")).toBe(true);
    expect(c.contentType).toContain("boundary=");
    expect(c.fileFilename).toBe("orders.csv");
    expect(c.fileText).toBe(tinyCsv);
    expect(result.content).toHaveLength(1);
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain('"o-100"');
  });

  it("surfaces per-row errors VERBATIM in the response text (D-08 passthrough)", async () => {
    const upstreamPayload = {
      created: [{ id: "o-200", row: 2 }],
      errors: {
        row_1: "missing sku column",
        row_5: "invalid date format: 2026/13/45",
      },
    };
    server.use(
      http.post(`${PLATFORM}/quiqdash/bulk_orders`, () =>
        HttpResponse.json(upstreamPayload),
      ),
    );
    const mod = await import("../../lib/tools/bulk-create-orders");
    const result = await mod.spec.handler(auth, {
      csv_base64: tinyCsvBase64,
      filename: "orders.csv",
      environment: "production",
    });
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    // Both row-level error strings MUST appear verbatim — no aggregation.
    expect(first.text).toContain("missing sku column");
    expect(first.text).toContain("invalid date format: 2026/13/45");
    expect(first.text).toContain("row_1");
    expect(first.text).toContain("row_5");
  });

  it("rejects csv_base64 over the 10MB cap BEFORE any network call", async () => {
    let networkCalled = false;
    server.use(
      http.post(`${PLATFORM}/quiqdash/bulk_orders`, () => {
        networkCalled = true;
        return HttpResponse.json({});
      }),
    );
    const mod = await import("../../lib/tools/bulk-create-orders");
    const huge = "A".repeat(13_500_001);
    // Either zod refuses to parse OR the handler throws — both are acceptable
    // defense-in-depth surfaces. Try the schema first; if it accepts, the
    // handler must reject.
    const parsed = mod.spec.inputSchema.safeParse({
      csv_base64: huge,
      filename: "huge.csv",
      environment: "production",
    });
    if (parsed.success) {
      await expect(
        mod.spec.handler(auth, parsed.data as never),
      ).rejects.toThrow(/10MB|cap/i);
    } else {
      // Schema rejection is also fine — that's a stricter gate.
      expect(parsed.success).toBe(false);
    }
    expect(networkCalled).toBe(false);
  });

  it("rejects unauthenticated callers BEFORE base64 decode or fetch", async () => {
    let networkCalled = false;
    server.use(
      http.post(`${PLATFORM}/quiqdash/bulk_orders`, () => {
        networkCalled = true;
        return HttpResponse.json({});
      }),
    );
    const mod = await import("../../lib/tools/bulk-create-orders");
    await expect(
      mod.spec.handler(authAnon, {
        csv_base64: tinyCsvBase64,
        filename: "orders.csv",
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated/i);
    expect(networkCalled).toBe(false);
  });

  it("inputSchema does NOT accept caller-supplied identity fields (BL-04)", async () => {
    const mod = await import("../../lib/tools/bulk-create-orders");
    const keys = Object.keys(mod.spec.inputSchema.shape);
    expect(keys).not.toContain("user_id");
    expect(keys).not.toContain("actor_id");
    expect(keys).not.toContain("actor_email");
    expect(keys).not.toContain("partner_id");
  });

  it("guardrails: rate-limit 5/min, idempotency keyArg, audit on", async () => {
    const mod = await import("../../lib/tools/bulk-create-orders");
    const g = mod.spec.guardrails;
    expect(g).toBeDefined();
    expect(g?.audit).toBe(true);
    expect(g?.idempotency?.keyArg).toBe("idempotency_key");
    expect(g?.rateLimit?.capacity).toBe(5);
  });

  it("source code does NOT manually set Content-Type for multipart (03-04 lockup)", async () => {
    // Read the source file directly to assert nothing wires a Content-Type
    // header onto the multipart fetch. This catches the regression at the
    // source level — even if the test above passes due to a default-value
    // boundary, manual Content-Type setting in source is forbidden.
    const fs = await import("fs/promises");
    const path = await import("path");
    const src = await fs.readFile(
      path.resolve(process.cwd(), "lib/tools/bulk-create-orders.ts"),
      "utf-8",
    );
    expect(src).not.toMatch(/['"]Content-Type['"]\s*:\s*['"]multipart/);
  });
});
