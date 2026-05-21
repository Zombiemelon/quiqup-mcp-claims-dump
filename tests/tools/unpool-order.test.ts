/**
 * MSW-mocked Vitest suite for `unpool_order` (ORDT-14) — the single-order
 * destructive PUT that severs a mission assignment without touching the
 * order itself.
 *
 * Why this file exists (per plan 04-02 Task-2 contract):
 *   `unpool_order` is the ONLY ORDT transition that does NOT go through
 *   `defineBatchTransition` (the factory is batch-shaped — see D-01
 *   specifics). It's hand-written against the canonical destructive
 *   helpers directly, but its handler order MUST match the factory's:
 *   auth → confirm → scope → dry_run → upstream.
 *
 * Coverage contract per the plan's Task-2 <behavior> block:
 *   [1] inputSchema shape: order_uuid + confirm + dry_run + idempotency_key
 *       + environment, NO order_ids array.
 *   [2] confirm missing → ConfirmationRequiredError, ZERO PUT.
 *   [3] confirm: false → ConfirmationRequiredError, ZERO PUT.
 *   [4] confirm: true + dry_run: true, in-scope → response with `dryRun:true`
 *       + `orderUuid:` (single-order shape, NOT orderIds array). ZERO PUT.
 *   [5] confirm: true, in-scope → ONE PUT to encoded path.
 *   [6] out-of-scope (ScopeViolationError) → refusal naming uuid, ZERO PUT.
 *   [7] order_uuid with `/` is URL-encoded — no raw path-injection.
 *   [8] !auth.userId throws "requires an authenticated user" BEFORE
 *       requireConfirm runs.
 *   [9] spec.guardrails matches canonical: rateLimit 3 / 3min,
 *       idempotency keyArg "idempotency_key" + 15-min TTL, audit true.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../setup/msw";
import { ScopeViolationError } from "@/lib/middleware/scope";

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

import { assertOrderBelongsToUser } from "@/lib/middleware/scope";

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

describe("unpool_order — spec shape", () => {
  it("[1] inputSchema has order_uuid + confirm + dry_run + idempotency_key + environment, NO order_ids", async () => {
    const { spec } = await import("@/lib/tools/unpool-order");
    const shape = (spec.inputSchema as unknown as { shape: Record<string, unknown> }).shape;
    expect(shape.order_uuid).toBeDefined();
    expect(shape.confirm).toBeDefined();
    expect(shape.dry_run).toBeDefined();
    expect(shape.idempotency_key).toBeDefined();
    expect(shape.environment).toBeDefined();
    expect(shape.order_ids).toBeUndefined();
  });

  it("[9] guardrails block matches canonical destructive shape", async () => {
    const { spec } = await import("@/lib/tools/unpool-order");
    expect(spec.guardrails).toEqual({
      rateLimit: { capacity: 3, refillPerSec: 3 / 60 },
      idempotency: { keyArg: "idempotency_key", ttlMs: 15 * 60 * 1000 },
      audit: true,
    });
  });
});

describe("unpool_order — destructive gate", () => {
  it("[2] confirm missing → ConfirmationRequiredError, ZERO PUT", async () => {
    let putCount = 0;
    server.use(
      http.put(`${PLATFORM}/quiqdash/missions/unpool/orders/:uuid`, () => {
        putCount += 1;
        return HttpResponse.json({});
      }),
    );
    const { spec } = await import("@/lib/tools/unpool-order");
    const result = (await spec.handler(auth, {
      order_uuid: "order-uuid-1",
      environment: "production",
    })) as { isError?: boolean; content: Array<{ type: string; text?: string }> };
    expect(putCount).toBe(0);
    expect(result.isError).toBe(true);
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("unpool_order");
    expect(first.text).toContain("confirm: true");
  });

  it("[3] confirm: false → ConfirmationRequiredError, ZERO PUT", async () => {
    let putCount = 0;
    server.use(
      http.put(`${PLATFORM}/quiqdash/missions/unpool/orders/:uuid`, () => {
        putCount += 1;
        return HttpResponse.json({});
      }),
    );
    const { spec } = await import("@/lib/tools/unpool-order");
    const result = (await spec.handler(auth, {
      order_uuid: "order-uuid-1",
      confirm: false,
      environment: "production",
    })) as { isError?: boolean; content: Array<{ type: string; text?: string }> };
    expect(putCount).toBe(0);
    expect(result.isError).toBe(true);
  });
});

describe("unpool_order — dry-run path", () => {
  it("[4] confirm:true + dry_run:true, in-scope → preview with dryRun:true + orderUuid, ZERO PUT", async () => {
    let putCount = 0;
    server.use(
      http.put(`${PLATFORM}/quiqdash/missions/unpool/orders/:uuid`, () => {
        putCount += 1;
        return HttpResponse.json({});
      }),
    );
    const { spec } = await import("@/lib/tools/unpool-order");
    const result = (await spec.handler(auth, {
      order_uuid: "order-uuid-1",
      confirm: true,
      dry_run: true,
      environment: "production",
    })) as { isError?: boolean; content: Array<{ type: string; text?: string }> };
    expect(putCount).toBe(0);
    expect(result.isError).toBeFalsy();
    expect(vi.mocked(assertOrderBelongsToUser)).toHaveBeenCalledWith(
      "order-uuid-1",
      auth.userId,
    );
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain('"dryRun": true');
    expect(first.text).toContain('"orderUuid":');
    const parsed = JSON.parse(first.text!) as Record<string, unknown>;
    expect(parsed.orderUuid).toBe("order-uuid-1");
    expect(parsed.simulated).toBeDefined();
  });
});

describe("unpool_order — live PUT path", () => {
  it("[5] confirm:true, in-scope → ONE PUT to encoded path", async () => {
    let putCount = 0;
    let capturedUrl: string | undefined;
    let capturedMethod: string | undefined;
    server.use(
      http.put(
        `${PLATFORM}/quiqdash/missions/unpool/orders/:uuid`,
        ({ request }) => {
          putCount += 1;
          capturedUrl = request.url;
          capturedMethod = request.method;
          return HttpResponse.json({ ok: true, unpooled: "order-uuid-1" });
        },
      ),
    );
    const { spec } = await import("@/lib/tools/unpool-order");
    const result = (await spec.handler(auth, {
      order_uuid: "order-uuid-1",
      confirm: true,
      environment: "production",
    })) as { isError?: boolean; content: Array<{ type: string; text?: string }> };
    expect(putCount).toBe(1);
    expect(capturedMethod).toBe("PUT");
    expect(capturedUrl).toBe(
      `${PLATFORM}/quiqdash/missions/unpool/orders/order-uuid-1`,
    );
    expect(result.isError).toBeFalsy();
  });

  it("[6] out-of-scope (ScopeViolationError) → refusal naming uuid, ZERO PUT", async () => {
    let putCount = 0;
    server.use(
      http.put(`${PLATFORM}/quiqdash/missions/unpool/orders/:uuid`, () => {
        putCount += 1;
        return HttpResponse.json({});
      }),
    );
    vi.mocked(assertOrderBelongsToUser).mockImplementation(async (id: string) => {
      throw new ScopeViolationError("order", id, auth.userId!);
    });
    const { spec } = await import("@/lib/tools/unpool-order");
    const result = (await spec.handler(auth, {
      order_uuid: "denied-uuid",
      confirm: true,
      environment: "production",
    })) as { isError?: boolean; content: Array<{ type: string; text?: string }> };
    expect(putCount).toBe(0);
    expect(result.isError).toBe(true);
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("denied-uuid");
  });

  it("[7] order_uuid with `/` is URL-encoded — no raw path injection", async () => {
    let putCount = 0;
    let capturedUrl: string | undefined;
    server.use(
      // The MSW handler uses :uuid path param so the URL matches regardless
      // of encoding; we assert by inspecting the captured request.url.
      http.put(
        `${PLATFORM}/quiqdash/missions/unpool/orders/:uuid`,
        ({ request }) => {
          putCount += 1;
          capturedUrl = request.url;
          return HttpResponse.json({ ok: true });
        },
      ),
    );
    const { spec } = await import("@/lib/tools/unpool-order");
    await spec.handler(auth, {
      order_uuid: "abc/def",
      confirm: true,
      environment: "production",
    });
    expect(putCount).toBe(1);
    expect(capturedUrl).toContain("abc%2Fdef");
    expect(capturedUrl).not.toContain("abc/def/");
  });
});

describe("unpool_order — auth gate ordering", () => {
  it("[8] !auth.userId throws BEFORE requireConfirm runs (confirm omitted to verify ordering)", async () => {
    let putCount = 0;
    server.use(
      http.put(`${PLATFORM}/quiqdash/missions/unpool/orders/:uuid`, () => {
        putCount += 1;
        return HttpResponse.json({});
      }),
    );
    const { spec } = await import("@/lib/tools/unpool-order");
    await expect(
      spec.handler(authAnon, {
        order_uuid: "order-uuid-1",
        // confirm intentionally omitted — auth should fire first
        environment: "production",
      }),
    ).rejects.toThrow(/requires an authenticated user/);
    expect(putCount).toBe(0);
  });
});

describe("unpool_order — tool-surface snapshot", () => {
  it("appears in evals/snapshots/tool-surface.json with enabled status", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const path = resolve(
      process.cwd(),
      "evals/snapshots/tool-surface.json",
    );
    const snapshot = JSON.parse(readFileSync(path, "utf8")) as {
      tools: Record<string, string>;
    };
    expect(snapshot.tools.unpool_order).toBe("enabled");
    // The 5 Wave-2 reason / no-reason tools landed in Task 1 — confirm
    // the snapshot also lists them so the tool-surface eval stays green.
    expect(snapshot.tools.set_on_hold).toBe("enabled");
    expect(snapshot.tools.set_return_to_origin).toBe("enabled");
    expect(snapshot.tools.set_returned_to_origin).toBe("enabled");
    expect(snapshot.tools.set_delivery_failed).toBe("enabled");
    expect(snapshot.tools.set_collection_failed).toBe("enabled");
  });
});
