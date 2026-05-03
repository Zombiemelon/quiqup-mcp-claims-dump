import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";

// Empty server — handlers added per-test via server.use(...).
//
// onUnhandledRequest: "error" is deliberate: any test that makes a real fetch
// without a stub fails loudly instead of silently hitting the network. This is
// what enforces the "msw at fetch (seam 3)" decision documented in
// wiki/concepts/general/mcp-tdd-test-seams.md.
export const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
