/**
 * Синхронизация: выгрузка слоёв в сырой архив и определение изменений.
 *
 * Архив — источник истины: `raw/layers/<ключ>.geojson.gz` плюс манифест с
 * URL, счётчиком сервера, отпечатком и sha256. База пересобирается из архива,
 * обратно — нет.
 *
 * Каждый слой качается ровно один раз и сверяется: «сервер обещал N —
 * забрали N». Расхождение помечается ok:false и перекачивается при следующем
 * запуске.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import { layerKey, isVydelPath } from './arcgis.js';

/** Выполнить задачи пулом заданной ширины. */
async function pool(items, width, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(width, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

export function readManifest(rawDir) {
  const p = path.join(rawDir, '_manifest.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
}

function writeManifest(rawDir, manifest) {
  const p = path.join(rawDir, '_manifest.json');
  fs.writeFileSync(`${p}.part`, JSON.stringify(manifest, null, 1));
  fs.renameSync(`${p}.part`, p);
}

/** Все слои системы: выделы, кварталы и прочее. */
export async function dumpTargets(gis) {
  const out = [];
  const seen = new Set();

  for (const svc of await gis.services()) {
    let tree;
    try {
      tree = await gis.tree(svc.url);
    } catch (e) {
      gis.log(`пропуск сервиса ${svc.title}: ${e.message}`);
      continue;
    }
    // общий по области слой кварталов лежит в корне сервиса
    const kv = tree.find((l) => l.path.length === 1 && /квартал/i.test(l.path[0]));

    for (const l of tree) {
      const key = layerKey(svc.url, l.id);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        kind: isVydelPath(l.path) ? 'vydel' : (kv && l.id === kv.id ? 'kvartal' : 'misc'),
        oblast: svc.title,
        serviceUrl: svc.url,
        layerId: l.id,
        path: l.path,
      });
    }
  }

  // отдельные слои FeatureServer из веб-карты (посадки, питомники, семена)
  try {
    const wm = await gis.webmap();
    for (const l of wm.operationalLayers || []) {
      const u = l.url || '';
      if (!u.includes('/FeatureServer/')) continue;
      const i = u.lastIndexOf('/');
      const base = u.slice(0, i);
      const id = Number(u.slice(i + 1));
      const key = layerKey(base, id);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, kind: 'misc', oblast: l.title || '', serviceUrl: base, layerId: id, path: [l.title || ''] });
    }
  } catch (e) {
    gis.log(`не удалось перечислить слои FeatureServer: ${e.message}`);
  }
  return out;
}

/**
 * Выгрузка. refreshKeys — принудительно перекачать только эти слои.
 * onProgress({i, total, key, oblast, path, status, count, bytes, error}).
 */
export async function dump(gis, {
  rawDir = 'raw', jobs = 4, skipExisting = true, refreshKeys = null,
  only = 'all', onProgress = null, signal = null,
} = {}) {
  fs.mkdirSync(path.join(rawDir, 'layers'), { recursive: true });
  fs.mkdirSync(path.join(rawDir, 'meta'), { recursive: true });

  let targets = await dumpTargets(gis);
  if (only !== 'all') targets = targets.filter((t) => t.kind === only);
  const refresh = refreshKeys ? new Set(refreshKeys) : null;
  if (refresh) targets = targets.filter((t) => refresh.has(t.key));

  const manifest = readManifest(rawDir);
  try {
    fs.writeFileSync(path.join(rawDir, 'meta', '_webmap.json'), JSON.stringify(await gis.webmap()));
  } catch { /* снимок веб-карты не критичен */ }

  const stats = { done: 0, skipped: 0, failed: 0, features: 0, bytes: 0 };
  let counter = 0;
  let dirty = false;

  await pool(targets, jobs, async (t) => {
    if (signal?.aborted) return;
    const i = ++counter;
    const layerUrl = `${t.serviceUrl}/${t.layerId}`;
    const file = path.join(rawDir, 'layers', `${t.key}.geojson.gz`);
    const rec = manifest[t.key];
    const report = (status, extra = {}) => onProgress?.({
      i, total: targets.length, key: t.key, oblast: t.oblast, path: t.path, status, ...extra,
    });

    if (skipExisting && !refresh?.has(t.key) && rec?.ok
        && fs.existsSync(file) && fs.statSync(file).size === rec.bytes) {
      stats.skipped += 1;
      report('уже есть');
      return;
    }

    try {
      const meta = await gis.api(layerUrl);
      if (meta.error) throw new Error(JSON.stringify(meta.error).slice(0, 200));
      fs.writeFileSync(path.join(rawDir, 'meta', `${t.key}.json`), JSON.stringify(meta));

      const fields = (meta.fields || []).map((f) => f.name);
      const probe = await gis.probe(layerUrl, fields);

      // прогресс внутри слоя: у крупных слоёв выкачка идёт тысячами запросов,
      // и без этого зависание неотличимо от «просто долго»
      let lastTick = 0;
      const { features, expected, skipped } = await gis.fetchLayer(layerUrl, {
        onChunk: (got, total) => {
          const now = Date.now();
          if (now - lastTick < 3000 && got < total) return;
          lastTick = now;
          report('качаю', { count: got, expected: total });
        },
      });

      const blob = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features }), 'utf8');
      const sha256 = crypto.createHash('sha256').update(blob).digest('hex');
      fs.writeFileSync(`${file}.part`, zlib.gzipSync(blob, { level: 6 }));
      fs.renameSync(`${file}.part`, file);
      const bytes = fs.statSync(file).size;

      manifest[t.key] = {
        key: t.key,
        kind: t.kind,
        oblast: t.oblast,
        service_url: t.serviceUrl,
        layer_id: t.layerId,
        path: t.path,
        layer_name: meta.name,
        geometry_type: meta.geometryType,
        fields,
        server_count: probe.count,
        fetched_count: features.length,
        sha256,
        bytes,
        probe,
        // Отдельные записи сервер не отдаёт вовсе: на них он отвечает
        // «Failed to execute query» даже поштучно. Такой слой считается
        // забранным полностью — иначе он вечно перекачивался бы впустую.
        skipped_ids: skipped.length ? skipped : undefined,
        ok: probe.count === features.length + skipped.length,
      };
      dirty = true;
      stats.done += 1;
      stats.features += features.length;
      stats.bytes += bytes;
      report(manifest[t.key].ok ? 'готово' : 'недобор', {
        count: features.length, expected, bytes, skipped: skipped.length,
      });
    } catch (e) {
      manifest[t.key] = {
        ...(rec || {}), key: t.key, kind: t.kind, oblast: t.oblast, path: t.path,
        ok: false, error: String(e.message || e).slice(0, 300),
      };
      dirty = true;
      stats.failed += 1;
      report('ошибка', { error: String(e.message || e).slice(0, 200) });
    }

    if (dirty && (stats.done + stats.failed) % 5 === 0) { writeManifest(rawDir, manifest); dirty = false; }
  });

  writeManifest(rawDir, manifest);
  return { ...stats, total: targets.length };
}

/** Что изменилось на сервере — по отпечаткам, без скачивания. */
export async function findChanges(gis, { rawDir = 'raw', jobs = 8, onProgress = null } = {}) {
  const manifest = readManifest(rawDir);
  const targets = await dumpTargets(gis);
  const known = new Set(targets.map((t) => t.key));

  const existing = targets.filter((t) => manifest[t.key]);
  const added = targets.filter((t) => !manifest[t.key]).map((t) => t.key);
  const removed = Object.keys(manifest).filter((k) => !known.has(k));

  const changed = [];
  let i = 0;
  await pool(existing, jobs, async (t) => {
    const layerUrl = `${t.serviceUrl}/${t.layerId}`;
    const old = manifest[t.key].probe || {};
    try {
      const meta = await gis.api(layerUrl);
      const fields = (meta.fields || []).map((f) => f.name);
      const now = await gis.probe(layerUrl, fields);
      const diff = ['count', 'max_oid', 'max_edit'].filter((f) => (old[f] ?? null) !== (now[f] ?? null));
      if (!manifest[t.key].ok) changed.push({ key: t.key, why: 'не докачан в прошлый раз', oblast: t.oblast });
      else if (Object.keys(old).length === 0) changed.push({ key: t.key, why: 'нет отпечатка', oblast: t.oblast });
      else if (diff.length) {
        changed.push({
          key: t.key, oblast: t.oblast,
          why: diff.map((f) => `${f}: ${old[f]} → ${now[f]}`).join(', '),
        });
      }
    } catch (e) {
      changed.push({ key: t.key, oblast: t.oblast, why: `не ответил: ${String(e.message).slice(0, 80)}` });
    }
    onProgress?.({ i: ++i, total: existing.length });
  });

  return { changed, added, removed, total: targets.length };
}
