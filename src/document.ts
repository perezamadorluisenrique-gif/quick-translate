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

/** The ranges of a line between its table-cell pipes: nothing is translated across one. */
function regions(line: Line): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let from = 0;
  line.forEach((part, i) => {
    if (!part.cell) return;
    out.push([from, i]);
    from = i + 1;
  });
  out.push([from, line.length]);
  return out;
}

/** The stretch from the first prose part to the last in `[lo, hi)`, or null when it has fewer than two or reads `{0}` already. */
function unitOf(line: Line, lo: number, hi: number): Unit | null {
  const indexes: number[] = [];
  for (let i = lo; i < hi; i++) if (!line[i].keep) indexes.push(i);
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
 * translated one by one instead: the result reads worse, but the syntax is never lost or moved. A table cell is always
 * translated apart from its neighbours, so a translator that reorders words cannot move text between columns.
 */
export async function translateMarkdown(source: string, translate: TranslateTexts): Promise<string> {
  const lines = segment(source);

  // Round one: whole units where a region has syntax inside its prose, single parts everywhere else.
  interface Job {
    line: Line;
    unit: Unit | null;
    /** The prose parts of a region with no unit, by reference. */
    parts: Part[];
    slot: number[];
  }
  const jobs: Job[] = [];
  const queue: string[] = [];
  const slots = new Map<string, number>();
  const ask = (text: string): number => {
    let index = slots.get(text);
    if (index === undefined) {
      index = queue.push(text) - 1;
      slots.set(text, index);
    }
    return index;
  };
  for (const line of lines) {
    for (const [lo, hi] of regions(line)) {
      const unit = unitOf(line, lo, hi);
      if (unit) {
        jobs.push({ line, unit, parts: [], slot: [ask(edges(unit.text).core)] });
        continue;
      }
      const parts = line.slice(lo, hi).filter((p) => !p.keep);
      if (parts.length > 0) jobs.push({ line, unit: null, parts, slot: parts.map((p) => ask(edges(p.text).core)) });
    }
  }
  if (queue.length === 0) return source;
  const first = await translate(queue);
  if (first.length !== queue.length) throw new Error('The translator returned a different number of texts.');

  const put = (part: Part, translated: string) => {
    const { before, after } = edges(part.text);
    part.text = before + translated.trim() + after;
  };

  // Round two: the units whose placeholders did not survive, part by part. Regions go right to left, so a merge
  // never moves the parts of a region still to come.
  const retry: Part[] = [];
  for (const job of [...jobs].reverse()) {
    const { line, unit } = job;
    if (!unit) {
      job.parts.forEach((part, i) => put(part, first[job.slot[i]]));
      continue;
    }
    const restored = restore(unit, first[job.slot[0]]);
    if (restored === null) {
      for (let i = unit.from; i <= unit.to; i++) if (!line[i].keep) retry.push(line[i]);
      continue;
    }
    const lead = edges(line[unit.from].text).before;
    const trail = edges(line[unit.to].text).after;
    line.splice(unit.from, unit.to - unit.from + 1, { text: lead + restored.trim() + trail, keep: false });
  }

  if (retry.length > 0) {
    const again = await translate(retry.map((part) => edges(part.text).core));
    if (again.length !== retry.length) throw new Error('The translator returned a different number of texts.');
    retry.forEach((part, i) => put(part, again[i]));
  }
  return join(lines);
}
