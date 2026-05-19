/**
 * MSW-mocked Vitest suite for the 7 Platform-auth ADDR tools and the 5 ORDL
 * reason-code tools shipped in plan 01-02. (`lookup_google_place` has its own
 * dedicated suite in `google-places.test.ts` because it bypasses the Quiqup
 * auth bridge.)
 *
 * Coverage contract per tool (same 3-assertion shape as auth-account-reads.test.ts):
 *   1. Happy path — content[0].text contains the mocked JSON body.
 *   2. Upstream 401 — handler rejects with QuiqupHttpError.
 *   3. Missing auth.userId — handler throws a plain Error before any fetch.
 *
 * Plus query-string lock-ins for the two tools that take query params:
 *   - list_on_hold_reasons:            ?service_kind=<v>
 *   - list_courier_failure_reasons:    ?delivery_type=<v>
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

describe("list_account_addresses", () => {
  const payload = [{ id: "addr_1", label: "Main Warehouse", town: "Dubai" }];

  it('returns addresses for default id="me"', async () => {
    server.use(
      http.get(`${PLATFORM}/accounts/me/addresses`, () =>
        HttpResponse.json(payload),
      ),
    );
    const mod = await import("../../lib/tools/list-account-addresses");
    const result = await mod.spec.handler(auth, {
      id: "me",
      environment: "production",
    });
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("Main Warehouse");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.get(`${PLATFORM}/accounts/me/addresses`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/list-account-addresses");
    const { QuiqupHttpError } = await import("../../lib/clients/quiqup-lastmile");
    await expect(
      mod.spec.handler(auth, { id: "me", environment: "production" }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/list-account-addresses");
    await expect(
      mod.spec.handler(authAnon, { id: "me", environment: "production" }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("create_partner_address", () => {
  const payload = { id: "addr_new", label: "New WH" };

  it("POSTs the address body and returns the created entity", async () => {
    server.use(
      http.post(`${PLATFORM}/partner/addresses`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        // Lock in: no `references` field is ever sent (poison memory).
        expect(body).not.toHaveProperty("references");
        expect(body).toHaveProperty("address1");
        return HttpResponse.json(payload);
      }),
    );
    const mod = await import("../../lib/tools/create-partner-address");
    const result = await mod.spec.handler(auth, {
      address1: "Warehouse 42",
      town: "Dubai",
      country: "AE",
      coordinates: { lat: 25.13, lng: 55.22 },
      label: "New WH",
      environment: "production",
    });
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("addr_new");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.post(`${PLATFORM}/partner/addresses`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/create-partner-address");
    const { QuiqupHttpError } = await import("../../lib/clients/quiqup-lastmile");
    await expect(
      mod.spec.handler(auth, {
        address1: "x",
        town: "Dubai",
        country: "AE",
        coordinates: { lat: 1, lng: 2 },
        environment: "production",
      }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/create-partner-address");
    await expect(
      mod.spec.handler(authAnon, {
        address1: "x",
        town: "Dubai",
        country: "AE",
        coordinates: { lat: 1, lng: 2 },
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("update_partner_address", () => {
  const payload = { id: "addr_123", label: "Renamed" };

  it("PATCHes the address by id and returns the updated entity", async () => {
    server.use(
      http.patch(`${PLATFORM}/partner/addresses/addr_123`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body).not.toHaveProperty("references");
        expect(body).toHaveProperty("label", "Renamed");
        return HttpResponse.json(payload);
      }),
    );
    const mod = await import("../../lib/tools/update-partner-address");
    const result = await mod.spec.handler(auth, {
      id: "addr_123",
      label: "Renamed",
      environment: "production",
    });
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("Renamed");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.patch(`${PLATFORM}/partner/addresses/addr_123`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/update-partner-address");
    const { QuiqupHttpError } = await import("../../lib/clients/quiqup-lastmile");
    await expect(
      mod.spec.handler(auth, { id: "addr_123", environment: "production" }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/update-partner-address");
    await expect(
      mod.spec.handler(authAnon, { id: "addr_123", environment: "production" }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("list_countries", () => {
  const payload = [{ iso2: "AE", name: "United Arab Emirates" }];

  it("returns the country list as text", async () => {
    server.use(
      http.get(`${PLATFORM}/countries`, () => HttpResponse.json(payload)),
    );
    const mod = await import("../../lib/tools/list-countries");
    const result = await mod.spec.handler(auth, { environment: "production" });
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("United Arab Emirates");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.get(`${PLATFORM}/countries`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/list-countries");
    const { QuiqupHttpError } = await import("../../lib/clients/quiqup-lastmile");
    await expect(
      mod.spec.handler(auth, { environment: "production" }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/list-countries");
    await expect(
      mod.spec.handler(authAnon, { environment: "production" }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("list_country_states", () => {
  const payload = [{ name: "Dubai", code: "DU" }];

  it("returns the states for an ISO2 country", async () => {
    server.use(
      http.get(`${PLATFORM}/countries/AE/states`, () =>
        HttpResponse.json(payload),
      ),
    );
    const mod = await import("../../lib/tools/list-country-states");
    const result = await mod.spec.handler(auth, {
      country_iso2: "AE",
      environment: "production",
    });
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("Dubai");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.get(`${PLATFORM}/countries/AE/states`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/list-country-states");
    const { QuiqupHttpError } = await import("../../lib/clients/quiqup-lastmile");
    await expect(
      mod.spec.handler(auth, { country_iso2: "AE", environment: "production" }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/list-country-states");
    await expect(
      mod.spec.handler(authAnon, {
        country_iso2: "AE",
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("list_country_cities", () => {
  const payload = [{ name: "Dubai" }];

  it("returns the cities for an ISO2-or-name country", async () => {
    server.use(
      http.get(`${PLATFORM}/countries/AE/cities`, () =>
        HttpResponse.json(payload),
      ),
    );
    const mod = await import("../../lib/tools/list-country-cities");
    const result = await mod.spec.handler(auth, {
      country_name_or_iso2: "AE",
      environment: "production",
    });
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("Dubai");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.get(`${PLATFORM}/countries/AE/cities`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/list-country-cities");
    const { QuiqupHttpError } = await import("../../lib/clients/quiqup-lastmile");
    await expect(
      mod.spec.handler(auth, {
        country_name_or_iso2: "AE",
        environment: "production",
      }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/list-country-cities");
    await expect(
      mod.spec.handler(authAnon, {
        country_name_or_iso2: "AE",
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("list_state_cities", () => {
  const payload = [{ name: "Jumeirah" }];

  it("returns the cities for an ISO2+state combination (both path params encoded)", async () => {
    // MSW intercepts the encoded path - "Abu%20Dhabi" decodes back to "Abu Dhabi"
    server.use(
      http.get(`${PLATFORM}/countries/AE/states/Abu%20Dhabi/cities`, () =>
        HttpResponse.json(payload),
      ),
    );
    const mod = await import("../../lib/tools/list-state-cities");
    const result = await mod.spec.handler(auth, {
      country_iso2: "AE",
      state_name_or_code: "Abu Dhabi",
      environment: "production",
    });
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("Jumeirah");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.get(`${PLATFORM}/countries/AE/states/Dubai/cities`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/list-state-cities");
    const { QuiqupHttpError } = await import("../../lib/clients/quiqup-lastmile");
    await expect(
      mod.spec.handler(auth, {
        country_iso2: "AE",
        state_name_or_code: "Dubai",
        environment: "production",
      }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/list-state-cities");
    await expect(
      mod.spec.handler(authAnon, {
        country_iso2: "AE",
        state_name_or_code: "Dubai",
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("list_partner_cancellation_reasons", () => {
  const payload = { reasons: [{ code: "customer_cancelled" }] };

  it("returns the reason list as text", async () => {
    server.use(
      http.get(`${PLATFORM}/orders/partner-cancellation-reasons`, () =>
        HttpResponse.json(payload),
      ),
    );
    const mod = await import("../../lib/tools/list-partner-cancellation-reasons");
    const result = await mod.spec.handler(auth, { environment: "production" });
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("customer_cancelled");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.get(`${PLATFORM}/orders/partner-cancellation-reasons`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/list-partner-cancellation-reasons");
    const { QuiqupHttpError } = await import("../../lib/clients/quiqup-lastmile");
    await expect(
      mod.spec.handler(auth, { environment: "production" }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/list-partner-cancellation-reasons");
    await expect(
      mod.spec.handler(authAnon, { environment: "production" }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("list_on_hold_reasons", () => {
  const payload = { reasons: [{ code: "customer_unreachable" }] };

  it("forwards service_kind as a query param and returns the reasons", async () => {
    server.use(
      http.get(
        `${PLATFORM}/quiqdash/orders/states/on_hold_reasons`,
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("service_kind")).toBe("express");
          return HttpResponse.json(payload);
        },
      ),
    );
    const mod = await import("../../lib/tools/list-on-hold-reasons");
    const result = await mod.spec.handler(auth, {
      service_kind: "express",
      environment: "production",
    });
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("customer_unreachable");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.get(`${PLATFORM}/quiqdash/orders/states/on_hold_reasons`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/list-on-hold-reasons");
    const { QuiqupHttpError } = await import("../../lib/clients/quiqup-lastmile");
    await expect(
      mod.spec.handler(auth, {
        service_kind: "express",
        environment: "production",
      }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/list-on-hold-reasons");
    await expect(
      mod.spec.handler(authAnon, {
        service_kind: "express",
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("list_return_to_origin_reasons", () => {
  const payload = { reasons: [{ code: "address_invalid" }] };

  it("returns the reason list as text", async () => {
    server.use(
      http.get(
        `${PLATFORM}/quiqdash/orders/states/return_to_origin_reasons`,
        () => HttpResponse.json(payload),
      ),
    );
    const mod = await import("../../lib/tools/list-return-to-origin-reasons");
    const result = await mod.spec.handler(auth, { environment: "production" });
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("address_invalid");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.get(
        `${PLATFORM}/quiqdash/orders/states/return_to_origin_reasons`,
        () => HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/list-return-to-origin-reasons");
    const { QuiqupHttpError } = await import("../../lib/clients/quiqup-lastmile");
    await expect(
      mod.spec.handler(auth, { environment: "production" }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/list-return-to-origin-reasons");
    await expect(
      mod.spec.handler(authAnon, { environment: "production" }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("list_cancellation_reasons", () => {
  const payload = { reasons: [{ code: "merchant_request" }] };

  it("returns the reason list as text", async () => {
    server.use(
      http.get(`${PLATFORM}/quiqdash/orders/cancellation-reasons`, () =>
        HttpResponse.json(payload),
      ),
    );
    const mod = await import("../../lib/tools/list-cancellation-reasons");
    const result = await mod.spec.handler(auth, { environment: "production" });
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("merchant_request");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.get(`${PLATFORM}/quiqdash/orders/cancellation-reasons`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/list-cancellation-reasons");
    const { QuiqupHttpError } = await import("../../lib/clients/quiqup-lastmile");
    await expect(
      mod.spec.handler(auth, { environment: "production" }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/list-cancellation-reasons");
    await expect(
      mod.spec.handler(authAnon, { environment: "production" }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("list_courier_failure_reasons", () => {
  const payload = { reasons: [{ code: "no_answer" }] };

  it("forwards delivery_type as a query param and returns the reasons", async () => {
    server.use(
      http.get(
        `${PLATFORM}/quiqdash/courier/delivery_failure_reasons`,
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("delivery_type")).toBe("delivery_failed");
          return HttpResponse.json(payload);
        },
      ),
    );
    const mod = await import("../../lib/tools/list-courier-failure-reasons");
    const result = await mod.spec.handler(auth, {
      delivery_type: "delivery_failed",
      environment: "production",
    });
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("no_answer");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.get(`${PLATFORM}/quiqdash/courier/delivery_failure_reasons`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/list-courier-failure-reasons");
    const { QuiqupHttpError } = await import("../../lib/clients/quiqup-lastmile");
    await expect(
      mod.spec.handler(auth, {
        delivery_type: "delivery_failed",
        environment: "production",
      }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/list-courier-failure-reasons");
    await expect(
      mod.spec.handler(authAnon, {
        delivery_type: "delivery_failed",
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
  });
});
