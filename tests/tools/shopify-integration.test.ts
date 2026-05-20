/**
 * MSW-mocked Vitest suite for the six Phase-2 / Wave-2 Shopify-integration
 * tools (INTG-07/08/09/10/11/12).
 *
 * Coverage contract per tool (locked in by acceptance criteria):
 *   1. Happy path — content[0].text contains the mocked JSON body.
 *   2. Upstream 401 — handler rejects with QuiqupHttpError (the registerTool
 *      wrapper catches and unwraps this in production; this suite calls the
 *      handler directly so it sees the raw throw).
 *   3. Missing auth.userId — handler throws a plain Error before any fetch.
 *
 * Plus tool-specific extras (locked in by acceptance criteria):
 *   - get_shopify_config: URL path includes the percent-encoded shop_name.
 *   - list_shopify_delivery_methods: ?shop_name=<encoded> on the URL; no body.
 *   - list_shopify_locations: same as delivery_methods.
 *   - update_shopify_config: outbound body shape matches input, body does NOT
 *     include idempotency_key or environment, schema-parse rejects
 *     wms_delay_minutes=10081 (>max).
 *   - update_shopify_connection: outbound body.token matches input;
 *     spec.inputSchema.shape.token is required (min 1); description-quality
 *     test asserts "sensitive" or "secret" wording per T-02-12.
 *   - setup_shopify_callback: URL carries all 3 query params; body is EMPTY
 *     (no JSON body sent); description-quality test asserts "single-use" per
 *     T-02-13.
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

describe("get_shopify_config", () => {
  const payload = {
    shop_name: "acme store",
    delivery_methods: [],
    locations: [],
    auto_mark_as_rfc: true,
    is_fulfillment: true,
    fulfillment_state: "fulfilled",
    is_manual_international_order_confirmed: false,
    wms_delay_minutes: 0,
    user_id: "u_123",
  };

  it("percent-encodes the shop_name path param", async () => {
    const rawShop = "acme store/with special";
    const encoded = encodeURIComponent(rawShop);
    let capturedUrl: string | undefined;
    server.use(
      http.get(`${PLATFORM}/shopify/config/:rest*`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(payload);
      }),
    );
    const mod = await import("../../lib/tools/get-shopify-config");
    const result = await mod.spec.handler(auth, {
      shop_name: rawShop,
      environment: "production",
    });
    expect(capturedUrl).toBeDefined();
    expect(capturedUrl!.includes(encoded)).toBe(true);
    // Raw (un-encoded) string must NOT appear verbatim.
    expect(capturedUrl!.includes(rawShop)).toBe(false);

    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("fulfillment_state");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.get(`${PLATFORM}/shopify/config/:rest*`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/get-shopify-config");
    const { QuiqupHttpError } = await import(
      "../../lib/clients/quiqup-lastmile"
    );
    await expect(
      mod.spec.handler(auth, {
        shop_name: "acme",
        environment: "production",
      }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/get-shopify-config");
    await expect(
      mod.spec.handler(authAnon, {
        shop_name: "acme",
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("list_shopify_delivery_methods", () => {
  const payload = {
    delivery_methods: [
      { code: "express", shipping_method_id: "sm_1", title: "Express" },
    ],
  };

  it("forwards shop_name as a percent-encoded query param and sends no body", async () => {
    let capturedUrl: URL | undefined;
    let capturedBody: string | undefined;
    server.use(
      http.get(
        `${PLATFORM}/shopify/delivery-methods`,
        async ({ request }) => {
          capturedUrl = new URL(request.url);
          // GET — request.text() returns "" if no body.
          capturedBody = await request.text();
          return HttpResponse.json(payload);
        },
      ),
    );
    const mod = await import(
      "../../lib/tools/list-shopify-delivery-methods"
    );
    const result = await mod.spec.handler(auth, {
      shop_name: "acme store",
      environment: "production",
    });
    expect(capturedUrl).toBeDefined();
    expect(capturedUrl!.searchParams.get("shop_name")).toBe("acme store");
    expect(capturedBody).toBe("");

    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("Express");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.get(`${PLATFORM}/shopify/delivery-methods`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import(
      "../../lib/tools/list-shopify-delivery-methods"
    );
    const { QuiqupHttpError } = await import(
      "../../lib/clients/quiqup-lastmile"
    );
    await expect(
      mod.spec.handler(auth, {
        shop_name: "acme",
        environment: "production",
      }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import(
      "../../lib/tools/list-shopify-delivery-methods"
    );
    await expect(
      mod.spec.handler(authAnon, {
        shop_name: "acme",
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("list_shopify_locations", () => {
  const payload = {
    locations: [
      { code: "loc_1", shipping_method_id: "sm_1", title: "Warehouse A" },
    ],
  };

  it("forwards shop_name as a query param and sends no body", async () => {
    let capturedUrl: URL | undefined;
    let capturedBody: string | undefined;
    server.use(
      http.get(`${PLATFORM}/shopify/locations`, async ({ request }) => {
        capturedUrl = new URL(request.url);
        capturedBody = await request.text();
        return HttpResponse.json(payload);
      }),
    );
    const mod = await import("../../lib/tools/list-shopify-locations");
    const result = await mod.spec.handler(auth, {
      shop_name: "acme",
      environment: "production",
    });
    expect(capturedUrl).toBeDefined();
    expect(capturedUrl!.searchParams.get("shop_name")).toBe("acme");
    expect(capturedBody).toBe("");

    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("Warehouse A");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.get(`${PLATFORM}/shopify/locations`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/list-shopify-locations");
    const { QuiqupHttpError } = await import(
      "../../lib/clients/quiqup-lastmile"
    );
    await expect(
      mod.spec.handler(auth, {
        shop_name: "acme",
        environment: "production",
      }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/list-shopify-locations");
    await expect(
      mod.spec.handler(authAnon, {
        shop_name: "acme",
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("update_shopify_config", () => {
  const payload = { message: "ok" };

  it("puts the body without idempotency_key or environment leaking", async () => {
    let captured: Record<string, unknown> | undefined;
    server.use(
      http.put(`${PLATFORM}/shopify/config`, async ({ request }) => {
        captured = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(payload);
      }),
    );
    const mod = await import("../../lib/tools/update-shopify-config");
    const deliveryMethods = [
      {
        quiqup_name: "express",
        shipping_method_id: "sm_1",
        shipping_profile_id: "sp_1",
        shopify_name: "Express",
      },
    ];
    const result = await mod.spec.handler(auth, {
      shop_name: "acme",
      delivery_methods: deliveryMethods,
      locations: [
        { quiqup_location: "warehouse_a", shopify_location: "loc_1" },
      ],
      auto_mark_as_rfc: true,
      wms_delay_minutes: 30,
      idempotency_key: "idem_abc",
      environment: "production",
    });
    expect(captured).toBeDefined();
    expect(captured!.shop_name).toBe("acme");
    expect(captured!.delivery_methods).toEqual(deliveryMethods);
    expect(captured!.auto_mark_as_rfc).toBe(true);
    expect(captured!.wms_delay_minutes).toBe(30);
    expect(captured).not.toHaveProperty("idempotency_key");
    expect(captured).not.toHaveProperty("environment");

    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("ok");
  });

  it("schema rejects wms_delay_minutes:10081 (max 10080)", async () => {
    const mod = await import("../../lib/tools/update-shopify-config");
    expect(
      mod.spec.inputSchema.safeParse({
        shop_name: "acme",
        wms_delay_minutes: 10081,
      }).success,
    ).toBe(false);
    expect(
      mod.spec.inputSchema.safeParse({
        shop_name: "acme",
        wms_delay_minutes: 10080,
      }).success,
    ).toBe(true);
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.put(`${PLATFORM}/shopify/config`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/update-shopify-config");
    const { QuiqupHttpError } = await import(
      "../../lib/clients/quiqup-lastmile"
    );
    await expect(
      mod.spec.handler(auth, {
        shop_name: "acme",
        environment: "production",
      }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/update-shopify-config");
    await expect(
      mod.spec.handler(authAnon, {
        shop_name: "acme",
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("update_shopify_connection", () => {
  const payload = { message: "ok" };

  it("puts the body including token; description marks token sensitive", async () => {
    let captured: Record<string, unknown> | undefined;
    server.use(
      http.put(`${PLATFORM}/shopify/connection`, async ({ request }) => {
        captured = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(payload);
      }),
    );
    const mod = await import("../../lib/tools/update-shopify-connection");
    const result = await mod.spec.handler(auth, {
      shop_name: "acme",
      code: "oauth_code_xyz",
      is_fulfillment: true,
      token: "shpat_secret_token",
      idempotency_key: "idem_abc",
      environment: "production",
    });
    expect(captured).toBeDefined();
    expect(captured!.shop_name).toBe("acme");
    expect(captured!.token).toBe("shpat_secret_token");
    expect(captured!.code).toBe("oauth_code_xyz");
    expect(captured!.is_fulfillment).toBe(true);
    // 02-REVIEW BL-04: user_id is server-bound to auth.userId, not caller-supplied.
    expect(captured!.user_id).toBe(auth.userId);
    expect(captured).not.toHaveProperty("idempotency_key");
    expect(captured).not.toHaveProperty("environment");

    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("ok");

    // Description-quality assertion: token is marked SENSITIVE (T-02-12).
    const desc = mod.spec.description.toLowerCase();
    expect(desc.includes("sensitive") || desc.includes("secret")).toBe(true);
  });

  it("schema requires token (z.string().min(1))", async () => {
    const mod = await import("../../lib/tools/update-shopify-connection");
    // Missing token → fails.
    expect(
      mod.spec.inputSchema.safeParse({
        shop_name: "acme",
        code: "c",
        is_fulfillment: true,
      }).success,
    ).toBe(false);
    // Empty token → fails (min 1).
    expect(
      mod.spec.inputSchema.safeParse({
        shop_name: "acme",
        code: "c",
        is_fulfillment: true,
        token: "",
      }).success,
    ).toBe(false);
    // All required fields present → passes.
    expect(
      mod.spec.inputSchema.safeParse({
        shop_name: "acme",
        code: "c",
        is_fulfillment: true,
        token: "t",
      }).success,
    ).toBe(true);
  });

  // 02-REVIEW BL-04: `user_id` must NOT be a caller-supplied arg — it is
  // server-bound to auth.userId. Schema must reject extra keys (strict)
  // OR simply ignore them; either way the upstream body must carry
  // auth.userId, NOT any caller-supplied value.
  it("user_id is server-bound (BL-04): handler ignores caller-supplied user_id", async () => {
    let captured: Record<string, unknown> | undefined;
    server.use(
      http.put(`${PLATFORM}/shopify/connection`, async ({ request }) => {
        captured = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ message: "ok" });
      }),
    );
    const mod = await import("../../lib/tools/update-shopify-connection");
    await mod.spec.handler(auth, {
      shop_name: "acme",
      code: "c",
      is_fulfillment: true,
      token: "t",
      // Intentionally inject a foreign user_id via type-cast (an LLM might
      // try this even after the schema is tightened); the handler must
      // ignore it and use auth.userId instead.
      ...({ user_id: "u_attacker" } as unknown as Record<string, never>),
      environment: "production",
    });
    expect(captured!.user_id).toBe(auth.userId);
    expect(captured!.user_id).not.toBe("u_attacker");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.put(`${PLATFORM}/shopify/connection`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/update-shopify-connection");
    const { QuiqupHttpError } = await import(
      "../../lib/clients/quiqup-lastmile"
    );
    await expect(
      mod.spec.handler(auth, {
        shop_name: "acme",
        code: "c",
        is_fulfillment: true,
        token: "t",
        environment: "production",
      }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/update-shopify-connection");
    await expect(
      mod.spec.handler(authAnon, {
        shop_name: "acme",
        code: "c",
        is_fulfillment: true,
        token: "t",
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("setup_shopify_callback", () => {
  const payload = { success_url: "https://app.quiqup.com/onboarding/done" };

  it("posts with all 3 query params and no JSON body; description warns single-use", async () => {
    let capturedUrl: URL | undefined;
    let capturedBody: string | undefined;
    let capturedContentType: string | null | undefined;
    server.use(
      http.post(`${PLATFORM}/shopify/callback`, async ({ request }) => {
        capturedUrl = new URL(request.url);
        capturedBody = await request.text();
        capturedContentType = request.headers.get("content-type");
        return HttpResponse.json(payload);
      }),
    );
    const mod = await import("../../lib/tools/setup-shopify-callback");
    const result = await mod.spec.handler(auth, {
      shop_name: "acme",
      code: "oauth_code_xyz",
      is_fulfillment: true,
      environment: "production",
    });
    expect(capturedUrl).toBeDefined();
    expect(capturedUrl!.searchParams.get("shop_name")).toBe("acme");
    expect(capturedUrl!.searchParams.get("code")).toBe("oauth_code_xyz");
    expect(capturedUrl!.searchParams.get("is_fulfillment")).toBe("true");
    // Body must be empty — endpoint takes ONLY query params.
    expect(capturedBody).toBe("");
    // And we should not have sent a Content-Type header for a JSON body.
    expect(capturedContentType).toBeFalsy();

    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("success_url");

    // Description-quality assertion: single-use warning locked in (T-02-13).
    expect(mod.spec.description.toLowerCase()).toContain("single-use");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.post(`${PLATFORM}/shopify/callback`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/setup-shopify-callback");
    const { QuiqupHttpError } = await import(
      "../../lib/clients/quiqup-lastmile"
    );
    await expect(
      mod.spec.handler(auth, {
        shop_name: "acme",
        code: "c",
        is_fulfillment: true,
        environment: "production",
      }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/setup-shopify-callback");
    await expect(
      mod.spec.handler(authAnon, {
        shop_name: "acme",
        code: "c",
        is_fulfillment: true,
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
  });
});
