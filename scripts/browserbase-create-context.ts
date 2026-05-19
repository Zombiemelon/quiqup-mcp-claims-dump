/**
 * One-shot CLI to create a fresh Browserbase Context for the Quiqdash V3 session.
 *
 * After running, paste the printed ID into .env.local as QUIQUP_BROWSERBASE_CONTEXT_ID,
 * then run scripts/quiqup-bootstrap-login.ts to seed it with cookies.
 *
 *   bun run scripts/browserbase-create-context.ts
 */
import Browserbase from "@browserbasehq/sdk";

async function main() {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey || !projectId) {
    throw new Error("BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID must be set");
  }
  const bb = new Browserbase({ apiKey });
  const ctx = await bb.contexts.create({ projectId });
  console.log(`QUIQUP_BROWSERBASE_CONTEXT_ID=${ctx.id}`);
}

main().catch((err) => {
  console.error("[create-context] failed:", err);
  process.exit(1);
});
