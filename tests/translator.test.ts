import test from 'node:test';
import assert from 'node:assert/strict';

import { TranslateError } from '../src/providers.ts';
import type { Languages } from '../src/providers.ts';
import { Translator, translateDocument } from '../src/translator.ts';
import type { ProviderSettings } from '../src/translator.ts';
import { DEEPL_PRO, fakeHttp, fixture, GOOGLE, googleShout, MYMEMORY, ok } from './helpers.ts';

const LANGS: Languages = { source: 'auto', target: 'es' };
const SETTINGS: ProviderSettings = { provider: 'google', deeplKey: '', email: '', fallback: true };
const myMemoryShout = (request: { url: string }) =>
  ok({ responseStatus: 200, responseData: { translatedText: `mm:${new URL(request.url).searchParams.get('q')}` } });

test('answers are remembered, per provider and language pair', async () => {
  const http = fakeHttp({ [GOOGLE]: googleShout });
  const t = new Translator(http);
  assert.deepEqual((await t.translate(['hello'], LANGS, SETTINGS)).texts, ['HELLO']);
  assert.deepEqual((await t.translate(['hello', 'again'], LANGS, SETTINGS)).texts, ['HELLO', 'AGAIN']);
  assert.equal(http.calls.length, 2);
  await t.translate(['hello'], { source: 'auto', target: 'fr' }, SETTINGS);
  assert.equal(http.calls.length, 3);
});

test('a remembered answer still knows the language it was detected in', async () => {
  const t = new Translator(fakeHttp({ [GOOGLE]: googleShout }));
  await t.translate(['hello'], LANGS, SETTINGS);
  assert.equal((await t.translate(['hello'], LANGS, SETTINGS)).detected, 'en');
});

test('a blocked Google falls back to MyMemory and says why', async () => {
  const http = fakeHttp({ [GOOGLE]: { status: 403, json: null }, [MYMEMORY]: myMemoryShout });
  const got = await new Translator(http).translate(['hello'], LANGS, SETTINGS);
  assert.deepEqual([got.texts, got.provider, got.fellBack], [['mm:hello'], 'mymemory', 'Google Translate refused the request (403).']);
});

test('with the fallback off, the error stands', async () => {
  const http = fakeHttp({ [GOOGLE]: { status: 403, json: null }, [MYMEMORY]: myMemoryShout });
  await assert.rejects(() => new Translator(http).translate(['hello'], LANGS, { ...SETTINGS, fallback: false }), /refused/);
  assert.equal(http.calls.length, 1);
});

test('a wrong DeepL key is never worked around: the text is not sent elsewhere', async () => {
  const http = fakeHttp({ [DEEPL_PRO]: { status: 403, json: null }, [MYMEMORY]: myMemoryShout });
  await assert.rejects(
    () => new Translator(http).translate(['hello'], LANGS, { ...SETTINGS, provider: 'deepl', deeplKey: 'bad' }),
    (e: unknown) => e instanceof TranslateError && e.kind === 'auth',
  );
  assert.ok(http.calls.every((c) => !c.url.startsWith(MYMEMORY)));
});

test('MyMemory failing has nowhere to fall back to', async () => {
  const http = fakeHttp({ [MYMEMORY]: { status: 500, json: null } });
  await assert.rejects(() => new Translator(http).translate(['x'], LANGS, { ...SETTINGS, provider: 'mymemory' }), /status 500/);
});

test('a rate-limited request is retried after a wait, then gives up', async () => {
  let n = 0;
  const waits: number[] = [];
  const flaky = fakeHttp({ [GOOGLE]: (r) => (++n < 3 ? { status: 429, json: null } : googleShout(r)) });
  const got = await new Translator(flaky, async (ms) => void waits.push(ms)).translate(['hi'], LANGS, SETTINGS);
  assert.deepEqual([got.texts, waits], [['HI'], [2000, 5000]]);

  const always = fakeHttp({ [GOOGLE]: { status: 429, json: null } });
  await assert.rejects(() => new Translator(always, async () => {}).translate(['hi'], LANGS, { ...SETTINGS, fallback: false }), /too many requests/);
  assert.equal(always.calls.length, 3);
});

test('an empty translation is an error, not a blank line in the note', async () => {
  const http = fakeHttp({ [GOOGLE]: ok({ sentences: [{ trans: '' }], src: 'en' }) });
  await assert.rejects(() => new Translator(http).translate(['hello'], LANGS, { ...SETTINGS, fallback: false }), /incomplete/);
});

test('progress counts up through chunks of 25', async () => {
  const http = fakeHttp({ [GOOGLE]: googleShout });
  const seen: Array<[number, number]> = [];
  const texts = Array.from({ length: 60 }, (_, i) => `line ${i}`);
  await new Translator(http).translate(texts, LANGS, SETTINGS, (done, total) => void seen.push([done, total]));
  assert.deepEqual(seen, [[0, 60], [25, 60], [50, 60], [60, 60]]);
});

test('a document goes through end to end, with the detected language', async () => {
  const http = fakeHttp({ [GOOGLE]: googleShout });
  const note = '---\ntags: [a]\n---\n# Title\n\nSee [[Other]] and `code` here.\n\n```js\nlet x;\n```\n';
  const got = await translateDocument(new Translator(http), note, LANGS, SETTINGS);
  assert.equal(got.text, '---\ntags: [a]\n---\n# TITLE\n\nSEE [[Other]] AND `code` HERE.\n\n```js\nlet x;\n```\n');
  assert.deepEqual([got.detected, got.provider, got.sent], ['en', 'google', true]);
});

test('a document with no prose reports that nothing was sent', async () => {
  const http = fakeHttp({});
  const got = await translateDocument(new Translator(http), '```\nx\n```\n', LANGS, SETTINGS);
  assert.deepEqual([got.sent, got.text, http.calls.length], [false, '```\nx\n```\n', 0]);
});

test('the fixtures of the real MyMemory answer still parse through the provider', async () => {
  const http = fakeHttp({ [MYMEMORY]: ok(fixture('mymemory-hello.json')) });
  const got = await new Translator(http).translate(['Hello world'], LANGS, { ...SETTINGS, provider: 'mymemory' });
  assert.deepEqual(got.texts, ['Hola mundo']);
});
