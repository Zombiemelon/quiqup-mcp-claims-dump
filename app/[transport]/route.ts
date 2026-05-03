import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { auth } from "@clerk/nextjs/server";
import { registerClaimsDump } from "@/lib/tools/claims-dump";
import { registerRecentOrders } from "@/lib/tools/recent-orders";
import { registerTool } from "@/lib/tools/register";
import { spec as getLastmileOrderSpec } from "@/lib/tools/get-lastmile-order";

const handler = createMcpHandler(
  (server) => {
    // Legacy tools — keep their own register*() functions per M1 audit.
    // Diagnostic — returns the decoded inbound Clerk JWT.
    registerClaimsDump(server);
    // Real data — proxies to Quiqup last-mile API via this server's own
    // OAuth2 client (BFF pattern, see lib/quiqup.ts for the why).
    registerRecentOrders(server);
    // M2-and-later tools — register through the typed wrapper so M4
    // can layer guardrails (output-size, redact, scope, rate-limit,
    // audit) without rewiring per-tool callsites.
    registerTool(server, getLastmileOrderSpec);
  },
  {},
  { basePath: "" },
);

const authHandler = withMcpAuth(
  handler,
  async (_req, bearerToken) => {
    if (!bearerToken) return undefined;

    const clerkAuth = await auth({ acceptsToken: "oauth_token" });
    if (!clerkAuth?.subject) return undefined;

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
