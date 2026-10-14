/**
 * Properties of the chunker for any note: segmenting and joining gives the
 * note back byte for byte, a translator that changes nothing changes
 * nothing, and whatever a translator does to the prose (upper-case it, lose
 * its placeholders, reverse its words) code, maths, links, URLs, HTML, front
 * matter and line endings come back exactly. Notes are the hand-written
 * ones in `markdown-samples.ts` and a couple of thousand generated ones.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { translateMarkdown } from '../src/document.ts';
import type { TranslateTexts } from '../src/document.ts';
import { join, segment } from '../src/segment.ts';
import { SAMPLES, protectedPieces, randomNote } from './markdown-samples.ts';

const NOTES: [string, string][] = [
  ...Object.entries(SAMPLES),
  ...Array.from({ length: 1500 }, (_, i): [string, string] => [`seed ${i + 1}`, randomNote(i + 1)]),
];

const TRANSLATORS: Record<string, TranslateTexts> = {
  'upper case': async (texts) => texts.map((t) => t.toUpperCase()),
  'loses placeholders': async (texts) => texts.map((t) => t.replace(/\{\d+\}/g, '').toUpperCase()),
  'reverses words': async (texts) => texts.map((t) => t.split(' ').reverse().join(' ').toUpperCase()),
};

/**
 * What must come back unchanged. A link's title is prose; a URL's closing
 * quote or bracket is punctuation the translator may move; an HTML comment
 * left open, or opened mid-line, is read differently by the plain reader.
 */
const untouchable = (text: string) =>
  protectedPieces(text.replace(/\r/g, ''))
    .filter((p) => !/^\]\(\S* "/.test(p) && !/^https?:/.test(p) && !(p.startsWith('<!--') && !p.endsWith('-->')))
    .sort();

const lineEndings = (text: string) => text.match(/\r?\n/g) ?? [];

test('segmenting and joining gives back the note exactly', () => {
  for (const [name, note] of NOTES) assert.equal(join(segment(note)), note, name);
});

test('a translator that changes nothing leaves the note as it was', async () => {
  for (const [name, note] of NOTES) assert.equal(await translateMarkdown(note, async (texts) => texts), note, name);
});

test('whatever the translator does, the syntax and the line endings come back', async () => {
  for (const [translator, translate] of Object.entries(TRANSLATORS)) {
    for (const [name, note] of NOTES) {
      if (/%%/.test(note)) continue; // Obsidian comments are read only by the chunker; see the dedicated tests.
      const sent: string[] = [];
      const out = await translateMarkdown(note, async (texts) => {
        sent.push(...texts);
        return translate(texts);
      });
      assert.deepEqual(lineEndings(out), lineEndings(note), `${translator}: ${name}`);
      assert.deepEqual(untouchable(out), untouchable(note), `${translator}: ${name}`);
      for (const text of sent) {
        assert.match(text.replace(/\{\d+\}/g, ''), /\p{L}/u, `${translator}: ${name}`);
        assert.doesNotMatch(text, /```|~~~|\]\(|\[\[/, `${translator}: ${name}`);
      }
    }
  }
});
