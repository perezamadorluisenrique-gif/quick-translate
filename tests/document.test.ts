import test from 'node:test';
import assert from 'node:assert/strict';

import { translateMarkdown } from '../src/document.ts';
import type { TranslateTexts } from '../src/document.ts';

/** A translator that upper-cases, as a stand-in: it keeps `{0}` placeholders like a good one. */
const shout = (calls: string[][] = []): TranslateTexts => async (texts) => {
  calls.push(texts);
  return texts.map((t) => t.toUpperCase());
};

test('only prose is translated; syntax and spacing come back exactly', async () => {
  const doc = '---\ntitle: Hello\n---\n# A heading\n\n- [ ] do the thing [[Note]] now\n\n```js\nconst x = 1;\n```\nEnd.\n';
  const got = await translateMarkdown(doc, shout());
  assert.equal(got, '---\ntitle: Hello\n---\n# A HEADING\n\n- [ ] DO THE THING [[Note]] NOW\n\n```js\nconst x = 1;\n```\nEND.\n');
});

test('a sentence with syntax in the middle is sent whole, with placeholders', async () => {
  const calls: string[][] = [];
  const got = await translateMarkdown('See [[Other note]] for `code` details.', shout(calls));
  assert.deepEqual(calls, [['See {0} for {1} details.']]);
  assert.equal(got, 'SEE [[Other note]] FOR `code` DETAILS.');
});

test('a link label is translated and its address is not', async () => {
  const got = await translateMarkdown('Read [the guide](https://example.com/guide) today', shout());
  assert.equal(got, 'READ [THE GUIDE](https://example.com/guide) TODAY');
});

test('a translator that reorders placeholders still gets them back in place', async () => {
  const got = await translateMarkdown('A [[x]] then `y` end', async () => ['END {1} THEN {0} A']);
  assert.equal(got, 'END `y` THEN [[x]] A');
});

test('a translator that spaces out the placeholders is understood', async () => {
  const got = await translateMarkdown('A [[x]] b', async () => ['A { 0 } B']);
  assert.equal(got, 'A [[x]] B');
});

test('when placeholders are lost the pieces are translated one by one', async () => {
  const calls: string[][] = [];
  const got = await translateMarkdown('See [[Other]] for details.', async (texts) => {
    calls.push(texts);
    return calls.length === 1 ? ['VOIR POUR DETAILS'] : texts.map((t) => `<${t}>`);
  });
  assert.deepEqual(calls, [['See {0} for details.'], ['See', 'for details.']]);
  assert.equal(got, '<See> [[Other]] <for details.>');
});

test('a doubled or invented placeholder counts as lost', async () => {
  const doubled = await translateMarkdown('A [[x]] b', async (texts) => (texts[0].includes('{0}') ? ['{0} {0}'] : texts.map((t) => t.toUpperCase())));
  assert.equal(doubled, 'A [[x]] B');
  const invented = await translateMarkdown('A [[x]] b', async (texts) => (texts[0].includes('{0}') ? ['A {0} {3}'] : texts.map((t) => t.toUpperCase())));
  assert.equal(invented, 'A [[x]] B');
});

test('text that already contains {0} is not sent with placeholders', async () => {
  const calls: string[][] = [];
  const got = await translateMarkdown('Use {0} in [[x]] now', shout(calls));
  assert.deepEqual(calls, [['Use {0} in', 'now']]);
  assert.equal(got, 'USE {0} IN [[x]] NOW');
});

test('spaces around a part survive a translator that trims', async () => {
  const got = await translateMarkdown('  indented line  \n', async (texts) => texts.map((t) => ` ${t.toUpperCase()} `));
  assert.equal(got, '  INDENTED LINE  \n');
});

test('repeated text is sent once', async () => {
  const calls: string[][] = [];
  await translateMarkdown('Yes\nNo\nYes\n- Yes\n', shout(calls));
  assert.deepEqual(calls, [['Yes', 'No']]);
});

test('a document with no prose does not call the translator', async () => {
  const calls: string[][] = [];
  const doc = '---\na: b\n---\n```\ncode\n```\n12345\n';
  assert.equal(await translateMarkdown(doc, shout(calls)), doc);
  assert.deepEqual(calls, []);
});

test('a translator that answers with the wrong count is an error', async () => {
  await assert.rejects(() => translateMarkdown('Hello\nWorld', async () => ['only one']), /different number/);
});

test('table cells are translated one by one and the pipes stay', async () => {
  const got = await translateMarkdown('| Name | Role |\n| --- | --- |\n| Ann | Chief |\n', shout());
  assert.equal(got, '| NAME | ROLE |\n| --- | --- |\n| ANN | CHIEF |\n');
});

test('a callout keeps its type and translates its title and body', async () => {
  const got = await translateMarkdown('> [!warning]- Be careful\n> Hot surface\n', shout());
  assert.equal(got, '> [!warning]- BE CAREFUL\n> HOT SURFACE\n');
});
