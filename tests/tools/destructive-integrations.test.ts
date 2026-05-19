/**
 * MSW-mocked Vitest suite for the two Phase-2 / Wave-5 DESTRUCTIVE delete
 * tools (INTG-02 delete_integration_source, INTG-22 delete_salla_connection).
 *
 * Coverage contract per tool — FIVE paths (per planner success criterion #7):
 *   1. confirm missing            → MSW asserts ZERO outbound DELETE.
 *                                   result.isError === true; text names tool
 *                                   + resource + literal "confirm: true".
 *   2. confirm: false             → same as 1 (defense-in-depth).
 *   3. confirm: true + dry_run    → MSW asserts ZERO outbound DELETE.
 *                                   result is non-error; text parses to
 *                                   `{ ok, dry_run:true, would_delete, note }`.
 *   4. confirm: true only         → MSW captures EXACTLY ONE DELETE; URL has
 *                                   encoded path params; no body; result text
 *                                   parses to `{ ok, deleted, upstream_status }`.
 *   5. missing auth.userId        → throws Error(/authenticated user/); MSW
 *                                   asserts ZERO outbound DELETE.
 *
 * Plus tool-specific:
 *   - delete_integration_source: shop_name with spaces is percent-encoded;
 *     source "magento" rejected at schema parse (enum-bound).
 *   - delete_salla_connection: id containing "/" is percent-encoded.
 *
 * Per WR-05 fix `QUIQUP_PLATFORM_API_BASE_URL` is unset in `beforeEach` —
 * a dev with that env var set would otherwise silently route around MSW.
 *
 * Request counting (per planner): each test that asserts "NO upstream
 * DELETE" registers a wide DELETE handler that bumps a counter; the
 * assertion is `expect(deleteCount).toBe(0)`. This is the bypass-proof
 * lock — it proves the gate runs CLIENT-SIDE and no traffic reaches
 * upstream on the negative paths.
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

// -----------------------------------------------------------------------------
// delete_integration_source (INTG-02)
// -----------------------------------------------------------------------------

describe("delete_integration_source", () => {
  it("[1] confirm missing → isError, NO upstream DELETE", async () => {
    let deleteCount = 0;
    server.use(
      http.delete(`${PLATFORM}/:source/delete/:shop`, () => {
        deleteCount += 1;
        return HttpResponse.json({});
      }),
    );
    const mod = await import("../../lib/tools/delete-integration-source");
    const result = await mod.spec.handler(auth, {
      source: "shopify",
      shop_name: "acme",
      environment: "production",
    });
    expect(deleteCount).toBe(0);
    expect((result as { isError?: boolean }).isError).toBe(true);
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("delete_integration_source");
    expect(first.text).toContain("confirm: true");
    expect(first.text).toContain("shopify");
    expect(first.text).toContain("acme");
  });

  it("[2] confirm: false → isError, NO upstream DELETE (defense-in-depth)", async () => {
    let deleteCount = 0;
    server.use(
      http.delete(`${PLATFORM}/:source/delete/:shop`, () => {
        deleteCount += 1;
        return HttpResponse.json({});
      }),
    );
    const mod = await import("../../lib/tools/delete-integration-source");
    const result = await mod.spec.handler(auth, {
      source: "shopify",
      shop_name: "acme",
      confirm: false,
      environment: "production",
    });
    expect(deleteCount).toBe(0);
    expect((result as { isError?: boolean }).isError).toBe(true);
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("confirm: true");
  });

  it("[3] confirm: true + dry_run: true → preview, NO upstream DELETE", async () => {
    let deleteCount = 0;
    server.use(
      http.delete(`${PLATFORM}/:source/delete/:shop`, () => {
        deleteCount += 1;
        return HttpResponse.json({});
      }),
    );
    const mod = await import("../../lib/tools/delete-integration-source");
    const result = await mod.spec.handler(auth, {
      source: "shopify",
      shop_name: "acme",
      confirm: true,
      dry_run: true,
      environment: "production",
    });
    expect(deleteCount).toBe(0);
    expect((result as { isError?: boolean }).isError).toBeFalsy();
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    const parsed = JSON.parse(first.text) as Record<string, unknown>;
    expect(parsed.ok).toBe(true);
    expect(parsed.dry_run).toBe(true);
    expect(parsed.would_delete).toEqual({ source: "shopify", shop_name: "acme" });
    expect(typeof parsed.note).toBe("string");
  });

  it("[4] confirm: true only → EXACTLY ONE DELETE with encoded path params and no body", async () => {
    let deleteCount = 0;
    let capturedUrl: string | undefined;
    let capturedMethod: string | undefined;
    let capturedBody: string | undefined;
    server.use(
      http.delete(`${PLATFORM}/:source/delete/:shop`, async ({ request }) => {
        deleteCount += 1;
        capturedUrl = request.url;
        capturedMethod = request.method;
        capturedBody = await request.text();
        return HttpResponse.json({});
      }),
    );
    const rawShop = "acme store with spaces";
    const encodedShop = encodeURIComponent(rawShop);
    const mod = await import("../../lib/tools/delete-integration-source");
    const result = await mod.spec.handler(auth, {
      source: "shopify",
      shop_name: rawShop,
      confirm: true,
      environment: "production",
    });

    expect(deleteCount).toBe(1);
    expect(capturedMethod).toBe("DELETE");
    expect(capturedUrl).toBeDefined();
    expect(capturedUrl!.includes(encodedShop)).toBe(true);
    // The raw form (with literal spaces) MUST NOT appear unencoded in the URL.
    expect(capturedUrl!.includes(rawShop)).toBe(false);
    expect(capturedUrl!.includes("/shopify/delete/")).toBe(true);
    expect(capturedBody).toBe("");

    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    const parsed = JSON.parse(first.text) as Record<string, unknown>;
    expect(parsed.ok).toBe(true);
    expect(parsed.deleted).toEqual({ source: "shopify", shop_name: rawShop });
    expect(parsed.upstream_status).toBe(200);
  });

  it("[5] missing auth.userId → throws Error, NO upstream DELETE", async () => {
    let deleteCount = 0;
    server.use(
      http.delete(`${PLATFORM}/:source/delete/:shop`, () => {
        deleteCount += 1;
        return HttpResponse.json({});
      }),
    );
    const mod = await import("../../lib/tools/delete-integration-source");
    await expect(
      mod.spec.handler(authAnon, {
        source: "shopify",
        shop_name: "acme",
        confirm: true,
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
    expect(deleteCount).toBe(0);
  });

  it("schema rejects source: 'magento' (enum-bound; path-injection guard)", async () => {
    const mod = await import("../../lib/tools/delete-integration-source");
    const parsed = mod.spec.inputSchema.safeParse({
      source: "magento",
      shop_name: "acme",
      confirm: true,
      environment: "production",
    });
    expect(parsed.success).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// delete_salla_connection (INTG-22)
// -----------------------------------------------------------------------------

describe("delete_salla_connection", () => {
  it("[1] confirm missing → isError, NO upstream DELETE", async () => {
    let deleteCount = 0;
    server.use(
      http.delete(`${PLATFORM}/integrations/connections/:rest*`, () => {
        deleteCount += 1;
        return HttpResponse.json({});
      }),
    );
    const mod = await import("../../lib/tools/delete-salla-connection");
    const result = await mod.spec.handler(auth, {
      id: "c-abc123",
      environment: "production",
    });
    expect(deleteCount).toBe(0);
    expect((result as { isError?: boolean }).isError).toBe(true);
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("delete_salla_connection");
    expect(first.text).toContain("confirm: true");
    expect(first.text).toContain("c-abc123");
  });

  it("[2] confirm: false → isError, NO upstream DELETE (defense-in-depth)", async () => {
    let deleteCount = 0;
    server.use(
      http.delete(`${PLATFORM}/integrations/connections/:rest*`, () => {
        deleteCount += 1;
        return HttpResponse.json({});
      }),
    );
    const mod = await import("../../lib/tools/delete-salla-connection");
    const result = await mod.spec.handler(auth, {
      id: "c-abc123",
      confirm: false,
      environment: "production",
    });
    expect(deleteCount).toBe(0);
    expect((result as { isError?: boolean }).isError).toBe(true);
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("confirm: true");
  });

  it("[3] confirm: true + dry_run: true → preview, NO upstream DELETE", async () => {
    let deleteCount = 0;
    // BL-03 source-check pre-flight needs a GET handler returning a Salla
    // connection so the dry-run reaches the preview branch.
    server.use(
      http.get(`${PLATFORM}/integrations/connections/:rest*`, () =>
        HttpResponse.json({ connection: { source: "salla" } }),
      ),
      http.delete(`${PLATFORM}/integrations/connections/:rest*`, () => {
        deleteCount += 1;
        return HttpResponse.json({});
      }),
    );
    const mod = await import("../../lib/tools/delete-salla-connection");
    const result = await mod.spec.handler(auth, {
      id: "c-abc123",
      confirm: true,
      dry_run: true,
      environment: "production",
    });
    expect(deleteCount).toBe(0);
    expect((result as { isError?: boolean }).isError).toBeFalsy();
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    const parsed = JSON.parse(first.text) as Record<string, unknown>;
    expect(parsed.ok).toBe(true);
    expect(parsed.dry_run).toBe(true);
    expect(parsed.would_delete).toEqual({ id: "c-abc123", source: "salla" });
    expect(typeof parsed.note).toBe("string");
  });

  it("[4] confirm: true only → EXACTLY ONE DELETE with encoded id, no body", async () => {
    let deleteCount = 0;
    let capturedUrl: string | undefined;
    let capturedMethod: string | undefined;
    let capturedBody: string | undefined;
    server.use(
      http.get(`${PLATFORM}/integrations/connections/:rest*`, () =>
        HttpResponse.json({ connection: { source: "salla" } }),
      ),
      http.delete(
        `${PLATFORM}/integrations/connections/:rest*`,
        async ({ request }) => {
          deleteCount += 1;
          capturedUrl = request.url;
          capturedMethod = request.method;
          capturedBody = await request.text();
          return HttpResponse.json({});
        },
      ),
    );
    // id contains "/" — must be percent-encoded so the upstream sees a
    // single path segment rather than nested routing.
    const rawId = "conn/with/slash";
    const encodedId = encodeURIComponent(rawId);
    const mod = await import("../../lib/tools/delete-salla-connection");
    const result = await mod.spec.handler(auth, {
      id: rawId,
      confirm: true,
      environment: "production",
    });

    expect(deleteCount).toBe(1);
    expect(capturedMethod).toBe("DELETE");
    expect(capturedUrl).toBeDefined();
    expect(capturedUrl!.includes(encodedId)).toBe(true);
    // The raw "/" form MUST NOT appear unencoded in the path segment after
    // /integrations/connections/.
    expect(
      capturedUrl!.includes(`/integrations/connections/${rawId}`),
    ).toBe(false);
    expect(capturedBody).toBe("");

    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    const parsed = JSON.parse(first.text) as Record<string, unknown>;
    expect(parsed.ok).toBe(true);
    expect(parsed.deleted).toEqual({ id: rawId });
    expect(parsed.upstream_status).toBe(200);
  });

  it("[5] missing auth.userId → throws Error, NO upstream DELETE", async () => {
    let deleteCount = 0;
    server.use(
      http.delete(`${PLATFORM}/integrations/connections/:rest*`, () => {
        deleteCount += 1;
        return HttpResponse.json({});
      }),
    );
    const mod = await import("../../lib/tools/delete-salla-connection");
    await expect(
      mod.spec.handler(authAnon, {
        id: "c-abc123",
        confirm: true,
        environment: "production",
      }),
    ).rejects.toThrow(/authenticated user/);
    expect(deleteCount).toBe(0);
  });

  // 02-REVIEW WR-09: newline / control-char injection in args.id is stripped
  // before the id is interpolated into the confirmation-required error text.
  // Prevents log-injection style attacks where a multi-line id smuggles
  // pseudo-fields into log aggregators.
  it("sanitizes args.id newline/control-char injection in error text (WR-09)", async () => {
    const mod = await import("../../lib/tools/delete-salla-connection");
    const malicious = "abc\nadmin_session: smuggled\r\tlog_level: critical";
    const result = await mod.spec.handler(auth, {
      id: malicious,
      // No confirm → confirmation-required error path.
      environment: "production",
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    // Raw newlines / tabs / CR must NOT survive into the error text.
    expect(first.text).not.toContain("\n");
    expect(first.text).not.toContain("\r");
    expect(first.text).not.toContain("\t");
    // The smuggled-field substrings (newlines stripped) might still appear
    // as ordinary characters — but the structural separators that matter
    // for log parsers are gone.
  });

  // 02-REVIEW BL-03: refuse to delete a non-Salla connection even with
  // confirm:true. The upstream DELETE endpoint is family-agnostic, so the
  // tool's "Salla" scope is enforced here by the pre-flight GET.
  it("[6] non-Salla connection (source=shopify) → isError, NO upstream DELETE", async () => {
    let deleteCount = 0;
    server.use(
      http.get(`${PLATFORM}/integrations/connections/:rest*`, () =>
        HttpResponse.json({
          connection: { id: "c-abc123", source: "shopify", shop_name: "acme" },
        }),
      ),
      http.delete(`${PLATFORM}/integrations/connections/:rest*`, () => {
        deleteCount += 1;
        return HttpResponse.json({});
      }),
    );
    const mod = await import("../../lib/tools/delete-salla-connection");
    const result = await mod.spec.handler(auth, {
      id: "c-abc123",
      confirm: true,
      environment: "production",
    });
    expect(deleteCount).toBe(0);
    expect((result as { isError?: boolean }).isError).toBe(true);
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("refused");
    expect(first.text).toContain("source=shopify");
    expect(first.text).toContain("delete_integration_source");
  });

  // 02-REVIEW BL-03: dry-run honours the source-check too — an LLM cannot get
  // a green "would_delete" preview for a non-Salla connection.
  it("[7] dry_run on non-Salla connection → isError, NO upstream DELETE", async () => {
    let deleteCount = 0;
    server.use(
      http.get(`${PLATFORM}/integrations/connections/:rest*`, () =>
        HttpResponse.json({
          connection: { id: "c-abc123", source: "woocommerce" },
        }),
      ),
      http.delete(`${PLATFORM}/integrations/connections/:rest*`, () => {
        deleteCount += 1;
        return HttpResponse.json({});
      }),
    );
    const mod = await import("../../lib/tools/delete-salla-connection");
    const result = await mod.spec.handler(auth, {
      id: "c-abc123",
      confirm: true,
      dry_run: true,
      environment: "production",
    });
    expect(deleteCount).toBe(0);
    expect((result as { isError?: boolean }).isError).toBe(true);
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("source=woocommerce");
  });
});
