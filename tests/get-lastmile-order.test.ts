import { describe, it, expect } from "vitest";

describe("get_lastmile_order", () => {
  describe("registration", () => {
    it("registers under the expected name with required input schema", async () => {
      // Spec exposed as a named export from lib/tools/get-lastmile-order.
      // The wrapper at lib/tools/register.ts feeds spec.inputSchema.shape
      // to the MCP SDK; here we assert the spec object itself.
      const mod = await import("../lib/tools/get-lastmile-order");
      expect(mod.spec).toBeDefined();
      expect(mod.spec.name).toBe("get_lastmile_order");
      expect(mod.spec.description).toMatch(/order/i);

      // inputSchema is a Zod object — assert shape via parse.
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
  });
});
