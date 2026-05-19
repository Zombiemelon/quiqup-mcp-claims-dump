/**
 * Drives the Quiqdash orders page, applies the "Pending" status filter, and
 * captures every fetch/XHR triggered during that flow. Emits curl commands
 * for each captured request so you can replay them offline.
 *
 *   pnpm inspect:orders-filter
 *
 * Requires ANTHROPIC_API_KEY_PERSONAL + QUIQUP_BUSINESS_EMAIL/PASSWORD in env.
 * Cookies persist in .stagehand-userdata/ so re-runs skip the login.
 */
import { openQuiqupSession, getActivePage, closeQuiqupSession } from "../lib/browserbase/session";
import { ensureLoggedIn } from "../lib/browserbase/login";

type CapturedRequest = {
  kind: "fetch" | "xhr";
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
  status: number;
  durationMs: number;
  phase: string;
};

const INIT_SCRIPT = `
(() => {
  if (window.__netCaptureInstalled) return;
  window.__netCaptureInstalled = true;

  const log = (data) => {
    try { console.log("[NET] " + JSON.stringify(data)); } catch (_) {}
  };

  const origFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const req = new Request(input, init);
    const headers = {};
    req.headers.forEach((v, k) => { headers[k] = v; });
    let body = null;
    if (init && init.body != null) {
      body = typeof init.body === "string" ? init.body : "[non-string body: " + Object.prototype.toString.call(init.body) + "]";
    }
    const t0 = performance.now();
    let status = 0;
    try {
      const res = await origFetch(input, init);
      status = res.status;
      return res;
    } finally {
      log({ kind: "fetch", method: req.method, url: req.url, headers, body, status, durationMs: Math.round(performance.now() - t0) });
    }
  };

  const OrigXHR = window.XMLHttpRequest;
  function PatchedXHR() {
    const xhr = new OrigXHR();
    let method = "GET";
    let url = "";
    let headers = {};
    let body = null;
    let t0 = 0;
    const origOpen = xhr.open;
    xhr.open = function (m, u) { method = m; url = u; return origOpen.apply(xhr, arguments); };
    const origSetHeader = xhr.setRequestHeader;
    xhr.setRequestHeader = function (k, v) { headers[k] = v; return origSetHeader.apply(xhr, arguments); };
    const origSend = xhr.send;
    xhr.send = function (b) {
      body = typeof b === "string" ? b : (b == null ? null : "[non-string body]");
      t0 = performance.now();
      xhr.addEventListener("loadend", () => {
        log({ kind: "xhr", method, url, headers, body, status: xhr.status, durationMs: Math.round(performance.now() - t0) });
      });
      return origSend.apply(xhr, arguments);
    };
    return xhr;
  }
  PatchedXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = PatchedXHR;
})();
`;

function toCurl(r: CapturedRequest): string {
  const parts = [`curl -X ${r.method} '${r.url}'`];
  for (const [k, v] of Object.entries(r.headers)) {
    // Skip headers the browser sets that curl would otherwise duplicate or that
    // are dynamic/internal.
    if (/^(host|content-length|connection|accept-encoding)$/i.test(k)) continue;
    parts.push(`  -H '${k}: ${v.replace(/'/g, "'\\''")}'`);
  }
  if (r.body) {
    parts.push(`  --data-raw '${r.body.replace(/'/g, "'\\''")}'`);
  }
  return parts.join(" \\\n");
}

async function main() {
  const session = await openQuiqupSession({ persist: true });
  const page = getActivePage(session);

  const captured: CapturedRequest[] = [];
  let phase = "init";

  page.on("console", (msg) => {
    const text = msg.text();
    if (!text.startsWith("[NET] ")) return;
    try {
      const data = JSON.parse(text.slice("[NET] ".length));
      captured.push({ ...data, phase });
    } catch {
      // ignore malformed lines
    }
  });

  await page.addInitScript(INIT_SCRIPT);

  // Make sure we're authenticated.
  await ensureLoggedIn(session);

  // Step 1: navigate to dashboard, let it hydrate.
  phase = "dashboard";
  await page.goto(session.baseUrl + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3_000);

  // Step 2: open Orders page.
  phase = "open-orders";
  console.log("\n[script] clicking the Orders nav item...");
  await session.stagehand.act("Click the 'Orders' item in the left-hand sidebar navigation");
  await page.waitForTimeout(3_000);
  console.log("[script] orders url:", page.url());

  // Snapshot the open-orders boundary.
  const afterOpenOrders = captured.length;

  // Step 3a: see what filters actually exist on this page.
  console.log("\n[script] observing available filters...");
  const observed = await session.stagehand.observe(
    "Find every filter, dropdown, toggle, chip, or button on this orders page that lets the user filter orders by their status or state.",
  );
  console.log("[script] candidates found:", JSON.stringify(observed, null, 2).slice(0, 1500));

  // Step 3b: apply the "Pending" status filter.
  phase = "apply-filter";
  console.log("\n[script] applying the Pending status filter...");
  await session.stagehand.act(
    "Open the order status filter dropdown (or whatever control filters by status/state) and select only 'Pending'. If 'Pending' is not literally listed, pick the value that maps to a not-yet-collected / awaiting-courier state (commonly called Submitted, Pending, or Awaiting). Make sure the filter is actually applied — close the dropdown or click the apply button if there is one.",
  );
  await page.waitForTimeout(5_000);

  // Step 4: report — per phase, with API-only curl dumps.
  const openOrdersRequests = captured.slice(0, afterOpenOrders);
  const filterRequests = captured.slice(afterOpenOrders);

  const isAPI = (r: CapturedRequest) =>
    !/\.(js|css|woff2?|png|jpg|jpeg|svg|gif|ico|map)(\?|$)/.test(r.url) &&
    !/^data:/.test(r.url) &&
    !/clerk\.|clarity\.ms|telemetry|sentry|launchdarkly|hotjar|datadog|amplitude|google|gstatic/.test(r.url);

  const renderSection = (title: string, requests: CapturedRequest[]) => {
    const api = requests.filter(isAPI);
    console.log(`\n=== ${title} — ${requests.length} requests (${api.length} API) ===`);
    for (const r of api) {
      console.log(`\n# [${r.phase}] ${r.method} ${r.url} → ${r.status} (${r.durationMs}ms)`);
      console.log(toCurl(r));
    }
    console.log(`\n--- all urls in ${title} ---`);
    for (const r of requests) {
      console.log(`  ${r.method.padEnd(6)} ${String(r.status || "?").padStart(3)} ${r.url}`);
    }
  };

  renderSection("OPEN ORDERS PAGE", openOrdersRequests);
  renderSection("APPLY PENDING FILTER", filterRequests);

  // Diff: did the apply-filter phase change the GraphQL `where` payload?
  const graphqlAll = captured.filter((r) => r.url.endsWith("/graph") && r.body);
  console.log(`\n=== GraphQL /graph "where" payloads (${graphqlAll.length}) ===`);
  for (const r of graphqlAll) {
    try {
      const parsed = JSON.parse(r.body!);
      console.log(`[${r.phase}] where =`, JSON.stringify(parsed.variables?.where));
    } catch {
      console.log(`[${r.phase}] (unparseable body)`);
    }
  }

  await closeQuiqupSession(session);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
