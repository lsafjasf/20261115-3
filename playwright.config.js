import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  fullyParallel: false,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4190",
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: "npm run dev -- --port 4190",
    url: "http://127.0.0.1:4190",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
