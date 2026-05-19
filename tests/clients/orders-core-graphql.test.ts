/**
 * MSW-mocked Vitest suite for OrdersCoreGraphQLClient (Phase 3 / Wave 1).
 *
 * Covers the contract the client layer owns:
 *   1. POST shape — method + URL + JSON envelope { query, variables } +
 *      Authorization/Content-Type/Accept headers.
 *   2. Partial-success contract — HTTP 200 with populated `errors[]` is
 *      returned verbatim (data AND errors), NOT auto-thrown. This is the
 *      anchor invariant for every GraphQL tool downstream.
 *   3. HTTP non-2xx → throws QuiqupHttpError carrying the upstream status.
 *   4. Env-var override (`QUIQUP_ORDERS_GRAPH_URL`) routes the request to
 *      the override host — MSW binds to that host.
 *   5. `environment: "staging"` routes to the staging cluster.
 *
 * WR-05 env-cleanup pattern: `process.env.QUIQUP_ORDERS_GRAPH_URL` and
 * `process.env.QUIQUP_ORDERS_GRAPH_STAGING_URL` are deleted in beforeEach
 * so a developer with the var set in their shell does not silently route
 * fetches around MSW (handlers are bound to the canonical production /
 * staging hosts, except the override-specific test which sets the var
 * explicitly).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../setup/msw";
import {
  OrdersCoreGraphQLClient,
  ORDERS_GRAPH_URLS,
  getOrdersGraphUrl,
} from "../../lib/clients/orders-core-graphql";
import { QuiqupHttpError } from "../../lib/clients/quiqup-lastmile";

const PROD = ORDERS_GRAPH_URLS.production;
const STAGING = ORDERS_GRAPH_URLS.staging;

const originalProdUrl = process.env.QUIQUP_ORDERS_GRAPH_URL;
const originalStagingUrl = process.env.QUIQUP_ORDERS_GRAPH_STAGING_URL;

beforeEach(() => {
  delete process.env.QUIQUP_ORDERS_GRAPH_URL;
  delete process.env.QUIQUP_ORDERS_GRAPH_STAGING_URL;
});

afterEach(() => {
  if (originalProdUrl === undefined) {
    delete process.env.QUIQUP_ORDERS_GRAPH_URL;
  } else {
    process.env.QUIQUP_ORDERS_GRAPH_URL = originalProdUrl;
  }
  if (originalStagingUrl === undefined) {
    delete process.env.QUIQUP_ORDERS_GRAPH_STAGING_URL;
  } else {
    process.env.QUIQUP_ORDERS_GRAPH_STAGING_URL = originalStagingUrl;
  }
});

describe("OrdersCoreGraphQLClient", () => {
  it("POSTs { query, variables } JSON envelope to /graph", async () => {
    type Captured = {
      method: string;
      url: string;
      auth: string | null;
      accept: string | null;
      contentType: string | null;
      body: unknown;
    };
    let captured: Captured | null = null;

    server.use(
      http.post(PROD, async ({ request }) => {
        captured = {
          method: request.method,
          url: request.url,
          auth: request.headers.get("authorization"),
          accept: request.headers.get("accept"),
          contentType: request.headers.get("content-type"),
          body: await request.json(),
        };
        return HttpResponse.json({ data: { ok: true } });
      }),
    );

    const client = new OrdersCoreGraphQLClient({ jwt: "test-jwt" });
    const result = await client.query("query Foo { foo }", { x: 1 });
    expect(result.data).toEqual({ ok: true });

    expect(captured).not.toBeNull();
    const c = captured as unknown as Captured;
    expect(c.method).toBe("POST");
    expect(c.url).toBe(PROD);
    expect(c.auth).toBe("Bearer test-jwt");
    expect(c.accept).toContain("application/json");
    expect(c.contentType).toContain("application/json");
    expect(c.body).toEqual({ query: "query Foo { foo }", variables: { x: 1 } });
  });

  it("returns { data, errors } as-is on HTTP 200 with populated errors[]", async () => {
    server.use(
      http.post(PROD, () =>
        HttpResponse.json({
          data: { orders: { totalCount: 0, edges: [] } },
          errors: [{ message: "partial", path: ["orders"] }],
        }),
      ),
    );

    const client = new OrdersCoreGraphQLClient({ jwt: "test-jwt" });
    const result = await client.query<{ orders: { totalCount: number } }>(
      "query X { orders { totalCount } }",
    );

    // Both surfaces present — proves we do NOT auto-throw on errors[].
    expect(result.data).not.toBeNull();
    expect(result.data?.orders.totalCount).toBe(0);
    expect(result.errors).toBeDefined();
    expect(Array.isArray(result.errors)).toBe(true);
    expect((result.errors as Array<{ message: string }>)[0].message).toBe(
      "partial",
    );
  });

  it("throws QuiqupHttpError on HTTP non-2xx", async () => {
    server.use(
      http.post(PROD, () =>
        HttpResponse.json({ error: "boom" }, { status: 500 }),
      ),
    );

    const client = new OrdersCoreGraphQLClient({ jwt: "test-jwt" });
    let thrown: unknown = null;
    try {
      await client.query("query X { x }");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(QuiqupHttpError);
    expect((thrown as QuiqupHttpError).status).toBe(500);
  });

  it("honours QUIQUP_ORDERS_GRAPH_URL override", async () => {
    process.env.QUIQUP_ORDERS_GRAPH_URL = "https://localhost.test/graph";
    expect(getOrdersGraphUrl("production")).toBe(
      "https://localhost.test/graph",
    );

    let hit = false;
    server.use(
      http.post("https://localhost.test/graph", () => {
        hit = true;
        return HttpResponse.json({ data: { ok: true } });
      }),
    );

    const client = new OrdersCoreGraphQLClient({ jwt: "test-jwt" });
    const result = await client.query("query X { x }");
    expect(hit).toBe(true);
    expect(result.data).toEqual({ ok: true });
  });

  it("environment: staging routes to staging cluster", async () => {
    let hit = false;
    server.use(
      http.post(STAGING, () => {
        hit = true;
        return HttpResponse.json({ data: { ok: true } });
      }),
    );

    const client = new OrdersCoreGraphQLClient({
      jwt: "test-jwt",
      environment: "staging",
    });
    const result = await client.query("query X { x }");
    expect(hit).toBe(true);
    expect(result.data).toEqual({ ok: true });
  });

  it("honours QUIQUP_ORDERS_GRAPH_STAGING_URL override on staging env", async () => {
    process.env.QUIQUP_ORDERS_GRAPH_STAGING_URL =
      "https://staging-localhost.test/graph";
    expect(getOrdersGraphUrl("staging")).toBe(
      "https://staging-localhost.test/graph",
    );

    let hit = false;
    server.use(
      http.post("https://staging-localhost.test/graph", () => {
        hit = true;
        return HttpResponse.json({ data: { ok: true } });
      }),
    );

    const client = new OrdersCoreGraphQLClient({
      jwt: "test-jwt",
      environment: "staging",
    });
    await client.query("query X { x }");
    expect(hit).toBe(true);
  });
});
