/**
 * Клиент к ArcGIS Server системы forestplant.gharysh.kz.
 *
 * Особенности этой установки, влияющие на устройство клиента:
 *  - каталог сервисов отключён администратором, работает только REST API;
 *  - сертификат не проходит проверку, поэтому она отключается точечно;
 *  - токен живёт сутки, при истечении сервер отвечает кодом 498/499;
 *  - часть сервисов отдаёт 403 «нет прав» — это не сбой, а граница доступа.
 */

import https from 'node:https';
import { URL } from 'node:url';

export const PORTAL = 'https://arcgis.gharysh.kz/portal';
export const APP = 'https://forestplant.gharysh.kz';
export const WEBMAP_ID = 'f2fc59bb490040d1a25ce2eaf9df664f';

// Сертификат сервера не проходит проверку цепочки. Агент ограничен этим
// клиентом и не влияет на остальной процесс.
const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true, maxSockets: 16 });

export class ArcGis {
  constructor({ username, password, onLog = null } = {}) {
    this.username = username;
    this.password = password;
    this.token = null;
    this.onLog = onLog;
    this._treeCache = new Map();
  }

  log(msg) { this.onLog?.(msg); }

  /**
   * POST формой. Повторы на сетевых сбоях и 5xx.
   *
   * Срок ответа задаётся жёстким таймером, а не опцией `timeout` у запроса:
   * при keepAlive-агенте она не применяется к переиспользованным сокетам, и
   * запрос может висеть бесконечно. Один такой висяк останавливает весь пул —
   * ровно так выгрузка простояла восемь часов на нулевом CPU.
   */
  post(url, params, { raw = false, tries = 6, timeout = 120000 } = {}) {
    const body = new URLSearchParams(params).toString();
    const u = new URL(url);

    const attempt = () => new Promise((resolve, reject) => {
      let done = false;
      const finish = (fn, arg) => { if (!done) { done = true; clearTimeout(timer); fn(arg); } };

      const req = https.request({
        agent,
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          Referer: APP,
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('aborted', () => finish(reject, new Error('соединение оборвано')));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (res.statusCode >= 500) { finish(reject, new Error(`HTTP ${res.statusCode}`)); return; }
          if (raw) { finish(resolve, buf); return; }
          const text = buf.toString('utf8');
          try {
            finish(resolve, JSON.parse(text));
          } catch {
            // Под нагрузкой сервер отвечает HTML-страницей ошибки вместо JSON.
            // Это временное состояние: те же запросы в одиночку проходят, —
            // поэтому такой ответ считаем «сервер занят» и ждём дольше обычного.
            const busy = /^\s*<(!doctype|html)/i.test(text);
            const err = new Error(busy ? 'сервер занят (ответил HTML)' : `не JSON: ${text.slice(0, 120)}`);
            err.busy = busy;
            finish(reject, err);
          }
        });
      });

      const timer = setTimeout(() => {
        req.destroy();
        finish(reject, new Error(`нет ответа за ${Math.round(timeout / 1000)} с`));
      }, timeout);

      req.on('error', (e) => finish(reject, e));
      req.end(body);
    });

    const run = async () => {
      let last;
      for (let n = 0; n < tries; n++) {
        try { return await attempt(); } catch (e) {
          last = e;
          if (n === tries - 1) break;
          // «занят» ждём заметно дольше: сервер должен успеть разгрестись
          const base = e.busy ? 5000 : 2000;
          const wait = Math.min(base * 2 ** n, 60000);
          this.log?.(`  повтор через ${Math.round(wait / 1000)} с: ${e.message.slice(0, 60)}`);
          await new Promise((r) => setTimeout(r, wait));
        }
      }
      throw new Error(`запрос ${url} не удался: ${last?.message || last}`);
    };
    return run();
  }

  async getToken(force = false) {
    if (this.token && !force) return this.token;
    const r = await this.post(`${PORTAL}/sharing/rest/generateToken`, {
      username: this.username,
      password: this.password,
      client: 'referer',
      referer: APP,
      expiration: 1440,
      f: 'json',
    });
    if (!r.token) throw new Error(`не удалось получить токен: ${JSON.stringify(r).slice(0, 200)}`);
    this.token = r.token;
    this.log('токен получен');
    return this.token;
  }

  /** Запрос к REST с автоматическим перевыпуском протухшего токена. */
  async api(url, params = {}, opts = {}) {
    for (const force of [false, true]) {
      const token = await this.getToken(force);
      const r = await this.post(url, { f: 'json', token, ...params }, opts);
      const code = r?.error?.code;
      if (code !== 498 && code !== 499) return r;
    }
    throw new Error('токен отвергнут дважды');
  }

  webmap() {
    return this.api(`${PORTAL}/sharing/rest/content/items/${WEBMAP_ID}/data`);
  }

  /** Сервисы карт из веб-карты приложения. */
  async services() {
    const data = await this.webmap();
    return (data.operationalLayers || [])
      .filter((l) => l.layerType === 'ArcGISMapServiceLayer' && String(l.url || '').endsWith('/MapServer'))
      .map((l) => ({ title: l.title || '', url: l.url }));
  }

  /** Дерево слоёв сервиса: [{path, id}] для всех Feature Layer. */
  async tree(serviceUrl) {
    if (this._treeCache.has(serviceUrl)) return this._treeCache.get(serviceUrl);
    const d = await this.api(serviceUrl);
    if (d.error) throw new Error(JSON.stringify(d.error).slice(0, 160));

    const byId = new Map((d.layers || []).map((l) => [l.id, l]));
    const out = [];
    for (const [id, l] of byId) {
      if (l.type !== 'Feature Layer') continue;
      const path = [];
      let cur = l;
      for (let guard = 0; cur && guard < 20; guard++) {
        path.push(cur.name);
        cur = byId.get(cur.parentLayerId);
      }
      out.push({ path: path.reverse(), id });
    }
    out.sort((a, b) => a.path.join('/').localeCompare(b.path.join('/')));
    this._treeCache.set(serviceUrl, out);
    return out;
  }

  /**
   * Дешёвый отпечаток слоя — чтобы понять, изменился ли он, не скачивая.
   * Ловит добавления и удаления надёжно; правки — только там, где сервер
   * заполняет last_edited_date (в этой системе он часто пуст).
   */
  async probe(layerUrl, fields = []) {
    const out = {};
    const c = await this.api(`${layerUrl}/query`, { where: '1=1', returnCountOnly: 'true' });
    out.count = c.error ? -1 : (c.count ?? -1);

    const stats = [];
    if (fields.includes('OBJECTID')) {
      stats.push({ statisticType: 'max', onStatisticField: 'OBJECTID', outStatisticFieldName: 'mx_oid' });
    }
    if (fields.includes('last_edited_date')) {
      stats.push({ statisticType: 'max', onStatisticField: 'last_edited_date', outStatisticFieldName: 'mx_ed' });
    }
    if (stats.length) {
      try {
        const r = await this.api(`${layerUrl}/query`, { where: '1=1', outStatistics: JSON.stringify(stats) });
        const a = r?.features?.[0]?.attributes || {};
        out.max_oid = a.mx_oid ?? null;
        out.max_edit = a.mx_ed ?? null;
      } catch { /* статистика не обязательна */ }
    }
    return out;
  }

  /**
   * Все объекты слоя в GeoJSON (WGS84), постранично по OBJECTID.
   *
   * Кусок, не взявшийся даже после повторов внутри post(), не обнуляет весь
   * слой: он откладывается и проходит вторым кругом с уменьшенным размером
   * страницы. У слоя в 400 тысяч объектов один сбойный запрос иначе выбрасывал
   * часы работы.
   */
  async fetchLayer(layerUrl, { where = '1=1', chunk = 400, onChunk = null } = {}) {
    const ids = await this.api(`${layerUrl}/query`, { where, returnIdsOnly: 'true' });
    if (ids.error) throw new Error(JSON.stringify(ids.error).slice(0, 160));
    const oids = ids.objectIds || [];
    const features = [];

    // Крупный кусок отбрасываем после одной-двух попыток и сразу дробим:
    // терпеливо ждать имеет смысл только когда кусок уже мелкий, иначе на
    // каждом уровне дробления тратятся минуты на заведомо безнадёжный запрос.
    const getChunk = async (part) => {
      const r = await this.post(`${layerUrl}/query`, {
        objectIds: part.join(','),
        outFields: '*',
        returnGeometry: 'true',
        outSR: '4326',
        f: 'geojson',
        token: await this.getToken(),
      }, { tries: part.length <= 4 ? 5 : 2 });
      if (r.error) throw new Error(JSON.stringify(r.error).slice(0, 160));
      return r.features || [];
    };

    // Дробление пополам. Размер ответа зависит не от числа объектов, а от их
    // сложности: тридцать полигонов границ лесничеств на область сервер не
    // отдаёт вовсе, а четыреста мелких выделов — легко. Заранее подобрать
    // размер страницы нельзя, поэтому подбираем по факту отказа.
    const skipped = [];
    const take = async (part, depth = 0) => {
      try {
        features.push(...await getChunk(part));
        onChunk?.(features.length, oids.length);
        return;
      } catch (e) {
        if (part.length === 1 || depth > 12) {
          this.log(`  объект ${part[0]} не отдаётся: ${String(e.message).slice(0, 60)}`);
          skipped.push(...part);
          return;
        }
        const mid = Math.ceil(part.length / 2);
        this.log(`  дроблю ${part.length} -> ${mid}: ${String(e.message).slice(0, 50)}`);
        await take(part.slice(0, mid), depth + 1);
        await take(part.slice(mid), depth + 1);
      }
    };

    for (let i = 0; i < oids.length; i += chunk) {
      await take(oids.slice(i, i + chunk));
    }

    return { features, expected: oids.length, skipped };
  }
}

/** Ключ слоя в манифесте: <сервис>_<MS|FS>_<id>. Совместим с архивом. */
export function layerKey(serviceUrl, layerId) {
  const parts = serviceUrl.replace(/\/+$/, '').split('/');
  const kind = parts[parts.length - 1] === 'MapServer' ? 'MS' : 'FS';
  return `${parts[parts.length - 2]}_${kind}_${layerId}`;
}

export const isVydelPath = (path) => path.length >= 2 && path[path.length - 1].includes('Границ');
