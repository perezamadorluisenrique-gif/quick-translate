import { deepLSource, deepLTarget, languageName, normalizeDetected } from './languages.ts';

export type ProviderId = 'google' | 'deepl' | 'mymemory';

export const PROVIDERS: Record<ProviderId, string> = {
  google: 'Google Translate (no key, unofficial)',
  deepl: 'DeepL (your own key)',
  mymemory: 'MyMemory (no key, limited per day)',
};

export interface HttpRequest {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  json: unknown;
}

/** Every request goes through this, so tests and the end-to-end specs answer without a network. It throws when there is none. */
export type Http = (request: HttpRequest) => Promise<HttpResponse>;

export type TranslateErrorKind = 'network' | 'rate-limited' | 'blocked' | 'auth' | 'quota' | 'unsupported' | 'bad-response';

export class TranslateError extends Error {
  readonly kind: TranslateErrorKind;

  constructor(kind: TranslateErrorKind, message: string) {
    super(message);
    this.name = 'TranslateError';
    this.kind = kind;
  }
}

export interface Languages {
  /** `auto` or a code from `LANGUAGES`. */
  source: string;
  target: string;
}

export interface Batch {
  texts: string[];
  /** The language the provider recognised, when it says. */
  detected?: string;
}

export interface Provider {
  id: ProviderId;
  /** Translates `texts` (single lines, none blank) and answers in the same order. */
  translate(texts: string[], languages: Languages, http: Http): Promise<Batch>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failStatus(status: number, service: string): never {
  if (status === 429) throw new TranslateError('rate-limited', `${service} says too many requests. Wait a minute and try again.`);
  if (status === 403 || status === 503) throw new TranslateError('blocked', `${service} refused the request (${status}).`);
  throw new TranslateError('bad-response', `${service} answered with status ${status}.`);
}

const encode = encodeURIComponent;

// --- Splitting long lines ------------------------------------------------------------------------------------------

/** The size of `text` as a provider counts it. */
export type Measure = (text: string) => number;

export const utf8Bytes: Measure = (text) => new TextEncoder().encode(text).length;

/**
 * Splits `text` into pieces that each measure at most `max`, at sentence ends if it can, else at spaces, else anywhere.
 * Joining the pieces gives `text` back.
 */
export function splitLong(text: string, max: number, measure: Measure = (t) => t.length): string[] {
  if (measure(text) <= max) return [text];
  const out: string[] = [];
  let current = '';
  const add = (piece: string) => {
    if (current && measure(current + piece) > max) {
      out.push(current);
      current = '';
    }
    if (measure(piece) > max) {
      // A piece with no place to cut: take it a character at a time.
      for (const ch of piece) {
        if (current && measure(current + ch) > max) {
          out.push(current);
          current = '';
        }
        current += ch;
      }
      return;
    }
    current += piece;
  };
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]*\s*|\s+/g) ?? [text];
  for (const sentence of sentences) {
    if (measure(sentence) <= max) add(sentence);
    else for (const word of sentence.match(/\S+\s*|\s+/g) ?? [sentence]) add(word);
  }
  if (current) out.push(current);
  return out;
}

/** Groups `texts` in order so that each group's `size` stays at or under `max` and has at most `count` texts. */
export function groups(texts: string[], max: number, size: (text: string) => number, count = Infinity): string[][] {
  const out: string[][] = [];
  let current: string[] = [];
  let total = 0;
  for (const text of texts) {
    const s = size(text);
    if (current.length > 0 && (total + s > max || current.length >= count)) {
      out.push(current);
      current = [];
      total = 0;
    }
    current.push(text);
    total += s;
  }
  if (current.length > 0) out.push(current);
  return out;
}

// --- Google ---------------------------------------------------------------------------------------------------------

/** The address-length budget for the text of one request. */
const GOOGLE_QUERY_LIMIT = 3000;

export function googleUrl(text: string, { source, target }: Languages): string {
  return `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encode(source)}&tl=${encode(target)}&dt=t&dj=1&q=${encode(text)}`;
}

/**
 * Reads the answer of the free web endpoint: `{ sentences: [{ trans }], src }` with `dj=1`, or the older nested arrays
 * `[[[translated, original], ...], null, source]`. Returns null for anything else.
 */
export function parseGoogle(json: unknown): { text: string; detected?: string } | null {
  let text = '';
  let detected: unknown;
  if (isRecord(json) && Array.isArray(json.sentences)) {
    for (const s of json.sentences) if (isRecord(s) && typeof s.trans === 'string') text += s.trans;
    detected = json.src;
  } else if (Array.isArray(json) && Array.isArray(json[0])) {
    for (const s of json[0]) if (Array.isArray(s) && typeof s[0] === 'string') text += s[0];
    detected = json[2];
  } else return null;
  return { text, detected: typeof detected === 'string' ? normalizeDetected(detected) : undefined };
}

async function googleOne(text: string, languages: Languages, http: Http): Promise<{ text: string; detected?: string }> {
  let res: HttpResponse;
  try {
    res = await http({ url: googleUrl(text, languages) });
  } catch {
    throw new TranslateError('network', 'Could not reach Google Translate. Check your connection.');
  }
  if (res.status !== 200) failStatus(res.status, 'Google Translate');
  const parsed = parseGoogle(res.json);
  if (!parsed) throw new TranslateError('bad-response', 'Google Translate answered in a format this version does not know. Try another provider.');
  return parsed;
}

const encodedLength: Measure = (text) => encode(text).length;

/** A long line goes out in pieces of this encoded size, so that a request holds several. */
const GOOGLE_PIECE = 1000;

export const google: Provider = {
  id: 'google',
  async translate(texts, languages, http) {
    const pieces = texts.map((t) => splitLong(t, GOOGLE_PIECE, encodedLength));
    const answers: string[] = [];
    let detected: string | undefined;
    // Several lines go in one request, one per line of it; if they do not come back one per line, one request each.
    for (const batch of groups(pieces.flat(), GOOGLE_QUERY_LIMIT, (t) => encodedLength(t) + 3)) {
      let lines: string[] | null = null;
      if (batch.length > 1) {
        const got = await googleOne(batch.join('\n'), languages, http);
        detected ??= got.detected;
        const split = got.text.replace(/\n+$/, '').split('\n');
        if (split.length === batch.length && split.every((s) => s.trim())) lines = split;
      }
      if (!lines) {
        lines = [];
        for (const piece of batch) {
          const got = await googleOne(piece, languages, http);
          detected ??= got.detected;
          lines.push(got.text);
        }
      }
      answers.push(...lines);
    }
    // The pieces of a long line go back together, with the space that followed each one.
    let at = 0;
    const out = pieces.map((parts) => {
      const text = parts.map((original, i) => answers[at + i].trimEnd() + /\s*$/.exec(original)?.[0]).join('');
      at += parts.length;
      return text;
    });
    return { texts: out, detected };
  },
};

// --- DeepL ----------------------------------------------------------------------------------------------------------

const DEEPL_TEXTS = 40;
const DEEPL_BYTES = 60_000;

/** Free keys end in `:fx` and use their own host. */
export function deepLHost(key: string): string {
  return key.trim().endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
}

export function parseDeepL(json: unknown): { texts: string[]; detected: Array<string | undefined> } | null {
  if (!isRecord(json) || !Array.isArray(json.translations)) return null;
  const texts: string[] = [];
  const detected: Array<string | undefined> = [];
  for (const t of json.translations) {
    if (!isRecord(t) || typeof t.text !== 'string') return null;
    texts.push(t.text);
    detected.push(typeof t.detected_source_language === 'string' ? normalizeDetected(t.detected_source_language.toLowerCase()) : undefined);
  }
  return { texts, detected };
}

export function deepL(key: string): Provider {
  return {
    id: 'deepl',
    async translate(texts, { source, target }, http) {
      if (!key.trim()) throw new TranslateError('auth', 'Add your DeepL key in the settings first.');
      const to = deepLTarget(target);
      if (!to) throw new TranslateError('unsupported', `DeepL does not translate into ${languageName(target)}.`);
      const from = source === 'auto' ? undefined : deepLSource(source);
      if (source !== 'auto' && !from) throw new TranslateError('unsupported', `DeepL does not read ${languageName(source)}.`);

      const out: string[] = [];
      let detected: string | undefined;
      for (const batch of groups(texts, DEEPL_BYTES, utf8Bytes, DEEPL_TEXTS)) {
        let res: HttpResponse;
        try {
          res = await http({
            url: `${deepLHost(key)}/v2/translate`,
            method: 'POST',
            headers: { Authorization: `DeepL-Auth-Key ${key.trim()}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: batch, target_lang: to, ...(from ? { source_lang: from } : {}), preserve_formatting: true }),
          });
        } catch {
          throw new TranslateError('network', 'Could not reach DeepL. Check your connection.');
        }
        if (res.status === 403) throw new TranslateError('auth', 'DeepL rejected the key. Check it in the settings.');
        if (res.status === 456) throw new TranslateError('quota', 'Your DeepL quota is used up for this period.');
        if (res.status === 400) throw new TranslateError('unsupported', 'DeepL could not translate that text between those languages.');
        if (res.status !== 200) failStatus(res.status, 'DeepL');
        const parsed = parseDeepL(res.json);
        if (!parsed || parsed.texts.length !== batch.length) throw new TranslateError('bad-response', 'DeepL answered in a format this version does not know.');
        out.push(...parsed.texts);
        detected ??= parsed.detected.find(Boolean);
      }
      return { texts: out, detected };
    },
  };
}

// --- MyMemory -------------------------------------------------------------------------------------------------------

/** MyMemory takes at most 500 bytes of text per request. */
const MYMEMORY_BYTES = 450;

export function myMemoryUrl(text: string, { source, target }: Languages, email: string): string {
  const pair = `${source === 'auto' ? 'Autodetect' : source}|${target}`;
  return `https://api.mymemory.translated.net/get?q=${encode(text)}&langpair=${encode(pair)}${email.trim() ? `&de=${encode(email.trim())}` : ''}`;
}

/** The translated text, or an error for the quota and language warnings MyMemory sends in place of a translation. */
export function parseMyMemory(json: unknown, original: string): string {
  if (!isRecord(json) || !isRecord(json.responseData) || typeof json.responseData.translatedText !== 'string') {
    throw new TranslateError('bad-response', 'MyMemory answered in a format this version does not know.');
  }
  const text = json.responseData.translatedText;
  const status = Number(json.responseStatus);
  if (json.quotaFinished === true || /^MYMEMORY WARNING/i.test(text)) {
    throw new TranslateError('quota', 'MyMemory’s free daily limit is used up. Add an email in the settings for a larger one, or try again tomorrow.');
  }
  if (status === 403 && /DISTINCT LANGUAGES/i.test(text)) return original;
  if (status !== 200) throw new TranslateError('unsupported', `MyMemory could not translate that: ${text.slice(0, 120)}`);
  return text;
}

export function myMemory(email: string): Provider {
  return {
    id: 'mymemory',
    async translate(texts, languages, http) {
      const out: string[] = [];
      for (const text of texts) {
        const pieces: string[] = [];
        for (const piece of splitLong(text, MYMEMORY_BYTES, utf8Bytes)) {
          let res: HttpResponse;
          try {
            res = await http({ url: myMemoryUrl(piece, languages, email) });
          } catch {
            throw new TranslateError('network', 'Could not reach MyMemory. Check your connection.');
          }
          if (res.status !== 200) failStatus(res.status, 'MyMemory');
          pieces.push(parseMyMemory(res.json, piece));
        }
        out.push(pieces.join(''));
      }
      return { texts: out };
    },
  };
}
