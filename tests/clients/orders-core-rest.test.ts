/**
 * MSW-mocked Vitest suite for OrdersCoreRestClient (Phase 3 / Wave 4).
 *
 * Covers the contract the client layer owns:
 *   1. requestMultipart sends Bearer auth WITHOUT a manual Content-Type
 *      — fetch sets `multipart/form-data; boundary=...` from the
 *      FormData body. Manual override would clobber the boundary and
 *      the upstream would reject.
 *   2. requestMultipart forwards form fields (file + document_type +
 *      admin_override) intact.
 *   3. Non-2xx → QuiqupHttpError (reused — Orders Core is a Quiqup-
 *      prefixed service).
 *   4. Fallback chain: when ORDERS_API_BASE_URL is unset and
 *      QUIQUP_ORDERS_GRAPH_URL is set, the REST client derives its
 *      host by stripping the `/graph` suffix — preserves the FE
 *      one-env-var-redirects-both-surfaces ergonomics.
 *   5. ORDERS_API_BASE_URL direct override wins over the fallback chain.
 *   6. `environment: "staging"` routes to the staging cluster.
 *
 * WR-05 env-cleanup pattern: ALL FOUR env-var keys consulted by the
 * fallback chain are deleted in beforeEach so a developer with any of
 * them set in their shell does not silently route fetches around MSW.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../setup/msw";
import {
  OrdersCoreRestClient,
  ORDERS_REST_BASE_URLS,
  getOrdersRestBaseUrl,
} from "../../lib/clients/orders-core-rest";
import { QuiqupHttpError } from "../../lib/clients/quiqup-lastmile";

const PROD = ORDERS_REST_BASE_URLS.production;
const STAGING = ORDERS_REST_BASE_URLS.staging;

const originalEnv = {
  ORDERS_API_BASE_URL: process.env.ORDERS_API_BASE_URL,
  ORDERS_API_STAGING_BASE_URL: process.env.ORDERS_API_STAGING_BASE_URL,
  QUIQUP_ORDERS_GRAPH_URL: process.env.QUIQUP_ORDERS_GRAPH_URL,
  QUIQUP_ORDERS_GRAPH_STAGING_URL: process.env.QUIQUP_ORDERS_GRAPH_STAGING_URL,
};

beforeEach(() => {
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

describe("OrdersCoreRestClient", () => {
  it("requestMultipart sends Bearer header WITHOUT a manual Content-Type", async () => {
    type Captured = {
      auth: string | null;
      contentType: string | null;
    };
    let captured: Captured | null = null;

    server.use(
      http.post(`${PROD}/orders-by-client-id/42/documents`, ({ request }) => {
        captured = {
          auth: request.headers.get("authorization"),
          contentType: request.headers.get("content-type"),
        };
        return HttpResponse.json({ ok: true });
      }),
    );

    const client = new OrdersCoreRestClient({ jwt: "test-jwt" });
    const fd = new FormData();
    fd.append("file", new Blob(["hi"], { type: "text/plain" }), "f.txt");
    fd.append("document_type", "proof_of_delivery");
    fd.append("admin_override", "true");

    await client.requestMultipart(
      "POST",
      "/orders-by-client-id/42/documents",
      fd,
    );

    expect(captured).not.toBeNull();
    const c = captured as unknown as Captured;
    expect(c.auth).toMatch(/^Bearer /);
    // fetch must have set the multipart/form-data Content-Type with a
    // boundary parameter — proof we did NOT clobber it from the client.
    expect(c.contentType).not.toBeNull();
    expect((c.contentType as string).startsWith("multipart/form-data")).toBe(
      true,
    );
    expect(c.contentType).toContain("boundary=");
  });

  it("requestMultipart forwards form fields", async () => {
    type CapturedFields = {
      fileFilename: string;
      fileType: string;
      documentType: string;
      adminOverride: string;
    };
    let captured: CapturedFields | null = null;

    server.use(
      http.post(`${PROD}/orders-by-client-id/9/documents`, async ({ request }) => {
        const form = await request.formData();
        const fileEntry = form.get("file");
        if (!(fileEntry instanceof File)) {
          throw new Error("file field is not a File");
        }
        captured = {
          fileFilename: fileEntry.name,
          fileType: fileEntry.type,
          documentType: String(form.get("document_type")),
          adminOverride: String(form.get("admin_override")),
        };
        return HttpResponse.json({ document_id: "doc-1" });
      }),
    );

    const client = new OrdersCoreRestClient({ jwt: "test-jwt" });
    const fd = new FormData();
    fd.append(
      "file",
      new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" }),
      "pod-9.jpg",
    );
    fd.append("document_type", "proof_of_delivery");
    fd.append("admin_override", "true");

    const result = await client.requestMultipart(
      "POST",
      "/orders-by-client-id/9/documents",
      fd,
    );

    expect(result).toEqual({ document_id: "doc-1" });
    expect(captured).not.toBeNull();
    const c = captured as unknown as CapturedFields;
    expect(c.fileFilename).toBe("pod-9.jpg");
    expect(c.fileType).toBe("image/jpeg");
    expect(c.documentType).toBe("proof_of_delivery");
    expect(c.adminOverride).toBe("true");
  });

  it("throws QuiqupHttpError on non-2xx", async () => {
    server.use(
      http.post(`${PROD}/orders-by-client-id/1/documents`, () =>
        HttpResponse.json({ error: "bad client_order_id" }, { status: 422 }),
      ),
    );

    const client = new OrdersCoreRestClient({ jwt: "test-jwt" });
    const fd = new FormData();
    fd.append("file", new Blob(["x"], { type: "text/plain" }), "x");
    fd.append("document_type", "proof_of_delivery");
    fd.append("admin_override", "true");

    let thrown: unknown = null;
    try {
      await client.requestMultipart(
        "POST",
        "/orders-by-client-id/1/documents",
        fd,
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(QuiqupHttpError);
    expect((thrown as QuiqupHttpError).status).toBe(422);
  });

  it("falls back to ORDERS_API_GRAPH_URL minus /graph when ORDERS_API_BASE_URL is unset", async () => {
    process.env.QUIQUP_ORDERS_GRAPH_URL = "https://localhost.test/graph";
    expect(getOrdersRestBaseUrl("production")).toBe("https://localhost.test");

    let hit = false;
    server.use(
      http.post(
        "https://localhost.test/orders-by-client-id/7/documents",
        () => {
          hit = true;
          return HttpResponse.json({ document_id: "doc-7" });
        },
      ),
    );

    const client = new OrdersCoreRestClient({ jwt: "test-jwt" });
    const fd = new FormData();
    fd.append("file", new Blob(["x"], { type: "text/plain" }), "x");
    fd.append("document_type", "proof_of_delivery");
    fd.append("admin_override", "true");

    const result = await client.requestMultipart(
      "POST",
      "/orders-by-client-id/7/documents",
      fd,
    );
    expect(hit).toBe(true);
    expect(result).toEqual({ document_id: "doc-7" });
  });

  it("honours ORDERS_API_BASE_URL when set", async () => {
    process.env.ORDERS_API_BASE_URL = "https://direct-rest.test";
    process.env.QUIQUP_ORDERS_GRAPH_URL = "https://should-not-be-used.test/graph";
    expect(getOrdersRestBaseUrl("production")).toBe("https://direct-rest.test");

    let hit = false;
    server.use(
      http.post(
        "https://direct-rest.test/orders-by-client-id/3/documents",
        () => {
          hit = true;
          return HttpResponse.json({ ok: true });
        },
      ),
    );

    const client = new OrdersCoreRestClient({ jwt: "test-jwt" });
    const fd = new FormData();
    fd.append("file", new Blob(["x"], { type: "text/plain" }), "x");
    fd.append("document_type", "proof_of_delivery");
    fd.append("admin_override", "true");

    await client.requestMultipart(
      "POST",
      "/orders-by-client-id/3/documents",
      fd,
    );
    expect(hit).toBe(true);
  });

  it("environment: staging routes to staging cluster", async () => {
    let hit = false;
    server.use(
      http.post(
        `${STAGING}/orders-by-client-id/5/documents`,
        () => {
          hit = true;
          return HttpResponse.json({ ok: true });
        },
      ),
    );

    const client = new OrdersCoreRestClient({
      jwt: "test-jwt",
      environment: "staging",
    });
    const fd = new FormData();
    fd.append("file", new Blob(["x"], { type: "text/plain" }), "x");
    fd.append("document_type", "proof_of_delivery");
    fd.append("admin_override", "true");

    await client.requestMultipart(
      "POST",
      "/orders-by-client-id/5/documents",
      fd,
    );
    expect(hit).toBe(true);
  });
});
