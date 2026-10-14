import { readFileSync } from 'node:fs';

import type { Http, HttpRequest, HttpResponse } from '../src/providers.ts';

export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
}

type Route = HttpResponse | ((request: HttpRequest) => HttpResponse) | 'throw';

/**
 * A fake network: the first route whose key the address starts with answers; anything else is a 404.
 * `calls` lists every request, in order.
 */
export function fakeHttp(routes: Record<string, Route>): Http & { calls: HttpRequest[] } {
  const calls: HttpRequest[] = [];
  const http = async (request: HttpRequest): Promise<HttpResponse> => {
    calls.push(request);
    const key = Object.keys(routes).find((k) => request.url.startsWith(k));
    if (!key) return { status: 404, json: null };
    const route = routes[key];
    if (route === 'throw') throw new Error('offline');
    return typeof route === 'function' ? route(request) : route;
  };
  return Object.assign(http, { calls });
}

export const ok = (json: unknown): HttpResponse => ({ status: 200, json });

export const GOOGLE = 'https://translate.googleapis.com/translate_a/single';
export const DEEPL_FREE = 'https://api-free.deepl.com/v2/translate';
export const DEEPL_PRO = 'https://api.deepl.com/v2/translate';
export const MYMEMORY = 'https://api.mymemory.translated.net/get';

/** The text a Google request asks for. */
export function googleQuery(url: string): string {
  return decodeURIComponent(new URL(url).searchParams.get('q') ?? '');
}

/** A Google answer that upper-cases the text, line for line. */
export function googleShout(request: HttpRequest): HttpResponse {
  const text = googleQuery(request.url);
  return ok({ sentences: [{ trans: text.toUpperCase() }], src: 'en' });
}
