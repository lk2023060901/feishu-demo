import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT_DIR } from './config.mjs';

const localRequire = createRequire(import.meta.url);

function uniquePush(list, value) {
  if (!value) {
    return;
  }
  const resolved = path.resolve(value);
  if (!list.includes(resolved)) {
    list.push(resolved);
  }
}

function collectCandidateRoots() {
  const roots = [];
  uniquePush(roots, ROOT_DIR);
  uniquePush(roots, process.cwd());
  uniquePush(roots, process.env.RUNTIME_DEPS_ROOT);
  uniquePush(roots, process.env.TNYMA_ROOT);

  for (const base of [ROOT_DIR, process.cwd()]) {
    uniquePush(roots, path.join(base, '..', 'tnyma-ai-installer'));
    uniquePush(roots, path.join(base, '..', '..', 'tnyma-ai-installer'));
  }

  return roots.filter((root) => fs.existsSync(root));
}

function collectCandidateRequires() {
  const requires = [localRequire];

  for (const root of collectCandidateRoots()) {
    const packageJsonPath = path.join(root, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      continue;
    }

    try {
      requires.push(createRequire(packageJsonPath));
    } catch {
      // Ignore invalid package roots and keep searching.
    }
  }

  return requires;
}

export function resolvePackageFile(specifier) {
  for (const runtimeRequire of collectCandidateRequires()) {
    try {
      return runtimeRequire.resolve(specifier);
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(
    `Cannot find module '${specifier}'. Install dependencies in this project or set TNYMA_ROOT/RUNTIME_DEPS_ROOT to a directory that has it.`,
  );
}

export function resolvePackageDir(packageName) {
  return path.dirname(resolvePackageFile(`${packageName}/package.json`));
}

function addIfExists(candidates, filePath) {
  if (filePath && fs.existsSync(filePath)) {
    candidates.push(filePath);
  }
}

export function resolveChromeExecutablePath() {
  const candidates = [];

  addIfExists(candidates, process.env.CHROME_PATH);
  addIfExists(candidates, process.env.BROWSER_PATH);
  addIfExists(candidates, process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH);

  if (process.platform === 'win32') {
    addIfExists(candidates, path.join(process.env['PROGRAMFILES'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'));
    addIfExists(candidates, path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'));
    addIfExists(candidates, path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'));
    addIfExists(candidates, path.join(process.env['PROGRAMFILES'] || '', 'Chromium', 'Application', 'chrome.exe'));
    addIfExists(candidates, path.join(process.env['PROGRAMFILES(X86)'] || '', 'Chromium', 'Application', 'chrome.exe'));
  } else if (process.platform === 'darwin') {
    addIfExists(candidates, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    addIfExists(candidates, '/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else {
    addIfExists(candidates, '/usr/bin/google-chrome');
    addIfExists(candidates, '/usr/bin/google-chrome-stable');
    addIfExists(candidates, '/usr/bin/chromium');
    addIfExists(candidates, '/usr/bin/chromium-browser');
  }

  return candidates[0] || '';
}

export function resolveAvatarPath() {
  const candidates = [];

  addIfExists(candidates, process.env.DEFAULT_AVATAR_PATH);
  addIfExists(candidates, path.join(ROOT_DIR, 'resources', 'icons', 'icon.png'));
  addIfExists(candidates, path.join(ROOT_DIR, 'public', 'icon.png'));

  for (const root of collectCandidateRoots()) {
    addIfExists(candidates, path.join(root, 'resources', 'icons', 'icon.png'));
  }

  return candidates[0] || '';
}
