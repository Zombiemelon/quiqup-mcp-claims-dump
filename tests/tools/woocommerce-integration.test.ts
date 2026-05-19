/**
 * MSW-mocked Vitest suite for the six Phase-2 / Wave-3 WooCommerce-integration
 * tools (INTG-13/14/15/16/17/18).
 *
 * Coverage contract per tool (locked in by acceptance criteria):
 *   1. Happy path — content[0].text contains the mocked JSON body.
 *   2. Upstream 401 — handler rejects with QuiqupHttpError.
 *   3. Missing auth.userId — handler throws a plain Error before any fetch.
 *
 * Plus tool-specific extras (locked in by acceptance criteria):
 *   - get_woocommerce_config: URL path includes the percent-encoded site_name.
 *   - list_woocommerce_shipping_lines: ?site_url=<encoded>; z.string().url()
 *     rejects "not-a-url" at the schema layer.
 *   - list_woocommerce_states: description disambiguates Quiqup vs WooCommerce
 *     state taxonomies (description-quality grep).
 *   - setup_woocommerce_connection: outbound body == { shop_name, site_url,
 *     token, is_fulfillment } (no idempotency_key/environment leak);
 *     description marks token as "sensitive" per T-02-22.
 *   - upsert_woocommerce_config: outbound body matches input (skip-undefined);
 *     description references list_woocommerce_states + list_woocommerce_shipping_lines;
 *     country_filter rejects ["USA"] (length 3); wms_delay_minutes rejects 10081.
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

describe("list_woocommerce_connections", () => {
  const payload = {
    connections: [
      {
        shop_name: "acme",
        site_url: "https://acme.example.com",
        is_fulfillment: true,
        user_id: "u_123",
      },
    ],
  };

  it("fetches the catalog and forwards the JSON body", async () => {
    server.use(
      http.get(`${PLATFORM}/woocommerce/connections`, () =>
        HttpResponse.json(payload),
      ),
    );
    const mod = await import("../../lib/tools/list-woocommerce-connections");
    const result = await mod.spec.handler(auth, {
      environment: "production",
    });
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("acme");
    expect(first.text).toContain("site_url");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.get(`${PLATFORM}/woocommerce/connections`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/list-woocommerce-connections");
    const { QuiqupHttpError } = await import(
      "../../lib/clients/quiqup-lastmile"
    );
    await expect(
      mod.spec.handler(auth, { environment: "production" }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/list-woocommerce-connections");
    await expect(
      mod.spec.handler(authAnon, { environment: "production" }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("get_woocommerce_config", () => {
  const payload = {
    site_url: "https://acme.example.com",
    auto_mark_as_rfc: true,
    country_filter: ["AE"],
    delivery_method: [],
    states: [],
    sync_products: false,
    wms_delay_minutes: 0,
    user_id: "u_123",
  };

  it("percent-encodes the site_name path param", async () => {
    const rawSite = "acme site/with special";
    const encoded = encodeURIComponent(rawSite);
    let capturedUrl: string | undefined;
    server.use(
      http.get(`${PLATFORM}/woocommerce/config/:rest*`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(payload);
      }),
    );
    const mod = await import("../../lib/tools/get-woocommerce-config");
    const result = await mod.spec.handler(auth, {
      site_name: rawSite,
      environment: "production",
    });
    expect(capturedUrl).toBeDefined();
    expect(capturedUrl!.includes(encoded)).toBe(true);
    // Raw (un-encoded) string must NOT appear verbatim.
    expect(capturedUrl!.includes(rawSite)).toBe(false);

    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("auto_mark_as_rfc");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.get(`${PLATFORM}/woocommerce/config/:rest*`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/get-woocommerce-config");
    const { QuiqupHttpError } = await import(
      "../../lib/clients/quiqup-lastmile"
    );
    await expect(
      mod.spec.handler(auth, {
        site_name: "acme",
        environment: "production",
      }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/get-woocommerce-config");
    await expect(
      mod.spec.handler(authAnon, {
        site_name: "acme",
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("list_woocommerce_states", () => {
  const payload = { states: ["delivered", "rfc", "cancelled"] };

  it("returns the canonical Quiqup state list; description disambiguates Quiqup vs WooCommerce", async () => {
    server.use(
      http.get(`${PLATFORM}/woocommerce/states`, () =>
        HttpResponse.json(payload),
      ),
    );
    const mod = await import("../../lib/tools/list-woocommerce-states");
    const result = await mod.spec.handler(auth, { environment: "production" });
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("delivered");

    // Description-quality assertion: distinguishes Quiqup vs WooCommerce
    // taxonomies (INTG-15 must-have).
    const desc = mod.spec.description.toLowerCase();
    expect(desc).toContain("quiqup");
    expect(desc).toContain("woocommerce");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.get(`${PLATFORM}/woocommerce/states`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/list-woocommerce-states");
    const { QuiqupHttpError } = await import(
      "../../lib/clients/quiqup-lastmile"
    );
    await expect(
      mod.spec.handler(auth, { environment: "production" }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/list-woocommerce-states");
    await expect(
      mod.spec.handler(authAnon, { environment: "production" }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("list_woocommerce_shipping_lines", () => {
  const payload = {
    shipping_methods: [
      {
        id: 1,
        instance_id: 7,
        method_id: "flat_rate",
        method_title: "Flat rate",
        enabled: true,
        zone_id: 1,
        zone_name: "UAE",
      },
    ],
  };

  it("forwards site_url as a query param and sends no body", async () => {
    let capturedUrl: URL | undefined;
    let capturedBody: string | undefined;
    server.use(
      http.get(
        `${PLATFORM}/woocommerce/shipping-lines`,
        async ({ request }) => {
          capturedUrl = new URL(request.url);
          capturedBody = await request.text();
          return HttpResponse.json(payload);
        },
      ),
    );
    const mod = await import(
      "../../lib/tools/list-woocommerce-shipping-lines"
    );
    const result = await mod.spec.handler(auth, {
      site_url: "https://acme.example.com",
      environment: "production",
    });
    expect(capturedUrl).toBeDefined();
    expect(capturedUrl!.searchParams.get("site_url")).toBe(
      "https://acme.example.com",
    );
    expect(capturedBody).toBe("");

    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("flat_rate");
  });

  it("schema rejects site_url that is not a URL", async () => {
    const mod = await import(
      "../../lib/tools/list-woocommerce-shipping-lines"
    );
    expect(
      mod.spec.inputSchema.safeParse({
        site_url: "not-a-url",
        environment: "production",
      }).success,
    ).toBe(false);
    expect(
      mod.spec.inputSchema.safeParse({
        site_url: "https://acme.example.com",
        environment: "production",
      }).success,
    ).toBe(true);
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.get(`${PLATFORM}/woocommerce/shipping-lines`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import(
      "../../lib/tools/list-woocommerce-shipping-lines"
    );
    const { QuiqupHttpError } = await import(
      "../../lib/clients/quiqup-lastmile"
    );
    await expect(
      mod.spec.handler(auth, {
        site_url: "https://acme.example.com",
        environment: "production",
      }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import(
      "../../lib/tools/list-woocommerce-shipping-lines"
    );
    await expect(
      mod.spec.handler(authAnon, {
        site_url: "https://acme.example.com",
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("setup_woocommerce_connection", () => {
  const payload = { message: "ok" };

  it("posts only the 4 documented fields; description marks token sensitive", async () => {
    let captured: Record<string, unknown> | undefined;
    server.use(
      http.post(
        `${PLATFORM}/woocommerce/connection`,
        async ({ request }) => {
          captured = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(payload);
        },
      ),
    );
    const mod = await import("../../lib/tools/setup-woocommerce-connection");
    const result = await mod.spec.handler(auth, {
      shop_name: "acme",
      site_url: "https://acme.example.com",
      token: "wc_consumer_secret_abc",
      is_fulfillment: true,
      idempotency_key: "idem_abc",
      environment: "production",
    });
    expect(captured).toBeDefined();
    expect(captured!.shop_name).toBe("acme");
    expect(captured!.site_url).toBe("https://acme.example.com");
    expect(captured!.token).toBe("wc_consumer_secret_abc");
    expect(captured!.is_fulfillment).toBe(true);
    // idempotency_key + environment must NOT leak upstream.
    expect(captured).not.toHaveProperty("idempotency_key");
    expect(captured).not.toHaveProperty("environment");
    // And no extra fields beyond the 4 documented body keys.
    expect(Object.keys(captured!).sort()).toEqual(
      ["is_fulfillment", "shop_name", "site_url", "token"].sort(),
    );

    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("ok");

    // Description-quality assertion: token is marked SENSITIVE per T-02-22.
    expect(mod.spec.description.toLowerCase()).toContain("sensitive");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.post(`${PLATFORM}/woocommerce/connection`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/setup-woocommerce-connection");
    const { QuiqupHttpError } = await import(
      "../../lib/clients/quiqup-lastmile"
    );
    await expect(
      mod.spec.handler(auth, {
        shop_name: "acme",
        site_url: "https://acme.example.com",
        token: "t",
        is_fulfillment: true,
        environment: "production",
      }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/setup-woocommerce-connection");
    await expect(
      mod.spec.handler(authAnon, {
        shop_name: "acme",
        site_url: "https://acme.example.com",
        token: "t",
        is_fulfillment: true,
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("upsert_woocommerce_config", () => {
  const payload = { message: "ok" };

  it("puts the body without idempotency_key or environment leaking; description references state + shipping-line sources", async () => {
    let captured: Record<string, unknown> | undefined;
    server.use(
      http.put(
        `${PLATFORM}/woocommerce/settings/config/upsert`,
        async ({ request }) => {
          captured = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(payload);
        },
      ),
    );
    const mod = await import("../../lib/tools/upsert-woocommerce-config");
    const states = [
      { quiqup_state: "delivered", woocommerce_state: "completed" },
    ];
    const countryFilter = ["AE", "SA"];
    const result = await mod.spec.handler(auth, {
      site_url: "https://acme.example.com",
      states,
      country_filter: countryFilter,
      wms_delay_minutes: 30,
      auto_mark_as_rfc: true,
      idempotency_key: "idem_abc",
      environment: "production",
    });
    expect(captured).toBeDefined();
    expect(captured!.site_url).toBe("https://acme.example.com");
    expect(captured!.states).toEqual(states);
    expect(captured!.country_filter).toEqual(countryFilter);
    expect(captured!.wms_delay_minutes).toBe(30);
    expect(captured!.auto_mark_as_rfc).toBe(true);
    expect(captured).not.toHaveProperty("idempotency_key");
    expect(captured).not.toHaveProperty("environment");
    // Skip-undefined: keys that were not supplied must NOT appear.
    expect(captured).not.toHaveProperty("delivery_method");
    expect(captured).not.toHaveProperty("sync_products");

    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("ok");

    // Description-quality assertion: legal-value lookups locked in.
    expect(mod.spec.description).toContain("list_woocommerce_states");
    expect(mod.spec.description).toContain("list_woocommerce_shipping_lines");
  });

  it("schema rejects country_filter entries with length != 2 (ISO-3166 alpha-2)", async () => {
    const mod = await import("../../lib/tools/upsert-woocommerce-config");
    expect(
      mod.spec.inputSchema.safeParse({
        site_url: "https://acme.example.com",
        country_filter: ["USA"],
      }).success,
    ).toBe(false);
    expect(
      mod.spec.inputSchema.safeParse({
        site_url: "https://acme.example.com",
        country_filter: ["AE", "SA"],
      }).success,
    ).toBe(true);
  });

  it("schema rejects wms_delay_minutes:10081 (max 10080)", async () => {
    const mod = await import("../../lib/tools/upsert-woocommerce-config");
    expect(
      mod.spec.inputSchema.safeParse({
        site_url: "https://acme.example.com",
        wms_delay_minutes: 10081,
      }).success,
    ).toBe(false);
    expect(
      mod.spec.inputSchema.safeParse({
        site_url: "https://acme.example.com",
        wms_delay_minutes: 10080,
      }).success,
    ).toBe(true);
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.put(`${PLATFORM}/woocommerce/settings/config/upsert`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/upsert-woocommerce-config");
    const { QuiqupHttpError } = await import(
      "../../lib/clients/quiqup-lastmile"
    );
    await expect(
      mod.spec.handler(auth, {
        site_url: "https://acme.example.com",
        environment: "production",
      }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/upsert-woocommerce-config");
    await expect(
      mod.spec.handler(authAnon, {
        site_url: "https://acme.example.com",
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
  });
});
