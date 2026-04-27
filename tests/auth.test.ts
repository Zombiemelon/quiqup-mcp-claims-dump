import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getClerkIssuerUrl } from "../lib/auth";

describe("getClerkIssuerUrl", () => {
  const original = { ...process.env };
  beforeEach(() => { delete process.env.CLERK_ISSUER_URL; delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY; });
  afterEach(() => { process.env = { ...original }; });

  it("returns CLERK_ISSUER_URL when set", () => {
    process.env.CLERK_ISSUER_URL = "https://clerk.example.com";
    expect(getClerkIssuerUrl()).toBe("https://clerk.example.com");
  });

  it("decodes pk_live_<base64> to issuer URL", () => {
    // base64('clerk.quiqup.com$') = 'Y2xlcmsucXVpcXVwLmNvbSQ='
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_live_Y2xlcmsucXVpcXVwLmNvbSQ";
    expect(getClerkIssuerUrl()).toBe("https://clerk.quiqup.com");
  });

  it("decodes pk_test_<base64> to issuer URL", () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_Y2xlcmsucXVpcXVwLmNvbSQ";
    expect(getClerkIssuerUrl()).toBe("https://clerk.quiqup.com");
  });

  it("throws when neither env var is set", () => {
    expect(() => getClerkIssuerUrl()).toThrow(/CLERK_ISSUER_URL or NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY/);
  });

  it("throws on invalid publishable key format", () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "not_a_real_key";
    expect(() => getClerkIssuerUrl()).toThrow(/Invalid Clerk publishable key format/);
  });

  it("handles trailing whitespace in publishable key", () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_live_Y2xlcmsucXVpcXVwLmNvbSQ\n";
    expect(getClerkIssuerUrl()).toBe("https://clerk.quiqup.com");
  });

  it("preserves decoded host when no trailing $ sentinel is present", () => {
    // base64('clerk.example.com') = 'Y2xlcmsuZXhhbXBsZS5jb20='
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_live_Y2xlcmsuZXhhbXBsZS5jb20";
    expect(getClerkIssuerUrl()).toBe("https://clerk.example.com");
  });
});
