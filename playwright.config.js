// @ts-check
import { defineConfig } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

// Some environments pre-install a Chromium revision at PLAYWRIGHT_BROWSERS_PATH
// that may not match the revision this @playwright/test version expects by
// default, and disables the postinstall download
// (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1). Resolve whatever chromium-* revision
// is actually on disk there instead of hardcoding one. CI runners without
// PLAYWRIGHT_BROWSERS_PATH set fall back to Playwright's normal resolution
// (after `npx playwright install`).
function findLocalChromiumExecutable() {
  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!browsersPath || !existsSync(browsersPath)) return undefined;
  const candidates = readdirSync(browsersPath).filter((name) => name.startsWith("chromium-"));
  for (const dir of candidates) {
    const exe = path.join(browsersPath, dir, "chrome-linux", "chrome");
    if (existsSync(exe)) return exe;
  }
  return undefined;
}

const localExecutablePath = findLocalChromiumExecutable();

export default defineConfig({
  testDir: "./tests",
  testMatch: /.*\.spec\.js/,
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    screenshot: "only-on-failure",
    ...(localExecutablePath ? { launchOptions: { executablePath: localExecutablePath } } : {}),
  },
});
