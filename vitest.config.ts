import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup/msw.ts"],
  },
  resolve: {
    alias: { "@": new URL("./", import.meta.url).pathname },
  },
});
