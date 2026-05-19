import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import { server } from "../setup/msw";
import {
  openQuiqupSession,
  closeQuiqupSession,
  getActivePage,
  type QuiqupSession,
} from "../../lib/browserbase/session";
import { ensureLoggedIn, isLoggedIn } from "../../lib/browserbase/login";

const SHOULD_RUN = process.env.RUN_INTEGRATION === "1";

describe.runIf(SHOULD_RUN)("Quiqdash business portal — login + sidebar smoke", () => {
  let session: QuiqupSession;

  beforeAll(async () => {
    // MSW's global "onUnhandledRequest: error" would block real Stagehand/Browserbase
    // traffic. This is the one test family that legitimately needs the live network.
    server.close();

    session = await openQuiqupSession({ persist: true });
    await ensureLoggedIn(session);
  }, 120_000);

  afterAll(async () => {
    if (session) await closeQuiqupSession(session);
    server.listen({ onUnhandledRequest: "error" });
  });

  it("has an active Clerk session cookie", async () => {
    expect(await isLoggedIn(session)).toBe(true);
  });

  it("shows the Orders item in the sidebar", async () => {
    const page = getActivePage(session);
    // Dashboard opens long-poll / SSE connections, so networkidle never settles.
    // Wait just for DOM, then give React a beat to hydrate the sidebar.
    await page.goto(session.baseUrl + "/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3_000);

    const result = await session.stagehand.extract(
      "Look at the left-hand sidebar navigation. Is there a menu item labelled exactly 'Orders'? Return ordersVisible=true only if you can see that specific item; otherwise false.",
      z.object({
        ordersVisible: z.boolean(),
        sidebarItems: z.array(z.string()).describe("Every visible nav label, in order"),
      }),
    );

    expect(result.ordersVisible).toBe(true);
    expect(result.sidebarItems).toEqual(expect.arrayContaining(["Orders"]));
  }, 60_000);
});
