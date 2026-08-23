/**
 * Учётные данные к ГИС.
 *
 * Пароль шифруется системным хранилищем (Keychain на macOS, DPAPI на Windows)
 * через safeStorage и кладётся в каталог приложения. В открытом виде он не
 * попадает ни в конфиги, ни в логи, ни в рендерер — наружу отдаётся только имя
 * пользователя и признак «пароль сохранён».
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { app, safeStorage } = require('electron');

const file = () => path.join(app.getPath('userData'), 'credentials.json');

export function load() {
  // Переменные окружения имеют приоритет — так удобно в CI и при отладке
  if (process.env.FP_USER && process.env.FP_PASS) {
    return { username: process.env.FP_USER, password: process.env.FP_PASS, source: 'окружение' };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
    if (!raw.username || !raw.secret) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;
    const password = safeStorage.decryptString(Buffer.from(raw.secret, 'base64'));
    return { username: raw.username, password, source: 'связка ключей' };
  } catch {
    return null;
  }
}

export function save(username, password) {
  if (!username || !password) throw new Error('Нужны логин и пароль');
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Системное хранилище недоступно — пароль сохранить нельзя');
  }
  const secret = safeStorage.encryptString(password).toString('base64');
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify({ username, secret }), { mode: 0o600 });
  return true;
}

export function clear() {
  try { fs.unlinkSync(file()); } catch { /* уже нет */ }
  return true;
}

/** Что можно показать в интерфейсе: без пароля. */
export function status() {
  const c = load();
  return c ? { saved: true, username: c.username, source: c.source } : { saved: false };
}
