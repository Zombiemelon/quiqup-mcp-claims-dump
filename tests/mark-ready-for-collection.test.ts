import { describe, it, expect } from "vitest";

describe("mark_ready_for_collection (disabled-pending-M6)", () => {
  describe("registration", () => {
    it("exposes a spec with the expected name and required input schema", async () => {
      const mod = await import("../lib/tools/mark-ready-for-collection");
      expect(mod.spec).toBeDefined();
      expect(mod.spec.name).toBe("mark_ready_for_collection");
      expect(mod.spec.description).toMatch(/ready|dispatch|collection/i);
      const ok = mod.spec.inputSchema.safeParse({ order_id: "12345" });
      expect(ok.success).toBe(true);
    });
  });

  describe("input validation", () => {
    it("rejects missing order_id", async () => {
      const mod = await import("../lib/tools/mark-ready-for-collection");
      const r = mod.spec.inputSchema.safeParse({});
      expect(r.success).toBe(false);
    });

    it("rejects non-string order_id", async () => {
      const mod = await import("../lib/tools/mark-ready-for-collection");
      const r = mod.spec.inputSchema.safeParse({ order_id: 12345 });
      expect(r.success).toBe(false);
    });
  });

  describe("disabled handler", () => {
    it("throws an M6-guardrail error when invoked", async () => {
      const mod = await import("../lib/tools/mark-ready-for-collection");
      const auth = {
        userId: "user_test",
        orgId: null,
        sessionId: "sess_test",
        scopes: ["read"],
        bearerToken: "test-token",
      };
      await expect(
        mod.spec.handler(auth, { order_id: "12345" }),
      ).rejects.toThrow(/disabled|M6|guardrail/i);
    });
  });
});
