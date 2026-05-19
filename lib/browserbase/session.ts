import { Stagehand } from "@browserbasehq/stagehand";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const QUIQUP_BUSINESS_BASE_URL = "https://business-ae-beta.quiqup.com";

// Local Chrome profile dir — persists cookies/localStorage across runs so the
// Clerk session sticks and we skip the login flow on subsequent invocations.
const LOCAL_USER_DATA_DIR = resolve(process.cwd(), ".stagehand-userdata");

export type QuiqupSession = {
  stagehand: Stagehand;
  baseUrl: string;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export async function openQuiqupSession(opts?: { persist?: boolean }): Promise<QuiqupSession> {
  const anthropicKey = requireEnv("ANTHROPIC_API_KEY_PERSONAL");
  const headless = process.env.STAGEHAND_HEADLESS !== "0";
  const persist = opts?.persist ?? true;

  if (persist) mkdirSync(LOCAL_USER_DATA_DIR, { recursive: true });

  const stagehand = new Stagehand({
    env: "LOCAL",
    localBrowserLaunchOptions: {
      headless,
      viewport: { width: 1366, height: 768 },
      ...(persist ? { userDataDir: LOCAL_USER_DATA_DIR, preserveUserDataDir: true } : {}),
    },
    model: { modelName: "anthropic/claude-sonnet-4-6", apiKey: anthropicKey },
    disableAPI: true,
    verbose: 0,
  });

  await stagehand.init();

  if (!headless) {
    console.log("[stagehand] running locally (visible Chrome)");
  }

  return { stagehand, baseUrl: QUIQUP_BUSINESS_BASE_URL };
}

export function getActivePage(session: QuiqupSession) {
  const page = session.stagehand.context.activePage();
  if (!page) throw new Error("Stagehand has no active page — was init() awaited?");
  return page;
}

export async function closeQuiqupSession(session: QuiqupSession): Promise<void> {
  await session.stagehand.close();
}
