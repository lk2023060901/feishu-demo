import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { resolveChromeExecutablePath, resolvePackageFile } from './runtime-deps.mjs';

const require = createRequire(import.meta.url);
let playwrightModule = null;

export function resolveChromePath() {
  const executablePath = resolveChromeExecutablePath();
  if (!executablePath || !fs.existsSync(executablePath)) {
    return '';
  }
  return executablePath;
}

export function getPlaywright() {
  if (playwrightModule) {
    return playwrightModule;
  }

  const packagePath = resolvePackageFile('playwright-core/package.json');
  playwrightModule = require(path.join(path.dirname(packagePath), 'index.js'));
  return playwrightModule;
}

export async function launchBrowser() {
  const { chromium } = getPlaywright();
  const executablePath = resolveChromePath();
  const args = [
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
  ];

  if (process.env.CHROME_NO_SANDBOX === '1') {
    args.push('--no-sandbox', '--disable-setuid-sandbox');
  }

  const launchOptions = {
    headless: process.env.SHOW_BROWSER !== '1',
    args,
  };

  if (executablePath) {
    launchOptions.executablePath = executablePath;
  } else {
    launchOptions.channel = 'chrome';
  }

  try {
    return await chromium.launch(launchOptions);
  } catch (error) {
    if (!executablePath) {
      throw new Error(
        'Failed to launch Chromium. Install Chrome/Chromium locally or set CHROME_PATH/BROWSER_PATH to the browser executable.',
        { cause: error },
      );
    }
    throw error;
  }
}
