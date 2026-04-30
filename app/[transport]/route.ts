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

const authHandler = withMcpAuth(
  handler,
  async (req, bearerToken) => {
    console.log("[mcp-auth] verify start", {
      url: req.url,
      hasBearer: !!bearerToken,
      bearerPreview: bearerToken ? `${bearerToken.slice(0, 24)}...${bearerToken.slice(-12)}` : null,
    });

    if (!bearerToken) {
      console.log("[mcp-auth] no bearer, rejecting");
      return undefined;
    }

    // Decode payload for diagnostics (signature NOT verified here; auth() does that)
    try {
      const [, payloadB64] = bearerToken.split(".");
      if (payloadB64) {
        const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
        console.log("[mcp-auth] token payload", {
          iss: payload.iss,
          aud: payload.aud,
          azp: payload.azp,
          sub: payload.sub,
          exp: payload.exp,
          scope: payload.scope,
        });
      }
    } catch (e) {
      console.log("[mcp-auth] failed to decode payload", e);
    }

    let clerkAuth;
    try {
      clerkAuth = await auth({ acceptsToken: "oauth_token" });
      console.log("[mcp-auth] auth() returned", {
        hasSubject: !!clerkAuth?.subject,
        subject: clerkAuth?.subject,
        clientId: clerkAuth?.clientId,
        scopes: clerkAuth?.scopes,
      });
    } catch (e) {
      console.log("[mcp-auth] auth() threw", e);
      return undefined;
    }

    if (!clerkAuth?.subject) {
      console.log("[mcp-auth] no subject, rejecting");
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
