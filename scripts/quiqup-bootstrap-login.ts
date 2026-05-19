/**
 * One-shot CLI to seed (or re-seed) the Browserbase Context with a Quiqdash V3 session.
 *
 * Run after creating the context and filling in QUIQUP_BUSINESS_EMAIL / PASSWORD.
 * Subsequent runs of `openQuiqupSession()` reuse the persisted cookies and skip login.
 *
 *   bun run scripts/quiqup-bootstrap-login.ts
 */
import { openQuiqupSession, closeQuiqupSession, getActivePage } from "../lib/browserbase/session";
import { ensureLoggedIn, isLoggedIn } from "../lib/browserbase/login";

async function main() {
  const session = await openQuiqupSession({ persist: true });
  try {
    const wasLoggedIn = await isLoggedIn(session);
    console.log(`[bootstrap] initial state: ${wasLoggedIn ? "already logged in" : "signed out"}`);
    await ensureLoggedIn(session);
    console.log(`[bootstrap] final URL: ${getActivePage(session).url()}`);
    console.log("[bootstrap] success — cookies will persist on session close");
  } finally {
    await closeQuiqupSession(session);
  }
}

main().catch((err) => {
  console.error("[bootstrap] failed:", err);
  process.exit(1);
});
