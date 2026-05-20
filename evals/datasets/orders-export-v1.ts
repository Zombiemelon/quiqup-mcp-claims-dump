/**
 * orders-export-v1 — first eval dataset for the Phase-3 Ex-core family
 * (download_orders_export).
 *
 * Each item: a natural-language merchant question + the canonical
 * Phase-3 Ex-core tool call. Scored by ../score-orders-export.ts.
 *
 * The family currently has one tool — download_orders_export — which
 * returns the canonical binary envelope { contentType, base64,
 * filenameHint } that Phase 5 (PDF labels), Phase 7 (inventory CSV),
 * and Phase 10 (Zoho PDFs) will all reuse.
 *
 * Date format: the upstream uses yyyy-mm-dd, NOT full ISO-8601
 * (source-doc §19 H line 4720). The dataset exclusively uses yyyy-mm-dd
 * so the args-overlap scorer rewards correct formatting.
 *
 * Tool-side reference (lib/tools/download-orders-export.ts):
 *   download_orders_export — { from, to, order_ids?, per_page?, environment? }
 */

export const TODAY = "2026-05-19";

export interface OrdersExportInput {
  request: string;
}

export interface OrdersExportExpected {
  tool: "download_orders_export";
  args: Record<string, unknown>;
}

export interface OrdersExportItem {
  input: OrdersExportInput;
  expectedOutput: OrdersExportExpected;
}

export const items: OrdersExportItem[] = [
  {
    input: {
      request:
        "Download the orders CSV for the last 7 days (2026-05-13 through 2026-05-19).",
    },
    expectedOutput: {
      tool: "download_orders_export",
      args: { from: "2026-05-13", to: "2026-05-19" },
    },
  },
  {
    input: {
      request: "Export orders 12345 and 12346 as CSV for 2026-05-19.",
    },
    expectedOutput: {
      tool: "download_orders_export",
      args: {
        from: "2026-05-19",
        to: "2026-05-19",
        order_ids: [12345, 12346],
      },
    },
  },
  {
    input: {
      request:
        "I want a CSV of every order from 2026-04-01 through 2026-05-19, 5000 rows per page.",
    },
    expectedOutput: {
      tool: "download_orders_export",
      args: {
        from: "2026-04-01",
        to: "2026-05-19",
        per_page: 5000,
      },
    },
  },
  {
    input: {
      request:
        "Give me an orders CSV for 2026-05-01 to 2026-05-19, but only for order_id 9999.",
    },
    expectedOutput: {
      tool: "download_orders_export",
      args: {
        from: "2026-05-01",
        to: "2026-05-19",
        order_ids: [9999],
      },
    },
  },
  {
    input: {
      request:
        "CSV export of yesterday's orders please — date is 2026-05-18.",
    },
    expectedOutput: {
      tool: "download_orders_export",
      args: { from: "2026-05-18", to: "2026-05-18" },
    },
  },
];
