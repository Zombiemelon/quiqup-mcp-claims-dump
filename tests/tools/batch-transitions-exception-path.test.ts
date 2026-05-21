/**
 * MSW-mocked Vitest suite for the 5 Wave-2 exception-path batch transition
 * tools (ORDT-09..13):
 *   - set_on_hold              (reason: list_on_hold_reasons)
 *   - set_return_to_origin     (reason: list_return_to_origin_reasons)
 *   - set_returned_to_origin   (NO reason — terminal acknowledgement)
 *   - set_delivery_failed      (reason: list_courier_failure_reasons)
 *   - set_collection_failed    (reason: list_courier_failure_reasons,
 *                               DIFFERENT root path: /quiqdash/courier/orders/...)
 *
 * Coverage contract per the plan's Task-1 <behavior> block:
 *   - Spec-shape: each reason-bearing spec exposes a required non-empty
 *     `reason` whose description pins its Phase-1 enumeration tool. The
 *     no-reason spec must NOT carry a `reason` key.
 *   - Destructive gate: confirm omitted → ConfirmationRequiredError result,
 *     ZERO PUT traffic per tool.
 *   - Dry-run: confirm:true + dry_run:true (with reason if applicable)
 *     yields a synthesized preview, ZERO PUT.
 *   - Live PUT: confirm:true (no dry_run) → ONE PUT to the EXACT per-tool
 *     path with body `{ order_ids: [...], reason? }`.
 *
 * Pairs with `_batch-transition-factory.test.ts` (factory contract via
 * synthetic configs) and `batch-transitions-happy-path.test.ts` (Wave-1
 * forward-path wrappers). This file verifies every Wave-2 wrapper is a
 * thin pass-through to the factory AND that the reason-field-pin
 * invariant (D-02) holds across all 4 reason-bearing tools.
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

// Table-driven per-tool config. The 4 reason-bearing tools list the
// enumeration tool whose name MUST appear in the spec.description (the
// reason-field-pin invariant — D-02).
const REASON_TOOLS = [
  {
    modulePath: "../../lib/tools/set-on-hold",
    name: "set_on_hold",
    path: "/quiqdash/orders/batch/set_on_hold",
    enumTool: "list_on_hold_reasons",
  },
  {
    modulePath: "../../lib/tools/set-return-to-origin",
    name: "set_return_to_origin",
    path: "/quiqdash/orders/batch/set_return_to_origin",
    enumTool: "list_return_to_origin_reasons",
  },
  {
    modulePath: "../../lib/tools/set-delivery-failed",
    name: "set_delivery_failed",
    path: "/quiqdash/orders/batch/set_delivery_failed",
    enumTool: "list_courier_failure_reasons",
  },
  {
    modulePath: "../../lib/tools/set-collection-failed",
    name: "set_collection_failed",
    // Distinct upstream root per REQ ORDT-13 — NOT /quiqdash/orders/batch/...
    path: "/quiqdash/courier/orders/set_collection_failed",
    enumTool: "list_courier_failure_reasons",
  },
] as const;

const NO_REASON_TOOL = {
  modulePath: "../../lib/tools/set-returned-to-origin",
  name: "set_returned_to_origin",
  path: "/quiqdash/orders/batch/set_returned_to_origin",
} as const;

describe("Wave 2 batch transitions — reason-bearing tools: spec shape", () => {
  for (const tool of REASON_TOOLS) {
    it(`[1] ${tool.name}: inputSchema rejects missing reason`, async () => {
      const mod = (await import(tool.modulePath)) as {
        spec: { inputSchema: { safeParse: (x: unknown) => { success: boolean } } };
      };
      const parsed = mod.spec.inputSchema.safeParse({
        order_ids: ["o1"],
        confirm: true,
        environment: "production",
      });
      expect(parsed.success).toBe(false);
    });

    it(`[2] ${tool.name}: inputSchema rejects reason: ""`, async () => {
      const mod = (await import(tool.modulePath)) as {
        spec: { inputSchema: { safeParse: (x: unknown) => { success: boolean } } };
      };
      const parsed = mod.spec.inputSchema.safeParse({
        order_ids: ["o1"],
        confirm: true,
        reason: "",
        environment: "production",
      });
      expect(parsed.success).toBe(false);
    });

    it(`[3] ${tool.name}: spec.description / reason description pins ${tool.enumTool}`, async () => {
      const mod = (await import(tool.modulePath)) as {
        spec: {
          description: string;
          inputSchema: { shape: Record<string, { description?: string }> };
        };
      };
      const reasonField = mod.spec.inputSchema.shape.reason;
      // The enumeration-tool name should appear on the reason field
      // description (the canonical discovery surface for the LLM).
      expect(reasonField?.description ?? "").toContain(tool.enumTool);
    });
  }
});

describe("Wave 2 batch transitions — no-reason terminal tool", () => {
  it(`[4] set_returned_to_origin: inputSchema does NOT have a 'reason' key`, async () => {
    const mod = (await import(NO_REASON_TOOL.modulePath)) as {
      spec: { inputSchema: { shape: Record<string, unknown> } };
    };
    const keys = Object.keys(mod.spec.inputSchema.shape);
    expect(keys).not.toContain("reason");
  });

  it(`[5] set_returned_to_origin: parses without reason`, async () => {
    const mod = (await import(NO_REASON_TOOL.modulePath)) as {
      spec: { inputSchema: { safeParse: (x: unknown) => { success: boolean } } };
    };
    const parsed = mod.spec.inputSchema.safeParse({
      order_ids: ["o1"],
      confirm: true,
      environment: "production",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("Wave 2 batch transitions — destructive gate (per tool)", () => {
  for (const tool of [...REASON_TOOLS, NO_REASON_TOOL]) {
    it(`[6] ${tool.name}: confirm missing → ConfirmationRequiredError, ZERO PUT`, async () => {
      let putCount = 0;
      server.use(
        http.put(`${PLATFORM}${tool.path}`, () => {
          putCount += 1;
          return HttpResponse.json({});
        }),
      );
      const mod = (await import(tool.modulePath)) as {
        spec: {
          handler: (
            a: typeof auth,
            args: unknown,
          ) => Promise<{
            content: Array<{ type: string; text?: string }>;
            isError?: boolean;
          }>;
        };
      };
      const args: Record<string, unknown> = {
        order_ids: ["o1"],
        environment: "production",
      };
      // reason-bearing tools require reason at schema parse, but the
      // handler is called directly here bypassing safeParse; we still
      // include reason so that the only thing missing is confirm.
      if ("enumTool" in tool) args.reason = "any-reason";
      const result = await mod.spec.handler(auth, args);
      expect(putCount).toBe(0);
      expect(result.isError).toBe(true);
      const first = result.content[0];
      if (first.type !== "text") throw new Error("expected text block");
      expect(first.text).toContain(tool.name);
      expect(first.text).toContain("confirm: true");
    });
  }
});

describe("Wave 2 batch transitions — dry-run (per tool)", () => {
  for (const tool of [...REASON_TOOLS, NO_REASON_TOOL]) {
    it(`[7] ${tool.name}: confirm:true + dry_run:true → preview with dryRun:true + orderIds, ZERO PUT`, async () => {
      let putCount = 0;
      server.use(
        http.put(`${PLATFORM}${tool.path}`, () => {
          putCount += 1;
          return HttpResponse.json({});
        }),
      );
      const mod = (await import(tool.modulePath)) as {
        spec: {
          handler: (
            a: typeof auth,
            args: unknown,
          ) => Promise<{
            content: Array<{ type: string; text?: string }>;
            isError?: boolean;
          }>;
        };
      };
      const args: Record<string, unknown> = {
        order_ids: ["o1", "o2"],
        confirm: true,
        dry_run: true,
        environment: "production",
      };
      if ("enumTool" in tool) args.reason = "test-reason";
      const result = await mod.spec.handler(auth, args);
      expect(putCount).toBe(0);
      expect(result.isError).toBeFalsy();
      const first = result.content[0];
      if (first.type !== "text") throw new Error("expected text block");
      expect(first.text).toContain('"dryRun": true');
      const parsed = JSON.parse(first.text!) as Record<string, unknown>;
      expect(parsed.orderIds).toEqual(["o1", "o2"]);
      const simulated = parsed.simulated as Record<string, unknown>;
      expect(simulated.transition).toBe(tool.name);
      if ("enumTool" in tool) {
        expect(simulated.reason).toBe("test-reason");
      }
    });
  }
});

describe("Wave 2 batch transitions — live PUT (per tool)", () => {
  it(`[8] set_on_hold: confirm:true + reason → PUT body { order_ids, reason }`, async () => {
    let putCount = 0;
    let capturedUrl: string | undefined;
    let capturedBody: unknown;
    server.use(
      http.put(
        `${PLATFORM}/quiqdash/orders/batch/set_on_hold`,
        async ({ request }) => {
          putCount += 1;
          capturedUrl = request.url;
          capturedBody = await request.json();
          return HttpResponse.json({ ok: true, transitioned: 1 });
        },
      ),
    );
    const mod = (await import("../../lib/tools/set-on-hold")) as {
      spec: {
        handler: (
          a: typeof auth,
          args: unknown,
        ) => Promise<{
          content: Array<{ type: string; text?: string }>;
          isError?: boolean;
        }>;
      };
    };
    const result = await mod.spec.handler(auth, {
      order_ids: ["order-1"],
      confirm: true,
      reason: "customer_not_home",
      environment: "production",
    });
    expect(putCount).toBe(1);
    expect(capturedUrl).toBe(`${PLATFORM}/quiqdash/orders/batch/set_on_hold`);
    expect(capturedBody).toEqual({
      order_ids: ["order-1"],
      reason: "customer_not_home",
    });
    expect(result.isError).toBeFalsy();
  });

  it(`[9] set_returned_to_origin: confirm:true → PUT body { order_ids } (NO reason)`, async () => {
    let putCount = 0;
    let capturedBody: unknown;
    server.use(
      http.put(
        `${PLATFORM}/quiqdash/orders/batch/set_returned_to_origin`,
        async ({ request }) => {
          putCount += 1;
          capturedBody = await request.json();
          return HttpResponse.json({ ok: true });
        },
      ),
    );
    const mod = (await import("../../lib/tools/set-returned-to-origin")) as {
      spec: {
        handler: (
          a: typeof auth,
          args: unknown,
        ) => Promise<{
          content: Array<{ type: string; text?: string }>;
          isError?: boolean;
        }>;
      };
    };
    await mod.spec.handler(auth, {
      order_ids: ["order-1"],
      confirm: true,
      environment: "production",
    });
    expect(putCount).toBe(1);
    expect(capturedBody).toEqual({ order_ids: ["order-1"] });
    // Sanity — no reason leaked into the body for the no-reason tool.
    expect((capturedBody as Record<string, unknown>).reason).toBeUndefined();
  });

  it(`[10] set_collection_failed: PUTs to the DISTINCT /quiqdash/courier/orders/... path (NOT /quiqdash/orders/batch/...)`, async () => {
    let putCount = 0;
    let capturedUrl: string | undefined;
    server.use(
      http.put(
        `${PLATFORM}/quiqdash/courier/orders/set_collection_failed`,
        async ({ request }) => {
          putCount += 1;
          capturedUrl = request.url;
          return HttpResponse.json({ ok: true });
        },
      ),
      // Sanity: if the wrapper accidentally used the /orders/batch/... root,
      // this catcher logs a counter-bump that the assertion below would catch.
      http.put(
        `${PLATFORM}/quiqdash/orders/batch/set_collection_failed`,
        () => {
          putCount += 100; // poison value so a wrong-path PUT fails loudly
          return HttpResponse.json({});
        },
      ),
    );
    const mod = (await import("../../lib/tools/set-collection-failed")) as {
      spec: {
        handler: (
          a: typeof auth,
          args: unknown,
        ) => Promise<{
          content: Array<{ type: string; text?: string }>;
          isError?: boolean;
        }>;
      };
    };
    await mod.spec.handler(auth, {
      order_ids: ["order-1"],
      confirm: true,
      reason: "future_delivery_request",
      environment: "production",
    });
    expect(putCount).toBe(1);
    expect(capturedUrl).toBe(
      `${PLATFORM}/quiqdash/courier/orders/set_collection_failed`,
    );
  });
});
