/**
 * MSW-mocked Vitest suite for the 6 Wave-1 forward-path batch transition
 * tools (ORDT-03..08): set_collected, set_received_at_depot, set_at_depot,
 * set_in_transit, set_scheduled, set_delivery_complete.
 *
 * Coverage contract per the plan's Task-2 <behavior> block:
 *   - Spec-shape: each spec exposes name + the canonical destructive
 *     input fields (order_ids/confirm/dry_run) and NO `reason` key.
 *   - Guardrails uniformity: every spec carries audit=true,
 *     idempotency.keyArg="idempotency_key", rateLimit.capacity=3.
 *   - Confirm missing → ConfirmationRequiredError result, ZERO PUT.
 *   - Confirm+dry_run → synthesized preview with `dryRun:true` +
 *     `orderIds:[...]`, ZERO PUT.
 *   - Confirm (no dry_run) → ONE PUT to the EXACT per-tool path with
 *     body { order_ids: [...] }.
 *
 * This file pairs with `_batch-transition-factory.test.ts` (which tests
 * the factory contract via synthetic configs). This file is the
 * end-to-end check that each of the 6 production wrappers is indeed
 * a thin pass-through to the factory — if a maintainer accidentally
 * re-derives a handler inline, the per-tool tests here catch it.
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

// Table-driven per-tool config. Each row maps the per-tool module path
// to its expected name + upstream batch endpoint path.
const WAVE_1_TOOLS = [
  {
    modulePath: "../../lib/tools/set-collected",
    name: "set_collected",
    path: "/quiqdash/orders/batch/set_collected",
  },
  {
    modulePath: "../../lib/tools/set-received-at-depot",
    name: "set_received_at_depot",
    path: "/quiqdash/orders/batch/set_received_at_depot",
  },
  {
    modulePath: "../../lib/tools/set-at-depot",
    name: "set_at_depot",
    path: "/quiqdash/orders/batch/set_at_depot",
  },
  {
    modulePath: "../../lib/tools/set-in-transit",
    name: "set_in_transit",
    path: "/quiqdash/orders/batch/set_in_transit",
  },
  {
    modulePath: "../../lib/tools/set-scheduled",
    name: "set_scheduled",
    path: "/quiqdash/orders/batch/set_scheduled",
  },
  {
    modulePath: "../../lib/tools/set-delivery-complete",
    name: "set_delivery_complete",
    path: "/quiqdash/orders/batch/set_delivery_complete",
  },
] as const;

describe("Wave 1 batch transitions — spec shape", () => {
  it("[1] each spec carries the canonical fields and NO `reason` key", async () => {
    for (const tool of WAVE_1_TOOLS) {
      const mod = (await import(tool.modulePath)) as {
        spec: {
          name: string;
          inputSchema: { shape: Record<string, unknown> };
        };
      };
      expect(mod.spec.name).toBe(tool.name);
      const shape = mod.spec.inputSchema.shape;
      expect(shape.order_ids).toBeDefined();
      expect(shape.confirm).toBeDefined();
      expect(shape.dry_run).toBeDefined();
      expect(shape.reason).toBeUndefined();
    }
  });

  it("[2] each spec carries the canonical guardrails block", async () => {
    for (const tool of WAVE_1_TOOLS) {
      const mod = (await import(tool.modulePath)) as {
        spec: {
          guardrails: {
            rateLimit: { capacity: number };
            idempotency: { keyArg: string };
            audit: boolean;
          };
        };
      };
      expect(mod.spec.guardrails.audit).toBe(true);
      expect(mod.spec.guardrails.idempotency.keyArg).toBe("idempotency_key");
      expect(mod.spec.guardrails.rateLimit.capacity).toBe(3);
    }
  });
});

describe("Wave 1 batch transitions — destructive gate (per tool)", () => {
  for (const tool of WAVE_1_TOOLS) {
    it(`[3] ${tool.name}: confirm missing → ConfirmationRequiredError, ZERO PUT`, async () => {
      let putCount = 0;
      server.use(
        http.put(`${PLATFORM}${tool.path}`, () => {
          putCount += 1;
          return HttpResponse.json({});
        }),
      );
      const mod = (await import(tool.modulePath)) as {
        spec: {
          handler: (a: typeof auth, args: unknown) => Promise<{
            content: Array<{ type: string; text?: string }>;
            isError?: boolean;
          }>;
        };
      };
      const result = await mod.spec.handler(auth, {
        order_ids: ["o1"],
        environment: "production",
      });
      expect(putCount).toBe(0);
      expect(result.isError).toBe(true);
      const first = result.content[0];
      if (first.type !== "text") throw new Error("expected text block");
      expect(first.text).toContain(tool.name);
      expect(first.text).toContain("confirm: true");
    });
  }
});

describe("Wave 1 batch transitions — dry-run (per tool)", () => {
  for (const tool of WAVE_1_TOOLS) {
    it(`[4] ${tool.name}: confirm:true + dry_run:true → preview with dryRun:true + orderIds, ZERO PUT`, async () => {
      let putCount = 0;
      server.use(
        http.put(`${PLATFORM}${tool.path}`, () => {
          putCount += 1;
          return HttpResponse.json({});
        }),
      );
      const mod = (await import(tool.modulePath)) as {
        spec: {
          handler: (a: typeof auth, args: unknown) => Promise<{
            content: Array<{ type: string; text?: string }>;
            isError?: boolean;
          }>;
        };
      };
      const result = await mod.spec.handler(auth, {
        order_ids: ["o1", "o2"],
        confirm: true,
        dry_run: true,
        environment: "production",
      });
      expect(putCount).toBe(0);
      expect(result.isError).toBeFalsy();
      const first = result.content[0];
      if (first.type !== "text") throw new Error("expected text block");
      expect(first.text).toContain('"dryRun": true');
      expect(first.text).toContain('"orderIds":');
      const parsed = JSON.parse(first.text!) as Record<string, unknown>;
      expect(parsed.orderIds).toEqual(["o1", "o2"]);
      const simulated = parsed.simulated as Record<string, unknown>;
      expect(simulated.transition).toBe(tool.name);
    });
  }
});

describe("Wave 1 batch transitions — live PUT (per tool)", () => {
  for (const tool of WAVE_1_TOOLS) {
    it(`[5] ${tool.name}: confirm:true → ONE PUT to ${tool.path} with order_ids body`, async () => {
      let putCount = 0;
      let capturedUrl: string | undefined;
      let capturedBody: unknown;
      server.use(
        http.put(`${PLATFORM}${tool.path}`, async ({ request }) => {
          putCount += 1;
          capturedUrl = request.url;
          capturedBody = await request.json();
          return HttpResponse.json({ ok: true, transitioned: 2 });
        }),
      );
      const mod = (await import(tool.modulePath)) as {
        spec: {
          handler: (a: typeof auth, args: unknown) => Promise<{
            content: Array<{ type: string; text?: string }>;
            isError?: boolean;
          }>;
        };
      };
      const result = await mod.spec.handler(auth, {
        order_ids: ["o1", "o2"],
        confirm: true,
        environment: "production",
      });
      expect(putCount).toBe(1);
      expect(capturedUrl).toBe(`${PLATFORM}${tool.path}`);
      expect(capturedBody).toEqual({ order_ids: ["o1", "o2"] });
      expect(result.isError).toBeFalsy();
    });
  }
});

describe("Wave 1 batch transitions — tool-surface snapshot", () => {
  it("[6] all 6 new tool names appear in evals/snapshots/tool-surface.json with enabled status", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const path = resolve(
      process.cwd(),
      "evals/snapshots/tool-surface.json",
    );
    const snapshot = JSON.parse(readFileSync(path, "utf8")) as {
      tools: Record<string, string>;
    };
    for (const tool of WAVE_1_TOOLS) {
      expect(snapshot.tools[tool.name]).toBe("enabled");
    }
  });
});
