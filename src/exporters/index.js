/**
 * Registry of exporters.
 *
 * Export is a replaceable part of the application, not its point: what
 * matters here is browsing and querying the data. Every format describes
 * itself — its name, its settings and how it writes. Adding a format is a
 * new file in this folder plus a line in the list below.
 *
 * An exporter:
 *   id       string identifier
 *   name     translation key of its name
 *   hint     translation key of a short explanation
 *   options  description of the settings (type, label key, default value)
 *   run({ db, filters, options, outDir, onProgress }) -> { files, ... }
 */

import kml from './kml.js';

const REGISTRY = [kml];

export const exporters = () => REGISTRY.map(({ id, name, hint, options }) => ({
  id, name, hint, options,
}));

export function getExporter(id) {
  const e = REGISTRY.find((x) => x.id === id);
  if (!e) throw new Error(`Unknown format: ${id}`);
  return e;
}

/** Default option values of a format. */
export function defaultOptions(id) {
  const out = {};
  for (const o of getExporter(id).options) out[o.key] = o.value;
  return out;
}

/** Keep only known settings of known types. */
export function sanitizeOptions(id, raw = {}) {
  const out = {};
  for (const o of getExporter(id).options) {
    const v = raw[o.key];
    if (v === undefined || v === null) { out[o.key] = o.value; continue; }
    if (o.type === 'number') {
      const n = Number(v);
      out[o.key] = Number.isFinite(n)
        ? Math.min(o.max ?? Infinity, Math.max(o.min ?? -Infinity, n))
        : o.value;
    } else if (o.type === 'bool') {
      out[o.key] = Boolean(v);
    } else if (o.type === 'select') {
      out[o.key] = o.choices.some((c) => c.value === v) ? v : o.value;
    } else if (o.type === 'text') {
      // A label template is free text from the window; length is the only
      // thing worth bounding, the placeholders are resolved by the renderer.
      out[o.key] = String(v).slice(0, o.max ?? 200);
    } else {
      out[o.key] = String(v);
    }
  }
  return out;
}
