/**
 * The Markdown subset the Canvas renders: **bold**, *italic*, `code` and
 * [links](https://...), plus paragraphs and simple "-" / "1." lists.
 *
 * Text is tokenized into plain data and rendered as Svelte elements, never
 * as HTML, so model output cannot inject markup. Emphasis does not nest.
 */

export type Inline =
  | { kind: 'text' | 'strong' | 'em' | 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

export type Block = { kind: 'p'; inlines: Inline[] } | { kind: 'ul' | 'ol'; items: Inline[][] };

/** Returns the normalized URL if it is http(s), otherwise null. */
export function safeHref(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

const ESCAPABLE = '\\`*_[]()';
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isWord = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** Index of the closing single `*` or `_` for emphasis opened at `open`, or -1. */
function closeEm(src: string, open: number): number {
  const d = src[open];
  // "2 * 3" and snake_case are not emphasis.
  if (isSpace(src[open + 1]) || (d === '_' && isWord(src[open - 1]))) return -1;
  for (let j = open + 1; j < src.length; j++) {
    if (src[j] === '\n') return -1;
    if (src[j] !== d || src[j + 1] === d || isSpace(src[j - 1])) continue;
    if (d === '_' && isWord(src[j + 1])) continue;
    return j > open + 1 ? j : -1;
  }
  return -1;
}

/** Index of the `)` closing a link target starting at `from`, allowing nested parens. */
function closeParen(src: string, from: number): number {
  let depth = 0;
  for (let j = from; j < src.length; j++) {
    if (src[j] === '\n') return -1;
    if (src[j] === '(') depth++;
    else if (src[j] === ')' && depth-- === 0) return j;
  }
  return -1;
}

/** Tokenizes one run of inline Markdown. */
export function inline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ kind: 'text', text: buf });
    buf = '';
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\' && ESCAPABLE.includes(src[i + 1] ?? '')) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (c === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ kind: 'code', text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if ((c === '*' || c === '_') && src[i + 1] === c && !isSpace(src[i + 2])) {
      const end = src.indexOf(c + c, i + 2);
      if (end > i + 2) {
        flush();
        out.push({ kind: 'strong', text: src.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    if (c === '*' || c === '_') {
      const end = closeEm(src, i);
      if (end > 0) {
        flush();
        out.push({ kind: 'em', text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (c === '[') {
      const mid = src.indexOf('](', i + 1);
      const end = mid < 0 ? -1 : closeParen(src, mid + 2);
      if (mid > i + 1 && end > mid && !src.slice(i + 1, mid).includes('\n')) {
        const text = src.slice(i + 1, mid);
        const href = safeHref(src.slice(mid + 2, end));
        flush();
        // A link to anything but http(s) keeps only its label.
        out.push(href ? { kind: 'link', text, href } : { kind: 'text', text });
        i = end + 1;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

const BULLET = /^\s*[-*•]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;

/** The list kind if every line is a bullet or every line is numbered. */
function listKind(lines: string[]): { kind: 'ul' | 'ol'; marker: RegExp } | null {
  if (lines.every((l) => BULLET.test(l))) return { kind: 'ul', marker: BULLET };
  if (lines.every((l) => NUMBERED.test(l))) return { kind: 'ol', marker: NUMBERED };
  return null;
}

/** Splits text into paragraphs and lists (blank lines separate blocks). */
export function blocks(src: string): Block[] {
  const out: Block[] = [];
  for (const chunk of src.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const lines = chunk.split('\n').filter((l) => l.trim() !== '');
    if (lines.length === 0) continue;
    const list = listKind(lines);
    out.push(
      list
        ? { kind: list.kind, items: lines.map((l) => inline(l.replace(list.marker, ''))) }
        : { kind: 'p', inlines: inline(lines.join('\n')) },
    );
  }
  return out;
}
