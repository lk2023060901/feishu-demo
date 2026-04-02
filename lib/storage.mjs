import fs from 'node:fs/promises';
import path from 'node:path';
import { AUTH_DIR, DATA_DIR, INVENTORY_FILE } from './config.mjs';

const AUTH_FILES = {
  feishu: path.join(AUTH_DIR, 'feishu.json'),
  qq: path.join(AUTH_DIR, 'qq.json'),
};

const EMPTY_INVENTORY = {
  feishu: [],
  qq: [],
};

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function ensureStorage() {
  await ensureDir(DATA_DIR);
  await ensureDir(AUTH_DIR);
}

async function readJson(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function readAuth(platform) {
  return await readJson(AUTH_FILES[platform], null);
}

export async function writeAuth(platform, value) {
  await writeJson(AUTH_FILES[platform], value);
}

export async function clearAuth(platform) {
  await fs.rm(AUTH_FILES[platform], { force: true });
}

export async function readInventory() {
  const inventory = await readJson(INVENTORY_FILE, EMPTY_INVENTORY);
  return {
    feishu: Array.isArray(inventory?.feishu) ? inventory.feishu : [],
    qq: Array.isArray(inventory?.qq) ? inventory.qq : [],
  };
}

export async function writeInventory(inventory) {
  await writeJson(INVENTORY_FILE, inventory);
}

export async function upsertBot(platform, entry) {
  const inventory = await readInventory();
  const items = inventory[platform];
  const index = items.findIndex((item) => item.appId === entry.appId);
  const nextEntry = {
    ...entry,
    deletedAt: null,
    updatedAt: new Date().toISOString(),
  };
  if (index >= 0) {
    items[index] = {
      ...items[index],
      ...nextEntry,
    };
  } else {
    items.unshift({
      ...nextEntry,
      createdAt: nextEntry.createdAt || new Date().toISOString(),
    });
  }
  await writeInventory(inventory);
}

export async function markBotsDeleted(platform, appIds) {
  const inventory = await readInventory();
  const set = new Set(appIds);
  for (const item of inventory[platform]) {
    if (set.has(item.appId)) {
      item.deletedAt = new Date().toISOString();
      item.updatedAt = item.deletedAt;
    }
  }
  await writeInventory(inventory);
}
