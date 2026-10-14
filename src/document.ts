import { join, segment } from './segment.ts';
import type { Line, Part } from './segment.ts';

/** Translates each text and gives the results in the same order. It throws when it cannot. */
export type TranslateTexts = (texts: string[]) => Promise<string[]>;

const HOLE = /\{\s*(\d+)\s*\}/g;

/** A stretch of prose translated in one go. Syntax inside it is sent as `{0}`, `{1}`... and put back afterwards. */
interface Unit {
  /** Index of the first and last part it covers. */
  from: number;
  to: number;
  /** What is sent: its prose with a placeholder for each kept part inside it. */
  text: string;
  /** The kept parts that stand in for the placeholders. */
  holes: string[];
}

/** The text with its edges split off, so a translator that trims them cannot eat the spaces between words. */
function edges(text: string): { before: string; core: string; after: string } {
  const core = text.trim();
  if (!core) return { before: text, core: '', after: '' };
  const start = text.indexOf(core);
  return { before: text.slice(0, start), core, after: text.slice(start + core.length) };
}

/** The whole stretch from the first prose part to the last, or null when the line has no prose or reads `{0}` already. */
function unitOf(line: Line): Unit | null {
  const indexes = line.flatMap((p, i) => (p.keep ? [] : [i]));
  if (indexes.length < 2) return null;
  const from = indexes[0];
  const to = indexes[indexes.length - 1];
  const holes: string[] = [];
  let text = '';
  for (let i = from; i <= to; i++) {
    const part = line[i];
    if (part.keep) text += `{${holes.push(part.text) - 1}}`;
    else {
      if (/\{\s*\d+\s*\}/.test(part.text)) return null;
      text += part.text;
    }
  }
  return { from, to, text, holes };
}

/** The unit back from its translation, or null when the translator lost or doubled a placeholder. */
function restore(unit: Unit, translated: string): string | null {
  const seen = new Set<number>();
  let ok = true;
  const text = translated.replace(HOLE, (whole, n: string) => {
    const index = Number(n);
    if (index >= unit.holes.length || seen.has(index)) {
      ok = false;
      return whole;
    }
    seen.add(index);
    return unit.holes[index];
  });
  return ok && seen.size === unit.holes.length ? text : null;
}

/**
 * Translates the prose of a Markdown document and leaves everything else as it was.
 *
 * A line with a link or code in the middle of a sentence goes out whole, with placeholders where the syntax is, so the
 * translator sees the full sentence. If a placeholder does not come back exactly once, the pieces between the syntax are
 * translated one by one instead: the result reads worse, but the syntax is never lost or moved.
 */
export async function translateMarkdown(source: string, translate: TranslateTexts): Promise<string> {
  const lines = segment(source);

  // Round one: whole units where a line has syntax inside its prose, single parts everywhere else.
  const units = new Map<number, Unit>();
  const queue: string[] = [];
  const slot = new Map<string, number>();
  const ask = (text: string): number => {
    let index = slot.get(text);
    if (index === undefined) {
      index = queue.push(text) - 1;
      slot.set(text, index);
    }
    return index;
  };
  const sent = new Map<string, number>();
  lines.forEach((line, row) => {
    const unit = unitOf(line);
    if (unit) {
      units.set(row, unit);
      sent.set(`${row}`, ask(edges(unit.text).core));
      return;
    }
    line.forEach((part, col) => {
      if (!part.keep) sent.set(`${row}:${col}`, ask(edges(part.text).core));
    });
  });
  if (queue.length === 0) return source;
  const first = await translate(queue);
  if (first.length !== queue.length) throw new Error('The translator returned a different number of texts.');

  const put = (part: Part, translated: string) => {
    const { before, after } = edges(part.text);
    part.text = before + translated.trim() + after;
  };

  // Round two: the lines whose placeholders did not survive, part by part.
  const retry: Array<{ row: number; col: number }> = [];
  lines.forEach((line, row) => {
    const unit = units.get(row);
    if (!unit) {
      line.forEach((part, col) => {
        if (!part.keep) put(part, first[sent.get(`${row}:${col}`) as number]);
      });
      return;
    }
    const restored = restore(unit, first[sent.get(`${row}`) as number]);
    if (restored === null) {
      line.forEach((part, col) => {
        if (!part.keep && col >= unit.from && col <= unit.to) retry.push({ row, col });
      });
      return;
    }
    const lead = edges(line[unit.from].text).before;
    const trail = edges(line[unit.to].text).after;
    const merged: Part = { text: lead + restored.trim() + trail, keep: false };
    line.splice(unit.from, unit.to - unit.from + 1, merged);
  });

  if (retry.length > 0) {
    const again = await translate(retry.map(({ row, col }) => edges(lines[row][col].text).core));
    if (again.length !== retry.length) throw new Error('The translator returned a different number of texts.');
    retry.forEach(({ row, col }, i) => put(lines[row][col], again[i]));
  }
  return join(lines);
}
