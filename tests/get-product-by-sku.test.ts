import { describe, it, expect } from "vitest";

describe("get_product_by_sku", () => {
  describe("registration", () => {
    it("registers under the expected name with required input schema", async () => {
      const mod = await import("../lib/tools/get-product-by-sku");
      expect(mod.spec).toBeDefined();
      expect(mod.spec.name).toBe("get_product_by_sku");
      expect(mod.spec.description).toMatch(/product/i);

      const result = mod.spec.inputSchema.safeParse({ sku: "SKU123" });
      expect(result.success).toBe(true);
    });
  });

  describe("input validation", () => {
    it("rejects missing sku", async () => {
      const mod = await import("../lib/tools/get-product-by-sku");
      const result = mod.spec.inputSchema.safeParse({});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(["sku"]);
      }
    });

    it("rejects non-string sku", async () => {
      const mod = await import("../lib/tools/get-product-by-sku");
      const result = mod.spec.inputSchema.safeParse({ sku: 123 });
      expect(result.success).toBe(false);
    });
  });
});
