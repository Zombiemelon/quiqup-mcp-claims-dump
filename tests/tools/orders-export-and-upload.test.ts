/**
 * MSW-mocked Vitest suite for Phase-3 Wave-4 tools:
 *   - download_orders_export   (ORDL-07 — Ex-core CSV base64)
 *   - upload_order_document    (ORDS-08 — Orders Core REST multipart)
 *
 * Coverage contract:
 *   download_orders_export:
 *     - Happy path returns the base64 envelope with filenameHint.
 *     - URL query forwarding (from / to / per_page).
 *     - filters[order_id] only when order_ids non-empty.
 *     - Date-format rejection at schema layer (yyyy-mm-dd only).
 *     - Unauthenticated callers rejected before fetch.
 *
 *   upload_order_document:
 *     - Happy path returns the document reference.
 *     - Multipart body has file + document_type + admin_override fields,
 *       and the runtime-set Content-Type begins with multipart/form-data.
 *     - client_order_id is encodeURIComponent-ed at the URL boundary.
 *     - Filename path-separators stripped server-side.
 *     - file_base64 > 10MB cap rejected BEFORE any network call.
 *     - Schema contains NO user_id / actor_id / actor_email keys (BL-04).
 *     - guardrails block matches the canonical BL-01 shape.
 *     - Unauthenticated callers rejected.
 *
 * WR-05 env cleanup: ALL FOUR new env-var families are unset in
 * beforeEach so a developer's shell cannot route fetches around MSW.
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

const EX_PROD = "https://ex-api.quiqup.com";
const ORDERS_REST_PROD = "https://orders-api.quiqup.com";

const originalEnv = {
  EX_API_BASE_URL: process.env.EX_API_BASE_URL,
  EX_API_STAGING_BASE_URL: process.env.EX_API_STAGING_BASE_URL,
  ORDERS_API_BASE_URL: process.env.ORDERS_API_BASE_URL,
  ORDERS_API_STAGING_BASE_URL: process.env.ORDERS_API_STAGING_BASE_URL,
  QUIQUP_ORDERS_GRAPH_URL: process.env.QUIQUP_ORDERS_GRAPH_URL,
  QUIQUP_ORDERS_GRAPH_STAGING_URL: process.env.QUIQUP_ORDERS_GRAPH_STAGING_URL,
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.EX_API_BASE_URL;
  delete process.env.EX_API_STAGING_BASE_URL;
  delete process.env.ORDERS_API_BASE_URL;
  delete process.env.ORDERS_API_STAGING_BASE_URL;
  delete process.env.QUIQUP_ORDERS_GRAPH_URL;
  delete process.env.QUIQUP_ORDERS_GRAPH_STAGING_URL;
});

afterEach(() => {
  for (const [k, v] of Object.entries(originalEnv)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
});

describe("download_orders_export", () => {
  it("happy path returns the base64 envelope with filenameHint", async () => {
    const csvBytes = "order_id,state\n42,delivered\n";
    server.use(
      http.get(`${EX_PROD}/orders/download`, () =>
        new HttpResponse(csvBytes, {
          status: 200,
          headers: { "Content-Type": "text/csv" },
        }),
      ),
    );
    const mod = await import("../../lib/tools/download-orders-export");
    const result = await mod.spec.handler(auth, {
      from: "2026-05-01",
      to: "2026-05-19",
      per_page: 1000,
      environment: "production",
    });
    expect(result.content).toHaveLength(1);
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    const parsed = JSON.parse(first.text);
    expect(parsed.contentType).toContain("text/csv");
    expect(typeof parsed.base64).toBe("string");
    expect(parsed.base64.length).toBeGreaterThan(0);
    expect(parsed.filenameHint).toMatch(
      /^orders-export-2026-05-01-to-2026-05-19\.csv$/,
    );
    expect(Buffer.from(parsed.base64, "base64").toString("utf-8")).toBe(
      csvBytes,
    );
  });

  it("forwards from/to/per_page query params", async () => {
    const captured: {
      from: string | null;
      to: string | null;
      perPage: string | null;
    } = { from: null, to: null, perPage: null };
    server.use(
      http.get(`${EX_PROD}/orders/download`, ({ request }) => {
        const url = new URL(request.url);
        captured.from = url.searchParams.get("from");
        captured.to = url.searchParams.get("to");
        captured.perPage = url.searchParams.get("per_page");
        return new HttpResponse("ok", {
          status: 200,
          headers: { "Content-Type": "text/csv" },
        });
      }),
    );
    const mod = await import("../../lib/tools/download-orders-export");
    await mod.spec.handler(auth, {
      from: "2026-05-01",
      to: "2026-05-19",
      per_page: 250,
      environment: "production",
    });
    expect(captured.from).toBe("2026-05-01");
    expect(captured.to).toBe("2026-05-19");
    expect(captured.perPage).toBe("250");
  });

  it("encodes filters[order_id] when order_ids is non-empty", async () => {
    let capturedUrl: string | null = null;
    server.use(
      http.get(`${EX_PROD}/orders/download`, ({ request }) => {
        capturedUrl = request.url;
        return new HttpResponse("ok", {
          status: 200,
          headers: { "Content-Type": "text/csv" },
        });
      }),
    );
    const mod = await import("../../lib/tools/download-orders-export");
    await mod.spec.handler(auth, {
      from: "2026-05-01",
      to: "2026-05-19",
      order_ids: [1, 2, 3],
      per_page: 1000,
      environment: "production",
    });
    expect(capturedUrl).not.toBeNull();
    const u = capturedUrl as unknown as string;
    expect(u).toContain("filters%5Border_id%5D=1%2C2%2C3");
    // decodeURIComponent round-trip recovers the literal upstream key.
    const decoded = decodeURIComponent(new URL(u).search.slice(1));
    expect(decoded).toContain("filters[order_id]=1,2,3");
  });

  it("omits filters[order_id] when order_ids is undefined", async () => {
    let capturedUrl: string | null = null;
    server.use(
      http.get(`${EX_PROD}/orders/download`, ({ request }) => {
        capturedUrl = request.url;
        return new HttpResponse("ok", {
          status: 200,
          headers: { "Content-Type": "text/csv" },
        });
      }),
    );
    const mod = await import("../../lib/tools/download-orders-export");
    await mod.spec.handler(auth, {
      from: "2026-05-01",
      to: "2026-05-19",
      per_page: 1000,
      environment: "production",
    });
    expect(capturedUrl).not.toBeNull();
    const u = new URL(capturedUrl as unknown as string);
    expect(u.searchParams.has("filters[order_id]")).toBe(false);
    // And ensure no percent-encoded variant snuck in via a different key.
    expect(u.search).not.toContain("filters");
  });

  it("rejects bad date format at the schema layer", async () => {
    const mod = await import("../../lib/tools/download-orders-export");
    const bad = mod.spec.inputSchema.safeParse({
      from: "2026/05/01",
      to: "2026-05-19",
    });
    expect(bad.success).toBe(false);
  });

  it("rejects unauthenticated callers", async () => {
    const mod = await import("../../lib/tools/download-orders-export");
    await expect(
      mod.spec.handler(authAnon, {
        from: "2026-05-01",
        to: "2026-05-19",
        per_page: 1000,
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated/i);
  });
});

describe("upload_order_document", () => {
  // A tiny but valid JPEG-magic payload for the multipart body.
  const tinyJpegBase64 = Buffer.from(
    new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  ).toString("base64");

  it("happy path returns the document reference", async () => {
    server.use(
      http.post(
        `${ORDERS_REST_PROD}/orders-by-client-id/12345/documents`,
        () => HttpResponse.json({ document_id: "doc-1" }),
      ),
    );
    const mod = await import("../../lib/tools/upload-order-document");
    const result = await mod.spec.handler(auth, {
      client_order_id: 12345,
      file_base64: tinyJpegBase64,
      filename: "pod-12345.jpg",
      content_type: "image/jpeg",
      document_type: "proof_of_delivery",
      admin_override: true,
      environment: "production",
    });
    expect(result.content).toHaveLength(1);
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain('"document_id": "doc-1"');
  });

  it("sends multipart body with file + document_type + admin_override fields", async () => {
    type Captured = {
      contentType: string | null;
      fields: {
        fileFilename: string;
        fileType: string;
        documentType: string;
        adminOverride: string;
      };
    };
    let captured: Captured | null = null;
    server.use(
      http.post(
        `${ORDERS_REST_PROD}/orders-by-client-id/12345/documents`,
        async ({ request }) => {
          const contentType = request.headers.get("content-type");
          const form = await request.formData();
          const fileEntry = form.get("file");
          if (!(fileEntry instanceof File)) {
            throw new Error("file field is not a File");
          }
          captured = {
            contentType,
            fields: {
              fileFilename: fileEntry.name,
              fileType: fileEntry.type,
              documentType: String(form.get("document_type")),
              adminOverride: String(form.get("admin_override")),
            },
          };
          return HttpResponse.json({ document_id: "doc-1" });
        },
      ),
    );
    const mod = await import("../../lib/tools/upload-order-document");
    await mod.spec.handler(auth, {
      client_order_id: 12345,
      file_base64: tinyJpegBase64,
      filename: "pod-12345.jpg",
      content_type: "image/jpeg",
      document_type: "proof_of_delivery",
      admin_override: true,
      environment: "production",
    });
    expect(captured).not.toBeNull();
    const c = captured as unknown as Captured;
    expect(c.contentType).not.toBeNull();
    expect((c.contentType as string).startsWith("multipart/form-data")).toBe(
      true,
    );
    expect(c.fields.fileFilename).toBe("pod-12345.jpg");
    expect(c.fields.fileType).toBe("image/jpeg");
    expect(c.fields.documentType).toBe("proof_of_delivery");
    expect(c.fields.adminOverride).toBe("true");
  });

  it("encodes client_order_id in the path", async () => {
    let capturedPath: string | null = null;
    // Match any path under the host so we can inspect the captured path.
    server.use(
      http.post(
        `${ORDERS_REST_PROD}/orders-by-client-id/:id/documents`,
        ({ request }) => {
          capturedPath = new URL(request.url).pathname;
          return HttpResponse.json({ document_id: "doc-1" });
        },
      ),
    );
    const mod = await import("../../lib/tools/upload-order-document");
    await mod.spec.handler(auth, {
      client_order_id: "12/345",
      file_base64: tinyJpegBase64,
      filename: "x.jpg",
      content_type: "image/jpeg",
      document_type: "proof_of_delivery",
      admin_override: true,
      environment: "production",
    });
    expect(capturedPath).toBe("/orders-by-client-id/12%2F345/documents");
  });

  it("strips path separators from filename", async () => {
    let capturedFilename: string | null = null;
    server.use(
      http.post(
        `${ORDERS_REST_PROD}/orders-by-client-id/9/documents`,
        async ({ request }) => {
          const form = await request.formData();
          const fileEntry = form.get("file");
          if (fileEntry instanceof File) {
            capturedFilename = fileEntry.name;
          }
          return HttpResponse.json({ document_id: "doc-1" });
        },
      ),
    );
    const mod = await import("../../lib/tools/upload-order-document");
    await mod.spec.handler(auth, {
      client_order_id: 9,
      file_base64: tinyJpegBase64,
      filename: "../../etc/passwd",
      content_type: "application/octet-stream",
      document_type: "proof_of_delivery",
      admin_override: true,
      environment: "production",
    });
    expect(capturedFilename).toBe(".._.._etc_passwd");
  });

  it("rejects file_base64 > 10MB cap BEFORE any network call", async () => {
    // Register an unreachable handler — if the handler hits the network
    // before the cap fires, this would still 200 and the test would fail
    // on assertion. We assert the throw + zero MSW interception by way
    // of the unreachable-handler not being called (msw would throw on
    // unhandled if we omitted it; we include it to make the assertion
    // explicit).
    let networkCalled = false;
    server.use(
      http.post(
        `${ORDERS_REST_PROD}/orders-by-client-id/:id/documents`,
        () => {
          networkCalled = true;
          return HttpResponse.json({ document_id: "should-not-happen" });
        },
      ),
    );
    const mod = await import("../../lib/tools/upload-order-document");
    const huge = "A".repeat(13_500_001);
    await expect(
      mod.spec.handler(auth, {
        client_order_id: 1,
        file_base64: huge,
        filename: "huge.bin",
        content_type: "application/octet-stream",
        document_type: "proof_of_delivery",
        admin_override: true,
        environment: "production",
      }),
    ).rejects.toThrow(/10MB/);
    expect(networkCalled).toBe(false);
  });

  it("does NOT accept caller-supplied identity fields", async () => {
    const mod = await import("../../lib/tools/upload-order-document");
    const keys = Object.keys(mod.spec.inputSchema.shape);
    expect(keys).not.toContain("user_id");
    expect(keys).not.toContain("actor_id");
    expect(keys).not.toContain("actor_email");
    expect(keys).not.toContain("partner_id");
    // Belt-and-braces: if a caller sneaks an unknown key into the args
    // object, z.object strips it on parse — verify with a smoke test.
    const parsed = mod.spec.inputSchema.safeParse({
      client_order_id: 1,
      file_base64: "Zm9v",
      filename: "a.jpg",
      content_type: "image/jpeg",
      user_id: "evil-user",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // The parsed shape MUST NOT carry a user_id field.
      expect(
        (parsed.data as Record<string, unknown>).user_id,
      ).toBeUndefined();
    }
  });

  it("guardrails block sets audit:true + rate-limit + idempotency", async () => {
    const mod = await import("../../lib/tools/upload-order-document");
    const g = mod.spec.guardrails;
    expect(g).toBeDefined();
    expect(g?.audit).toBe(true);
    expect(g?.idempotency?.keyArg).toBe("idempotency_key");
    expect(g?.idempotency?.ttlMs).toBe(15 * 60 * 1000);
    expect(g?.rateLimit?.capacity).toBe(10);
    expect(g?.rateLimit?.refillPerSec).toBeCloseTo(10 / 60, 6);
  });

  it("rejects unauthenticated callers", async () => {
    const mod = await import("../../lib/tools/upload-order-document");
    await expect(
      mod.spec.handler(authAnon, {
        client_order_id: 1,
        file_base64: tinyJpegBase64,
        filename: "x.jpg",
        content_type: "image/jpeg",
        document_type: "proof_of_delivery",
        admin_override: true,
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated/i);
  });
});
