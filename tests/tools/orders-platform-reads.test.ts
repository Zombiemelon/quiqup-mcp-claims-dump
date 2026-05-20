/**
 * MSW-mocked Vitest suite for the Phase-3 Wave-3 Platform read tools:
 *   - find_order_by_id_or_barcode (ORDL-04)
 *   - list_depots                  (ORDL-05)
 *   - list_missions_filter         (ORDL-06)
 *
 * Coverage contract per tool:
 *   1. Happy path — content[0].text contains the mocked JSON body.
 *   2. URL-query forwarding — asserts URLSearchParams is wired correctly
 *      (T-03-18 hygiene; no string concatenation).
 *   3. Schema rejection where applicable (empty required strings).
 *   4. Missing auth.userId — handler throws a plain Error before any fetch
 *      (T-03-17 spoofing mitigation).
 *   5. Upstream 401 — handler rejects with QuiqupHttpError.
 *
 * WR-05 env cleanup: capture+restore QUIQUP_PLATFORM_API_BASE_URL AND
 * QUIQUP_PLATFORM_API_STAGING_BASE_URL in beforeEach/afterEach so a developer
 * with the var set in their shell does not silently route fetches around MSW.
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

// WR-05 env cleanup — capture+restore both the production AND staging
// overrides so a shell with either set cannot silently route fetches around
// MSW.
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
    process.env.QUIQUP_PLATFORM_API_STAGING_BASE_URL =
      originalPlatformStagingUrl;
  }
});

describe("find_order_by_id_or_barcode", () => {
  const happyPayload = {
    found_by: "id",
    order: {
      id: 12345,
      state: "pending",
      uuid: "ord-uuid-abc",
      partner_order_id: "client-id-12345",
    },
  };

  it("happy path returns order envelope", async () => {
    server.use(
      http.get(
        `${PLATFORM}/quiqdash/orders/find_by_id_or_barcode`,
        () => HttpResponse.json(happyPayload),
      ),
    );
    const mod = await import("../../lib/tools/find-order-by-id-or-barcode");
    const result = await mod.spec.handler(auth, {
      value: "12345",
      intention: "set_on_hold",
      environment: "production",
    });
    expect(result.content).toHaveLength(1);
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain('"found_by": "id"');
    expect(first.text).toContain('"state": "pending"');
  });

  it("forwards value + intention as query params", async () => {
    const captured: { value: string | null; intention: string | null } = {
      value: null,
      intention: null,
    };
    server.use(
      http.get(
        `${PLATFORM}/quiqdash/orders/find_by_id_or_barcode`,
        ({ request }) => {
          const url = new URL(request.url);
          captured.value = url.searchParams.get("value");
          captured.intention = url.searchParams.get("intention");
          return HttpResponse.json(happyPayload);
        },
      ),
    );
    const mod = await import("../../lib/tools/find-order-by-id-or-barcode");
    await mod.spec.handler(auth, {
      value: "12345",
      intention: "set_on_hold",
      environment: "production",
    });
    expect(captured.value).toBe("12345");
    expect(captured.intention).toBe("set_on_hold");
  });

  it("surfaces upstream 200-with-error envelope (no-match contract)", async () => {
    server.use(
      http.get(
        `${PLATFORM}/quiqdash/orders/find_by_id_or_barcode`,
        () =>
          HttpResponse.json({ error: "not found", found_by: "", order: null }),
      ),
    );
    const mod = await import("../../lib/tools/find-order-by-id-or-barcode");
    const result = await mod.spec.handler(auth, {
      value: "nope",
      intention: "set_on_hold",
      environment: "production",
    });
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain('"error": "not found"');
    // 200-with-error is the upstream contract for "no match" — NOT a tool
    // error. The handler returns a result without isError set.
    expect((result as { isError?: boolean }).isError).toBeUndefined();
  });

  it("rejects unauthenticated callers", async () => {
    const mod = await import("../../lib/tools/find-order-by-id-or-barcode");
    await expect(
      mod.spec.handler(authAnon, {
        value: "12345",
        intention: "set_on_hold",
        environment: "production",
      }),
    ).rejects.toThrow(/requires an authenticated user/);
  });

  it("maps HTTP 401 to QuiqupHttpError", async () => {
    server.use(
      http.get(
        `${PLATFORM}/quiqdash/orders/find_by_id_or_barcode`,
        () =>
          HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/find-order-by-id-or-barcode");
    const { QuiqupHttpError } = await import(
      "../../lib/clients/quiqup-lastmile"
    );
    await expect(
      mod.spec.handler(auth, {
        value: "12345",
        intention: "set_on_hold",
        environment: "production",
      }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });
});

describe("list_depots", () => {
  const happyPayload = {
    depots: [
      {
        id: "depot-1",
        name: "DXB Main",
        region: "UAE",
        mainDepot: "true",
        country: "AE",
      },
    ],
  };

  it("happy path returns depots[]", async () => {
    server.use(
      http.get(`${PLATFORM}/quiqdash/depots`, () =>
        HttpResponse.json(happyPayload),
      ),
    );
    const mod = await import("../../lib/tools/list-depots");
    const result = await mod.spec.handler(auth, {
      region: "UAE",
      main_depot: true,
      environment: "production",
    });
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("depot-1");
    expect(first.text).toContain("DXB Main");
  });

  it("forwards region + mainDepot (camelCase) as query params", async () => {
    const captured: { region: string | null; mainDepot: string | null } = {
      region: null,
      mainDepot: null,
    };
    server.use(
      http.get(`${PLATFORM}/quiqdash/depots`, ({ request }) => {
        const url = new URL(request.url);
        captured.region = url.searchParams.get("region");
        captured.mainDepot = url.searchParams.get("mainDepot");
        return HttpResponse.json(happyPayload);
      }),
    );
    const mod = await import("../../lib/tools/list-depots");
    await mod.spec.handler(auth, {
      region: "UAE",
      main_depot: true,
      environment: "production",
    });
    expect(captured.region).toBe("UAE");
    // camelCase on the wire; boolean serialized as the literal string "true".
    expect(captured.mainDepot).toBe("true");
  });

  it("rejects empty region", async () => {
    const mod = await import("../../lib/tools/list-depots");
    const parsed = mod.spec.inputSchema.safeParse({
      region: "",
      main_depot: true,
      environment: "production",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects unauthenticated callers", async () => {
    const mod = await import("../../lib/tools/list-depots");
    await expect(
      mod.spec.handler(authAnon, {
        region: "UAE",
        main_depot: true,
        environment: "production",
      }),
    ).rejects.toThrow(/requires an authenticated user/);
  });

  it("maps HTTP 401 to QuiqupHttpError", async () => {
    server.use(
      http.get(`${PLATFORM}/quiqdash/depots`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/list-depots");
    const { QuiqupHttpError } = await import(
      "../../lib/clients/quiqup-lastmile"
    );
    await expect(
      mod.spec.handler(auth, {
        region: "UAE",
        main_depot: true,
        environment: "production",
      }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });
});

describe("list_missions_filter", () => {
  const happyPayload = {
    results: ["DXB-mission-1", "DXB-mission-2"],
  };

  it("happy path returns results[]", async () => {
    server.use(
      http.get(`${PLATFORM}/quiqdash/missions`, () =>
        HttpResponse.json(happyPayload),
      ),
    );
    const mod = await import("../../lib/tools/list-missions-filter");
    const result = await mod.spec.handler(auth, {
      value: "DXB",
      environment: "production",
    });
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("DXB-mission-1");
    expect(first.text).toContain("DXB-mission-2");
  });

  it("forwards value as query param", async () => {
    const captured: { value: string | null } = { value: null };
    server.use(
      http.get(`${PLATFORM}/quiqdash/missions`, ({ request }) => {
        const url = new URL(request.url);
        captured.value = url.searchParams.get("value");
        return HttpResponse.json(happyPayload);
      }),
    );
    const mod = await import("../../lib/tools/list-missions-filter");
    await mod.spec.handler(auth, {
      value: "DXB",
      environment: "production",
    });
    expect(captured.value).toBe("DXB");
  });

  it("rejects empty value", async () => {
    const mod = await import("../../lib/tools/list-missions-filter");
    const parsed = mod.spec.inputSchema.safeParse({
      value: "",
      environment: "production",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects unauthenticated callers", async () => {
    const mod = await import("../../lib/tools/list-missions-filter");
    await expect(
      mod.spec.handler(authAnon, {
        value: "DXB",
        environment: "production",
      }),
    ).rejects.toThrow(/requires an authenticated user/);
  });

  it("maps HTTP 401 to QuiqupHttpError", async () => {
    server.use(
      http.get(`${PLATFORM}/quiqdash/missions`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/list-missions-filter");
    const { QuiqupHttpError } = await import(
      "../../lib/clients/quiqup-lastmile"
    );
    await expect(
      mod.spec.handler(auth, {
        value: "DXB",
        environment: "production",
      }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });
});
