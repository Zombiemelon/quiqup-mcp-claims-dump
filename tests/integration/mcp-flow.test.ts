import { describe, it, expect } from "vitest";
import { createClerkClient } from "@clerk/backend";

const SHOULD_RUN = process.env.RUN_INTEGRATION === "1";

describe.runIf(SHOULD_RUN)("MCP flow integration", () => {
  it("returns claims_dump output for a real Clerk-issued token", async () => {
    if (!process.env.CLERK_SECRET_KEY) {
      throw new Error("CLERK_SECRET_KEY required when RUN_INTEGRATION=1");
    }

    const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

    // Clerk's testingTokens API mints short-lived tokens for test mode.
    // Note: testing tokens are session-shaped, not OAuth-access-token-shaped.
    // This test verifies the wiring + tool dispatch + response format,
    // not the full OAuth-access-token surface (which Phase 7 manual testing covers).
    // See: https://clerk.com/docs/testing/overview
    const testingToken = await clerk.testingTokens.createTestingToken();

    const baseUrl = process.env.MCP_BASE_URL ?? "http://localhost:3000";
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${testingToken.token}`,
        "Accept": "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "claims_dump", arguments: {} },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBeDefined();
    expect(body.result.content).toHaveLength(1);
    const text = body.result.content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.serverNotes.tokenSurface).toBe("oauth-access-token");
  }, 30_000);
});
