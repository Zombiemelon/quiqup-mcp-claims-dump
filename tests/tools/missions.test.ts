/**
 * MSW-mocked Vitest suite for Phase-4 Wave-4 mission orchestration tool:
 *   - transfer_mission_orders (MISS-02, Platform PUT, DESTRUCTIVE-gated per D-05)
 *
 * create_mission (MISS-01, non-destructive) is covered in
 * tests/tools/order-creation.test.ts — the two were split because the
 * destructive contract on MISS-02 carries enough setup (confirm + dry_run
 * + scope-loop + scope mock) that clustering it with non-destructive
 * tools would muddy the suite.
 *
 * Contract under test (per 04-04 plan Task 3 <behavior> block):
 *   - inputSchema: mission_id, order_ids[1..50], confirm, dry_run,
 *     idempotency_key, environment.
 *   - confirm missing → ConfirmationRequiredError result, ZERO PUT.
 *   - confirm+dry_run + all in-scope → response carries dryRun:true,
 *     missionId, orderIds; ZERO PUT.
 *   - confirm only + all in-scope → ONE PUT to
 *     /quiqdash/missions/transfer/<encoded mission_id> with
 *     body { order_ids: [...] }.
 *   - Per-id sequential assertOrderBelongsToUser BEFORE PUT.
 *   - Out-of-scope id → refusal naming denied id; ZERO PUT.
 *   - mission_id URL-encoded on path interpolation.
 *   - Guardrails block matches canonical 3/min destructive shape.
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

describe("transfer_mission_orders", () => {
  it("inputSchema declares mission_id, order_ids (min 1, max 50), confirm, dry_run, idempotency_key, environment", async () => {
    const mod = await import("../../lib/tools/transfer-mission-orders");
    const keys = Object.keys(mod.spec.inputSchema.shape);
    expect(keys).toContain("mission_id");
    expect(keys).toContain("order_ids");
    expect(keys).toContain("confirm");
    expect(keys).toContain("dry_run");
    expect(keys).toContain("idempotency_key");
    expect(keys).toContain("environment");

    // order_ids size constraints — 1..50.
    const okOne = mod.spec.inputSchema.safeParse({
      mission_id: "m-1",
      order_ids: ["o-1"],
      confirm: true,
      environment: "production",
    });
    expect(okOne.success).toBe(true);
    const tooMany = mod.spec.inputSchema.safeParse({
      mission_id: "m-1",
      order_ids: new Array(51).fill(0).map((_, i) => `o-${i}`),
      confirm: true,
      environment: "production",
    });
    expect(tooMany.success).toBe(false);
    const empty = mod.spec.inputSchema.safeParse({
      mission_id: "m-1",
      order_ids: [],
      confirm: true,
      environment: "production",
    });
    expect(empty.success).toBe(false);
  });

  it("confirm missing → ConfirmationRequiredError result; ZERO upstream PUT", async () => {
    let putCalled = false;
    server.use(
      http.put(`${PLATFORM}/quiqdash/missions/transfer/m-1`, () => {
        putCalled = true;
        return HttpResponse.json({});
      }),
    );
    const mod = await import("../../lib/tools/transfer-mission-orders");
    const result = await mod.spec.handler(auth, {
      mission_id: "m-1",
      order_ids: ["o-1", "o-2"],
      environment: "production",
    });
    expect(result.isError).toBe(true);
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toMatch(/confirm/i);
    expect(putCalled).toBe(false);
  });

  it("confirm + dry_run + all in-scope → synthesized preview; ZERO upstream PUT", async () => {
    let putCalled = false;
    server.use(
      http.put(`${PLATFORM}/quiqdash/missions/transfer/m-1`, () => {
        putCalled = true;
        return HttpResponse.json({});
      }),
    );
    const mod = await import("../../lib/tools/transfer-mission-orders");
    const result = await mod.spec.handler(auth, {
      mission_id: "m-1",
      order_ids: ["o-1", "o-2"],
      confirm: true,
      dry_run: true,
      environment: "production",
    });
    expect(putCalled).toBe(false);
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    const payload = JSON.parse(first.text);
    expect(payload.dryRun).toBe(true);
    expect(payload.missionId).toBe("m-1");
    expect(payload.orderIds).toEqual(["o-1", "o-2"]);
  });

  it("confirm + all in-scope → ONE PUT to /quiqdash/missions/transfer/<encoded>", async () => {
    let capturedBody: unknown = null;
    let capturedPath: string | null = null;
    server.use(
      http.put(
        `${PLATFORM}/quiqdash/missions/transfer/:missionId`,
        async ({ request }) => {
          capturedPath = new URL(request.url).pathname;
          capturedBody = await request.json();
          return HttpResponse.json({ ok: true });
        },
      ),
    );
    const mod = await import("../../lib/tools/transfer-mission-orders");
    const result = await mod.spec.handler(auth, {
      mission_id: "m-1",
      order_ids: ["o-1", "o-2"],
      confirm: true,
      environment: "production",
    });
    expect(capturedPath).toBe("/quiqdash/missions/transfer/m-1");
    expect(capturedBody).toEqual({ order_ids: ["o-1", "o-2"] });
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain('"ok": true');
  });

  it("per-id assertOrderBelongsToUser called sequentially BEFORE PUT", async () => {
    const scope = (await import("@/lib/middleware/scope")) as unknown as {
      assertOrderBelongsToUser: ReturnType<typeof vi.fn>;
    };
    let putCalled = false;
    server.use(
      http.put(
        `${PLATFORM}/quiqdash/missions/transfer/:missionId`,
        () => {
          putCalled = true;
          return HttpResponse.json({});
        },
      ),
    );
    const mod = await import("../../lib/tools/transfer-mission-orders");
    await mod.spec.handler(auth, {
      mission_id: "m-1",
      order_ids: ["o-1", "o-2", "o-3"],
      confirm: true,
      environment: "production",
    });
    expect(putCalled).toBe(true);
    expect(scope.assertOrderBelongsToUser).toHaveBeenCalledTimes(3);
    expect(scope.assertOrderBelongsToUser).toHaveBeenNthCalledWith(
      1,
      "o-1",
      "user_test",
    );
    expect(scope.assertOrderBelongsToUser).toHaveBeenNthCalledWith(
      2,
      "o-2",
      "user_test",
    );
    expect(scope.assertOrderBelongsToUser).toHaveBeenNthCalledWith(
      3,
      "o-3",
      "user_test",
    );
  });

  it("out-of-scope order id → refusal naming denied id; ZERO upstream PUT", async () => {
    const { ScopeViolationError } = await import("@/lib/middleware/scope");
    const scope = (await import("@/lib/middleware/scope")) as unknown as {
      assertOrderBelongsToUser: ReturnType<typeof vi.fn>;
    };
    scope.assertOrderBelongsToUser.mockImplementation(
      async (id: string, u: string) => {
        if (id === "o-foreign") {
          throw new ScopeViolationError("order", id, u);
        }
        return;
      },
    );
    let putCalled = false;
    server.use(
      http.put(
        `${PLATFORM}/quiqdash/missions/transfer/:missionId`,
        () => {
          putCalled = true;
          return HttpResponse.json({});
        },
      ),
    );
    const mod = await import("../../lib/tools/transfer-mission-orders");
    const result = await mod.spec.handler(auth, {
      mission_id: "m-1",
      order_ids: ["o-1", "o-foreign", "o-3"],
      confirm: true,
      environment: "production",
    });
    expect(putCalled).toBe(false);
    expect(result.isError).toBe(true);
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("o-foreign");
  });

  it("mission_id is URL-encoded on path interpolation", async () => {
    let capturedPath: string | null = null;
    server.use(
      http.put(
        `${PLATFORM}/quiqdash/missions/transfer/:weirdId`,
        ({ request }) => {
          capturedPath = new URL(request.url).pathname;
          return HttpResponse.json({});
        },
      ),
    );
    const mod = await import("../../lib/tools/transfer-mission-orders");
    await mod.spec.handler(auth, {
      mission_id: "m/with slash",
      order_ids: ["o-1"],
      confirm: true,
      environment: "production",
    });
    expect(capturedPath).toBe("/quiqdash/missions/transfer/m%2Fwith%20slash");
  });

  it("guardrails block matches the canonical 3/min destructive shape", async () => {
    const mod = await import("../../lib/tools/transfer-mission-orders");
    const g = mod.spec.guardrails;
    expect(g).toBeDefined();
    expect(g?.audit).toBe(true);
    expect(g?.idempotency?.keyArg).toBe("idempotency_key");
    expect(g?.rateLimit?.capacity).toBe(3);
    expect(g?.rateLimit?.refillPerSec).toBeCloseTo(3 / 60, 6);
  });

  it("rejects unauthenticated callers BEFORE confirm gate", async () => {
    const mod = await import("../../lib/tools/transfer-mission-orders");
    // The auth gate must fire BEFORE the confirm gate per T-02-37 — even
    // if the caller supplies confirm:true, anon callers must see the
    // auth error rather than a successful destructive operation.
    await expect(
      mod.spec.handler(authAnon, {
        mission_id: "m-1",
        order_ids: ["o-1"],
        confirm: true,
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated/i);
  });
});
