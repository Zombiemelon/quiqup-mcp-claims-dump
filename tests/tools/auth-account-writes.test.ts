/**
 * MSW-mocked Vitest suite for the five Phase-1 write tools.
 *
 * Coverage contract per tool (locked in by acceptance criteria):
 *   1. Happy path — content[0].text contains the mocked JSON body.
 *   2. Upstream 401 — handler rejects with QuiqupHttpError.
 *   3. Missing auth.userId — handler throws a plain Error before any fetch.
 *
 * Plus tool-specific extras:
 *   - update_account: description includes "FIN-05", "update_bank_details",
 *     "get_account" — locks the AUTH-07/FIN-05 disambiguation in via the test
 *     surface, not just static grep.
 *   - decide_feature_flags_bulk: MSW captures the request body and asserts
 *     `body.Identifier === auth.userId`. Also asserts that the input schema
 *     does NOT expose an `Identifier` field (Identifier is server-derived).
 *   - update_return_settings: request URL includes the encoded account_id;
 *     request body does NOT include account_id (it goes in the path).
 *   - create_account_team_member: spec.inputSchema.shape.email exists and an
 *     invalid email fails Zod parse at the schema layer.
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

// Capture and clear QUIQUP_PLATFORM_API_BASE_URL so a developer with the var
// set in their shell does not silently route fetches around MSW (the
// handlers below are bound to the production host). Mirrors the
// GOOGLE_PLACES_BASE_URL pattern in google-places.test.ts.
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

describe("update_account", () => {
  const payload = { id: "acct_123", display_name: "Acme Partner" };

  it("returns the PUT /accounts payload as text", async () => {
    server.use(
      http.put(`${PLATFORM}/accounts`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        // Sanity: handler must not send keys the caller did not pass.
        expect(body).not.toHaveProperty("name");
        expect(body.display_name).toBe("Acme Partner");
        return HttpResponse.json(payload);
      }),
    );
    const mod = await import("../../lib/tools/update-account");
    const result = await mod.spec.handler(auth, {
      display_name: "Acme Partner",
      environment: "production",
    });
    expect(result.content).toHaveLength(1);
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("acct_123");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.put(`${PLATFORM}/accounts`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/update-account");
    const { QuiqupHttpError } = await import("../../lib/clients/quiqup-lastmile");
    await expect(
      mod.spec.handler(auth, { display_name: "x", environment: "production" }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/update-account");
    await expect(
      mod.spec.handler(authAnon, { environment: "production" }),
    ).rejects.toThrow(/authenticated user/);
  });

  it("description carries the AUTH-07 vs FIN-05 disambiguation lock-in", async () => {
    const mod = await import("../../lib/tools/update-account");
    expect(mod.spec.description).toContain("FIN-05");
    expect(mod.spec.description).toContain("update_bank_details");
    expect(mod.spec.description).toContain("get_account");
  });

  it("schema-parses raw args (locks in environment .default('production'))", async () => {
    let captured: URL | undefined;
    server.use(
      http.put(`${PLATFORM}/accounts`, async ({ request }) => {
        captured = new URL(request.url);
        return HttpResponse.json({ id: "acct_123" });
      }),
    );
    const mod = await import("../../lib/tools/update-account");
    // Caller omits `environment` — .default("production") should land it.
    const parsed = mod.spec.inputSchema.safeParse({
      display_name: "Acme Partner",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.environment).toBe("production");
    const result = await mod.spec.handler(auth, parsed.data);
    expect(captured?.host).toBe("platform-api.quiqup.com");
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("acct_123");
  });
});

describe("decide_feature_flags_bulk", () => {
  const payload = { new_dashboard: true, experimental_export: false };

  it("binds Identifier to auth.userId, NOT to caller-supplied args", async () => {
    let captured: Record<string, unknown> | undefined;
    server.use(
      http.post(`${PLATFORM}/featureflags/decide-bulk`, async ({ request }) => {
        captured = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(payload);
      }),
    );
    const mod = await import("../../lib/tools/decide-feature-flags-bulk");
    const result = await mod.spec.handler(auth, {
      features: ["new_dashboard", "experimental_export"],
      environment: "production",
    });
    expect(captured).toBeDefined();
    // Identifier must come from auth.userId.
    expect(captured!.Identifier).toBe("user_test");
    expect(captured!.Features).toEqual([
      "new_dashboard",
      "experimental_export",
    ]);
    // Input schema does NOT expose an Identifier field — the agent cannot
    // smuggle one in. (T-01-18 invariant.)
    expect(mod.spec.inputSchema.shape).not.toHaveProperty("Identifier");

    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("new_dashboard");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.post(`${PLATFORM}/featureflags/decide-bulk`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/decide-feature-flags-bulk");
    const { QuiqupHttpError } = await import("../../lib/clients/quiqup-lastmile");
    await expect(
      mod.spec.handler(auth, {
        features: ["new_dashboard"],
        environment: "production",
      }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/decide-feature-flags-bulk");
    await expect(
      mod.spec.handler(authAnon, {
        features: ["new_dashboard"],
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
  });

  it("ignores smuggled Identifier in raw args (T-01-18 regression guard)", async () => {
    // The handler signature is `(auth, z.input<TInput>)` — the SDK pre-handler
    // parse strips unknown keys, BUT a future refactor that spreads raw args
    // into the upstream body would silently break the invariant. This test
    // bypasses TS via `as never` and confirms the body still carries
    // auth.userId even when args carry a malicious Identifier field.
    let captured: Record<string, unknown> | undefined;
    server.use(
      http.post(`${PLATFORM}/featureflags/decide-bulk`, async ({ request }) => {
        captured = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({});
      }),
    );
    const mod = await import("../../lib/tools/decide-feature-flags-bulk");
    await mod.spec.handler(auth, {
      features: ["new_dashboard"],
      environment: "production",
      Identifier: "victim_account",
    } as never);
    expect(captured).toBeDefined();
    // CRITICAL: Identifier MUST be the caller's auth.userId, never the
    // smuggled value.
    expect(captured!.Identifier).toBe("user_test");
    expect(captured!.Identifier).not.toBe("victim_account");
  });
});

describe("get_return_settings", () => {
  const payload = {
    return_window_days: 14,
    allowed_reasons: ["damaged", "wrong_item"],
  };

  it("returns the return-settings payload (default account_id=me)", async () => {
    server.use(
      http.get(`${PLATFORM}/api/accounts/me/return-settings`, () =>
        HttpResponse.json(payload),
      ),
    );
    const mod = await import("../../lib/tools/get-return-settings");
    const result = await mod.spec.handler(auth, {
      account_id: "me",
      environment: "production",
    });
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("damaged");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.get(`${PLATFORM}/api/accounts/me/return-settings`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/get-return-settings");
    const { QuiqupHttpError } = await import("../../lib/clients/quiqup-lastmile");
    await expect(
      mod.spec.handler(auth, { account_id: "me", environment: "production" }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/get-return-settings");
    await expect(
      mod.spec.handler(authAnon, {
        account_id: "me",
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
  });
});

describe("update_return_settings", () => {
  const payload = { ok: true, return_window_days: 21 };

  it("encodes account_id in the URL and omits it from the body", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    let capturedUrl: string | undefined;
    server.use(
      http.put(
        `${PLATFORM}/api/accounts/:id/return-settings`,
        async ({ request }) => {
          capturedUrl = request.url;
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(payload);
        },
      ),
    );
    const mod = await import("../../lib/tools/update-return-settings");
    const result = await mod.spec.handler(auth, {
      account_id: "acct 123",
      return_window_days: 21,
      allowed_reasons: ["damaged"],
      environment: "production",
    });
    expect(capturedUrl).toContain("/api/accounts/acct%20123/return-settings");
    expect(capturedBody).toBeDefined();
    // account_id MUST NOT be in the body — it travels in the URL path.
    expect(capturedBody).not.toHaveProperty("account_id");
    expect(capturedBody!.return_window_days).toBe(21);
    expect(capturedBody!.allowed_reasons).toEqual(["damaged"]);

    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("return_window_days");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.put(`${PLATFORM}/api/accounts/me/return-settings`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/update-return-settings");
    const { QuiqupHttpError } = await import("../../lib/clients/quiqup-lastmile");
    await expect(
      mod.spec.handler(auth, {
        account_id: "me",
        return_window_days: 7,
        environment: "production",
      }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/update-return-settings");
    await expect(
      mod.spec.handler(authAnon, {
        account_id: "me",
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
  });

  it("schema-parses raw args (locks in account_id .default('me') and environment .default('production'))", async () => {
    let capturedUrl: URL | undefined;
    server.use(
      http.put(`${PLATFORM}/api/accounts/me/return-settings`, async ({ request }) => {
        capturedUrl = new URL(request.url);
        return HttpResponse.json({ ok: true });
      }),
    );
    const mod = await import("../../lib/tools/update-return-settings");
    // Caller omits BOTH account_id and environment — both defaults must
    // land via the Zod parse, not via the LLM's good behaviour.
    const parsed = mod.spec.inputSchema.safeParse({
      return_window_days: 14,
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.account_id).toBe("me");
    expect(parsed.data.environment).toBe("production");
    await mod.spec.handler(auth, parsed.data);
    expect(capturedUrl?.pathname).toBe("/api/accounts/me/return-settings");
  });
});

describe("create_account_team_member", () => {
  const payload = { id: "team_member_1", email: "ops@partner.example" };

  it("returns the /account/team payload as text", async () => {
    server.use(
      http.post(`${PLATFORM}/account/team`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body.email).toBe("ops@partner.example");
        expect(body.role).toBe("operator");
        return HttpResponse.json(payload);
      }),
    );
    const mod = await import("../../lib/tools/create-account-team-member");
    const result = await mod.spec.handler(auth, {
      email: "ops@partner.example",
      role: "operator",
      environment: "production",
    });
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("team_member_1");
  });

  it("throws QuiqupHttpError on upstream 401", async () => {
    server.use(
      http.post(`${PLATFORM}/account/team`, () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );
    const mod = await import("../../lib/tools/create-account-team-member");
    const { QuiqupHttpError } = await import("../../lib/clients/quiqup-lastmile");
    await expect(
      mod.spec.handler(auth, {
        email: "ops@partner.example",
        role: "operator",
        environment: "production",
      }),
    ).rejects.toBeInstanceOf(QuiqupHttpError);
  });

  it("throws when auth.userId is null", async () => {
    const mod = await import("../../lib/tools/create-account-team-member");
    await expect(
      mod.spec.handler(authAnon, {
        email: "ops@partner.example",
        role: "operator",
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
  });

  it("exposes an email field that rejects invalid addresses at the schema layer", async () => {
    const mod = await import("../../lib/tools/create-account-team-member");
    expect(mod.spec.inputSchema.shape).toHaveProperty("email");
    const parsed = mod.spec.inputSchema.safeParse({
      email: "not-an-email",
      role: "operator",
      environment: "production",
    });
    expect(parsed.success).toBe(false);
  });
});
