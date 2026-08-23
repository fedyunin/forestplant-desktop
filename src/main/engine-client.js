/**
 * Сторона главного процесса: рабочие процессы базы и вызовы к ним.
 *
 * Процессов два, и это не роскошь. Один процесс обрабатывает сообщения по
 * очереди, поэтому тяжёлый запрос задерживал все остальные: замер показал
 * 3.8 секунды на обычный вызов, пока считался SQL из консоли.
 *
 *   fast   просмотр: список, таблица, карточка, оценка выборки
 *   heavy  долгое: SQL-консоль, экспорт, синхронизация, пересборка
 *
 * SQLite допускает несколько соединений на чтение, поэтому оба процесса
 * открывают одну и ту же базу. Пересборка идёт в heavy и после себя
 * переоткрывает базу в fast — файл к тому времени уже другой.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { utilityProcess } = require('electron');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Вызовы, которые могут идти долго. Остальные считаются быстрыми. */
const HEAVY = new Set(['query', 'runExport', 'pull', 'rebuild', 'checkUpdates', 'stats']);

const lanes = new Map();
let seq = 0;
let onEvent = () => {};
let onLog = () => {};
let dbFile = null;

function spawn(name) {
  const lane = { child: null, pending: new Map() };
  lane.child = utilityProcess.fork(path.join(__dirname, 'engine.cjs'), [], {
    serviceName: `forestplant-${name}`,
    stdio: 'inherit',
  });

  lane.child.on('message', (msg) => {
    if (msg?.fatal) { onLog(`движок «${name}» не запустился: ${msg.fatal}`); return; }
    // События хода работы шлёт только тяжёлая дорожка — иначе они задвоятся
    if (msg?.event) { if (name === 'heavy' && msg.event !== 'ready') onEvent(msg.event, msg.payload); return; }

    const p = lane.pending.get(msg.id);
    if (!p) return;
    lane.pending.delete(msg.id);
    msg.ok ? p.resolve(msg.data) : p.reject(new Error(msg.error));
  });

  lane.child.on('exit', (code) => {
    onLog(`движок «${name}» завершился, код ${code}`);
    for (const p of lane.pending.values()) p.reject(new Error('движок базы остановлен'));
    lane.pending.clear();
    lanes.delete(name);
  });

  lanes.set(name, lane);
  return lane;
}

const laneOf = (name) => lanes.get(name) || spawn(name);

function post(name, method, args) {
  const lane = laneOf(name);
  const id = ++seq;
  return new Promise((resolve, reject) => {
    lane.pending.set(id, { resolve, reject });
    lane.child.postMessage({ id, method, args });
  });
}

export function startEngine({ onEvent: ev, onLog: lg } = {}) {
  onEvent = ev || onEvent;
  onLog = lg || onLog;
  laneOf('fast');
  laneOf('heavy');
}

export function stopEngine() {
  for (const lane of lanes.values()) lane.child.kill();
  lanes.clear();
}

/** Вызов метода движка. Дорожка выбирается по методу. */
export async function callEngine(method, args = {}) {
  // Базу открывают обе дорожки: каждая работает своим соединением
  if (method === 'open') {
    dbFile = args.dbFile;
    const [r] = await Promise.all([post('fast', 'open', args), post('heavy', 'open', args)]);
    return r;
  }

  const res = await post(HEAVY.has(method) ? 'heavy' : 'fast', method, args);

  // После пересборки файл базы другой — быстрая дорожка должна переоткрыть его
  if ((method === 'rebuild' || method === 'pull') && dbFile) {
    await post('fast', 'open', { dbFile });
  }
  return res;
}
