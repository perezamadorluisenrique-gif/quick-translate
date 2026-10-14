/** Languages offered for translation, by the code Google and MyMemory use. */
export const LANGUAGES: Record<string, string> = {
  af: 'Afrikaans',
  ar: 'Arabic',
  bg: 'Bulgarian',
  ca: 'Catalan',
  cs: 'Czech',
  da: 'Danish',
  de: 'German',
  el: 'Greek',
  en: 'English',
  es: 'Spanish',
  et: 'Estonian',
  fa: 'Persian',
  fi: 'Finnish',
  fr: 'French',
  he: 'Hebrew',
  hi: 'Hindi',
  hr: 'Croatian',
  hu: 'Hungarian',
  id: 'Indonesian',
  is: 'Icelandic',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  lt: 'Lithuanian',
  lv: 'Latvian',
  ms: 'Malay',
  nl: 'Dutch',
  no: 'Norwegian',
  pl: 'Polish',
  pt: 'Portuguese',
  ro: 'Romanian',
  ru: 'Russian',
  sk: 'Slovak',
  sl: 'Slovenian',
  sr: 'Serbian',
  sv: 'Swedish',
  sw: 'Swahili',
  th: 'Thai',
  tl: 'Filipino',
  tr: 'Turkish',
  uk: 'Ukrainian',
  ur: 'Urdu',
  vi: 'Vietnamese',
  'zh-CN': 'Chinese (Simplified)',
  'zh-TW': 'Chinese (Traditional)',
};

export const DEFAULT_TARGET = 'en';

/** The source-language choices: automatic detection, then every language. */
export const SOURCE_LANGUAGES: Record<string, string> = { auto: 'Detect the language', ...LANGUAGES };

export function languageName(code: string): string {
  return LANGUAGES[code] ?? code;
}

/** `locale` (such as `es`, `pt-br` or `zh-tw`) as one of the codes above, or null. */
export function matchLocale(locale: string): string | null {
  const lower = locale.trim().toLowerCase().replace('_', '-');
  if (!lower) return null;
  const exact = Object.keys(LANGUAGES).find((code) => code.toLowerCase() === lower);
  if (exact) return exact;
  if (lower.startsWith('zh')) return /tw|hk|hant/.test(lower) ? 'zh-TW' : 'zh-CN';
  const base = lower.split('-')[0];
  if (base === 'nb' || base === 'nn') return 'no';
  if (base === 'iw') return 'he';
  return base in LANGUAGES ? base : null;
}

/** Google writes the code of a detected language its own way (`iw` for Hebrew, `zh-CN`); this maps it to ours. */
export function normalizeDetected(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return matchLocale(code) ?? code;
}

// DeepL names languages in capitals, with regions for some targets and Bokmål for Norwegian.
const DEEPL_TARGETS: Record<string, string> = {
  ar: 'AR', bg: 'BG', cs: 'CS', da: 'DA', de: 'DE', el: 'EL', en: 'EN-US', es: 'ES', et: 'ET', fi: 'FI', fr: 'FR',
  he: 'HE', hu: 'HU', id: 'ID', it: 'IT', ja: 'JA', ko: 'KO', lt: 'LT', lv: 'LV', no: 'NB', nl: 'NL', pl: 'PL',
  pt: 'PT-BR', ro: 'RO', ru: 'RU', sk: 'SK', sl: 'SL', sv: 'SV', th: 'TH', tr: 'TR', uk: 'UK', vi: 'VI',
  'zh-CN': 'ZH-HANS', 'zh-TW': 'ZH-HANT',
};

/** DeepL's code for a target language, or null when DeepL does not translate into it. */
export function deepLTarget(code: string): string | null {
  return DEEPL_TARGETS[code] ?? null;
}

/** DeepL's code for a source language (no regions), or null when it does not read it. */
export function deepLSource(code: string): string | null {
  const target = DEEPL_TARGETS[code];
  return target ? target.split('-')[0] : null;
}
