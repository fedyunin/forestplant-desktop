/**
 * The main-process side: the database worker processes and calls into them.
 *
 * There are two processes, and that is not a luxury. One process handles
 * messages in order, so a heavy query held up everything else: a measurement
 * showed 3.8 seconds for an ordinary call while an SQL console query ran.
 *
 *   fast   browsing: the list, the table, one object, the estimate
 *   heavy  the slow ones: SQL console, export, syncing, rebuild
 *
 * SQLite allows several readers, so both processes open the same database.
 * A rebuild runs in heavy and afterwards reopens the database in fast — by
 * then the file is a different one.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { utilityProcess } = require('electron');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Calls that may run for a long time. Everything else counts as fast. */
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
    if (msg?.fatal) { onLog(`engine «${name}» did not start: ${msg.fatal}`); return; }
    // Progress events are sent by the heavy lane only — otherwise they double
    if (msg?.event) { if (name === 'heavy' && msg.event !== 'ready') onEvent(msg.event, msg.payload); return; }

    const p = lane.pending.get(msg.id);
    if (!p) return;
    lane.pending.delete(msg.id);
    msg.ok ? p.resolve(msg.data) : p.reject(new Error(msg.error));
  });

  lane.child.on('exit', (code) => {
    onLog(`engine «${name}» exited, code ${code}`);
    for (const p of lane.pending.values()) p.reject(new Error('the database engine stopped'));
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

/** Call an engine method. The lane is chosen by the method. */
export async function callEngine(method, args = {}) {
  // Both lanes open the database: each works through its own connection
  if (method === 'open') {
    dbFile = args.dbFile;
    const [r] = await Promise.all([post('fast', 'open', args), post('heavy', 'open', args)]);
    return r;
  }

  const res = await post(HEAVY.has(method) ? 'heavy' : 'fast', method, args);

  // After a rebuild the database file is another one — fast must reopen it
  if ((method === 'rebuild' || method === 'pull') && dbFile) {
    await post('fast', 'open', { dbFile });
  }
  return res;
}
