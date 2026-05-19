/**
 * MSW-mocked Vitest suite for the five Phase-2 / Wave-1 shared-integration
 * tools (INTG-01/03/04/05/06).
 *
 * Coverage contract per tool (locked in by acceptance criteria):
 *   1. Happy path — content[0].text contains the mocked JSON body.
 *   2. Upstream 401 — handler rejects with QuiqupHttpError (the registerTool
 *      wrapper catches and unwraps this in production; this suite calls the
 *      handler directly so it sees the raw throw).
 *   3. Missing auth.userId — handler throws a plain Error before any fetch.
 *
 * Plus tool-specific extras:
 *   - list_integration_order_reasons: outbound URL carries all 7 query params;
 *     schema-parse rejects limit:500 (max 200) and limit:0 (min 1).
 *   - repair_integration_orders: outbound body == input minus
 *     `idempotency_key`/`environment`; schema rejects 51 ids and a
 *     non-enum source.
 *   - get_integration_order: outbound URL contains the percent-encoded uuid.
 *   - confirm_ff_export: outbound body is EXACTLY `{ order_uuid }` (no other
 *     fields leak from the tool layer).
 *
 * Per WR-05 fix (commit f89c3b9) `QUIQUP_PLATFORM_API_BASE_URL` is unset in
 * `beforeEach` — without that, a developer with the var set in their shell
 * would silently route fetches around MSW.
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

// Per WR-05: clear QUIQUP_PLATFORM_API_BASE_URL so MSW catches the production
// host. Restore the original value in afterEach so other suites are
// unaffected.
const originalPlatformUrl = process.env.QUIQUP_PLATFORM_API_BASE_URL;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.QUIQUP_PLATFORM_API_BASE_URL;
});

afterEach(() => {
  if (originalPlatformUrl === undefined) {
    delete process.env.QUIQUP_PLATFORM_API_BASE_URL;
  } else {
    process.env.QUIQUP_PLATFORM_API_BASE_URL = originalPlatformUrl;
  }
});

describe("list_integration_connections", () => {
  const payload = {
    connections: [
      {
        id: "conn_1",
        shop_name: "acme",
        site_url: "https://acme.myshopify.com",
        source: "shopify",
        is_fulfillment: true,
        token: "tkn_x",
        user_id: "u_123",
        created_at: "2026-05-01T00:00:00Z",
        updated_at: "2026-05-02T00:00:00Z",
      },
    ],
  };

  it("returns the /integrations/connections payload as a text content block", async () => {
    server.use(
      http.get(`${PLATFORM}/integrations/connections`, () =>
        HttpResponse.json(payload),
      ),
    );
    const mod = await import("../../lib/tools/list-integration-connections");
    const result = await mod.spec.handler(auth, { environment: "production" });
    expect(result.content).toHaveLength(1);
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("acme");
    const parsed = JSON.parse(first.text);
    expect(parsed.connections[0].source).toBe("shopify");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.get(`${PLATFORM}/integrations/connections`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/list-integration-connections");
    const { QuiqupHttpError } = await import(
      "../../lib/clients/quiqup-lastmile"
    );
    await expect(
      mod.spec.handler(auth, { environment: "production" }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/list-integration-connections");
    await expect(
      mod.spec.handler(authAnon, { environment: "production" }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("list_integration_order_reasons", () => {
  const payload = {
    limit: 50,
    offset: 0,
    total: 1,
    reasons: [
      {
        id: 42,
        order_id: "ord_42",
        order_number: "#1042",
        fulfillment_order_id: "ff_42",
        sales_channel: "shopify",
        reason: "address_invalid",
        status: "failed",
        attempts: 2,
        last_attempt_at: "2026-05-18T12:00:00Z",
        shop_name: "acme",
      },
    ],
  };

  it("forwards all 7 query params on /integrations/order-reasons", async () => {
    let captured: URL | undefined;
    server.use(
      http.get(`${PLATFORM}/integrations/order-reasons`, ({ request }) => {
        captured = new URL(request.url);
        return HttpResponse.json(payload);
      }),
    );
    const mod = await import("../../lib/tools/list-integration-order-reasons");
    const result = await mod.spec.handler(auth, {
      sales_channel: "shopify",
      status: "failed",
      start_date: "2026-05-01T00:00:00Z",
      end_date: "2026-05-19T00:00:00Z",
      user_id: "u_123",
      limit: 50,
      offset: 0,
      environment: "production",
    });
    expect(captured).toBeDefined();
    expect(captured!.searchParams.get("sales_channel")).toBe("shopify");
    expect(captured!.searchParams.get("status")).toBe("failed");
    expect(captured!.searchParams.get("start_date")).toBe(
      "2026-05-01T00:00:00Z",
    );
    expect(captured!.searchParams.get("end_date")).toBe(
      "2026-05-19T00:00:00Z",
    );
    expect(captured!.searchParams.get("user_id")).toBe("u_123");
    expect(captured!.searchParams.get("limit")).toBe("50");
    expect(captured!.searchParams.get("offset")).toBe("0");

    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("address_invalid");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.get(`${PLATFORM}/integrations/order-reasons`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/list-integration-order-reasons");
    const { QuiqupHttpError } = await import(
      "../../lib/clients/quiqup-lastmile"
    );
    await expect(
      mod.spec.handler(auth, {
        sales_channel: "shopify",
        status: "failed",
        start_date: "2026-05-01T00:00:00Z",
        end_date: "2026-05-19T00:00:00Z",
        user_id: "u_123",
        limit: 50,
        offset: 0,
        environment: "production",
      }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/list-integration-order-reasons");
    await expect(
      mod.spec.handler(authAnon, {
        sales_channel: "shopify",
        status: "failed",
        start_date: "2026-05-01T00:00:00Z",
        end_date: "2026-05-19T00:00:00Z",
        user_id: "u_123",
        limit: 50,
        offset: 0,
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
  });

  it("schema rejects limit:500 (max 200) and limit:0 (min 1)", async () => {
    const mod = await import("../../lib/tools/list-integration-order-reasons");
    const base = {
      sales_channel: "shopify",
      status: "failed",
      start_date: "2026-05-01T00:00:00Z",
      end_date: "2026-05-19T00:00:00Z",
      user_id: "u_123",
      offset: 0,
    };
    expect(
      mod.spec.inputSchema.safeParse({ ...base, limit: 500 }).success,
    ).toBe(false);
    expect(
      mod.spec.inputSchema.safeParse({ ...base, limit: 0 }).success,
    ).toBe(false);
    expect(
      mod.spec.inputSchema.safeParse({ ...base, limit: 50 }).success,
    ).toBe(true);
  });
});

describe("repair_integration_orders", () => {
  const payload = {
    orders_processed: 2,
    orders_created: 2,
    message: "ok",
    errors: [],
  };

  it("posts the body without idempotency_key or environment leaking", async () => {
    let captured: Record<string, unknown> | undefined;
    server.use(
      http.post(
        `${PLATFORM}/integrations/repair-orders`,
        async ({ request }) => {
          captured = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(payload);
        },
      ),
    );
    const mod = await import("../../lib/tools/repair-integration-orders");
    const result = await mod.spec.handler(auth, {
      ids: ["i1", "i2"],
      order_name: "#1234",
      shop_name: "acme",
      site_url: "https://acme.myshopify.com",
      source: "shopify",
      user_id: "u_123",
      start_date: "2026-05-01T00:00:00Z",
      end_date: "2026-05-19T00:00:00Z",
      idempotency_key: "idem_abc",
      environment: "production",
    });
    expect(captured).toBeDefined();
    expect(captured!.ids).toEqual(["i1", "i2"]);
    expect(captured!.source).toBe("shopify");
    expect(captured!.order_name).toBe("#1234");
    // idempotency_key + environment are tool-level — must not be forwarded.
    expect(captured).not.toHaveProperty("idempotency_key");
    expect(captured).not.toHaveProperty("environment");

    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("orders_processed");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.post(`${PLATFORM}/integrations/repair-orders`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/repair-integration-orders");
    const { QuiqupHttpError } = await import(
      "../../lib/clients/quiqup-lastmile"
    );
    await expect(
      mod.spec.handler(auth, {
        ids: ["i1"],
        order_name: "#1234",
        shop_name: "acme",
        site_url: "https://acme.myshopify.com",
        source: "shopify",
        user_id: "u_123",
        start_date: "2026-05-01T00:00:00Z",
        end_date: "2026-05-19T00:00:00Z",
        environment: "production",
      }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/repair-integration-orders");
    await expect(
      mod.spec.handler(authAnon, {
        ids: ["i1"],
        order_name: "#1234",
        shop_name: "acme",
        site_url: "https://acme.myshopify.com",
        source: "shopify",
        user_id: "u_123",
        start_date: "2026-05-01T00:00:00Z",
        end_date: "2026-05-19T00:00:00Z",
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
  });

  it("schema rejects 51 ids (max 50) and non-enum source", async () => {
    const mod = await import("../../lib/tools/repair-integration-orders");
    const tooManyIds = Array.from({ length: 51 }, (_, i) => `id_${i}`);
    expect(
      mod.spec.inputSchema.safeParse({
        ids: tooManyIds,
        order_name: "#1234",
        shop_name: "acme",
        site_url: "https://acme.myshopify.com",
        source: "shopify",
        user_id: "u_123",
        start_date: "2026-05-01T00:00:00Z",
        end_date: "2026-05-19T00:00:00Z",
      }).success,
    ).toBe(false);
    expect(
      mod.spec.inputSchema.safeParse({
        ids: ["i1"],
        order_name: "#1234",
        shop_name: "acme",
        site_url: "https://acme.myshopify.com",
        source: "magento",
        user_id: "u_123",
        start_date: "2026-05-01T00:00:00Z",
        end_date: "2026-05-19T00:00:00Z",
      }).success,
    ).toBe(false);
  });
});

describe("get_integration_order", () => {
  const payload = {
    uuid: "uuid:1234",
    status: "ready_to_fulfil",
    products: [],
    totals: { grand_total: 100 },
  };

  it("percent-encodes the order_uuid path param", async () => {
    const rawUuid = "uuid:1234/with special";
    const encoded = encodeURIComponent(rawUuid);
    let capturedUrl: string | undefined;
    server.use(
      // Match any /order/* and inspect the URL ourselves so the assertion
      // doesn't depend on MSW's path-pattern parsing of special chars.
      http.get(`${PLATFORM}/order/:rest*`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(payload);
      }),
    );
    const mod = await import("../../lib/tools/get-integration-order");
    const result = await mod.spec.handler(auth, {
      order_uuid: rawUuid,
      environment: "production",
    });
    expect(capturedUrl).toBeDefined();
    expect(capturedUrl!.includes(encoded)).toBe(true);
    // Also: the raw (un-encoded) string must NOT appear verbatim — proves
    // we didn't accidentally bypass encodeURIComponent.
    expect(capturedUrl!.includes(rawUuid)).toBe(false);

    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("ready_to_fulfil");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.get(`${PLATFORM}/order/:rest*`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/get-integration-order");
    const { QuiqupHttpError } = await import(
      "../../lib/clients/quiqup-lastmile"
    );
    await expect(
      mod.spec.handler(auth, {
        order_uuid: "uuid_x",
        environment: "production",
      }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/get-integration-order");
    await expect(
      mod.spec.handler(authAnon, {
        order_uuid: "uuid_x",
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("confirm_ff_export", () => {
  const payload = { result: "ack" };

  it("posts EXACTLY { order_uuid } — no extra fields leak", async () => {
    let captured: Record<string, unknown> | undefined;
    server.use(
      http.post(
        `${PLATFORM}/orders/confirm-ff-export`,
        async ({ request }) => {
          captured = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(payload);
        },
      ),
    );
    const mod = await import("../../lib/tools/confirm-ff-export");
    const result = await mod.spec.handler(auth, {
      order_uuid: "uuid_x",
      idempotency_key: "idem_xyz",
      environment: "production",
    });
    expect(captured).toEqual({ order_uuid: "uuid_x" });
    expect(captured).not.toHaveProperty("idempotency_key");
    expect(captured).not.toHaveProperty("environment");

    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("ack");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.post(`${PLATFORM}/orders/confirm-ff-export`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/confirm-ff-export");
    const { QuiqupHttpError } = await import(
      "../../lib/clients/quiqup-lastmile"
    );
    await expect(
      mod.spec.handler(auth, {
        order_uuid: "uuid_x",
        environment: "production",
      }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/confirm-ff-export");
    await expect(
      mod.spec.handler(authAnon, {
        order_uuid: "uuid_x",
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
  });
});
