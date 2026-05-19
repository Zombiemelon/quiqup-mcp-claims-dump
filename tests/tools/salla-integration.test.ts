/**
 * MSW-mocked Vitest suite for the six Phase-2 / Wave-4 Salla-integration
 * tools (INTG-20/21/23/24/25/26).
 *
 * Coverage contract per tool (locked in by acceptance criteria):
 *   1. Happy path — content[0].text contains the mocked JSON body.
 *   2. Upstream 401 — handler rejects with QuiqupHttpError.
 *   3. Missing auth.userId — handler throws a plain Error before any fetch.
 *
 * Plus tool-specific extras (locked in by acceptance criteria):
 *   - install_salla: description contains "OAuth".
 *   - get_salla_connection: CANARY token "SECRET-TOKEN-DO-NOT-LEAK" is in the
 *     MSW response but MUST NOT appear in the tool output (T-02-29 regression).
 *     Envelope unwrap verified (no top-level `connection:` key).
 *     Description references the token-strip contract.
 *   - get_salla_platform_data: URL-encode test for connection_id path param.
 *   - get_salla_config: TWO paths — (a) 200 unwraps `{ config }` envelope;
 *     (b) 404 returns STRUCTURED `{ config: null, message }` non-error.
 *     Description references the 404-as-null semantic.
 *   - toggle_salla_fulfillment: body == `{ is_fulfillment: <bool> }`; id
 *     path is encoded; synthesized echo response shape verified.
 *   - update_salla_config: body matches input (skip-undefined; connection_id,
 *     idempotency_key, environment NEVER leak); awb_trigger enum validation;
 *     country_filter length-2 validation; description references
 *     list_service_kinds (Phase 1 AUTH-08 cross-reference).
 *
 * Per WR-05 fix `QUIQUP_PLATFORM_API_BASE_URL` is unset in `beforeEach` —
 * without that, a developer with the var set in their shell would silently
 * route fetches around MSW.
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

describe("install_salla", () => {
  const payload = { url: "https://salla.example/oauth/authorize?client_id=q" };

  it("returns the OAuth install URL; description mentions OAuth", async () => {
    server.use(
      http.get(`${PLATFORM}/integrations/install/salla`, () =>
        HttpResponse.json(payload),
      ),
    );
    const mod = await import("../../lib/tools/install-salla");
    const result = await mod.spec.handler(auth, { environment: "production" });
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("https://salla.example/oauth/authorize");

    expect(mod.spec.description).toContain("OAuth");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.get(`${PLATFORM}/integrations/install/salla`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/install-salla");
    const { QuiqupHttpError } = await import(
      "../../lib/clients/quiqup-lastmile"
    );
    await expect(
      mod.spec.handler(auth, { environment: "production" }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/install-salla");
    await expect(
      mod.spec.handler(authAnon, { environment: "production" }),
    ).rejects.toThrow(/authenticated user/);
  });

  // 02-REVIEW WR-03: this tool initiates an OAuth flow — must carry
  // `audit: true` AND a rate-limit. A pure read tool would skip both, but
  // install_salla is closer to a transactional write.
  it("declares audit + rate-limit guardrails (WR-03)", async () => {
    const mod = await import("../../lib/tools/install-salla");
    expect(mod.spec.guardrails?.audit).toBe(true);
    expect(mod.spec.guardrails?.rateLimit).toBeDefined();
    expect(mod.spec.guardrails?.rateLimit?.capacity).toBeGreaterThan(0);
  });
});

describe("get_salla_connection", () => {
  const CANARY = "SECRET-TOKEN-DO-NOT-LEAK";
  const payload = {
    connection: {
      id: "c1",
      shop_name: "acme",
      site_url: "https://acme.salla.sa",
      source: "salla",
      user_id: "u1",
      is_fulfillment: true,
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-02T00:00:00Z",
      // The BE deliberately sends a `token` here — the MCP layer MUST strip
      // it before returning anything to the caller. This is the T-02-29 canary.
      token: CANARY,
    },
  };

  it("unwraps the envelope AND strips the upstream `token` field (canary test)", async () => {
    server.use(
      http.get(`${PLATFORM}/integrations/connections/c1`, () =>
        HttpResponse.json(payload),
      ),
    );
    const mod = await import("../../lib/tools/get-salla-connection");
    const result = await mod.spec.handler(auth, {
      id: "c1",
      environment: "production",
    });
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");

    // (1) Canonical T-02-29 regression: the canary MUST NOT appear in output.
    expect(first.text).not.toContain(CANARY);
    expect(first.text).not.toContain("token");

    // (2) Envelope is unwrapped — no top-level `connection` key.
    const parsed = JSON.parse(first.text) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("connection");
    expect(parsed.id).toBe("c1");
    expect(parsed.shop_name).toBe("acme");
    expect(parsed.source).toBe("salla");
    expect(parsed.is_fulfillment).toBe(true);

    // (3) Description references the token-strip contract so an LLM reading
    //     the description understands the omission.
    expect(mod.spec.description.toLowerCase()).toContain("token");
  });

  it("URL-encodes the id path param", async () => {
    const rawId = "conn id/with special";
    const encoded = encodeURIComponent(rawId);
    let capturedUrl: string | undefined;
    server.use(
      http.get(`${PLATFORM}/integrations/connections/:rest*`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(payload);
      }),
    );
    const mod = await import("../../lib/tools/get-salla-connection");
    await mod.spec.handler(auth, { id: rawId, environment: "production" });
    expect(capturedUrl).toBeDefined();
    expect(capturedUrl!.includes(encoded)).toBe(true);
    expect(capturedUrl!.includes(rawId)).toBe(false);
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.get(`${PLATFORM}/integrations/connections/c1`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/get-salla-connection");
    const { QuiqupHttpError } = await import(
      "../../lib/clients/quiqup-lastmile"
    );
    await expect(
      mod.spec.handler(auth, { id: "c1", environment: "production" }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/get-salla-connection");
    await expect(
      mod.spec.handler(authAnon, { id: "c1", environment: "production" }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("get_salla_platform_data", () => {
  const payload = {
    shipping_methods: [
      { id: "sm1", code: "salla_express", title: "Salla Express", kind: "in_house" },
    ],
    locations: [{ id: "loc1", name: "Riyadh DC" }],
  };

  it("URL-encodes the connection_id path param and forwards the body", async () => {
    const rawId = "conn id/with special";
    const encoded = encodeURIComponent(rawId);
    let capturedUrl: string | undefined;
    server.use(
      http.get(
        `${PLATFORM}/integrations/configs/:rest*/platform-data`,
        ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json(payload);
        },
      ),
    );
    const mod = await import("../../lib/tools/get-salla-platform-data");
    const result = await mod.spec.handler(auth, {
      connection_id: rawId,
      environment: "production",
    });
    expect(capturedUrl).toBeDefined();
    expect(capturedUrl!.includes(encoded)).toBe(true);
    expect(capturedUrl!.includes(rawId)).toBe(false);

    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("salla_express");
    expect(first.text).toContain("Riyadh DC");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.get(
        `${PLATFORM}/integrations/configs/:rest*/platform-data`,
        () =>
          HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/get-salla-platform-data");
    const { QuiqupHttpError } = await import(
      "../../lib/clients/quiqup-lastmile"
    );
    await expect(
      mod.spec.handler(auth, {
        connection_id: "c1",
        environment: "production",
      }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/get-salla-platform-data");
    await expect(
      mod.spec.handler(authAnon, {
        connection_id: "c1",
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("get_salla_config", () => {
  const fullConfig = {
    config: {
      delivery_methods: [
        {
          platform_method: "salla_express",
          platform_method_id: "sm1",
          service_kind: "same_day",
        },
      ],
      locations: [{ platform_location_id: "loc1", warehouse_id: "wh1" }],
      initial_order_states: ["paid"],
      awb_trigger: "pending",
      country_filter: ["AE", "SA"],
      sync_products: true,
      auto_mark_as_rfc: false,
      wms_delay_minutes: 0,
      is_manual_international_order_confirmed: false,
    },
  };

  it("unwraps the { config } envelope on 200", async () => {
    server.use(
      http.get(`${PLATFORM}/integrations/configs/c1`, () =>
        HttpResponse.json(fullConfig),
      ),
    );
    const mod = await import("../../lib/tools/get-salla-config");
    const result = await mod.spec.handler(auth, {
      connection_id: "c1",
      environment: "production",
    });
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");

    const parsed = JSON.parse(first.text) as Record<string, unknown>;
    // No top-level `config` key — it was unwrapped.
    expect(parsed).not.toHaveProperty("config");
    expect(parsed.awb_trigger).toBe("pending");
    expect(parsed.country_filter).toEqual(["AE", "SA"]);
  });

  it("returns STRUCTURED { config: null } on 404 (not an error)", async () => {
    server.use(
      http.get(`${PLATFORM}/integrations/configs/c1`, () =>
        new HttpResponse(null, { status: 404 }),
      ),
    );
    const mod = await import("../../lib/tools/get-salla-config");
    const result = await mod.spec.handler(auth, {
      connection_id: "c1",
      environment: "production",
    });

    // Not flagged as an error (this is a clean negative read).
    expect((result as { isError?: boolean }).isError).toBeFalsy();

    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    const parsed = JSON.parse(first.text) as Record<string, unknown>;
    expect(parsed).toHaveProperty("config", null);
    expect(typeof parsed.message).toBe("string");
    expect((parsed.message as string).toLowerCase()).toContain("no salla config");

    // Description-quality: 404-as-null semantic is documented.
    const desc = mod.spec.description.toLowerCase();
    expect(desc).toContain("no salla config");
  });

  it("throws QuiqupHttpError on upstream 401 (NOT swallowed like 404)", async () => {
    server.use(
      http.get(`${PLATFORM}/integrations/configs/c1`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/get-salla-config");
    const { QuiqupHttpError } = await import(
      "../../lib/clients/quiqup-lastmile"
    );
    await expect(
      mod.spec.handler(auth, {
        connection_id: "c1",
        environment: "production",
      }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/get-salla-config");
    await expect(
      mod.spec.handler(authAnon, {
        connection_id: "c1",
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("toggle_salla_fulfillment", () => {
  it("sends body { is_fulfillment }; URL-encodes id; returns synthesized echo", async () => {
    const rawId = "conn id/x";
    const encoded = encodeURIComponent(rawId);
    let capturedUrl: string | undefined;
    let capturedBody: Record<string, unknown> | undefined;
    server.use(
      http.put(
        `${PLATFORM}/integrations/connections/:rest*/fulfillment`,
        async ({ request }) => {
          capturedUrl = request.url;
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({});
        },
      ),
    );
    const mod = await import("../../lib/tools/toggle-salla-fulfillment");
    const result = await mod.spec.handler(auth, {
      id: rawId,
      is_fulfillment: true,
      idempotency_key: "idem_x",
      environment: "production",
    });

    expect(capturedUrl).toBeDefined();
    expect(capturedUrl!.includes(encoded)).toBe(true);
    expect(capturedUrl!.includes(rawId)).toBe(false);

    expect(capturedBody).toEqual({ is_fulfillment: true });
    expect(capturedBody).not.toHaveProperty("idempotency_key");
    expect(capturedBody).not.toHaveProperty("environment");
    expect(capturedBody).not.toHaveProperty("id");

    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    const echo = JSON.parse(first.text) as Record<string, unknown>;
    expect(echo).toEqual({ ok: true, is_fulfillment: true, id: rawId });
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.put(
        `${PLATFORM}/integrations/connections/:rest*/fulfillment`,
        () =>
          HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/toggle-salla-fulfillment");
    const { QuiqupHttpError } = await import(
      "../../lib/clients/quiqup-lastmile"
    );
    await expect(
      mod.spec.handler(auth, {
        id: "c1",
        is_fulfillment: false,
        environment: "production",
      }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/toggle-salla-fulfillment");
    await expect(
      mod.spec.handler(authAnon, {
        id: "c1",
        is_fulfillment: true,
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("update_salla_config", () => {
  it("PUTs the unwrapped body without connection_id / idempotency_key / environment leaking; description references list_service_kinds", async () => {
    let captured: Record<string, unknown> | undefined;
    let capturedUrl: string | undefined;
    server.use(
      http.put(
        `${PLATFORM}/integrations/configs/:rest*`,
        async ({ request }) => {
          capturedUrl = request.url;
          captured = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({});
        },
      ),
    );
    const mod = await import("../../lib/tools/update-salla-config");
    const deliveryMethods = [
      {
        platform_method: "salla_express",
        platform_method_id: "sm1",
        service_kind: "same_day",
      },
    ];
    const countryFilter = ["AE", "SA"];
    const result = await mod.spec.handler(auth, {
      connection_id: "c1",
      delivery_methods: deliveryMethods,
      country_filter: countryFilter,
      awb_trigger: "ready_for_collection",
      wms_delay_minutes: 30,
      auto_mark_as_rfc: true,
      idempotency_key: "idem_abc",
      environment: "production",
    });

    expect(capturedUrl).toBeDefined();
    expect(capturedUrl!.includes("/integrations/configs/c1")).toBe(true);

    expect(captured).toBeDefined();
    expect(captured!.delivery_methods).toEqual(deliveryMethods);
    expect(captured!.country_filter).toEqual(countryFilter);
    expect(captured!.awb_trigger).toBe("ready_for_collection");
    expect(captured!.wms_delay_minutes).toBe(30);
    expect(captured!.auto_mark_as_rfc).toBe(true);

    // The path-only / tool-level fields must NOT leak into the body.
    expect(captured).not.toHaveProperty("connection_id");
    expect(captured).not.toHaveProperty("idempotency_key");
    expect(captured).not.toHaveProperty("environment");
    // Skip-undefined: omitted optional keys must NOT appear.
    expect(captured).not.toHaveProperty("locations");
    expect(captured).not.toHaveProperty("sync_products");
    expect(captured).not.toHaveProperty("initial_order_states");
    expect(captured).not.toHaveProperty(
      "is_manual_international_order_confirmed",
    );

    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    const echo = JSON.parse(first.text) as Record<string, unknown>;
    expect(echo).toEqual({ ok: true, connection_id: "c1" });

    // Description-quality: list_service_kinds cross-phase reference.
    expect(mod.spec.description).toContain("list_service_kinds");
  });

  it("schema rejects awb_trigger values outside the 6-value enum", async () => {
    const mod = await import("../../lib/tools/update-salla-config");
    expect(
      mod.spec.inputSchema.safeParse({
        connection_id: "c1",
        awb_trigger: "invalid_value",
        environment: "production",
      }).success,
    ).toBe(false);
    expect(
      mod.spec.inputSchema.safeParse({
        connection_id: "c1",
        awb_trigger: "ready_for_collection_or_webhook",
        environment: "production",
      }).success,
    ).toBe(true);
  });

  it("schema rejects country_filter entries that aren't ISO-3166 alpha-2 (WR-01)", async () => {
    const mod = await import("../../lib/tools/update-salla-config");
    // Length-3 — original rejection.
    expect(
      mod.spec.inputSchema.safeParse({
        connection_id: "c1",
        country_filter: ["XYZ"],
        environment: "production",
      }).success,
    ).toBe(false);
    // 02-REVIEW WR-01: the previous length(2) shape ADMITTED these.
    for (const bad of ["12", "  ", "\n\n", "ae", "Ae", "A1", "A-"]) {
      expect(
        mod.spec.inputSchema.safeParse({
          connection_id: "c1",
          country_filter: [bad],
          environment: "production",
        }).success,
      ).toBe(false);
    }
    // Positive.
    expect(
      mod.spec.inputSchema.safeParse({
        connection_id: "c1",
        country_filter: ["AE", "SA"],
        environment: "production",
      }).success,
    ).toBe(true);
  });

  it("schema rejects wms_delay_minutes:10081 (max 10080)", async () => {
    const mod = await import("../../lib/tools/update-salla-config");
    expect(
      mod.spec.inputSchema.safeParse({
        connection_id: "c1",
        wms_delay_minutes: 10081,
        environment: "production",
      }).success,
    ).toBe(false);
    expect(
      mod.spec.inputSchema.safeParse({
        connection_id: "c1",
        wms_delay_minutes: 10080,
        environment: "production",
      }).success,
    ).toBe(true);
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.put(`${PLATFORM}/integrations/configs/:rest*`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/update-salla-config");
    const { QuiqupHttpError } = await import(
      "../../lib/clients/quiqup-lastmile"
    );
    await expect(
      mod.spec.handler(auth, {
        connection_id: "c1",
        environment: "production",
      }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/update-salla-config");
    await expect(
      mod.spec.handler(authAnon, {
        connection_id: "c1",
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
  });
});
