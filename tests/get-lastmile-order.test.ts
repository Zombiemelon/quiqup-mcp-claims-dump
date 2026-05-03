import { describe, it, expect, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "./setup/msw";
import cassette from "./cassettes/get-lastmile-order.json";

// Mock the Clerk-session-JWT mint so unit tests don't need real Clerk creds.
// The client itself is stubbed via msw at the fetch boundary; this just
// short-circuits the upstream-token-resolution step inside the handler.
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

describe("get_lastmile_order", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("registration", () => {
    // TODO(M2 ship): this test name lies — it asserts the *spec object*,
    // not that the MCP server actually has the tool registered. Either
    // rename to "exposes a spec with the expected name and schema" or add
    // a real registration test that calls server.registerTool and inspects
    // what got registered (probably belongs in a register.test.ts unit
    // test against the wrapper itself). A4 manual verification covers the
    // gap for now. Flagged in 2026-05-03 review.
    it("registers under the expected name with required input schema", async () => {
      const mod = await import("../lib/tools/get-lastmile-order");
      expect(mod.spec).toBeDefined();
      expect(mod.spec.name).toBe("get_lastmile_order");
      expect(mod.spec.description).toMatch(/order/i);

      const result = mod.spec.inputSchema.safeParse({ order_id: "abc" });
      expect(result.success).toBe(true);
    });
  });

  describe("input validation", () => {
    it("rejects missing order_id", async () => {
      const mod = await import("../lib/tools/get-lastmile-order");
      const result = mod.spec.inputSchema.safeParse({});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(["order_id"]);
      }
    });

    it("rejects non-string order_id", async () => {
      const mod = await import("../lib/tools/get-lastmile-order");
      const result = mod.spec.inputSchema.safeParse({ order_id: 123 });
      expect(result.success).toBe(false);
    });
  });

  describe("happy path", () => {
    it("returns formatted order via msw cassette replay", async () => {
      const orderId = String(cassette.order.id);
      server.use(
        http.get(`https://api-ae.quiqup.com/orders/${orderId}`, () =>
          HttpResponse.json(cassette),
        ),
      );

      const mod = await import("../lib/tools/get-lastmile-order");
      const result = await mod.spec.handler(auth, { order_id: orderId });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      const parsed = JSON.parse(result.content[0].text);
      // The handler unwraps Quiqup's `{order: {...}}` envelope.
      expect(parsed.id).toBe(cassette.order.id);
      expect(parsed.state).toBe(cassette.order.state);
    });
  });
});
