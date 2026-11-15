import { defineConfig } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "./tests",
  timeout: 45_000,
  fullyParallel: false,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4290",
    viewport: { width: 1440, height: 900 },
    headless: true,
    launchOptions: {
      args: ["--use-angle=swiftshader", "--enable-webgl"],
      ...(executablePath ? { executablePath } : {}),
    },
  },
  webServer: {
    command: "PORT=4290 node scripts/serve.mjs",
    url: "http://127.0.0.1:4290",
    reuseExistingServer: true,
    timeout: 15_000,
  },
});
