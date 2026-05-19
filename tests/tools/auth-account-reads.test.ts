/**
 * MSW-mocked Vitest suite for the seven Phase-1 read tools plus a reciprocal
 * disambiguation lock-in on whoami_platform.
 *
 * Coverage contract per tool (locked in by acceptance criteria):
 *   1. Happy path — content[0].text contains the mocked JSON body.
 *   2. Upstream 401 — handler rejects with QuiqupHttpError (the registerTool
 *      wrapper catches and unwraps this in production; this suite calls the
 *      handler directly so it sees the raw throw).
 *   3. Missing auth.userId — handler throws a plain Error before any fetch.
 *
 * Plus disambiguation lock-ins:
 *   - get_account.description.includes("whoami_platform")
 *   - get_account.description.includes("get_account_by_id")
 *   - whoami_platform.description.includes("get_account")
 *
 * The MSW handlers below intentionally use the production base URL —
 * lib/clients/quiqup-env.ts defaults the env to "production" and there is no
 * QUIQUP_PLATFORM_API_BASE_URL override exported for the test process, so the
 * handlers under test will hit platform-api.quiqup.com (which msw intercepts).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
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
  scopes: ["read"],
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("get_account", () => {
  const payload = {
    id: "acct_123",
    name: "Test Partner",
    settings: { currency: "AED" },
    service_offering: ["lastmile", "fulfilment"],
  };

  it("returns the /account payload as a text content block", async () => {
    server.use(
      http.get(`${PLATFORM}/account`, () => HttpResponse.json(payload)),
    );
    const mod = await import("../../lib/tools/get-account");
    const result = await mod.spec.handler(auth, { environment: "production" });
    expect(result.content).toHaveLength(1);
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("acct_123");
    const parsed = JSON.parse(first.text);
    expect(parsed.name).toBe("Test Partner");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.get(`${PLATFORM}/account`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/get-account");
    const { QuiqupHttpError } = await import("../../lib/clients/quiqup-lastmile");
    await expect(
      mod.spec.handler(auth, { environment: "production" }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/get-account");
    await expect(
      mod.spec.handler(authAnon, { environment: "production" }),
    ).rejects.toThrow(/authenticated user/);
  });

  it("description disambiguates against whoami_platform and get_account_by_id", async () => {
    const mod = await import("../../lib/tools/get-account");
    expect(mod.spec.description).toContain("whoami_platform");
    expect(mod.spec.description).toContain("get_account_by_id");
  });
});

describe("get_permissions", () => {
  const payload = { permissions: ["orders.read", "inventory.read"] };

  it("returns the /permissions payload as text", async () => {
    server.use(
      http.get(`${PLATFORM}/permissions`, ({ request }) => {
        // Lock in the x-api-version header (T-01-07 in PLAN.md).
        expect(request.headers.get("x-api-version")).toBe("1");
        return HttpResponse.json(payload);
      }),
    );
    const mod = await import("../../lib/tools/get-permissions");
    const result = await mod.spec.handler(auth, { environment: "production" });
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("orders.read");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.get(`${PLATFORM}/permissions`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/get-permissions");
    const { QuiqupHttpError } = await import("../../lib/clients/quiqup-lastmile");
    await expect(
      mod.spec.handler(auth, { environment: "production" }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/get-permissions");
    await expect(
      mod.spec.handler(authAnon, { environment: "production" }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("get_account_capabilities", () => {
  const payload = { fulfillment_enabled: true, wms_setup_complete: false };

  it("returns capability flags as text (default id=me)", async () => {
    server.use(
      http.get(`${PLATFORM}/accounts/me/capabilities`, () =>
        HttpResponse.json(payload),
      ),
    );
    const mod = await import("../../lib/tools/get-account-capabilities");
    const result = await mod.spec.handler(auth, {
      id: "me",
      environment: "production",
    });
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("fulfillment_enabled");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.get(`${PLATFORM}/accounts/me/capabilities`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/get-account-capabilities");
    const { QuiqupHttpError } = await import("../../lib/clients/quiqup-lastmile");
    await expect(
      mod.spec.handler(auth, { id: "me", environment: "production" }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/get-account-capabilities");
    await expect(
      mod.spec.handler(authAnon, { id: "me", environment: "production" }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("get_account_by_id", () => {
  const payload = { id: "0035g000xyz", name: "Other Partner" };

  it("returns the /accounts/{id} payload as text", async () => {
    server.use(
      http.get(`${PLATFORM}/accounts/0035g000xyz`, () =>
        HttpResponse.json(payload),
      ),
    );
    const mod = await import("../../lib/tools/get-account-by-id");
    const result = await mod.spec.handler(auth, {
      id: "0035g000xyz",
      environment: "production",
    });
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("Other Partner");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.get(`${PLATFORM}/accounts/0035g000xyz`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/get-account-by-id");
    const { QuiqupHttpError } = await import("../../lib/clients/quiqup-lastmile");
    await expect(
      mod.spec.handler(auth, { id: "0035g000xyz", environment: "production" }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/get-account-by-id");
    await expect(
      mod.spec.handler(authAnon, {
        id: "0035g000xyz",
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("get_quiqdash_init", () => {
  const payload = {
    roles: ["partner_admin"],
    feature_toggles: { wms_v2: true },
    currency: "AED",
  };

  it("returns the boot bundle as text", async () => {
    server.use(
      http.get(`${PLATFORM}/quiqdash/init`, () => HttpResponse.json(payload)),
    );
    const mod = await import("../../lib/tools/get-quiqdash-init");
    const result = await mod.spec.handler(auth, { environment: "production" });
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("partner_admin");
    expect(first.text).toContain("AED");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.get(`${PLATFORM}/quiqdash/init`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/get-quiqdash-init");
    const { QuiqupHttpError } = await import("../../lib/clients/quiqup-lastmile");
    await expect(
      mod.spec.handler(auth, { environment: "production" }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/get-quiqdash-init");
    await expect(
      mod.spec.handler(authAnon, { environment: "production" }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("list_service_kinds", () => {
  const payload = [
    { id: 1, name: "express" },
    { id: 2, name: "standard" },
    { id: 3, name: "returns" },
  ];

  it("returns the service-kind list as text", async () => {
    server.use(
      http.get(`${PLATFORM}/quiqup/service-kinds`, () =>
        HttpResponse.json(payload),
      ),
    );
    const mod = await import("../../lib/tools/list-service-kinds");
    const result = await mod.spec.handler(auth, { environment: "production" });
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("express");
    expect(first.text).toContain("standard");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.get(`${PLATFORM}/quiqup/service-kinds`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/list-service-kinds");
    const { QuiqupHttpError } = await import("../../lib/clients/quiqup-lastmile");
    await expect(
      mod.spec.handler(auth, { environment: "production" }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/list-service-kinds");
    await expect(
      mod.spec.handler(authAnon, { environment: "production" }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("list_quiqup_order_states", () => {
  const payload = ["new", "confirmed", "out_for_delivery", "delivered"];

  it("returns the order-state list as text", async () => {
    server.use(
      http.get(`${PLATFORM}/quiqup/orders/states`, () =>
        HttpResponse.json(payload),
      ),
    );
    const mod = await import("../../lib/tools/list-quiqup-order-states");
    const result = await mod.spec.handler(auth, { environment: "production" });
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("out_for_delivery");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.get(`${PLATFORM}/quiqup/orders/states`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/list-quiqup-order-states");
    const { QuiqupHttpError } = await import("../../lib/clients/quiqup-lastmile");
    await expect(
      mod.spec.handler(auth, { environment: "production" }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/list-quiqup-order-states");
    await expect(
      mod.spec.handler(authAnon, { environment: "production" }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("whoami_platform (reciprocal disambiguation lock-in)", () => {
  it("description references get_account so the pair stays disambiguated", async () => {
    const mod = await import("../../lib/tools/whoami-platform");
    expect(mod.spec.description).toContain("get_account");
  });
});
