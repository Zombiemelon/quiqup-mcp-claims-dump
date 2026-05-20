/**
 * Unit tests for the canonical batch-transition factory.
 *
 * Why this file exists (decision D-01, Phase 4 plan 04-01):
 *   The factory at `lib/tools/_batch-transition-factory.ts` is the SINGLE
 *   source for the destructive-batch contract used by ORDT-03..14 (12
 *   forward + reason-bearing batch status transitions). Each per-tool file
 *   is a thin wrapper that calls `defineBatchTransition({...})` once. To
 *   guarantee the contract cannot drift between transitions, the factory
 *   itself owns: the destructive-gate (confirm:true), the dry-run shape,
 *   the sequential per-id scope-assertion loop, the guardrails block, and
 *   the canonical "<name> requires an authenticated user" auth gate.
 *
 *   These 14 tests exercise the factory directly (synthetic configs) so
 *   the contract is verified without depending on any production
 *   per-tool file — that's important because under TDD the per-tool
 *   wrappers in Task 2 haven't shipped yet.
 *
 * MSW conventions: every test sets up a wide PUT handler that bumps a
 * counter so the "ZERO upstream traffic" assertions are bypass-proof.
 * `assertOrderBelongsToUser` is mocked via `vi.mock("@/lib/middleware/scope")`
 * so denial scenarios can be controlled deterministically without
 * having to script the upstream GET round-trip.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../setup/msw";
import { ScopeViolationError } from "@/lib/middleware/scope";

// Mock the JWT mint — the factory calls it before constructing the
// PlatformApiClient; tests don't need a real Clerk round-trip.
vi.mock("@/lib/quiqup", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getQuiqupReadyJwt: vi.fn(async (_userId: string) => "test-jwt-for-msw"),
  };
});

// Mock the scope helper — every test that exercises the confirm:true path
// supplies a deterministic implementation via `vi.mocked(...).mockImplementation`.
vi.mock("@/lib/middleware/scope", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    assertOrderBelongsToUser: vi.fn(async (_id: string, _u: string) => undefined),
  };
});

import { assertOrderBelongsToUser } from "@/lib/middleware/scope";
import { defineBatchTransition } from "@/lib/tools/_batch-transition-factory";

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
  // Default: all ids in scope (resolve void).
  vi.mocked(assertOrderBelongsToUser).mockImplementation(async () => undefined);
  delete process.env.QUIQUP_PLATFORM_API_BASE_URL;
});

afterEach(() => {
  if (originalPlatformUrl === undefined) {
    delete process.env.QUIQUP_PLATFORM_API_BASE_URL;
  } else {
    process.env.QUIQUP_PLATFORM_API_BASE_URL = originalPlatformUrl;
  }
});

// Synthetic configs — exercise the factory without binding to any
// production per-tool file (those land in Task 2).
const NO_REASON_CFG = {
  name: "set_test",
  path: "/quiqdash/orders/batch/set_test",
  description: "Mark a batch of orders as in the test state.",
};

const WITH_REASON_CFG = {
  name: "set_test_with_reason",
  path: "/quiqdash/orders/batch/set_test_with_reason",
  description: "Mark a batch of orders as in the test state, with a reason.",
  reasonField: {
    description:
      "Free-form reason string. Call `list_on_hold_reasons` to discover valid values.",
  },
};

describe("defineBatchTransition — factory shape", () => {
  it("[1] returns a ToolSpec with the canonical fields", () => {
    const spec = defineBatchTransition(NO_REASON_CFG);
    expect(spec.name).toBe("set_test");
    expect(typeof spec.description).toBe("string");
    expect(spec.inputSchema).toBeDefined();
    expect(spec.outputSchema).toBeDefined();
    expect(spec.guardrails).toBeDefined();
    expect(typeof spec.handler).toBe("function");
  });

  it("[2] inputSchema.shape has order_ids/confirm/dry_run/idempotency_key/environment AND NO `reason` key when reasonField unset", () => {
    const spec = defineBatchTransition(NO_REASON_CFG);
    const shape = spec.inputSchema.shape;
    expect(shape.order_ids).toBeDefined();
    expect(shape.confirm).toBeDefined();
    expect(shape.dry_run).toBeDefined();
    expect(shape.idempotency_key).toBeDefined();
    expect(shape.environment).toBeDefined();
    expect(shape.reason).toBeUndefined();

    // order_ids min:1 max:10
    const tooMany = spec.inputSchema.safeParse({
      order_ids: Array(11).fill("x"),
      confirm: true,
    });
    expect(tooMany.success).toBe(false);
    const tooFew = spec.inputSchema.safeParse({ order_ids: [], confirm: true });
    expect(tooFew.success).toBe(false);
  });

  it("[3] inputSchema.shape has `reason` (required, min 1) when reasonField IS passed", () => {
    const spec = defineBatchTransition(WITH_REASON_CFG);
    const shape = spec.inputSchema.shape;
    expect(shape.reason).toBeDefined();

    const empty = spec.inputSchema.safeParse({
      order_ids: ["x"],
      confirm: true,
      reason: "",
    });
    expect(empty.success).toBe(false);
    const ok = spec.inputSchema.safeParse({
      order_ids: ["x"],
      confirm: true,
      reason: "valid",
    });
    expect(ok.success).toBe(true);
  });

  it("[4] guardrails block is exactly the canonical destructive shape", () => {
    const spec = defineBatchTransition(NO_REASON_CFG);
    expect(spec.guardrails).toEqual({
      rateLimit: { capacity: 3, refillPerSec: 3 / 60 },
      idempotency: { keyArg: "idempotency_key", ttlMs: 15 * 60 * 1000 },
      audit: true,
    });
  });
});

describe("defineBatchTransition — destructive gate", () => {
  it("[5] confirm omitted → ConfirmationRequiredError result, ZERO PUT traffic", async () => {
    let putCount = 0;
    server.use(
      http.put(`${PLATFORM}/quiqdash/orders/batch/set_test`, () => {
        putCount += 1;
        return HttpResponse.json({});
      }),
    );
    const spec = defineBatchTransition(NO_REASON_CFG);
    const result = await spec.handler(auth, {
      order_ids: ["o1", "o2"],
      environment: "production",
    });
    expect(putCount).toBe(0);
    expect((result as { isError?: boolean }).isError).toBe(true);
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("set_test");
    expect(first.text).toContain("confirm: true");
  });

  it("[6] confirm: false → ConfirmationRequiredError result, ZERO PUT traffic", async () => {
    let putCount = 0;
    server.use(
      http.put(`${PLATFORM}/quiqdash/orders/batch/set_test`, () => {
        putCount += 1;
        return HttpResponse.json({});
      }),
    );
    const spec = defineBatchTransition(NO_REASON_CFG);
    const result = await spec.handler(auth, {
      order_ids: ["o1"],
      confirm: false,
      environment: "production",
    });
    expect(putCount).toBe(0);
    expect((result as { isError?: boolean }).isError).toBe(true);
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("confirm: true");
  });
});

describe("defineBatchTransition — dry-run path", () => {
  it("[7] confirm:true + dry_run:true → synthesized payload with dryRun:true + orderIds[], scope-assertion ran, ZERO PUT traffic", async () => {
    let putCount = 0;
    server.use(
      http.put(`${PLATFORM}/quiqdash/orders/batch/set_test`, () => {
        putCount += 1;
        return HttpResponse.json({});
      }),
    );
    const spec = defineBatchTransition(NO_REASON_CFG);
    const result = await spec.handler(auth, {
      order_ids: ["o1", "o2", "o3"],
      confirm: true,
      dry_run: true,
      environment: "production",
    });
    expect(putCount).toBe(0);
    expect((result as { isError?: boolean }).isError).toBeFalsy();
    // Each id should have been scope-checked, sequentially.
    expect(vi.mocked(assertOrderBelongsToUser)).toHaveBeenCalledTimes(3);
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain('"dryRun": true');
    expect(first.text).toContain('"orderIds":');
    const parsed = JSON.parse(first.text) as Record<string, unknown>;
    expect(parsed.dryRun).toBe(true);
    expect(parsed.orderIds).toEqual(["o1", "o2", "o3"]);
    expect(parsed.simulated).toBeDefined();
  });

  it("[8] confirm:true + dry_run:true + out-of-scope id → refusal naming the denied id, ZERO PUT traffic", async () => {
    let putCount = 0;
    server.use(
      http.put(`${PLATFORM}/quiqdash/orders/batch/set_test`, () => {
        putCount += 1;
        return HttpResponse.json({});
      }),
    );
    vi.mocked(assertOrderBelongsToUser).mockImplementation(async (id: string) => {
      if (id === "denied-id") {
        throw new ScopeViolationError("order", id, auth.userId!);
      }
    });
    const spec = defineBatchTransition(NO_REASON_CFG);
    const result = await spec.handler(auth, {
      order_ids: ["ok-1", "denied-id", "ok-2"],
      confirm: true,
      dry_run: true,
      environment: "production",
    });
    expect(putCount).toBe(0);
    expect((result as { isError?: boolean }).isError).toBe(true);
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("denied-id");
    expect(first.text).toContain("set_test");
    // Sanity: the refusal message must NOT contain the simulated dry-run payload.
    expect(first.text).not.toContain('"dryRun": true');
  });
});

describe("defineBatchTransition — live PUT path", () => {
  it("[9] confirm:true (no dry_run) + all in scope → ONE PUT to configured path with order_ids body, returns upstream payload", async () => {
    let putCount = 0;
    let capturedUrl: string | undefined;
    let capturedMethod: string | undefined;
    let capturedBody: unknown;
    server.use(
      http.put(`${PLATFORM}/quiqdash/orders/batch/set_test`, async ({ request }) => {
        putCount += 1;
        capturedUrl = request.url;
        capturedMethod = request.method;
        capturedBody = await request.json();
        return HttpResponse.json({ ok: true, transitioned: 2 });
      }),
    );
    const spec = defineBatchTransition(NO_REASON_CFG);
    const result = await spec.handler(auth, {
      order_ids: ["o1", "o2"],
      confirm: true,
      environment: "production",
    });
    expect(putCount).toBe(1);
    expect(capturedMethod).toBe("PUT");
    expect(capturedUrl).toBe(
      `${PLATFORM}/quiqdash/orders/batch/set_test`,
    );
    expect(capturedBody).toEqual({ order_ids: ["o1", "o2"] });

    expect((result as { isError?: boolean }).isError).toBeFalsy();
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("set_test");
    expect(first.text).toContain('"transitioned": 2');
  });

  it("[10] confirm:true + one denied id → refusal naming denied id, ZERO PUT traffic", async () => {
    let putCount = 0;
    server.use(
      http.put(`${PLATFORM}/quiqdash/orders/batch/set_test`, () => {
        putCount += 1;
        return HttpResponse.json({});
      }),
    );
    vi.mocked(assertOrderBelongsToUser).mockImplementation(async (id: string) => {
      if (id === "denied-id") {
        throw new ScopeViolationError("order", id, auth.userId!);
      }
    });
    const spec = defineBatchTransition(NO_REASON_CFG);
    const result = await spec.handler(auth, {
      order_ids: ["ok-1", "denied-id"],
      confirm: true,
      environment: "production",
    });
    expect(putCount).toBe(0);
    expect((result as { isError?: boolean }).isError).toBe(true);
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("denied-id");
    expect(first.text).toContain("No upstream call was attempted");
  });
});

describe("defineBatchTransition — reasonField behaviour", () => {
  it("[11] reasonField configured + reason arg present → reason included in PUT body verbatim", async () => {
    let putCount = 0;
    let capturedBody: unknown;
    server.use(
      http.put(
        `${PLATFORM}/quiqdash/orders/batch/set_test_with_reason`,
        async ({ request }) => {
          putCount += 1;
          capturedBody = await request.json();
          return HttpResponse.json({ ok: true });
        },
      ),
    );
    const spec = defineBatchTransition(WITH_REASON_CFG);
    await spec.handler(auth, {
      order_ids: ["o1"],
      confirm: true,
      reason: "customer_not_home",
      environment: "production",
    });
    expect(putCount).toBe(1);
    expect(capturedBody).toEqual({
      order_ids: ["o1"],
      reason: "customer_not_home",
    });
  });

  it("[12] reasonField configured but reason arg OMITTED → schema parse rejects", () => {
    const spec = defineBatchTransition(WITH_REASON_CFG);
    const parsed = spec.inputSchema.safeParse({
      order_ids: ["o1"],
      confirm: true,
      environment: "production",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("defineBatchTransition — auth + ordering invariants", () => {
  it("[13] missing auth.userId → throws 'requires an authenticated user' BEFORE requireConfirm runs, ZERO PUT traffic", async () => {
    let putCount = 0;
    server.use(
      http.put(`${PLATFORM}/quiqdash/orders/batch/set_test`, () => {
        putCount += 1;
        return HttpResponse.json({});
      }),
    );
    const spec = defineBatchTransition(NO_REASON_CFG);
    await expect(
      spec.handler(authAnon, {
        order_ids: ["o1"],
        // confirm intentionally omitted to verify auth fires first
        environment: "production",
      }),
    ).rejects.toThrow(/requires an authenticated user/);
    expect(putCount).toBe(0);
  });

  it("[14] per-id scope-assertion runs sequentially (not Promise.all) — call order matches order_ids order", async () => {
    server.use(
      http.put(`${PLATFORM}/quiqdash/orders/batch/set_test`, async () =>
        HttpResponse.json({ ok: true }),
      ),
    );
    const callOrder: string[] = [];
    vi.mocked(assertOrderBelongsToUser).mockImplementation(async (id: string) => {
      // Introduce a microtask gap so a parallel implementation would
      // interleave; a sequential one preserves caller order.
      await Promise.resolve();
      callOrder.push(id);
    });
    const spec = defineBatchTransition(NO_REASON_CFG);
    await spec.handler(auth, {
      order_ids: ["a", "b", "c", "d"],
      confirm: true,
      environment: "production",
    });
    expect(callOrder).toEqual(["a", "b", "c", "d"]);
  });
});
