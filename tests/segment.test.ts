import test from 'node:test';
import assert from 'node:assert/strict';

import { join, segment } from '../src/segment.ts';

/** Each line's prose parts, with the kept syntax shown as ‹…›. */
function view(source: string): string[] {
  return segment(source).map((line) => line.map((p) => (p.keep ? `‹${p.text.replace(/\n/g, '\\n')}›` : p.text)).join(''));
}

test('segmenting never changes the text', () => {
  const doc = '---\ntitle: x\n---\n# Heading ##\n\n- [ ] task [[Link|alias]] and `code`\r\n> [!note]- Title\n> body\n\n```js\nconst a = 1;\n```\n| a | b |\n|---|---|\n| [[x|y]] | **bold** |\n$$\nx\n$$\nend';
  assert.equal(join(segment(doc)), doc);
});

test('front matter, fences, maths and comments are kept whole', () => {
  assert.deepEqual(view('---\ntitle: Hello world\n---\nHello\n```\nnot prose\n```\n$$\nx = y\n$$\n%%\nprivate note\n%%\n<!-- a comment -->\nafter'), [
    '‹---\\n›',
    '‹title: Hello world\\n›',
    '‹---\\n›',
    'Hello‹\\n›',
    '‹```\\n›',
    '‹not prose\\n›',
    '‹```\\n›',
    '‹$$\\n›',
    '‹x = y\\n›',
    '‹$$\\n›',
    '‹%%\\n›',
    '‹private note\\n›',
    '‹%%\\n›',
    '‹<!-- a comment -->\\n›',
    'after',
  ]);
});

test('a document that opens with a rule has no front matter', () => {
  assert.deepEqual(view('---\nHello there\n'), ['‹---\\n›', 'Hello there‹\\n›']);
});

test('a fence closes only on a matching fence, and ~~~ differs from ```', () => {
  assert.deepEqual(view('````\n```\ninside\n````\nout\n~~~\ncode\n```\nstill code\n~~~\nout again'), [
    '‹````\\n›', '‹```\\n›', '‹inside\\n›', '‹````\\n›', 'out‹\\n›', '‹~~~\\n›', '‹code\\n›', '‹```\\n›', '‹still code\\n›', '‹~~~\\n›', 'out again',
  ]);
});

test('single-line maths and comments are kept, and an unclosed %% runs to the end', () => {
  assert.deepEqual(view('$$a+b$$\n%%hidden%%\ntext\n%%\nhidden'), ['‹$$a+b$$\\n›', '‹%%hidden%%\\n›', 'text‹\\n›', '‹%%\\n›', '‹hidden›']);
});

test('list markers, tasks, quotes, headings and callouts keep their syntax', () => {
  assert.deepEqual(view('- [x] Buy milk\n  1. Second level\n> [!tip]+ Nice trick\n> > Nested quote\n## Title ##\n> ### Quoted heading\n[^1]: A footnote'), [
    '‹- [x] ›Buy milk‹\\n›',
    '‹  1. ›Second level‹\\n›',
    '‹> [!tip]+ ›Nice trick‹\\n›',
    '‹> > ›Nested quote‹\\n›',
    '‹## ›Title‹ ##\\n›',
    '‹> ### ›Quoted heading‹\\n›',
    '‹[^1]: ›A footnote',
  ]);
});

test('links keep their address, wikilinks and embeds stay whole, bare addresses are kept', () => {
  assert.deepEqual(view('See [the docs](https://example.com/a_b) and [[Note#Head|shown]] ![[img.png]] or https://example.com/x.'), [
    'See ‹[›the docs‹](https://example.com/a_b)› and ‹[[Note#Head|shown]] ![[img.png]]› or ‹https://example.com/x.›',
  ]);
});

test('inline code, maths, tags, footnote references, block ids and emphasis markers stay', () => {
  assert.deepEqual(view('Use `a ``b`` c` and ``x`` with $x^2$ #todo/now **bold** word[^2] ^block-1'), [
    'Use ‹`a ``b`` c`› and ‹``x``› with ‹$x^2$ #todo/now **›bold‹**› word‹[^2] ^block-1›',
  ]);
});

test('prices, issue numbers and lone backticks are prose', () => {
  assert.deepEqual(view('It costs $5 or $10, see #12 and a ` tick'), ['It costs $5 or $10, see #12 and a ` tick']);
  assert.deepEqual(view('Issue#7 and C# language'), ['Issue#7 and C# language']);
});

test('table rows keep their pipes, and a pipe in a wikilink is not a column', () => {
  assert.deepEqual(view('| Name | See [[A|b]] |\n| --- | :-: |\n| one | two |'), [
    '‹|› Name ‹|› See ‹[[A|b]] |\\n›',
    '‹| --- | :-: |\\n›',
    '‹|› one ‹|› two ‹|›',
  ]);
});

test('lines with no letters, rules and link definitions are kept', () => {
  assert.deepEqual(view('***\n12 + 34 = 46\n[ref]: https://example.com "Title"\n2024-01-02'), ['‹***\\n›', '‹12 + 34 = 46\\n›', '‹[ref]: https://example.com "Title"\\n›', '‹2024-01-02›']);
});

test('Templater tags and HTML tags stay, the text between HTML tags is prose', () => {
  assert.deepEqual(view('<% tp.date.now() %> <b>bold text</b> <br/>'), ['‹<% tp.date.now() %> <b>›bold text‹</b> <br/>›']);
});

test('escapes stay so they are not translated away', () => {
  assert.deepEqual(view('Not \\*italic\\* here'), ['Not ‹\\*›italic‹\\*› here']);
});

test('CRLF line endings are kept per line', () => {
  const doc = 'one\r\ntwo\nthree';
  assert.equal(join(segment(doc)), doc);
  assert.deepEqual(view(doc), ['one‹\r\\n›', 'two‹\\n›', 'three']);
});

test('an empty document has no lines', () => {
  assert.deepEqual(segment(''), []);
});
