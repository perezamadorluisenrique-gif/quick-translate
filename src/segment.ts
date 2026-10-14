/**
 * Splits Markdown into the text a translator should see and the syntax it must not touch.
 *
 * A document becomes lines, and a line becomes parts: `keep` parts (list markers, links, code, maths, tags,
 * front matter...) go back exactly as they were, the rest is prose. Only parts with a letter in them are ever sent.
 */

export interface Part {
  text: string;
  keep: boolean;
  /** A pipe between table cells: never merged, and no translation spans it, so a cell stays in its column. */
  cell?: boolean;
}

export type Line = Part[];

const LETTER = /\p{L}/u;

function keep(text: string): Part {
  return { text, keep: true };
}

function prose(text: string): Part {
  return { text, keep: !LETTER.test(text) };
}

/** Joins neighbours of the same kind, and drops empty parts. */
function tidy(parts: Part[]): Line {
  const out: Part[] = [];
  for (const part of parts) {
    if (!part.text) continue;
    const last = out[out.length - 1];
    if (last && last.keep === part.keep && !last.cell && !part.cell) last.text += part.text;
    else out.push({ ...part });
  }
  return out;
}

// --- Inline syntax -------------------------------------------------------------------------------------------------

/**
 * What stays inside a line of prose. Order matters: the first alternative that matches at a position wins.
 * No lookbehind (old iOS cannot parse it): the callers look at the character before a match instead.
 */
const INLINE = new RegExp(
  [
    '`+', // 1: code span, closed by hand
    '\\$\\$[^\\n]*?\\$\\$', // 2: display maths on one line
    '\\$(?=[^\\s$])[^$\\n]*?[^\\s$]\\$(?!\\d)|\\$[^\\s$]\\$(?!\\d)', // 3: inline maths, but not "$5 and $10"
    '!?\\[\\[[^\\]\\n]*\\]\\]', // 4: wikilink or embed
    '!\\[[^\\]\\n]*\\]\\([^)\\n]*\\)', // 5: image
    '\\[([^\\]\\n]*)\\]\\(([^)\\n]*)\\)', // 6 (groups 1, 2): link
    '<[a-z][a-z0-9+.-]*:[^>\\s]+>', // 7: autolink
    'https?://[^\\s<>]+', // 8: bare address
    '</?[A-Za-z][^>\\n]*>', // 9: HTML tag
    '<%[^\\n]*?%>', // 10: Templater
    '\\[\\^[^\\]\\n]+\\]', // 11: footnote reference
    '%%[^\\n]*?%%|<!--[^\\n]*?-->', // 12: comment, Obsidian's or HTML
    '\\\\[\\\\`*_{}\\[\\]()#+\\-.!|~>$%^=]', // 13: escape
    '\\*\\*|__|~~|==', // 14: emphasis markers
    '#[\\p{L}\\p{N}_/-]+', // 15: tag
    '\\^[A-Za-z0-9-]+\\s*$', // 16: block id at the end
  ].join('|'),
  'gu',
);

const ADDRESS_END = /[.,;:!?'")\]}*_]+$/;

/** One line of running text as parts: prose, and the syntax inside it that stays. */
function inline(text: string): Line {
  const parts: Part[] = [];
  let pos = 0;
  const flush = (end: number) => {
    if (end > pos) parts.push(prose(text.slice(pos, end)));
  };
  INLINE.lastIndex = 0;
  for (let m = INLINE.exec(text); m; m = INLINE.exec(text)) {
    const start = m.index;
    let end = start + m[0].length;
    const before = start > 0 ? text[start - 1] : '';
    const first = m[0][0];

    if (first === '`') {
      const close = findBackticks(text, end, m[0].length);
      if (close < 0) {
        INLINE.lastIndex = end;
        continue;
      }
      end = close;
    } else if (first === '#') {
      // A tag follows a space or an opening bracket, and is not just a number (#1).
      if ((before && !/[\s([{]/.test(before)) || !/\D/.test(m[0].slice(1))) {
        INLINE.lastIndex = start + 1;
        continue;
      }
    } else if (first === '^') {
      if (before && !/\s/.test(before)) {
        INLINE.lastIndex = start + 1;
        continue;
      }
    } else if (m[1] !== undefined && first === '[') {
      // [label](address): the label is prose, the brackets and the address are not.
      flush(start);
      parts.push(keep('['), ...inline(m[1]), keep(`](${m[2]})`));
      pos = end;
      INLINE.lastIndex = end;
      continue;
    } else if (first === 'h') {
      const trailing = ADDRESS_END.exec(m[0]);
      if (trailing) end -= trailing[0].length;
    }

    flush(start);
    parts.push(keep(text.slice(start, end)));
    pos = end;
    INLINE.lastIndex = end;
  }
  flush(text.length);
  return tidy(parts);
}

/** Where the code span that opened with `size` backticks ends (after its closing run), or -1. */
function findBackticks(text: string, from: number, size: number): number {
  let i = from;
  while (i < text.length) {
    if (text[i] !== '`') {
      i++;
      continue;
    }
    let j = i;
    while (text[j] === '`') j++;
    if (j - i === size) return j;
    i = j;
  }
  return -1;
}

// --- Lines -------------------------------------------------------------------------------------------------------

const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const HEADING = /^(\s{0,3}#{1,6}\s+)(.*?)(\s+#+\s*)?$/;
const QUOTE = /^(?:\s*>)+[ \t]?/;
const CALLOUT = /^\[![^\]\n]+\][+-]?\s*/;
const LIST = /^\s*(?:[-*+]|\d+[.)])[ \t]+(?:\[[^\]\n]\][ \t]+)?/;
const FOOTNOTE_DEFINITION = /^\s*\[\^[^\]\n]+\]:[ \t]*/;
const LINK_DEFINITION = /^\s*\[[^\]\n]+\]:\s*\S+(\s+("[^"]*"|'[^']*'|\([^)]*\)))?\s*$/;

/** The parts of one line of prose, structure first. */
function proseLine(line: string): Line {
  if (!line.trim() || RULE.test(line) || LINK_DEFINITION.test(line)) return [keep(line)];
  if (line.includes('|') && TABLE_SEPARATOR.test(line)) return [keep(line)];

  const parts: Part[] = [];
  let rest = line;
  const take = (re: RegExp): boolean => {
    const m = re.exec(rest);
    if (!m || !m[0]) return false;
    parts.push(keep(m[0]));
    rest = rest.slice(m[0].length);
    return true;
  };

  if (take(QUOTE)) take(CALLOUT);
  const heading = HEADING.exec(rest);
  if (heading) {
    parts.push(keep(heading[1]), ...inline(heading[2]));
    if (heading[3]) parts.push(keep(heading[3]));
    return tidy(parts);
  }
  if (!take(FOOTNOTE_DEFINITION)) take(LIST);

  if (rest.trimStart().startsWith('|')) {
    for (const part of inline(rest)) {
      if (part.keep) {
        parts.push(part);
        continue;
      }
      part.text.split('|').forEach((cell, i) => {
        if (i > 0) parts.push({ text: '|', keep: true, cell: true });
        parts.push(prose(cell));
      });
    }
    return tidy(parts);
  }
  parts.push(...inline(rest));
  return tidy(parts);
}

// --- Documents ---------------------------------------------------------------------------------------------------

const FENCE = /^\s*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?(`{3,}|~{3,})/;
/** The start of an HTML block whose content is raw: code, a script, a style sheet. */
const RAW_HTML = /^<(pre|script|style|textarea)(?=[\s>]|$)/i;

/** Quote and callout markers at the start of a line: `> > `. */
const QUOTE_MARKERS = /^(?:[ \t]*>[ \t]?)*/;

/** How many quote or callout levels a line sits in: two for `> > text`. */
function quoteDepth(line: string): number {
  return (QUOTE_MARKERS.exec(line)?.[0] ?? '').split('>').length - 1;
}

/** Every line of `source`, with its line ending, as parts. Front matter, code, maths and comments are kept whole. */
export function segment(source: string): Line[] {
  if (!source) return [];
  const pieces = source.split(/(\r?\n)/);
  const out: Line[] = [];
  let fence = '';
  let math = false;
  // How deep in quotes or callouts the open code or maths block is: it ends with them.
  let depth = 0;
  let comment = '';
  // Front matter needs its closing line: a document that opens with a rule is just a document.
  let frontMatter = pieces[0].trimEnd() === '---' && pieces.some((p, i) => i > 0 && i % 2 === 0 && (p.trim() === '---' || p.trim() === '...'));

  for (let i = 0; i < pieces.length; i += 2) {
    const text = pieces[i];
    const eol = pieces[i + 1] ?? '';
    if (i > 0 && !text && !eol) break; // the empty piece after a final line ending
    const whole = (): Line => [keep(text + eol)];
    // Code and maths can sit in a quote or a callout; their lines are read without the `>` markers.
    const body = text.slice((QUOTE_MARKERS.exec(text)?.[0] ?? '').length);
    const trimmed = body.trim();
    if ((fence || math) && quoteDepth(text) < depth) {
      fence = '';
      math = false;
    }

    if (frontMatter) {
      out.push(whole());
      if (i > 0 && (trimmed === '---' || trimmed === '...')) frontMatter = false;
      continue;
    }
    if (fence) {
      out.push(whole());
      const close = FENCE.exec(body);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length && trimmed === close[1] && quoteDepth(text) === depth) {
        fence = '';
      }
      continue;
    }
    if (math) {
      out.push(whole());
      if (trimmed.includes('$$')) math = false;
      continue;
    }
    if (comment) {
      out.push(whole());
      if (comment === '%%' || comment === '-->' ? trimmed.includes(comment) : trimmed.toLowerCase().includes(comment)) comment = '';
      continue;
    }

    const open = FENCE.exec(body);
    if (open) {
      fence = open[1];
      depth = quoteDepth(text);
      out.push(whole());
      continue;
    }
    if (trimmed.startsWith('$$') && !(trimmed.length > 3 && trimmed.endsWith('$$'))) {
      math = true;
      depth = quoteDepth(text);
      out.push(whole());
      continue;
    }
    // `<pre>`, `<script>`, `<style>` and `<textarea>` hold code or raw text up to their closing tag.
    const raw = RAW_HTML.exec(trimmed);
    if (raw) {
      out.push(whole());
      const closer = `</${raw[1].toLowerCase()}>`;
      if (!trimmed.toLowerCase().includes(closer)) comment = closer;
      continue;
    }
    if (trimmed.startsWith('<!--') && !trimmed.includes('-->')) {
      comment = '-->';
      out.push(whole());
      continue;
    }
    if (trimmed === '%%' || (trimmed.startsWith('%%') && !trimmed.slice(2).includes('%%'))) {
      comment = '%%';
      out.push(whole());
      continue;
    }
    if (trimmed.startsWith('<!--')) {
      out.push(whole());
      continue;
    }

    out.push(tidy([...proseLine(text), keep(eol)]));
  }
  return out;
}

/** The document back from its lines. */
export function join(lines: Line[]): string {
  return lines.map((line) => line.map((p) => p.text).join('')).join('');
}
