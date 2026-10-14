import { translateMarkdown } from './document.ts';
import { deepL, google, myMemory, TranslateError } from './providers.ts';
import type { Batch, Http, Languages, Provider, ProviderId } from './providers.ts';

export interface ProviderSettings {
  provider: ProviderId;
  deeplKey: string;
  /** Optional email for MyMemory, which raises its daily limit. */
  email: string;
  /** When the chosen provider fails, try MyMemory. */
  fallback: boolean;
}

export interface Translated {
  texts: string[];
  detected?: string;
  /** The provider that did the work. */
  provider: ProviderId;
  /** Set when the chosen provider failed and MyMemory answered instead: why. */
  fellBack?: string;
}

/** Texts sent to a provider at a time, so a long note can report how far it has got. */
const CHUNK = 25;
const CACHE_LIMIT = 3000;
/** Waits before retrying a request a provider found too frequent. */
const RETRY_DELAYS = [2000, 5000];

function providerFor(id: ProviderId, settings: ProviderSettings): Provider {
  if (id === 'deepl') return deepL(settings.deeplKey);
  if (id === 'mymemory') return myMemory(settings.email);
  return google;
}

/** Runs the chosen provider (and MyMemory behind it), remembering the answers for the session. */
export class Translator {
  private cache = new Map<string, { text: string; detected?: string }>();

  private readonly http: Http;

  private readonly sleep: (ms: number) => Promise<void>;

  constructor(http: Http, sleep: (ms: number) => Promise<void> = () => Promise.resolve()) {
    this.http = http;
    this.sleep = sleep;
  }

  private key(provider: ProviderId, { source, target }: Languages, text: string): string {
    return `${provider}\u0000${source}\u0000${target}\u0000${text}`;
  }

  private async run(provider: Provider, texts: string[], languages: Languages): Promise<Batch> {
    for (let attempt = 0; ; attempt++) {
      try {
        const got = await provider.translate(texts, languages, this.http);
        if (got.texts.length !== texts.length || got.texts.some((t, i) => !t.trim() && texts[i].trim())) {
          throw new TranslateError('bad-response', 'The translation came back incomplete.');
        }
        return got;
      } catch (error) {
        if (error instanceof TranslateError && error.kind === 'rate-limited' && attempt < RETRY_DELAYS.length) {
          await this.sleep(RETRY_DELAYS[attempt]);
          continue;
        }
        throw error;
      }
    }
  }

  /** Translates `texts` (no blank ones), reporting after each chunk how many are done. It throws a `TranslateError`. */
  async translate(texts: string[], languages: Languages, settings: ProviderSettings, progress?: (done: number, total: number) => void): Promise<Translated> {
    let provider = settings.provider;
    let detected: string | undefined;
    let fellBack: string | undefined;
    const out: string[] = new Array<string>(texts.length);
    const missing: number[] = [];
    texts.forEach((text, i) => {
      const hit = this.cache.get(this.key(provider, languages, text));
      if (hit === undefined) missing.push(i);
      else {
        out[i] = hit.text;
        detected ??= hit.detected;
      }
    });
    progress?.(texts.length - missing.length, texts.length);

    for (let at = 0; at < missing.length; at += CHUNK) {
      const slice = missing.slice(at, at + CHUNK);
      const chunk = slice.map((i) => texts[i]);
      let got: Batch;
      try {
        got = await this.run(providerFor(provider, settings), chunk, languages);
      } catch (error) {
        const reason = error instanceof TranslateError ? error : new TranslateError('bad-response', 'The translation failed.');
        // A wrong key is the user's to fix: do not quietly send their text somewhere else.
        if (provider === 'mymemory' || !settings.fallback || reason.kind === 'auth') throw reason;
        fellBack = reason.message;
        provider = 'mymemory';
        got = await this.run(providerFor(provider, settings), chunk, languages);
      }
      detected ??= got.detected;
      slice.forEach((i, j) => {
        out[i] = got.texts[j];
        this.remember(this.key(provider, languages, texts[i]), { text: got.texts[j], detected: got.detected });
      });
      progress?.(texts.length - missing.length + at + slice.length, texts.length);
    }
    return { texts: out, detected, provider, fellBack };
  }

  private remember(key: string, value: { text: string; detected?: string }) {
    if (this.cache.size >= CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(key, value);
  }
}

export interface TranslatedDocument {
  text: string;
  detected?: string;
  provider: ProviderId;
  fellBack?: string;
  /** Whether any prose was sent at all. */
  sent: boolean;
}

/** Translates Markdown, leaving its syntax alone, and reports what the providers did. */
export async function translateDocument(
  translator: Translator,
  source: string,
  languages: Languages,
  settings: ProviderSettings,
  progress?: (done: number, total: number) => void,
): Promise<TranslatedDocument> {
  const result: TranslatedDocument = { text: source, provider: settings.provider, sent: false };
  const text = await translateMarkdown(source, async (texts) => {
    result.sent = true;
    const got = await translator.translate(texts, languages, settings, progress);
    result.detected ??= got.detected;
    result.provider = got.provider;
    result.fellBack ??= got.fellBack;
    return got.texts;
  });
  result.text = text;
  return result;
}
