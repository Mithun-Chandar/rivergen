import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
    reporters: ["verbose"],
    testTimeout: 30_000,
    hookTimeout: 20_000,
    coverage: {
      provider: "v8",
      include: ["*.ts", "gates/**/*.ts", "templates/**/*.ts"],
      exclude: ["bin/**", "gates/layer3-worker.ts", "vitest.config.ts"],
      thresholds: { lines: 70, functions: 70 },
    },
  },
});
