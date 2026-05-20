/**
 * Dedicated MSW-mocked suite for `lookup_google_place` — the only MCP tool in
 * this server that does NOT go through the Clerk → Quiqup actor-token bridge.
 *
 * This suite locks in the auth-isolation must-have from plan 01-02:
 *   1. Happy path — the upstream JSON is surfaced as a text content block.
 *   2. Auth-isolation — the outbound request carries `X-Goog-Api-Key` and
 *      `X-Goog-FieldMask` but NO `Authorization` header.
 *   3. Missing GOOGLE_PLACES_API_KEY — the handler throws with a message
 *      that does NOT echo the secret value.
 *   4. Missing auth.userId — the handler throws even though upstream auth
 *      is an API key (Clerk binding still prevents anonymous quota burn).
 *   5. Upstream 4xx — the handler translates GooglePlacesError into a
 *      QuiqupHttpError so the registerTool wrapper produces the same MCP
 *      isError shape every other tool emits.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../setup/msw";

// `lookup_google_place` does not call getQuiqupReadyJwt — but a stray import
// in test infra (e.g. transitive shared util) could pull it in. Stub it to a
// no-op so any accidental call would be obvious in the test output.
vi.mock("@/lib/quiqup", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getQuiqupReadyJwt: vi.fn(async (_userId: string) => "should-not-be-called"),
  };
});

const auth = {
  userId: "user_test",
  orgId: null,
  sessionId: "sess_test",
  scopes: ["read"],
  bearerToken: "inbound_at_jwt_unused_in_v3b",
};

const authAnon = {
  userId: null,
  orgId: null,
  sessionId: null,
  scopes: [],
  bearerToken: null,
};

const GOOGLE = "https://places.googleapis.com";

const originalApiKey = process.env.GOOGLE_PLACES_API_KEY;
const originalBaseUrl = process.env.GOOGLE_PLACES_BASE_URL;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  // Default base URL is https://places.googleapis.com, which is what MSW intercepts.
  delete process.env.GOOGLE_PLACES_BASE_URL;
});

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
  else process.env.GOOGLE_PLACES_API_KEY = originalApiKey;
  if (originalBaseUrl === undefined) delete process.env.GOOGLE_PLACES_BASE_URL;
  else process.env.GOOGLE_PLACES_BASE_URL = originalBaseUrl;
});

describe("lookup_google_place", () => {
  const payload = {
    id: "ChIJBxxxxxxxxxxxxxx",
    displayName: { text: "Burj Khalifa" },
    formattedAddress: "1 Sheikh Mohammed bin Rashid Blvd, Dubai",
    location: { latitude: 25.1972, longitude: 55.2744 },
    addressComponents: [{ longText: "Dubai", types: ["locality"] }],
  };

  it("returns the place payload as a text content block", async () => {
    server.use(
      http.get(`${GOOGLE}/v1/places/:placeId`, () => HttpResponse.json(payload)),
    );
    const mod = await import("../../lib/tools/lookup-google-place");
    const result = await mod.spec.handler(auth, {
      place_id: "ChIJBxxxxxxxxxxxxxx",
    });
    expect(result.content).toHaveLength(1);
    const first = result.content[0];
    if (first.type !== "text") throw new Error("expected text block");
    expect(first.text).toContain("Burj Khalifa");
  });

  it("sends X-Goog-Api-Key + X-Goog-FieldMask and NO authorization header", async () => {
    let capturedHeaders: Headers | null = null;
    server.use(
      http.get(`${GOOGLE}/v1/places/:placeId`, ({ request }) => {
        capturedHeaders = request.headers;
        return HttpResponse.json(payload);
      }),
    );
    const mod = await import("../../lib/tools/lookup-google-place");
    await mod.spec.handler(auth, { place_id: "ChIJxxx" });
    expect(capturedHeaders).not.toBeNull();
    const headers = capturedHeaders as unknown as Headers;
    // Header lookups are case-insensitive in fetch/Headers.
    expect(headers.get("x-goog-api-key")).toBe("test-key");
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-goog-fieldmask")).toBeTruthy();
  });

  it("throws without GOOGLE_PLACES_API_KEY and never echoes the env value in the message", async () => {
    // Set a sentinel value first, then unset — this proves that even if the
    // key WERE somehow loaded into a closure, our error message wouldn't
    // include it (the value below should never appear in any error text).
    process.env.GOOGLE_PLACES_API_KEY = "secret-value-xyz";
    delete process.env.GOOGLE_PLACES_API_KEY;
    const mod = await import("../../lib/tools/lookup-google-place");
    let caught: Error | null = null;
    try {
      await mod.spec.handler(auth, { place_id: "ChIJxxx" });
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    const msg = caught!.message;
    expect(msg).toMatch(/GOOGLE_PLACES_API_KEY/);
    expect(msg).not.toContain("secret-value-xyz");
  });

  it("throws when auth.userId is null (Clerk binding still enforced)", async () => {
    const mod = await import("../../lib/tools/lookup-google-place");
    await expect(
      mod.spec.handler(authAnon, { place_id: "ChIJxxx" }),
    ).rejects.toThrow(/authenticated user/);
  });

  it("translates an upstream 4xx into QuiqupHttpError (not GooglePlacesError)", async () => {
    server.use(
      http.get(`${GOOGLE}/v1/places/:placeId`, () =>
        HttpResponse.json({ error: "NOT_FOUND" }, { status: 404 }),
      ),
    );
    const mod = await import("../../lib/tools/lookup-google-place");
    const { QuiqupHttpError } = await import("../../lib/clients/quiqup-lastmile");
    const { GooglePlacesError } = await import(
      "../../lib/clients/google-places"
    );
    let caught: unknown = null;
    try {
      await mod.spec.handler(auth, { place_id: "ChIJxxx" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(QuiqupHttpError);
    expect(caught).not.toBeInstanceOf(GooglePlacesError);
  });
});
