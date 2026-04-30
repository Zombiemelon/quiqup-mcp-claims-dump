import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { auth } from "@clerk/nextjs/server";
import { registerClaimsDump } from "@/lib/tools/claims-dump";

const handler = createMcpHandler(
  (server) => {
    registerClaimsDump(server);
  },
  {},
  { basePath: "" },
);

// Log prefixes are kept short (≤24 chars) so the diagnostic value lands in
// Vercel's truncated log table column.
const authHandler = withMcpAuth(
  handler,
  async (req, bearerToken) => {
    console.log("[A1-url]", req.url);
    console.log("[A2-bearer]", bearerToken ? `len=${bearerToken.length} head=${bearerToken.slice(0, 16)}` : "missing");

    if (!bearerToken) {
      console.log("[A3-reject] no bearer");
      return undefined;
    }

    try {
      const [, payloadB64] = bearerToken.split(".");
      if (payloadB64) {
        const p = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
        console.log("[A4-aud]", JSON.stringify(p.aud));
        console.log("[A5-iss]", String(p.iss));
        console.log("[A6-sub]", String(p.sub));
        console.log("[A7-azp]", String(p.azp));
        console.log("[A8-scope]", String(p.scope));
        console.log("[A9-exp]", String(p.exp));
      }
    } catch (e) {
      console.log("[A10-decode-err]", String(e));
    }

    let clerkAuth;
    try {
      clerkAuth = await auth({ acceptsToken: "oauth_token" });
      console.log("[B1-auth-subject]", String(clerkAuth?.subject ?? "null"));
      console.log("[B2-auth-clientId]", String(clerkAuth?.clientId ?? "null"));
      console.log("[B3-auth-scopes]", JSON.stringify(clerkAuth?.scopes ?? null));
    } catch (e) {
      console.log("[B4-auth-threw]", String(e));
      return undefined;
    }

    if (!clerkAuth?.subject) {
      console.log("[B5-reject] no subject");
      return undefined;
    }
    return {
      token: bearerToken,
      clientId: clerkAuth.clientId ?? "",
      scopes: clerkAuth.scopes ?? [],
      extra: { clerkAuth },
    };
  },
  {
    required: true,
    resourceMetadataPath: "/.well-known/oauth-protected-resource",
  },
);

export { authHandler as GET, authHandler as POST };
