import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const AUTH_DIR = path.join(DATA_DIR, 'auth');
export const INVENTORY_FILE = path.join(DATA_DIR, 'bots.json');
export const TNYMA_ROOT = process.env.TNYMA_ROOT || '/Volumes/data/liukai/tools/tnyma-ai-installer';
export const CHROME_PATH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const DEFAULT_AVATAR_PATH = path.join(TNYMA_ROOT, 'resources', 'icons', 'icon.png');
export const SERVER_PORT = Number.parseInt(process.env.PORT || '3030', 10);
