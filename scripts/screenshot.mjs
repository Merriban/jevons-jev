// Produces docs/screenshots/desktop.png and docs/screenshots/mobile.png from
// the built dist/index.html, for README.md and check F.17.
import { chromium } from "@playwright/test";
import { existsSync, readdirSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const distPath = path.join(root, "dist", "index.html");
const outDir = path.join(root, "docs", "screenshots");
mkdirSync(outDir, { recursive: true });

function findLocalChromiumExecutable() {
  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!browsersPath || !existsSync(browsersPath)) return undefined;
  for (const dir of readdirSync(browsersPath).filter((n) => n.startsWith("chromium-"))) {
    const exe = path.join(browsersPath, dir, "chrome-linux", "chrome");
    if (existsSync(exe)) return exe;
  }
  return undefined;
}

const executablePath = findLocalChromiumExecutable();
const browser = await chromium.launch(executablePath ? { executablePath } : {});

const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await desktop.goto(`file://${distPath}`);
await desktop.waitForTimeout(500);
await desktop.screenshot({ path: path.join(outDir, "desktop.png"), fullPage: true });

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.goto(`file://${distPath}`);
await mobile.waitForTimeout(500);
await mobile.screenshot({ path: path.join(outDir, "mobile.png"), fullPage: true });

await browser.close();
console.log("Screenshots written to", outDir);
