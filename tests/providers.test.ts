import test from 'node:test';
import assert from 'node:assert/strict';

import { deepLSource, deepLTarget, matchLocale, normalizeDetected } from '../src/languages.ts';
import { deepL, deepLHost, google, groups, myMemory, parseDeepL, parseGoogle, parseMyMemory, splitLong, TranslateError, utf8Bytes } from '../src/providers.ts';
import { DEEPL_FREE, DEEPL_PRO, fakeHttp, fixture, GOOGLE, googleQuery, googleShout, MYMEMORY, ok } from './helpers.ts';

const EN_ES = { source: 'auto', target: 'es' };

test('Google: both answer shapes read as the same translation, with the detected language', () => {
  const expected = { text: 'Hola mundo. ¿Cómo estás?', detected: 'en' };
  assert.deepEqual(parseGoogle(fixture('google-dj.json')), expected);
  assert.deepEqual(parseGoogle(fixture('google-array.json')), expected);
  assert.equal(parseGoogle('<html>'), null);
  assert.equal(parseGoogle({ sentences: 'no' }), null);
});

test('Google: one line is one request, with the languages and the text in the address', async () => {
  const http = fakeHttp({ [GOOGLE]: ok(fixture('google-dj.json')) });
  const got = await google.translate(['Hello world. How are you?'], EN_ES, http);
  assert.deepEqual(got, { texts: ['Hola mundo. ¿Cómo estás?'], detected: 'en' });
  const url = new URL(http.calls[0].url);
  assert.deepEqual([url.searchParams.get('client'), url.searchParams.get('sl'), url.searchParams.get('tl'), url.searchParams.get('q')], ['gtx', 'auto', 'es', 'Hello world. How are you?']);
});

test('Google: several lines share a request and come back one each', async () => {
  const http = fakeHttp({ [GOOGLE]: googleShout });
  const got = await google.translate(['one', 'two words', 'tres'], EN_ES, http);
  assert.deepEqual(got.texts, ['ONE', 'TWO WORDS', 'TRES']);
  assert.equal(http.calls.length, 1);
  assert.equal(googleQuery(http.calls[0].url), 'one\ntwo words\ntres');
});

test('Google: if the lines do not come back one each, they are sent one at a time', async () => {
  const http = fakeHttp({
    [GOOGLE]: (request) => {
      const text = googleQuery(request.url);
      return ok({ sentences: [{ trans: text.includes('\n') ? text.replace(/\n/g, ' ').toUpperCase() : text.toUpperCase() }], src: 'fr' });
    },
  });
  const got = await google.translate(['un', 'deux'], EN_ES, http);
  assert.deepEqual(got.texts, ['UN', 'DEUX']);
  assert.equal(http.calls.length, 3);
});

test('Google: a very long line goes in pieces and is joined with its spaces', async () => {
  const sentence = 'This is a sentence that is fairly long. ';
  const text = sentence.repeat(60).trim();
  const http = fakeHttp({ [GOOGLE]: googleShout });
  const got = await google.translate([text], EN_ES, http);
  assert.equal(got.texts[0], text.toUpperCase());
  assert.ok(http.calls.length > 1);
  for (const call of http.calls) assert.ok(call.url.length < 3500, `${call.url.length}`);
});

test('Google: statuses become errors a person can read', async () => {
  for (const [status, kind] of [[429, 'rate-limited'], [403, 'blocked'], [500, 'bad-response']] as const) {
    await assert.rejects(
      () => google.translate(['x'], EN_ES, fakeHttp({ [GOOGLE]: { status, json: null } })),
      (e: unknown) => e instanceof TranslateError && e.kind === kind,
    );
  }
  await assert.rejects(() => google.translate(['x'], EN_ES, fakeHttp({ [GOOGLE]: 'throw' })), (e: unknown) => e instanceof TranslateError && e.kind === 'network');
  await assert.rejects(
    () => google.translate(['x'], EN_ES, fakeHttp({ [GOOGLE]: ok('<html>blocked</html>') })),
    (e: unknown) => e instanceof TranslateError && e.kind === 'bad-response',
  );
});

test('DeepL: free and pro keys use their own hosts, the key goes in the header, texts go as a list', async () => {
  assert.equal(deepLHost('abc:fx'), 'https://api-free.deepl.com');
  assert.equal(deepLHost(' abc '), 'https://api.deepl.com');
  const http = fakeHttp({ [DEEPL_FREE]: ok(fixture('deepl.json')) });
  const got = await deepL('key:fx').translate(['Hello world', 'How are you?'], { source: 'auto', target: 'es' }, http);
  assert.deepEqual(got, { texts: ['Hola mundo', '¿Cómo estás?'], detected: 'en' });
  const call = http.calls[0];
  assert.equal(call.method, 'POST');
  assert.equal(call.headers?.Authorization, 'DeepL-Auth-Key key:fx');
  assert.deepEqual(JSON.parse(call.body ?? ''), { text: ['Hello world', 'How are you?'], target_lang: 'ES', preserve_formatting: true });
});

test('DeepL: language codes map to its own, and an unsupported one is refused before any request', async () => {
  assert.deepEqual([deepLTarget('en'), deepLTarget('pt'), deepLTarget('no'), deepLTarget('zh-TW'), deepLTarget('sw')], ['EN-US', 'PT-BR', 'NB', 'ZH-HANT', null]);
  assert.deepEqual([deepLSource('en'), deepLSource('pt'), deepLSource('zh-CN')], ['EN', 'PT', 'ZH']);
  const http = fakeHttp({ [DEEPL_PRO]: ok(fixture('deepl.json')) });
  await assert.rejects(() => deepL('key').translate(['x'], { source: 'auto', target: 'sw' }, http), /does not translate into Swahili/);
  assert.equal(http.calls.length, 0);
  await deepL('key').translate(['x', 'y'], { source: 'fr', target: 'de' }, http);
  assert.equal(JSON.parse(http.calls[0].body ?? '').source_lang, 'FR');
});

test('DeepL: no key, a wrong key and a spent quota each say so', async () => {
  await assert.rejects(() => deepL('').translate(['x'], EN_ES, fakeHttp({})), (e: unknown) => e instanceof TranslateError && e.kind === 'auth');
  await assert.rejects(() => deepL('k').translate(['x'], EN_ES, fakeHttp({ [DEEPL_PRO]: { status: 403, json: null } })), (e: unknown) => e instanceof TranslateError && e.kind === 'auth');
  await assert.rejects(() => deepL('k').translate(['x'], EN_ES, fakeHttp({ [DEEPL_PRO]: { status: 456, json: null } })), (e: unknown) => e instanceof TranslateError && e.kind === 'quota');
  assert.equal(parseDeepL({ translations: [{ text: 1 }] }), null);
});

test('DeepL: more than 40 texts go in several requests', async () => {
  const http = fakeHttp({
    [DEEPL_PRO]: (request) => ok({ translations: (JSON.parse(request.body ?? '').text as string[]).map((t) => ({ text: t.toUpperCase() })) }),
  });
  const texts = Array.from({ length: 95 }, (_, i) => `text ${i}`);
  const got = await deepL('k').translate(texts, EN_ES, http);
  assert.equal(http.calls.length, 3);
  assert.deepEqual(got.texts, texts.map((t) => t.toUpperCase()));
});

test('MyMemory: reads the translation, asks for autodetection, and sends an email when given', async () => {
  const http = fakeHttp({ [MYMEMORY]: ok(fixture('mymemory-hello.json')) });
  const got = await myMemory('me@example.com').translate(['Hello world'], EN_ES, http);
  assert.deepEqual(got.texts, ['Hola mundo']);
  const url = new URL(http.calls[0].url);
  assert.deepEqual([url.searchParams.get('q'), url.searchParams.get('langpair'), url.searchParams.get('de')], ['Hello world', 'Autodetect|es', 'me@example.com']);
  const plain = fakeHttp({ [MYMEMORY]: ok(fixture('mymemory-hello.json')) });
  await myMemory('').translate(['Hello world'], { source: 'en', target: 'es' }, plain);
  const u = new URL(plain.calls[0].url);
  assert.deepEqual([u.searchParams.get('langpair'), u.searchParams.has('de')], ['en|es', false]);
});

test('MyMemory: same-language, quota and bad-language answers', () => {
  assert.equal(parseMyMemory(fixture('mymemory-same-language.json'), 'Hola mundo'), 'Hola mundo');
  assert.throws(() => parseMyMemory({ responseStatus: 200, quotaFinished: true, responseData: { translatedText: 'x' } }, 'x'), (e: unknown) => e instanceof TranslateError && e.kind === 'quota');
  assert.throws(() => parseMyMemory({ responseStatus: 429, responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY' } }, 'x'), (e: unknown) => e instanceof TranslateError && e.kind === 'quota');
  assert.throws(() => parseMyMemory({ responseStatus: 403, responseData: { translatedText: "'XX' IS AN INVALID TARGET LANGUAGE" } }, 'x'), (e: unknown) => e instanceof TranslateError && e.kind === 'unsupported');
  assert.throws(() => parseMyMemory({}, 'x'), (e: unknown) => e instanceof TranslateError && e.kind === 'bad-response');
});

test('MyMemory: a line over 450 bytes is sent in pieces that rebuild it', async () => {
  const text = 'Ça va très bien, merci beaucoup. '.repeat(30).trim();
  const http = fakeHttp({
    [MYMEMORY]: (request) => ok({ responseStatus: 200, responseData: { translatedText: new URL(request.url).searchParams.get('q')?.toUpperCase() } }),
  });
  const got = await myMemory('').translate([text, 'short'], EN_ES, http);
  assert.equal(got.texts[0], text.toUpperCase());
  assert.equal(got.texts[1], 'SHORT');
  for (const call of http.calls) assert.ok(utf8Bytes(new URL(call.url).searchParams.get('q') ?? '') <= 450);
});

test('splitLong cuts at sentence ends, then spaces, and never loses text', () => {
  const text = 'One sentence here. Another sentence follows! And a third? Yes, a fourth one too.';
  const pieces = splitLong(text, 30);
  assert.ok(pieces.length > 1 && pieces.every((p) => p.length <= 30));
  assert.equal(pieces.join(''), text);
  assert.deepEqual(splitLong('short', 30), ['short']);
  const noBreaks = 'x'.repeat(100);
  assert.equal(splitLong(noBreaks, 30).join(''), noBreaks);
  const cjk = '这是一个很长的句子，没有空格。'.repeat(5);
  assert.equal(splitLong(cjk, 40, utf8Bytes).join(''), cjk);
});

test('groups keeps order and respects both limits', () => {
  assert.deepEqual(groups(['aa', 'bb', 'cc', 'dd'], 4, (t) => t.length), [['aa', 'bb'], ['cc', 'dd']]);
  assert.deepEqual(groups(['a', 'b', 'c'], 100, (t) => t.length, 2), [['a', 'b'], ['c']]);
  assert.deepEqual(groups(['toolong'], 3, (t) => t.length), [['toolong']]);
});

test('language helpers map locales and detected codes onto ours', () => {
  assert.deepEqual([matchLocale('es'), matchLocale('pt-BR'), matchLocale('zh_tw'), matchLocale('zh'), matchLocale('nb'), matchLocale('xx'), matchLocale('')], ['es', 'pt', 'zh-TW', 'zh-CN', 'no', null, null]);
  assert.deepEqual([normalizeDetected('iw'), normalizeDetected('zh-CN'), normalizeDetected('haw'), normalizeDetected(undefined)], ['he', 'zh-CN', 'haw', undefined]);
});
