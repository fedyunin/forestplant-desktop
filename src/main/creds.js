/**
 * GIS credentials.
 *
 * The password is encrypted by the system store (Keychain on macOS, DPAPI on
 * Windows) through safeStorage and kept in the application folder. In the
 * clear it reaches neither configs, nor logs, nor the renderer — only the user
 * name and a «password saved» flag go out.
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { app, safeStorage } = require('electron');

const file = () => path.join(app.getPath('userData'), 'credentials.json');

export function load() {
  // Environment variables win — handy in CI and while debugging
  if (process.env.FP_USER && process.env.FP_PASS) {
    return { username: process.env.FP_USER, password: process.env.FP_PASS, source: 'environment' };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
    if (!raw.username || !raw.secret) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;
    const password = safeStorage.decryptString(Buffer.from(raw.secret, 'base64'));
    return { username: raw.username, password, source: 'keychain' };
  } catch {
    return null;
  }
}

export function save(username, password) {
  if (!username || !password) throw new Error('A login and a password are required');
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('The system store is unavailable — the password cannot be saved');
  }
  const secret = safeStorage.encryptString(password).toString('base64');
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify({ username, secret }), { mode: 0o600 });
  return true;
}

export function clear() {
  try { fs.unlinkSync(file()); } catch { /* already gone */ }
  return true;
}

/** What may be shown in the interface: no password. */
export function status() {
  const c = load();
  return c ? { saved: true, username: c.username, source: c.source } : { saved: false };
}
