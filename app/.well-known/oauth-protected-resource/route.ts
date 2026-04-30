import {
  generateClerkProtectedResourceMetadata,
  corsHeaders,
} from "@clerk/mcp-tools/server";
import { metadataCorsOptionsRequestHandler } from "@clerk/mcp-tools/next";

// Per MCP authorization spec, `resource` MUST be the canonical URL of the MCP
// endpoint *including the path* (e.g. https://example.com/mcp), not just the
// origin. The default `protectedResourceHandlerClerk` auto-derives from the
// request URL hitting /.well-known/... and emits the origin only — which causes
// an `aud` mismatch when the MCP client uses that as the resource indicator.
const RESOURCE_URL = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/mcp`;

export function GET() {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!publishableKey) {
    return new Response(
      JSON.stringify({ error: "missing NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const metadata = generateClerkProtectedResourceMetadata({
    publishableKey,
    resourceUrl: RESOURCE_URL,
    properties: { scopes_supported: ["email", "profile"] },
  });

  return new Response(JSON.stringify(metadata), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
