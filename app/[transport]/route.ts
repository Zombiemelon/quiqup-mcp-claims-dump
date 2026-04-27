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
