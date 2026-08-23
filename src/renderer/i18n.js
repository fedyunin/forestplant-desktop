/*
 * Interface translations.
 *
 * Two languages: Russian and English. The dictionary is flat on purpose —
 * a key names the place in the interface, so a missing translation is easy
 * to spot and easy to add.
 *
 * Strings with numbers take parameters: t('data.objects', { n: 1234 }).
 */

const DICT = {
  ru: {
    'app.title': 'Лесной фонд',
    'tab.data': 'Данные',
    'tab.export': 'Экспорт',
    'tab.settings': 'Настройки',
    'db.notOpen': 'база не открыта',
    'db.notChosen': 'база не выбрана',
    'db.info': '{vydels} выделов · {forestries} лесничеств · {oblasts} областей',

    'search.forestry': 'лесничество, учреждение, область…',
    'search.findForestry': 'найти лесничество…',
    'list.clearPick': 'сбросить выбор',
    'list.all': 'всё',
    'list.picked': 'выбрано {n}',
    'list.addFound': 'добавить найденные',
    'list.clear': 'очистить',

    'mode.filters': 'Фильтры',
    'mode.sql': 'SQL',
    'filter.kvartal': 'Квартал',
    'filter.vydel': 'Выдел',
    'filter.areaFrom': 'Площадь от',
    'filter.areaTo': 'до',
    'filter.more': 'ещё фильтры',
    'filter.poroda': 'Порода',
    'filter.katZem': 'Категория земель',
    'filter.bonitet': 'Бонитет',

    'sql.apply': 'Применить',
    'sql.fromFilters': 'взять из фильтров',
    'sql.tables': 'таблицы…',
    'sql.running': 'выполняю…',
    'sql.hint': 'Запрос, вернувший колонку id, становится выборкой: её видно в таблице '
      + 'ниже и можно выгрузить. Запрос без id — просто отчёт, выгружать нечего.',
    'sql.selection': 'выборка: {n} объектов за {ms} мс',
    'sql.report': 'отчёт: {n} строк за {ms} мс',
    'sql.reportNoExport': ' · нет колонки id, выгрузить нельзя',
    'sql.truncated': ' (обрезано)',
    'sql.reportRows': '{n} строк отчёта',

    'data.objects': '{n} объектов',
    'data.empty': 'ничего не найдено',
    'data.range': '{from}–{to} из {total}',
    'data.toExport': 'Выгрузить эту выборку',
    'data.chooseDb': 'база не выбрана — укажите каталог данных в настройках',

    'detail.title': 'кв {kvartal} выд {vydel}',
    'detail.close': 'закрыть',
    'detail.parsed': 'Разобранные поля',
    'detail.raw': 'Как в источнике',
    'detail.extent': 'Охват',
    'detail.geometry': 'геометрия',
    'detail.yes': 'есть',
    'detail.no': 'нет',
    'detail.lon': 'долгота',
    'detail.lat': 'широта',

    'export.format': 'Формат',
    'export.nothingPicked': 'ничего не выбрано',
    'export.pickLeft': 'выберите лесничества слева',
    'export.counting': 'считаю…',
    'export.estimate': '{vydels} выделов, {vertices} вершин → примерно {files} файл(ов)',
    'export.willSplit': ' (с разбивкой)',
    'export.nothingMatches': 'под фильтр ничего не попадает',
    'export.run': 'Выгрузить',
    'export.running': 'Выгружаю…',
    'export.done': 'готово: {vydels} выделов в {files} файл(ов)',
    'export.skippedGeom': ' · пропущено с битой геометрией: {n}',
    'export.toast': 'Выгружено {vydels} выделов в {files} файл(ов)',

    'settings.dataDir': 'Каталог данных',
    'settings.dataDirHint': 'Внутри лежат база forest.sqlite и сырой архив raw/. '
      + 'Архив нужен только для синхронизации: база пересобирается из него, обратно — нет.',
    'settings.notChosen': 'не выбран',
    'settings.choose': 'Выбрать…',
    'settings.reveal': 'Показать',
    'settings.language': 'Язык',
    'settings.languageHint': 'По умолчанию берётся из системы.',
    'settings.langSystem': 'как в системе',
    'settings.langRu': 'Русский',
    'settings.langEn': 'English',
    'settings.creds': 'Учётные данные к ГИС',
    'settings.credsHint': 'Нужны только для синхронизации. Пароль шифруется системной '
      + 'связкой ключей и в файлы не попадает.',
    'settings.credsNone': 'не заданы',
    'settings.credsSet': 'Указать…',
    'settings.credsForget': 'Забыть',
    'settings.credsSaved': 'Сохранено в связке ключей',
    'settings.credsCleared': 'Учётные данные забыты',
    'settings.login': 'Логин',
    'settings.password': 'Пароль',
    'settings.cancel': 'Отмена',
    'settings.save': 'Сохранить',

    'settings.dbSection': 'Управление базой',
    'settings.check': 'Проверить обновления',
    'settings.pull': 'Докачать',
    'settings.retry': 'Повторить упавшие',
    'settings.rebuild': 'Пересобрать из архива',
    'settings.dbHint': 'Проверка опрашивает отпечаток каждого слоя и ничего не качает. '
      + 'Пересборка нужна после исправлений в разборе данных — она не обращается к серверу.',
    'settings.archiveState': 'Состояние архива',
    'settings.schemas': 'Схемы полей',
    'settings.schemasHint': 'Имена полей в системе разнородны: номер выдела встречается как '
      + 'НумерацияВыделов, Nвыд, NВыд, Нумерация_выделов. Здесь видно, какое поле в какую '
      + 'роль легло — дважды именно здесь пряталась молчаливая ошибка.',
    'settings.summary': 'Сводка',

    'stat.db': 'База',
    'stat.archive': 'Архив',
    'stat.archiveLayers': 'Слоёв в архиве',
    'stat.objects': 'Объектов',
    'stat.vydels': 'Выделов',
    'stat.kvartaly': 'Кварталов',
    'stat.forestries': 'Лесничеств',
    'stat.oblasts': 'Областей',
    'stat.schemaVersion': 'Версия схемы',
    'stat.none': 'нет',

    'sync.noChanges': 'Изменений нет, база актуальна.',
    'sync.toPull': 'К докачке {n} слоёв',
    'sync.removed': ', исчезло с сервера {n} (в базе остаются)',
    'sync.layer': 'Слой',
    'sync.oblast': 'Область',
    'sync.whatChanged': 'Что изменилось',
    'sync.reason': 'Причина',
    'sync.noRights': 'нет прав (403)',
    'sync.allFetched': 'Все слои забраны полностью.',
    'sync.badSummary': 'Из {layers} слоёв недоступно {bad}: нет прав {noRights}, прочих {other}. '
      + 'Отказ по правам повторами не лечится.',
    'sync.archiveUnavailable': 'Архив недоступен.',
    'sync.nothingToPull': 'Нечего качать',
    'sync.pulled': 'Докачано {n} слоёв',
    'sync.rebuilt': 'База пересобрана',
    'sync.probed': 'опрошено {i}/{total}',
    'sync.loaded': 'загружено {i}/{total}',
    'sync.status.fetching': 'качаю',
    'sync.status.done': 'готово',
    'sync.status.partial': 'недобор',
    'sync.status.failed': 'ошибка',
    'sync.pullReport': 'слоёв {done}, ошибок {failed}, объектов {features}',
    'sync.rebuildReport': 'загружено {loaded} слоёв, связей {links}',
    'sync.dbConnected': 'База подключена',
    'sync.noDbInDir': 'В каталоге нет базы — синхронизируйте или укажите другой',
    'sync.chooseDbFirst': 'Выберите файл базы выше.',

    'role.les': 'лесничество',
    'role.kv': '№ квартала',
    'role.vd': '№ выдела',
    'role.comp': 'учреждение',
    'role.ploshad': 'площадь',
    'role.poroda': 'порода',
    'role.bonitet': 'бонитет',
    'role.tip_lesa': 'тип леса',
    'role.kat_zem': 'категория земель',
    'role.kat_zasch': 'защитность',

    'col.oblast': 'Область',
    'col.lesnichestvo': 'Лесничество',
    'col.kvartal': 'Квартал',
    'col.vydel': 'Выдел',
    'col.ploshad': 'Площадь, га',
    'col.poroda': 'Порода',
    'col.bonitet': 'Бонитет',
    'col.tip_lesa': 'Тип леса',
    'col.kat_zem': 'Категория земель',

    'fmt.kml.name': 'KML для Google Earth',
    'fmt.kml.hint': 'Полигоны с подписями, границами кварталов и лесничества. '
      + 'Крупные выборки делятся на части по пределу Google Earth.',
    'opt.split': 'Файлы',
    'opt.split.les': 'на каждое лесничество',
    'opt.split.none': 'один общий',
    'opt.labelFormat': 'Подписи выделов',
    'opt.labelFormat.vydel': 'номер выдела — 5',
    'opt.labelFormat.kvvd': 'квартал-выдел — 29-5',
    'opt.labelFormat.full': 'кв 29 выд 5',
    'opt.labels': 'подписи',
    'opt.kvartaly': 'кварталы',
    'opt.outline': 'границы лесничества',
    'opt.index': 'сводный файл со ссылками',
    'opt.budget': 'Предел вершин на файл',
    'opt.lesColor': 'Границы лесничества',
    'opt.kvColor': 'Кварталы',
    'opt.vdColor': 'Выделы',
    'opt.width': 'толщина',
    'opt.vdFill': 'заливка выделов',

    'unit.gb': 'ГБ',
    'unit.mb': 'МБ',
    'unit.b': 'Б',
  },

  en: {
    'app.title': 'Forest Fund',
    'tab.data': 'Data',
    'tab.export': 'Export',
    'tab.settings': 'Settings',
    'db.notOpen': 'no database open',
    'db.notChosen': 'no database selected',
    'db.info': '{vydels} stands · {forestries} forestries · {oblasts} regions',

    'search.forestry': 'forestry, agency, region…',
    'search.findForestry': 'find a forestry…',
    'list.clearPick': 'clear selection',
    'list.all': 'all',
    'list.picked': '{n} selected',
    'list.addFound': 'add all found',
    'list.clear': 'clear',

    'mode.filters': 'Filters',
    'mode.sql': 'SQL',
    'filter.kvartal': 'Block',
    'filter.vydel': 'Stand',
    'filter.areaFrom': 'Area from',
    'filter.areaTo': 'to',
    'filter.more': 'more filters',
    'filter.poroda': 'Species',
    'filter.katZem': 'Land category',
    'filter.bonitet': 'Site class',

    'sql.apply': 'Apply',
    'sql.fromFilters': 'take from filters',
    'sql.tables': 'tables…',
    'sql.running': 'running…',
    'sql.hint': 'A query returning an id column becomes a selection: you see it in the table '
      + 'below and can export it. A query without id is just a report — nothing to export.',
    'sql.selection': 'selection: {n} objects in {ms} ms',
    'sql.report': 'report: {n} rows in {ms} ms',
    'sql.reportNoExport': ' · no id column, cannot export',
    'sql.truncated': ' (truncated)',
    'sql.reportRows': '{n} report rows',

    'data.objects': '{n} objects',
    'data.empty': 'nothing found',
    'data.range': '{from}–{to} of {total}',
    'data.toExport': 'Export this selection',
    'data.chooseDb': 'no database selected — set the data folder in settings',

    'detail.title': 'block {kvartal} stand {vydel}',
    'detail.close': 'close',
    'detail.parsed': 'Parsed fields',
    'detail.raw': 'As in source',
    'detail.extent': 'Extent',
    'detail.geometry': 'geometry',
    'detail.yes': 'present',
    'detail.no': 'missing',
    'detail.lon': 'longitude',
    'detail.lat': 'latitude',

    'export.format': 'Format',
    'export.nothingPicked': 'nothing selected',
    'export.pickLeft': 'select forestries on the left',
    'export.counting': 'counting…',
    'export.estimate': '{vydels} stands, {vertices} vertices → about {files} file(s)',
    'export.willSplit': ' (will be split)',
    'export.nothingMatches': 'nothing matches the filter',
    'export.run': 'Export',
    'export.running': 'Exporting…',
    'export.done': 'done: {vydels} stands in {files} file(s)',
    'export.skippedGeom': ' · skipped for broken geometry: {n}',
    'export.toast': 'Exported {vydels} stands into {files} file(s)',

    'settings.dataDir': 'Data folder',
    'settings.dataDirHint': 'Holds the forest.sqlite database and the raw/ archive. '
      + 'The archive is only needed for syncing: the database is rebuilt from it, not the other way round.',
    'settings.notChosen': 'not selected',
    'settings.choose': 'Choose…',
    'settings.reveal': 'Reveal',
    'settings.language': 'Language',
    'settings.languageHint': 'Follows the system by default.',
    'settings.langSystem': 'follow system',
    'settings.langRu': 'Русский',
    'settings.langEn': 'English',
    'settings.creds': 'GIS credentials',
    'settings.credsHint': 'Needed only for syncing. The password is encrypted by the system '
      + 'keychain and never written to files.',
    'settings.credsNone': 'not set',
    'settings.credsSet': 'Set…',
    'settings.credsForget': 'Forget',
    'settings.credsSaved': 'Saved to the system keychain',
    'settings.credsCleared': 'Credentials forgotten',
    'settings.login': 'Login',
    'settings.password': 'Password',
    'settings.cancel': 'Cancel',
    'settings.save': 'Save',

    'settings.dbSection': 'Database management',
    'settings.check': 'Check for updates',
    'settings.pull': 'Fetch changes',
    'settings.retry': 'Retry failed',
    'settings.rebuild': 'Rebuild from archive',
    'settings.dbHint': 'The check probes each layer fingerprint and downloads nothing. '
      + 'A rebuild is needed after fixes in data parsing — it never contacts the server.',
    'settings.archiveState': 'Archive state',
    'settings.schemas': 'Field schemas',
    'settings.schemasHint': 'Field names across the system are inconsistent: the stand number '
      + 'appears as НумерацияВыделов, Nвыд, NВыд, Нумерация_выделов. This screen shows which '
      + 'field took which role — twice a silent bug hid exactly here.',
    'settings.summary': 'Summary',

    'stat.db': 'Database',
    'stat.archive': 'Archive',
    'stat.archiveLayers': 'Layers in archive',
    'stat.objects': 'Objects',
    'stat.vydels': 'Stands',
    'stat.kvartaly': 'Blocks',
    'stat.forestries': 'Forestries',
    'stat.oblasts': 'Regions',
    'stat.schemaVersion': 'Schema version',
    'stat.none': 'none',

    'sync.noChanges': 'No changes, the database is up to date.',
    'sync.toPull': '{n} layers to fetch',
    'sync.removed': ', {n} gone from the server (kept in the database)',
    'sync.layer': 'Layer',
    'sync.oblast': 'Region',
    'sync.whatChanged': 'What changed',
    'sync.reason': 'Reason',
    'sync.noRights': 'no access (403)',
    'sync.allFetched': 'All layers fetched in full.',
    'sync.badSummary': '{bad} of {layers} layers unavailable: {noRights} without access, '
      + '{other} other. An access denial cannot be fixed by retrying.',
    'sync.archiveUnavailable': 'Archive unavailable.',
    'sync.nothingToPull': 'Nothing to fetch',
    'sync.pulled': 'Fetched {n} layers',
    'sync.rebuilt': 'Database rebuilt',
    'sync.probed': 'probed {i}/{total}',
    'sync.loaded': 'loaded {i}/{total}',
    'sync.status.fetching': 'fetching',
    'sync.status.done': 'done',
    'sync.status.partial': 'incomplete',
    'sync.status.failed': 'failed',
    'sync.pullReport': '{done} layers, {failed} failed, {features} objects',
    'sync.rebuildReport': '{loaded} layers loaded, {links} links',
    'sync.dbConnected': 'Database connected',
    'sync.noDbInDir': 'No database in that folder — sync it or choose another',
    'sync.chooseDbFirst': 'Choose a database file above.',

    'role.les': 'forestry',
    'role.kv': 'block no.',
    'role.vd': 'stand no.',
    'role.comp': 'agency',
    'role.ploshad': 'area',
    'role.poroda': 'species',
    'role.bonitet': 'site class',
    'role.tip_lesa': 'forest type',
    'role.kat_zem': 'land category',
    'role.kat_zasch': 'protection category',

    'col.oblast': 'Region',
    'col.lesnichestvo': 'Forestry',
    'col.kvartal': 'Block',
    'col.vydel': 'Stand',
    'col.ploshad': 'Area, ha',
    'col.poroda': 'Species',
    'col.bonitet': 'Site class',
    'col.tip_lesa': 'Forest type',
    'col.kat_zem': 'Land category',

    'fmt.kml.name': 'KML for Google Earth',
    'fmt.kml.hint': 'Polygons with labels, block and forestry boundaries. '
      + 'Large selections are split to stay under the Google Earth limit.',
    'opt.split': 'Files',
    'opt.split.les': 'one per forestry',
    'opt.split.none': 'a single file',
    'opt.labelFormat': 'Stand labels',
    'opt.labelFormat.vydel': 'stand number — 5',
    'opt.labelFormat.kvvd': 'block-stand — 29-5',
    'opt.labelFormat.full': 'block 29 stand 5',
    'opt.labels': 'labels',
    'opt.kvartaly': 'blocks',
    'opt.outline': 'forestry boundary',
    'opt.index': 'index file with links',
    'opt.budget': 'Vertex limit per file',
    'opt.lesColor': 'Forestry boundary',
    'opt.kvColor': 'Blocks',
    'opt.vdColor': 'Stands',
    'opt.width': 'width',
    'opt.vdFill': 'stand fill',

    'unit.gb': 'GB',
    'unit.mb': 'MB',
    'unit.b': 'B',
  },
};

let lang = 'ru';

export const setLang = (code) => { lang = DICT[code] ? code : 'ru'; };
export const getLang = () => lang;
export const locale = () => (lang === 'ru' ? 'ru-RU' : 'en-US');

/** Translate a key, substituting {name} placeholders. */
export function t(key, params) {
  const s = DICT[lang][key] ?? DICT.ru[key] ?? key;
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, name) => (name in params ? params[name] : m));
}

/**
 * Apply translations to the document.
 *
 * Markup carries the keys: data-i18n for text, data-i18n-ph for placeholders.
 * Re-running this after a language switch is enough — no reload needed.
 */
export function applyDom(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of root.querySelectorAll('[data-i18n-ph]')) {
    el.placeholder = t(el.dataset.i18nPh);
  }
  for (const el of root.querySelectorAll('[data-i18n-html]')) {
    el.innerHTML = t(el.dataset.i18nHtml);
  }
  document.documentElement.lang = lang;
}
