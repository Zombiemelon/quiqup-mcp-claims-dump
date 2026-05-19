import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import {
  openQuiqupSession,
  closeQuiqupSession,
  getActivePage,
  type QuiqupSession,
} from "../../lib/browserbase/session";
import { ensureLoggedIn } from "../../lib/browserbase/login";

const SHOULD_RUN = process.env.RUN_INTEGRATION === "1";

describe.runIf(SHOULD_RUN)("Quiqdash business portal — login + sidebar smoke", () => {
  let session: QuiqupSession;

  beforeAll(async () => {
    session = await openQuiqupSession({ persist: true });
    await ensureLoggedIn(session);
  }, 120_000);

  afterAll(async () => {
    if (session) await closeQuiqupSession(session);
  });

  it("lands on a non-/login URL after auth", () => {
    const url = getActivePage(session).url();
    expect(url.startsWith(session.baseUrl)).toBe(true);
    expect(url).not.toMatch(/\/login(\b|\/|$)/);
  });

  it("shows the Orders item in the sidebar", async () => {
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
