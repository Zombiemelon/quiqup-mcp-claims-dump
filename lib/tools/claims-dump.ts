import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClerkIssuerUrl } from "@/lib/auth";

interface AuthObject {
  userId: string | null;
  orgId: string | null;
  sessionId: string | null;
  scopes: string[];
}

interface BuildArgs {
  auth: AuthObject;
  bearerToken: string | null;
  jwksSource: string;
  audienceBound: string;
}

export function buildClaimsDumpResponse(args: BuildArgs) {
  let decodedJwt: { header: unknown; payload: unknown } | null = null;
  if (args.bearerToken) {
    const [headerB64, payloadB64] = args.bearerToken.split(".");
    if (headerB64 && payloadB64) {
      decodedJwt = {
        header: JSON.parse(Buffer.from(headerB64, "base64url").toString("utf-8")),
        payload: JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8")),
      };
    }
  }

  const body = {
    authObject: args.auth,
    decodedJwt,
    serverNotes: {
      tokenSurface: "oauth-access-token",
      jwksSource: args.jwksSource,
      audienceBound: args.audienceBound,
    },
  };

  return {
    content: [
      { type: "text" as const, text: JSON.stringify(body, null, 2) },
    ],
  };
}

export function registerClaimsDump(server: McpServer): void {
  server.registerTool(
    "claims_dump",
    {
      title: "Claims Dump",
      description: "Returns the authenticated user's ID and full decoded JWT claims. Diagnostic tool for understanding what an OAuth access token from this server actually contains.",
      inputSchema: {},
    },
    async (_args, extra) => {
      const authInfo = extra.authInfo;
      const clerkAuth = (authInfo?.extra as { clerkAuth?: { subject?: string; orgId?: string | null; sessionId?: string | null; scopes?: string[] } } | undefined)?.clerkAuth;

      const auth: AuthObject = {
        userId: clerkAuth?.subject ?? null,
        orgId: clerkAuth?.orgId ?? null,
        sessionId: clerkAuth?.sessionId ?? null,
        scopes: clerkAuth?.scopes ?? authInfo?.scopes ?? [],
      };

      const bearerToken = authInfo?.token ?? null;

      const audienceBound = process.env.NEXT_PUBLIC_APP_URL
        ? `${process.env.NEXT_PUBLIC_APP_URL}/mcp`
        : "<unset>";

      let jwksSource = "<unset>";
      try {
        jwksSource = `${getClerkIssuerUrl()}/.well-known/jwks.json`;
      } catch {
        // env not configured; leave as <unset>
      }

      return buildClaimsDumpResponse({ auth, bearerToken, jwksSource, audienceBound });
    },
  );
}
