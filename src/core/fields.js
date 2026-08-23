/**
 * Разбор схем полей.
 *
 * В системе 10 различных наборов имён полей. Номер выдела встречается как
 * НумерацияВыделов, Nвыд, NВыд, Нумерация_выделов; лесничество — как
 * Лесничество и Лесничеств. Тип слоя по названию тоже не определить: у
 * Северо-Казахстанской области выделы называются ВыдПород, ВыдПород2_12.
 *
 * Поэтому роли выводятся по образцу имени, а не берутся из константы. Дважды
 * это уже приводило к молчаливым ошибкам, каждый раз выглядевшим исправно:
 * захардкоженное НумерацияВыделов покрывало 266 слоёв из 381 (у остальных в
 * подпись попадал бы OBJECTID), а роль «категория земель» перехватывала
 * КатегорияЗащитностиЛесныхЗемель — в названии есть и «категор», и «Земель».
 */

/** [роль, что искать, что исключить] — порядок важен, первое совпадение выигрывает. */
export const ROLE_PATTERNS = [
  // «квар» и «лесн» без окончаний: у Костанайской области поля усечены до
  // «Nквар» и «Лесни», и требование полных слов молча отключало связывание
  // кварталов для всей области.
  ['kv', /квар/i, /выд/i],
  ['vd', /выд/i, /квар/i],
  ['les', /^лесн/i, null],
  ['comp', /^company$/i, null],
  ['ploshad', /^площ/i, null],
  ['poroda', /^порода$/i, null],
  ['bonitet', /^бонитет/i, null],
  ['tip_lesa', /^тип.?леса/i, null],
  // «защитность» разбирается раньше, иначе перехватит роль kat_zem
  ['kat_zasch', /(категор.*защит|^катзащ$)/i, null],
  ['kat_zem', /(категор.*зем|^катзем$)/i, /защит/i],
];

/** Имена полей -> { роль: имя поля }. */
export function resolveRoles(fieldNames) {
  const roles = {};
  for (const [role, include, exclude] of ROLE_PATTERNS) {
    for (const name of fieldNames) {
      if (roles[role]) break;
      if (include.test(name) && !(exclude && exclude.test(name))) roles[role] = name;
    }
  }
  return roles;
}

/**
 * Тип слоя по составу полей, а не по названию.
 * Наличие номера квартала и номера выдела опознаёт слой выделов надёжно.
 */
export function classifyLayer({ layerName = '', geometryType = '', kind = null }, roles) {
  if (!/Polygon/i.test(geometryType)) return 'misc';
  if (/кварт/i.test(layerName) && !roles.vd) return 'kvartal';
  if (roles.vd && roles.kv) return 'vydel';
  return kind || 'misc';
}

/** Значение по роли, без хвоста .0 у чисел с плавающей точкой. */
export function roleValue(props, roles, role) {
  if (!roles[role]) return null;
  const v = props[roles[role]];
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  return v;
}

export function asInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function asFloat(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Ключ для сопоставления названий лесничеств.
 *
 * В исходных данных встречаются опечатки — например «Каскеленско» вместо
 * «Каскеленское» у одного выдела из 2024. Кроме того, слой выделов называется
 * «Каскеленское лесничество», а в атрибутах кварталов то же самое записано как
 * «Каскеленское». Сравнивать сырые строки поэтому нельзя.
 *
 * Нормализация снимает регистр, родовые слова и пунктуацию.
 */
const GENERIC_WORDS = new Set([
  'лесничество', 'лесничества', 'лесничеств', 'лесн', 'лхо',
  'участок', 'участка', 'уч', 'филиал', 'филиала',
  'гу', 'кгу', 'лу', 'гнпп', 'гпз', 'гпр', 'ггпз', 'оопт',
  // «Л-во» и «Уч.» распадаются на части при разбиении по пунктуации
  'л', 'во', 'лво',
]);

export function forestryKey(name) {
  if (!name) return '';
  // Разбор по токенам, а не регуляркой с \b: в JS граница слова определена
  // только для латиницы, и на кириллице «Каскеленское лесничество» осталось бы
  // с родовым словом, не совпав с «Каскеленское» из атрибутов кварталов.
  return String(name)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t && !GENERIC_WORDS.has(t))
    .join('');
}

/** Служебные поля, которые не нужно показывать в балуне KML. */
export const SKIP_FIELDS = new Set([
  'Shape', 'Shape.STArea()', 'Shape.STLength()',
  'created_user', 'created_date', 'last_edited_user', 'last_edited_date',
  'gid',
]);
