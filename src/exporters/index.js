/**
 * Реестр экспортёров.
 *
 * Экспорт — сменная часть приложения, а не его суть: основное здесь смотреть
 * и запрашивать данные. Каждый формат описывает себя сам — как называется, что
 * умеет настраивать и как выгружает. Добавление формата это новый файл в этом
 * каталоге плюс строка в списке ниже; интерфейс подстраивается сам.
 *
 * Экспортёр:
 *   id       строковый идентификатор
 *   name     название для интерфейса
 *   hint     короткое пояснение
 *   options  описание настроек (тип, подпись, значение по умолчанию)
 *   run({ db, filters, options, outDir, onProgress }) -> { files, ... }
 */

import kml from './kml.js';

const REGISTRY = [kml];

export const exporters = () => REGISTRY.map(({ id, name, hint, options }) => ({
  id, name, hint, options,
}));

export function getExporter(id) {
  const e = REGISTRY.find((x) => x.id === id);
  if (!e) throw new Error(`Неизвестный формат: ${id}`);
  return e;
}

/** Значения настроек по умолчанию для формата. */
export function defaultOptions(id) {
  const out = {};
  for (const o of getExporter(id).options) out[o.key] = o.value;
  return out;
}

/** Оставить только известные настройки известных типов. */
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
    } else {
      out[o.key] = String(v);
    }
  }
  return out;
}
