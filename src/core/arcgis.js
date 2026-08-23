/**
 * Client for the ArcGIS Server behind forestplant.gharysh.kz.
 *
 * Traits of this installation that shape the client:
 *  - the services directory is switched off, only the REST API answers;
 *  - the certificate fails validation, so validation is disabled locally;
 *  - a token lives for a day; once expired the server answers 498/499;
 *  - some services answer 403 «no access» — a boundary, not a failure.
 */

import https from 'node:https';
import { URL } from 'node:url';

export const PORTAL = 'https://arcgis.gharysh.kz/portal';
export const APP = 'https://forestplant.gharysh.kz';
export const WEBMAP_ID = 'f2fc59bb490040d1a25ce2eaf9df664f';

// The server certificate fails chain validation. The agent is confined to this
// client and does not affect the rest of the process.
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
   * POST as a form. Retries on network failures and 5xx.
   *
   * The deadline is enforced by an explicit timer rather than the request
   * `timeout` option: with a keepAlive agent that option is not applied to
   * reused sockets and a request can hang forever. One such hang stalls the
   * whole pool — that is exactly how a dump stood still for eight hours at 0% CPU.
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
        res.on('aborted', () => finish(reject, new Error('connection aborted')));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (res.statusCode >= 500) { finish(reject, new Error(`HTTP ${res.statusCode}`)); return; }
          if (raw) { finish(resolve, buf); return; }
          const text = buf.toString('utf8');
          try {
            finish(resolve, JSON.parse(text));
          } catch {
            // Under load the server answers with an HTML error page, not JSON.
            // That state is temporary — the same requests succeed alone — so we
            // read such an answer as «server busy» and wait longer than usual.
            const busy = /^\s*<(!doctype|html)/i.test(text);
            const err = new Error(busy ? 'server busy (answered HTML)' : `not JSON: ${text.slice(0, 120)}`);
            err.busy = busy;
            finish(reject, err);
          }
        });
      });

      const timer = setTimeout(() => {
        req.destroy();
        finish(reject, new Error(`no answer within ${Math.round(timeout / 1000)} s`));
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
          // «busy» waits noticeably longer: the server needs time to catch up
          const base = e.busy ? 5000 : 2000;
          const wait = Math.min(base * 2 ** n, 60000);
          this.log?.(`  retry in ${Math.round(wait / 1000)} s: ${e.message.slice(0, 60)}`);
          await new Promise((r) => setTimeout(r, wait));
        }
      }
      throw new Error(`request ${url} failed: ${last?.message || last}`);
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
    if (!r.token) throw new Error(`could not get a token: ${JSON.stringify(r).slice(0, 200)}`);
    this.token = r.token;
    this.log('token received');
    return this.token;
  }

  /** A REST request that reissues an expired token by itself. */
  async api(url, params = {}, opts = {}) {
    for (const force of [false, true]) {
      const token = await this.getToken(force);
      const r = await this.post(url, { f: 'json', token, ...params }, opts);
      const code = r?.error?.code;
      if (code !== 498 && code !== 499) return r;
    }
    throw new Error('token rejected twice');
  }

  webmap() {
    return this.api(`${PORTAL}/sharing/rest/content/items/${WEBMAP_ID}/data`);
  }

  /** Map services taken from the application web map. */
  async services() {
    const data = await this.webmap();
    return (data.operationalLayers || [])
      .filter((l) => l.layerType === 'ArcGISMapServiceLayer' && String(l.url || '').endsWith('/MapServer'))
      .map((l) => ({ title: l.title || '', url: l.url }));
  }

  /** Layer tree of a service: [{path, id}] for every Feature Layer. */
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
   * A cheap fingerprint of a layer — to tell whether it changed without
   * downloading it. Catches additions and removals reliably; edits only where
   * the server fills last_edited_date (often empty in this system).
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
      } catch { /* statistics are optional */ }
    }
    return out;
  }

  /**
   * All objects of a layer as GeoJSON (WGS84), paged by OBJECTID.
   *
   * A chunk that fails even after the retries inside post() does not void the
   * whole layer: it is deferred and taken again on a second pass with a
   * smaller page. On a layer of 400 thousand objects one failed request would
   * otherwise throw away hours of work.
   */
  async fetchLayer(layerUrl, { where = '1=1', chunk = 400, onChunk = null } = {}) {
    const ids = await this.api(`${layerUrl}/query`, { where, returnIdsOnly: 'true' });
    if (ids.error) throw new Error(JSON.stringify(ids.error).slice(0, 160));
    const oids = ids.objectIds || [];
    const features = [];

    // A large chunk is abandoned after one or two attempts and split at once:
    // waiting patiently only pays off once the chunk is small, otherwise every
    // level of splitting spends minutes on a request that is hopeless anyway.
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

    // Halving. The size of an answer depends not on the number of objects but
    // on their complexity: thirty forestry boundary polygons of a region the
    // server refuses outright, while four hundred small stands come easily.
    // The page size cannot be guessed ahead, so we settle it by actual refusal.
    const skipped = [];
    const take = async (part, depth = 0) => {
      try {
        features.push(...await getChunk(part));
        onChunk?.(features.length, oids.length);
        return;
      } catch (e) {
        if (part.length === 1 || depth > 12) {
          this.log(`  object ${part[0]} is not served: ${String(e.message).slice(0, 60)}`);
          skipped.push(...part);
          return;
        }
        const mid = Math.ceil(part.length / 2);
        this.log(`  splitting ${part.length} -> ${mid}: ${String(e.message).slice(0, 50)}`);
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

/** Layer key in the manifest: <service>_<MS|FS>_<id>. Matches the archive. */
export function layerKey(serviceUrl, layerId) {
  const parts = serviceUrl.replace(/\/+$/, '').split('/');
  const kind = parts[parts.length - 1] === 'MapServer' ? 'MS' : 'FS';
  return `${parts[parts.length - 2]}_${kind}_${layerId}`;
}

export const isVydelPath = (path) => path.length >= 2 && path[path.length - 1].includes('Границ');
