import { describe, it, expect, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "./setup/msw";
import cassette from "./cassettes/get-lastmile-order-label.json";

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

// Replays the synthetic-PDF cassette as raw bytes with the
// content-type the client branch detects on.
const replayLabel = (orderId: string) =>
  http.get(`https://api-ae.quiqup.com/order_label/${orderId}`, () => {
    const bytes = Buffer.from(cassette.body_base64, "base64");
    return new HttpResponse(bytes, {
      status: cassette.status,
      headers: { "content-type": cassette.content_type },
    });
  });

describe("get_lastmile_order_label", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("registration", () => {
    it("registers under the expected name with required input schema", async () => {
      const mod = await import("../lib/tools/get-lastmile-order-label");
      expect(mod.spec.name).toBe("get_lastmile_order_label");
      expect(mod.spec.description).toMatch(/label|pdf/i);

      const ok = mod.spec.inputSchema.safeParse({ order_id: "abc" });
      expect(ok.success).toBe(true);
    });
  });

  describe("input validation", () => {
    it("rejects missing order_id", async () => {
      const mod = await import("../lib/tools/get-lastmile-order-label");
      const result = mod.spec.inputSchema.safeParse({});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(["order_id"]);
      }
    });

    it("rejects empty order_id", async () => {
      const mod = await import("../lib/tools/get-lastmile-order-label");
      const result = mod.spec.inputSchema.safeParse({ order_id: "" });
      expect(result.success).toBe(false);
    });
  });

  describe("happy path", () => {
    it("returns text summary + resource block carrying the PDF blob", async () => {
      const orderId = "12345";
      server.use(replayLabel(orderId));

      const mod = await import("../lib/tools/get-lastmile-order-label");
      const result = await mod.spec.handler(auth, { order_id: orderId });

      expect(result.isError).not.toBe(true);
      expect(result.content).toHaveLength(2);

      const [summary, resource] = result.content;
      if (summary.type !== "text") throw new Error("expected text summary");
      expect(summary.text).toMatch(new RegExp(`order_id=${orderId}`));
      expect(summary.text).toMatch(/application\/pdf/);

      if (resource.type !== "resource")
        throw new Error("expected resource block");
      expect(resource.resource.mimeType).toBe("application/pdf");
      expect(resource.resource.uri).toMatch(
        new RegExp(`^quiqup-lastmile://order_label/${orderId}\\.pdf$`),
      );

      // The magic-byte check is the load-bearing assertion: confirms what
      // the client extracts decodes to a real PDF, not a JSON string of a
      // PDF or some other accidental double-encode.
      const blob = (resource.resource as { blob: string }).blob;
      expect(typeof blob).toBe("string");
      const decoded = Buffer.from(blob, "base64").subarray(0, 5).toString();
      expect(decoded).toBe("%PDF-");
    });

    it("strips a charset parameter from the upstream content-type for mimeType", async () => {
      server.use(
        http.get("https://api-ae.quiqup.com/order_label/:id", () => {
          const bytes = Buffer.from(cassette.body_base64, "base64");
          return new HttpResponse(bytes, {
            status: 200,
            headers: { "content-type": "application/pdf; charset=binary" },
          });
        }),
      );

      const mod = await import("../lib/tools/get-lastmile-order-label");
      const result = await mod.spec.handler(auth, { order_id: "abc" });
      const resource = result.content[1];
      if (resource.type !== "resource")
        throw new Error("expected resource block");
      expect(resource.resource.mimeType).toBe("application/pdf");
    });
  });

  describe("error mapping (via registerTool QuiqupHttpError wrapper)", () => {
    // The handler doesn't try to remap upstream errors itself — it throws
    // QuiqupHttpError from the shared client and lets the registerTool
    // wrapper produce the isError:true tool-result. These tests reproduce
    // the path end-to-end via spec.handler so the wrapper-shape isn't
    // covered here (registerTool has its own unit tests); we just confirm
    // that the handler does NOT swallow upstream failures.
    it("throws QuiqupHttpError on 404 so the wrapper can surface it", async () => {
      server.use(
        http.get("https://api-ae.quiqup.com/order_label/:id", () =>
          HttpResponse.json({ error: "Not Found" }, { status: 404 }),
        ),
      );
      const mod = await import("../lib/tools/get-lastmile-order-label");
      await expect(
        mod.spec.handler(auth, { order_id: "missing" }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("throws QuiqupHttpError on 401", async () => {
      server.use(
        http.get("https://api-ae.quiqup.com/order_label/:id", () =>
          HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
        ),
      );
      const mod = await import("../lib/tools/get-lastmile-order-label");
      await expect(
        mod.spec.handler(auth, { order_id: "abc" }),
      ).rejects.toMatchObject({ status: 401 });
    });

    it("throws QuiqupHttpError on 5xx", async () => {
      server.use(
        http.get("https://api-ae.quiqup.com/order_label/:id", () =>
          HttpResponse.json({ error: "upstream" }, { status: 503 }),
        ),
      );
      const mod = await import("../lib/tools/get-lastmile-order-label");
      await expect(
        mod.spec.handler(auth, { order_id: "abc" }),
      ).rejects.toMatchObject({ status: 503 });
    });
  });

  describe("upstream content-type guard", () => {
    it("returns isError when upstream returns 200 with non-PDF body (e.g. HTML edge error page)", async () => {
      server.use(
        http.get(
          "https://api-ae.quiqup.com/order_label/:id",
          () =>
            new HttpResponse("<html><body>503 from edge</body></html>", {
              status: 200,
              headers: { "content-type": "text/html; charset=utf-8" },
            }),
        ),
      );
      const mod = await import("../lib/tools/get-lastmile-order-label");
      const result = await mod.spec.handler(auth, { order_id: "abc" });
      expect(result.isError).toBe(true);
      const first = result.content[0];
      if (first.type !== "text") throw new Error("expected text block");
      expect(first.text).toMatch(/unexpected content type/i);
    });

    it("returns isError when upstream returns no base64 body", async () => {
      server.use(
        http.get(
          "https://api-ae.quiqup.com/order_label/:id",
          () =>
            new HttpResponse("", {
              status: 200,
              headers: { "content-type": "application/pdf" },
            }),
        ),
      );
      const mod = await import("../lib/tools/get-lastmile-order-label");
      const result = await mod.spec.handler(auth, { order_id: "abc" });
      expect(result.isError).toBe(true);
    });
  });

  describe("output schema", () => {
    it("validates the cassette response shape", async () => {
      const mod = await import("../lib/tools/get-lastmile-order-label");
      const result = mod.spec.outputSchema.safeParse({
        contentType: cassette.content_type,
        base64: cassette.body_base64,
      });
      expect(result.success).toBe(true);
    });
  });
});
