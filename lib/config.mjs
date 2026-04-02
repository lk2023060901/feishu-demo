import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const AUTH_DIR = path.join(DATA_DIR, 'auth');
export const INVENTORY_FILE = path.join(DATA_DIR, 'bots.json');
export const SERVER_PORT = Number.parseInt(process.env.PORT || '3030', 10);
