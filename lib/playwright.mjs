import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { CHROME_PATH, TNYMA_ROOT } from './config.mjs';

const require = createRequire(import.meta.url);
let playwrightModule = null;

function createProjectRequire() {
  return createRequire(path.join(TNYMA_ROOT, 'package.json'));
}

export function resolveChromePath() {
  if (!fs.existsSync(CHROME_PATH)) {
    throw new Error(`Chrome executable not found: ${CHROME_PATH}`);
  }
  return CHROME_PATH;
}

export function getPlaywright() {
  if (playwrightModule) {
    return playwrightModule;
  }

  const projectRequire = createProjectRequire();
  const packagePath = projectRequire.resolve('playwright-core/package.json');
  playwrightModule = require(path.join(path.dirname(packagePath), 'index.js'));
  return playwrightModule;
}

export async function launchBrowser() {
  const { chromium } = getPlaywright();
  return await chromium.launch({
    executablePath: resolveChromePath(),
    headless: process.env.SHOW_BROWSER !== '1',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
}
