/**
 * Resolving field schemas.
 *
 * The system holds 10 different sets of field names. The stand number appears
 * as НумерацияВыделов, Nвыд, NВыд, Нумерация_выделов; the forestry as
 * Лесничество and Лесничеств. Nor can a layer type be told from its name: in
 * the North Kazakhstan region the stands are called ВыдПород, ВыдПород2_12.
 *
 * So roles are derived from the shape of a name instead of a constant. Twice
 * that has already caused silent bugs, each looking perfectly healthy: a
 * hardcoded НумерацияВыделов covered 266 layers out of 381 (the rest would
 * have carried OBJECTID into the labels), and the «land category» role stole
 * КатегорияЗащитностиЛесныхЗемель — the name holds both «категор» and «Земель».
 */

/** [role, what to look for, what to exclude] — order matters, first match wins. */
export const ROLE_PATTERNS = [
  // «квар» and «лесн» without endings: in the Kostanay region the fields are
  // truncated to «Nквар» and «Лесни», and demanding whole words silently
  // switched off block linking for the entire region.
  ['kv', /квар/i, /выд/i],
  ['vd', /выд/i, /квар/i],
  ['les', /^лесн/i, null],
  ['comp', /^company$/i, null],
  ['ploshad', /^площ/i, null],
  ['poroda', /^порода$/i, null],
  ['bonitet', /^бонитет/i, null],
  ['tip_lesa', /^тип.?леса/i, null],
  // «protection category» is resolved first, or it would steal the kat_zem role
  ['kat_zasch', /(категор.*защит|^катзащ$)/i, null],
  ['kat_zem', /(категор.*зем|^катзем$)/i, /защит/i],
];

/** Field names -> { role: field name }. */
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
 * Layer type from the composition of its fields, not from its name.
 * A block number together with a stand number identifies a stand layer surely.
 */
export function classifyLayer({ layerName = '', geometryType = '', kind = null }, roles) {
  if (!/Polygon/i.test(geometryType)) return 'misc';
  if (/кварт/i.test(layerName) && !roles.vd) return 'kvartal';
  if (roles.vd && roles.kv) return 'vydel';
  return kind || 'misc';
}

/** Value by role, without the trailing .0 of floating point numbers. */
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
 * Key for matching forestry names.
 *
 * The source data contains typos — «Каскеленско» instead of «Каскеленское»
 * on one stand from 2024. On top of that the stand layer is called
 * «Каскеленское лесничество» while the block attributes spell the same thing
 * «Каскеленское». Comparing raw strings is therefore out.
 *
 * Normalisation strips case, generic words and punctuation.
 */
const GENERIC_WORDS = new Set([
  'лесничество', 'лесничества', 'лесничеств', 'лесн', 'лхо',
  'участок', 'участка', 'уч', 'филиал', 'филиала',
  'гу', 'кгу', 'лу', 'гнпп', 'гпз', 'гпр', 'ггпз', 'оопт',
  // «Л-во» and «Уч.» fall apart into pieces when split on punctuation
  'л', 'во', 'лво',
]);

export function forestryKey(name) {
  if (!name) return '';
  // Split into tokens rather than a regex with \b: in JS a word boundary is
  // defined for Latin only, so on Cyrillic «Каскеленское лесничество» would
  // keep its generic word and never match «Каскеленское» from the blocks.
  return String(name)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t && !GENERIC_WORDS.has(t))
    .join('');
}

/** Service fields that need not be shown in a KML balloon. */
export const SKIP_FIELDS = new Set([
  'Shape', 'Shape.STArea()', 'Shape.STLength()',
  'created_user', 'created_date', 'last_edited_user', 'last_edited_date',
  'gid',
]);
