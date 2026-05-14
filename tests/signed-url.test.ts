import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.LABEL_URL_SIGNING_SECRET =
    "test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
});

describe("signed-url", () => {
  it("round-trips a sign → verify with matching fields", async () => {
    const { signLabelUrl, verifyLabelUrl } = await import("../lib/signed-url");
    const { url } = signLabelUrl({
      orderId: "order_1",
      userId: "user_1",
      baseUrl: "https://app.example.com",
    });
    const parsed = new URL(url);
    const verdict = verifyLabelUrl({
      orderId: "order_1",
      userId: parsed.searchParams.get("u"),
      exp: parsed.searchParams.get("exp"),
      sig: parsed.searchParams.get("sig"),
    });
    expect(verdict.ok).toBe(true);
  });

  it("rejects a tampered userId", async () => {
    const { signLabelUrl, verifyLabelUrl } = await import("../lib/signed-url");
    const { url } = signLabelUrl({
      orderId: "order_1",
      userId: "user_1",
      baseUrl: "https://app.example.com",
    });
    const parsed = new URL(url);
    const verdict = verifyLabelUrl({
      orderId: "order_1",
      userId: "user_evil",
      exp: parsed.searchParams.get("exp"),
      sig: parsed.searchParams.get("sig"),
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("bad_signature");
  });

  it("rejects a tampered orderId", async () => {
    const { signLabelUrl, verifyLabelUrl } = await import("../lib/signed-url");
    const { url } = signLabelUrl({
      orderId: "order_1",
      userId: "user_1",
      baseUrl: "https://app.example.com",
    });
    const parsed = new URL(url);
    const verdict = verifyLabelUrl({
      orderId: "order_evil",
      userId: parsed.searchParams.get("u"),
      exp: parsed.searchParams.get("exp"),
      sig: parsed.searchParams.get("sig"),
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("bad_signature");
  });

  it("rejects an expired URL", async () => {
    const { signLabelUrl, verifyLabelUrl } = await import("../lib/signed-url");
    const past = Date.now() - 60 * 60 * 1000;
    const { url } = signLabelUrl({
      orderId: "order_1",
      userId: "user_1",
      baseUrl: "https://app.example.com",
      ttlSeconds: 60,
      now: () => past,
    });
    const parsed = new URL(url);
    const verdict = verifyLabelUrl({
      orderId: "order_1",
      userId: parsed.searchParams.get("u"),
      exp: parsed.searchParams.get("exp"),
      sig: parsed.searchParams.get("sig"),
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("expired");
  });

  it("rejects missing params", async () => {
    const { verifyLabelUrl } = await import("../lib/signed-url");
    const verdict = verifyLabelUrl({
      orderId: "order_1",
      userId: null,
      exp: null,
      sig: null,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("missing_params");
  });
});
