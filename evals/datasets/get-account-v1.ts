/**
 * get-account-v1 — first eval dataset for the Phase-1 Platform-read family.
 *
 * Each item: a natural-language merchant question + a hand-authored canonical
 * Platform-read tool call. Scored by ../score-get-account.ts.
 *
 * The dataset deliberately spans the read substrate's disambiguation surface
 * (get_account vs whoami_platform vs get_account_by_id vs
 * get_account_capabilities vs list_account_addresses). The "is auth working"
 * prompt anchors the contrast case: it MUST route to whoami_platform, not to
 * get_account, otherwise the recent disambiguation language in
 * get_account.ts has regressed.
 *
 * No real PII / no real Salesforce ids. The single SFID-style prompt uses
 * the literal placeholder "003ABC123" (matches the threat-model T-01-23
 * mitigation in 01-04-PLAN.md).
 *
 * Tool-side reference (lib/tools/*.ts):
 *   get_account                — { environment? }
 *   get_permissions            — { environment? }
 *   get_account_capabilities   — { id?: "me" | <sfid>, environment? }
 *   get_account_by_id          — { id: <sfid>, environment? }
 *   list_account_addresses     — { id?: "me" | <sfid>, environment? }
 *   whoami_platform            — { environment? }
 */

export const TODAY = "2026-05-19";

export interface GetAccountInput {
  request: string;
}

export interface GetAccountExpected {
  tool:
    | "get_account"
    | "get_permissions"
    | "get_account_capabilities"
    | "get_account_by_id"
    | "list_account_addresses"
    | "whoami_platform";
  args: Record<string, unknown>;
}

export interface GetAccountItem {
  input: GetAccountInput;
  expectedOutput: GetAccountExpected;
}

export const items: GetAccountItem[] = [
  {
    input: { request: "Show me my account profile." },
    expectedOutput: {
      tool: "get_account",
      args: {},
    },
  },
  {
    input: { request: "What permissions do I have on this account?" },
    expectedOutput: {
      tool: "get_permissions",
      args: {},
    },
  },
  {
    input: {
      request:
        "What can my account do? Is fulfillment enabled? Is WMS set up yet?",
    },
    expectedOutput: {
      tool: "get_account_capabilities",
      // `id` defaults to "me" in the production schema — passing it
      // explicitly is redundant, and the LLM correctly omits it when the
      // prompt doesn't demand a non-default id. Asserting {} here scores
      // the behavior we actually want, not an over-prescriptive contract.
      args: {},
    },
  },
  {
    input: { request: "List my warehouse addresses." },
    expectedOutput: {
      tool: "list_account_addresses",
      // Same default-behaviour relaxation as above (`id` defaults to "me").
      args: {},
    },
  },
  {
    input: { request: "What's my account's service offering?" },
    expectedOutput: {
      tool: "get_account",
      args: {},
    },
  },
  {
    input: {
      request: "Look up the account with salesforce id 003ABC123.",
    },
    expectedOutput: {
      tool: "get_account_by_id",
      args: { id: "003ABC123" },
    },
  },
  {
    input: {
      request:
        "Is my auth actually working against the platform API? I just want to confirm the JWT resolves.",
    },
    expectedOutput: {
      tool: "whoami_platform",
      args: {},
    },
  },
];
