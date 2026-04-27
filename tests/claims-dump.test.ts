import { describe, it, expect } from "vitest";
import { buildClaimsDumpResponse } from "../lib/tools/claims-dump";

describe("buildClaimsDumpResponse", () => {
  it("returns auth object + decoded JWT + server notes as MCP text content", () => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-kid" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: "user_abc", aud: "https://example.com/mcp", iss: "https://clerk.example.com", exp: 9999999999 })).toString("base64url");
    const fakeJwt = `${header}.${payload}.fake-signature`;

    const result = buildClaimsDumpResponse({
      auth: { userId: "user_abc", orgId: null, sessionId: "sess_1", scopes: ["email", "profile"] },
      bearerToken: fakeJwt,
      jwksSource: "https://clerk.example.com/.well-known/jwks.json",
      audienceBound: "https://example.com/mcp",
    });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.authObject).toEqual({
      userId: "user_abc",
      orgId: null,
      sessionId: "sess_1",
      scopes: ["email", "profile"],
    });
    expect(parsed.decodedJwt.header).toEqual({ alg: "RS256", typ: "JWT", kid: "test-kid" });
    expect(parsed.decodedJwt.payload.sub).toBe("user_abc");
    expect(parsed.decodedJwt.payload.aud).toBe("https://example.com/mcp");
    expect(parsed.serverNotes.tokenSurface).toBe("oauth-access-token");
    expect(parsed.serverNotes.audienceBound).toBe("https://example.com/mcp");
  });

  it("handles missing bearer gracefully", () => {
    const result = buildClaimsDumpResponse({
      auth: { userId: "user_abc", orgId: null, sessionId: null, scopes: [] },
      bearerToken: null,
      jwksSource: "https://clerk.example.com/.well-known/jwks.json",
      audienceBound: "https://example.com/mcp",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.decodedJwt).toBeNull();
  });
});
