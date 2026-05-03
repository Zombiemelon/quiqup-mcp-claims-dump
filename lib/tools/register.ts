import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";

/**
 * Flat auth context exposed to tool handlers. Built from `extra.authInfo`
 * by the registerTool wrapper so handlers don't have to redo the
 * Clerk-specific extraction every time.
 */
export interface AuthContext {
  userId: string | null;
  orgId: string | null;
  sessionId: string | null;
  scopes: string[];
  bearerToken: string | null;
}

/**
 * Typed tool specification. New tools export a `spec` of this shape and
 * register through `registerTool(server, spec)`. The wrapper is the
 * single chokepoint M4 will layer guardrails into (output-size,
 * error-shape, redact, scope, rate-limit, audit). At M2 it's a thin
 * pass-through plus auth extraction.
 *
 * Output schema is carried on the spec for tests (e.g. asserting cassette
 * shape conformance via `spec.outputSchema.safeParse(cassette)`) but the
 * wrapper does NOT enforce it at runtime in M2 — M4 adds enforcement.
 */
export interface ToolSpec<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TInput extends z.ZodObject<any>,
  TOutput extends z.ZodTypeAny,
> {
  name: string;
  description: string;
  inputSchema: TInput;
  outputSchema: TOutput;
  handler: (
    auth: AuthContext,
    args: z.infer<TInput>,
  ) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
}

export function registerTool<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TIn extends z.ZodObject<any>,
  TOut extends z.ZodTypeAny,
>(server: McpServer, spec: ToolSpec<TIn, TOut>): void {
  server.registerTool(
    spec.name,
    {
      title: spec.name,
      description: spec.description,
      // The SDK expects a raw {field: ZodType} shape map, not a wrapped
      // z.object(...). We carry the wrapped form on the spec for ergonomic
      // .safeParse() in tests; .shape unwraps it for the SDK.
      inputSchema: spec.inputSchema.shape,
    },
    async (
      args: Record<string, unknown>,
      extra: {
        authInfo?: {
          token?: string | null;
          scopes?: string[];
          extra?: unknown;
        };
      },
    ) => {
      const authInfo = extra.authInfo;
      const clerkAuth = (
        authInfo?.extra as
          | {
              clerkAuth?: {
                subject?: string;
                orgId?: string | null;
                sessionId?: string | null;
                scopes?: string[];
              };
            }
          | undefined
      )?.clerkAuth;

      const auth: AuthContext = {
        userId: clerkAuth?.subject ?? null,
        orgId: clerkAuth?.orgId ?? null,
        sessionId: clerkAuth?.sessionId ?? null,
        scopes: clerkAuth?.scopes ?? authInfo?.scopes ?? [],
        bearerToken: authInfo?.token ?? null,
      };

      return spec.handler(auth, args as z.infer<TIn>);
    },
  );
}
