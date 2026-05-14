/**
 * Online round-trip eval: Claude → POST /orders → verify → cancel.
 *
 * Hits the real Quiqup last-mile staging API at
 * https://api.staging.quiqup.com using OAuth2 client_credentials.
 *
 * NOTE on auth flavour: the deployed MCP server uses V3b Clerk-session-JWT
 * (see lib/quiqup.ts). This eval uses OAuth2 client_credentials directly,
 * the same flavour docs/quiqup-api/scripts/quiqup.sh uses. Quiqup accepts
 * both on the same endpoint, so this validates "Claude's args produce a
 * valid order on staging" — NOT the full MCP HTTP/Clerk pipeline.
 *
 * Env vars (auto-loaded by bun from .env.local):
 *   QUIQUP_STAGING_CLIENT_ID, QUIQUP_STAGING_CLIENT_SECRET
 *     — last-mile-scoped staging client_credentials. If this client is
 *       fulfilment-scoped, the OAuth token call will 401.
 *   QUIQUP_LM_STAGING_BASE_URL (default https://api.staging.quiqup.com)
 *   LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL
 *   ANTHROPIC_API_KEY
 *
 * Run: `bun run eval:lastmile-roundtrip`
 *
 * Cleanup guarantee: try/finally around the create → if anything between
 * create and cancel throws, we still attempt the cancel. Orphaned staging
 * orders are still possible if the cancel itself fails (alert in stdout).
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { LangfuseClient } from "@langfuse/client";
import { AnthropicInstrumentation } from "@arizeai/openinference-instrumentation-anthropic";
import Anthropic from "@anthropic-ai/sdk";
import type { ExperimentTask } from "@langfuse/client";

import { spec as createLastmileOrderSpec } from "@/lib/tools/create-lastmile-order";
import {
  items,
  type RoundtripInput,
  type RoundtripExpected,
} from "./datasets/lastmile-order-roundtrip-v1";

const MODEL = process.env.EVAL_MODEL ?? "claude-sonnet-4-6";
const BASE = process.env.QUIQUP_LM_STAGING_BASE_URL ?? "https://api.staging.quiqup.com";
const CLIENT_ID = process.env.QUIQUP_STAGING_CLIENT_ID;
const CLIENT_SECRET = process.env.QUIQUP_STAGING_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  throw new Error(
    "Missing QUIQUP_STAGING_CLIENT_ID / QUIQUP_STAGING_CLIENT_SECRET. Add " +
      "staging last-mile client_credentials to .env.local. Get them from " +
      "qadmin.quiqup.com/oauth/clients.",
  );
}

const otelSdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()],
  instrumentations: [new AnthropicInstrumentation()],
});
otelSdk.start();

const langfuse = new LangfuseClient();
const anthropic = new Anthropic();

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getStagingToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  const url =
    `${BASE}/oauth/token?grant_type=client_credentials` +
    `&client_id=${encodeURIComponent(CLIENT_ID!)}` +
    `&client_secret=${encodeURIComponent(CLIENT_SECRET!)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) {
    throw new Error(`OAuth token fetch failed: ${res.status} ${await res.text()}`);
  }
  const j = (await res.json()) as { access_token: string; expires_in: number };
  // Refresh 60s before expiry. Staging tokens live 1h.
  cachedToken = { value: j.access_token, expiresAt: Date.now() + (j.expires_in - 60) * 1000 };
  return cachedToken.value;
}

async function apiCall(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const token = await getStagingToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  return { status: res.status, body: parsed };
}

const tool = {
  name: createLastmileOrderSpec.name,
  description: createLastmileOrderSpec.description,
  input_schema: { type: "object" as const, additionalProperties: true },
};

interface TaskOutput {
  toolName: string | null;
  args: Record<string, unknown> | null;
  create: { status: number; body: unknown } | null;
  orderId: number | null;
  postCreateState: string | null;
  cancel: { status: number; body: unknown } | null;
}

const task: ExperimentTask<RoundtripInput, RoundtripExpected> = async (item) => {
  const input = (item as { input?: RoundtripInput }).input;
  const out: TaskOutput = {
    toolName: null,
    args: null,
    create: null,
    orderId: null,
    postCreateState: null,
    cancel: null,
  };
  if (!input?.request) return out;

  // 1) Claude → tool_use
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [tool],
    tool_choice: { type: "any" },
    messages: [
      {
        role: "user",
        content:
          "You are a logistics assistant for a Dubai-based merchant. " +
          "Translate the merchant's request into a create_lastmile_order tool call. " +
          "Use sensible defaults for unspecified fields.\n\n" +
          `Request: ${input.request}`,
      },
    ],
  });
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") return out;
  out.toolName = block.name;
  out.args = block.input as Record<string, unknown>;

  try {
    // 2) POST /orders (real staging hit)
    out.create = await apiCall("POST", "/orders", out.args);
    const createBody = out.create.body as { order?: { id?: number; state?: string }; id?: number };
    out.orderId = createBody?.order?.id ?? createBody?.id ?? null;

    // 3) GET /orders/{id} to confirm state
    if (out.orderId !== null) {
      const getResp = await apiCall("GET", `/orders/${out.orderId}`);
      const getBody = getResp.body as { order?: { state?: string }; state?: string };
      out.postCreateState = getBody?.order?.state ?? getBody?.state ?? null;
    }
  } finally {
    // 4) Always attempt cleanup if we got an order id, even on prior failure.
    if (out.orderId !== null) {
      try {
        out.cancel = await apiCall("PUT", "/orders/batch/set_cancelled", {
          order_ids: [out.orderId],
        });
        if (out.cancel.status < 200 || out.cancel.status >= 300) {
          console.error(
            `⚠️  Failed to cancel order ${out.orderId} on staging (status ${out.cancel.status}). ` +
              `Manually clean up: PUT ${BASE}/orders/batch/set_cancelled body {"order_ids":[${out.orderId}]}`,
          );
        }
      } catch (e) {
        console.error(`⚠️  Cancel threw for order ${out.orderId}:`, e);
      }
    }
  }

  return out;
};

// --- Scorers ---

const isOk = (s: number | undefined) => typeof s === "number" && s >= 200 && s < 300;

const createOk = async ({ output }: { output: TaskOutput }) => {
  const status = output.create?.status;
  return {
    name: "create-2xx",
    value: isOk(status) ? 1 : 0,
    comment: `POST /orders → ${status ?? "<no call>"}`,
  };
};

const ordersLandsPending = async ({ output }: { output: TaskOutput }) => {
  const state = output.postCreateState;
  return {
    name: "order-lands-pending",
    value: state === "pending" ? 1 : 0,
    comment: `state: ${state ?? "<no fetch>"}`,
  };
};

const cancelOk = async ({ output }: { output: TaskOutput }) => {
  const status = output.cancel?.status;
  return {
    name: "cancel-2xx",
    value: isOk(status) ? 1 : 0,
    comment: `PUT /orders/batch/set_cancelled → ${status ?? "<no call>"}`,
  };
};

const result = await langfuse.experiment.run({
  name: `lastmile-order-roundtrip-v1 (${MODEL})`,
  description:
    `Online round-trip eval against ${BASE}. Each item: Claude → POST /orders → ` +
    "GET /orders/{id} → PUT /orders/batch/set_cancelled. " +
    "Auth: OAuth2 client_credentials (NOT the V3b Clerk JWT flow the MCP uses).",
  data: items,
  task,
  evaluators: [createOk, ordersLandsPending, cancelOk],
});

console.log(await result.format());

await langfuse.shutdown();
await otelSdk.shutdown();

// CI gate (opt-in via EVAL_GATE=1; no-op locally).
if (process.env.EVAL_GATE === "1") {
  const { gate } = await import("./gate");
  gate(result, [{ scoreName: "create-2xx", min: 1.0 }]);
}
