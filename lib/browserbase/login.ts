import { getActivePage, type QuiqupSession } from "./session";

const LOGIN_PATH = "/login";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export async function isLoggedIn(session: QuiqupSession): Promise<boolean> {
  // This app renders the login form at / (no URL change) when unauthenticated,
  // so the URL is a useless signal. Cookies are definitive: a Clerk-issued
  // __session cookie on the app's domain means we have an active session.
  const cookies = await session.stagehand.context.cookies(session.baseUrl);
  return cookies.some((c) => c.name === "__session" && c.value.length > 0);
}

export async function loginToQuiqdash(session: QuiqupSession): Promise<void> {
  const email = requireEnv("QUIQUP_BUSINESS_EMAIL");
  const password = requireEnv("QUIQUP_BUSINESS_PASSWORD");
  const page = getActivePage(session);

  await page.goto(session.baseUrl + LOGIN_PATH, { waitUntil: "networkidle" });

  await session.stagehand.act("Type %email% into the email address field", {
    variables: { email },
  });
  await session.stagehand.act("Click the Continue button");

  // Clerk swaps the password field in after the email step settles.
  await new Promise((r) => setTimeout(r, 2_000));

  await session.stagehand.act("Type %password% into the password field", {
    variables: { password },
  });
  await session.stagehand.act("Click the Continue button to submit the password");

  // Wait for the post-submit redirect + cookie to land.
  await new Promise((r) => setTimeout(r, 3_000));
}

export async function ensureLoggedIn(session: QuiqupSession): Promise<void> {
  if (await isLoggedIn(session)) return;
  await loginToQuiqdash(session);
}
