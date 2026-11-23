// main.ts is mend, the CLI SPEC.md specifies (MIT).
// Node 22 and the standard library alone. Run it as `node main.ts [options] [PATCH]`.
//
// In a trial the grader runs `node /bot/main.ts` with MAKEFUN_ENV_URL set, and then this file hands over to runner.ts
// (the last lines below): keep that hand-over and runner.ts as they are, and write the CLI.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

const FORMATS = ['auto', 'unified', 'search-replace', 'v4a', 'json'];

class Exit2 {
  readonly line: string;
  constructor(line: string) {
    this.line = line;
  }
}
class Fail {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path: string) {
    this.code = code;
    this.path = path;
  }
}

const blank = (s: string): boolean => s.trim() === '';

function patchLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

function safe(p: string): boolean {
  return p !== '' && !p.startsWith('/') && !p.includes('\\') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** The tree as the edits leave it: changed paths in `now` (null: deleted), the rest read from disk. */
class Tree {
  private readonly orig = new Map<string, string | null>();
  readonly now = new Map<string, string | null>();
  original(p: string): string | null {
    if (!this.orig.has(p)) {
      let v: string | null = null;
      try {
        if (statSync(p).isFile()) v = readFileSync(p, 'utf8');
      } catch {
        v = null;
      }
      this.orig.set(p, v);
    }
    return this.orig.get(p)!;
  }
  get(p: string): string | null {
    return this.now.has(p) ? this.now.get(p)! : this.original(p);
  }
}

type Edit = (tree: Tree) => void;

function detect(lines: string[]): string | null {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) return null;
  if (lines[first]!.trim() === '*** Begin Patch') return 'v4a';
  const c = lines[first]!.trimStart()[0];
  if (c === '[' || c === '{') return 'json';
  if (lines.some((l) => l.trimEnd() === '<<<<<<< SEARCH')) return 'search-replace';
  if (lines.some((l, i) => l.startsWith('diff --git ') || (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')))) return 'unified';
  return null;
}

/** One JSON edit object (SPEC.md section 9), or null when it is not one. */
function jsonEdit(v: unknown): Edit | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const p = o.path;
  if (typeof p !== 'string') return null;
  const exists = (tree: Tree): string => {
    if (!safe(p)) throw new Fail('unsafe', p);
    const t = tree.get(p);
    if (t === null) throw new Fail('missing', p);
    return t;
  };
  if (o.command === 'create' && typeof o.file_text === 'string') {
    const text = o.file_text;
    return (tree) => {
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) !== null) throw new Fail('exists', p);
      tree.now.set(p, text);
    };
  }
  if (o.command === 'str_replace' && typeof o.old_str === 'string' && o.old_str !== '' && (o.new_str === undefined || typeof o.new_str === 'string')) {
    const oldStr = o.old_str;
    const newStr = (o.new_str as string | undefined) ?? '';
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const crlf = nl > 0 && before[nl - 1] === '\r';
      const lf = (s: string): string => (crlf ? s.replaceAll('\r\n', '\n') : s);
      const t = lf(before);
      const old = lf(oldStr);
      let count = 0;
      for (let k = t.indexOf(old); k >= 0; k = t.indexOf(old, k + 1)) count += 1;
      if (count === 0) throw new Fail('no-match', p);
      if (count > 1) throw new Fail('ambiguous', p);
      const at = t.indexOf(old);
      const out = t.slice(0, at) + lf(newStr) + t.slice(at + old.length);
      tree.now.set(p, crlf ? out.replaceAll('\n', '\r\n') : out);
    };
  }
  if (o.command === 'insert' && typeof o.insert_line === 'number' && Number.isInteger(o.insert_line) && typeof o.new_str === 'string') {
    const line = o.insert_line;
    const add = patchLines(o.new_str);
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const br = nl > 0 && before[nl - 1] === '\r' ? '\r\n' : '\n';
      const lines = before === '' ? [] : before.split(br);
      const final = before !== '' && before.endsWith(br);
      if (final) lines.pop();
      if (line < 0 || line > lines.length) throw new Fail('no-match', p);
      lines.splice(line, 0, ...add);
      tree.now.set(p, lines.length === 0 ? '' : lines.join(br) + (final ? br : ''));
    };
  }
  return null;
}

function jsonEdits(text: string, lines: string[]): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  const edits: Edit[] = [];
  if (lines[first]!.trimStart().startsWith('[')) {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      throw new Exit2(`error: parse ${first + 1}`);
    }
    if (!Array.isArray(v)) throw new Exit2(`error: parse ${first + 1}`);
    for (const x of v) {
      const e = jsonEdit(x);
      if (e === null) throw new Exit2(`error: parse ${first + 1}`);
      edits.push(e);
    }
    return edits;
  }
  lines.forEach((l, i) => {
    if (blank(l)) return;
    let e: Edit | null = null;
    try {
      e = jsonEdit(JSON.parse(l));
    } catch {
      e = null;
    }
    if (e === null) throw new Exit2(`error: parse ${i + 1}`);
    edits.push(e);
  });
  return edits;
}

type Moves = Array<[string, string]>;
type ReplacementLine = { text: string; ctx: boolean; oIndex: number };
type LineChange = { old: string[]; next: ReplacementLine[] };
type Tier = 0 | 1 | 2;

function parseError(line: number): never {
  throw new Exit2(`error: parse ${line}`);
}

function checkPath(path: string): void {
  if (!safe(path)) throw new Fail('unsafe', path);
}

function mustExist(tree: Tree, path: string): string {
  const text = tree.get(path);
  if (text === null) throw new Fail('missing', path);
  return text;
}

function mustBeAbsent(tree: Tree, path: string): void {
  if (tree.get(path) !== null) throw new Fail('exists', path);
}

function saveUpdate(tree: Tree, oldPath: string, newPath: string, text: string, moves: Moves): void {
  tree.now.set(newPath, text);
  if (oldPath !== newPath) {
    tree.now.set(oldPath, null);
    moves.push([oldPath, newPath]);
  }
}

function fileLines(text: string): { lines: string[]; br: string; finalBreak: boolean } {
  const firstLf = text.indexOf('\n');
  const br = firstLf > 0 && text[firstLf - 1] === '\r' ? '\r\n' : '\n';
  const finalBreak = text !== '' && text.endsWith(br);
  const lines = text === '' ? [] : text.split(br);
  if (finalBreak) lines.pop();
  return { lines, br, finalBreak };
}

function joinLines(lines: string[], br: string, finalBreak: boolean): string {
  return lines.length === 0 ? '' : lines.join(br) + (finalBreak ? br : '');
}

const stripR = (s: string): string => s.replace(/[ \t]+$/, '');
const stripBoth = (s: string): string => stripR(s).replace(/^[ \t]+/, '');
const indent = (s: string): string => s.match(/^[ \t]*/)?.[0] ?? '';

function occurrences(old: string[], lines: string[], tier: Tier, from: number): number[] {
  const normalize = tier === 1 ? stripR : stripBoth;
  const wanted = tier === 0 ? old : old.map(normalize);
  const positions: number[] = [];
  for (let pos = from; pos <= lines.length - old.length; pos++) {
    if (wanted.every((line, i) => {
      const actual = lines[pos + i]!;
      return line === (tier === 0 ? actual : normalize(actual));
    })) positions.push(pos);
  }
  return positions;
}

function firstMatches(old: string[], lines: string[], strict: boolean, from = 0): { tier: Tier; positions: number[] } | null {
  const tiers: Tier[] = strict ? [0] : [0, 1, 2];
  for (const tier of tiers) {
    const positions = occurrences(old, lines, tier, from);
    if (positions.length > 0) return { tier, positions };
  }
  return null;
}

function addBodyLine(change: LineChange, line: string): void {
  const text = line.slice(1);
  const oIndex = change.old.length;
  if (line[0] !== '+') change.old.push(text);
  if (line[0] !== '-') change.next.push({ text, ctx: line[0] !== '+', oIndex });
}

function replaceLines(lines: string[], pos: number, change: LineChange, tier: Tier): string[] {
  const fileIndent = tier === 2 ? indent(lines[pos]!) : '';
  const patchIndent = tier === 2 ? indent(change.old[0]!) : '';
  const replacement = change.next.map(({ text, ctx, oIndex }) => {
    if (ctx) return lines[pos + oIndex]!;
    if (tier === 2 && !blank(text) && text.startsWith(patchIndent)) {
      return fileIndent + text.slice(patchIndent.length);
    }
    return text;
  });
  return lines.slice(0, pos).concat(replacement, lines.slice(pos + change.old.length));
}

type UnifiedHunk = {
  oldStart: number;
  body: Array<{ line: string; noEol: boolean }>;
};

function unifiedPair(lines: string[], i: number): boolean {
  return lines[i]?.startsWith('--- ') === true && lines[i + 1]?.startsWith('+++ ') === true;
}

function unifiedPath(line: string): string | null {
  const path = line.slice(4).split('\t', 1)[0]!.trim();
  if (path === '/dev/null') return null;
  return path.replace(/^[ab]\//, '');
}

function applyUnifiedHunks(text: string, hunks: UnifiedHunk[], path: string, strict: boolean): string {
  let { lines, br, finalBreak } = fileLines(text);
  let delta = 0;
  for (const { oldStart, body } of hunks) {
    const change: LineChange = { old: [], next: [] };
    for (const { line } of body) addBodyLine(change, line);

    let pos: number;
    let tier: Tier = 0;
    if (change.old.length === 0) {
      pos = Math.max(0, Math.min(oldStart + delta, lines.length));
    } else {
      const match = firstMatches(change.old, lines, strict);
      if (match === null) throw new Fail('no-match', path);
      tier = match.tier;
      const target = Math.max(0, Math.min(oldStart - 1 + delta, lines.length));
      pos = match.positions[0]!;
      for (const candidate of match.positions) {
        if (Math.abs(candidate - target) < Math.abs(pos - target)) pos = candidate;
      }
    }
    if (pos + change.old.length === lines.length) {
      finalBreak = !body.findLast(({ line }) => line[0] !== '-')?.noEol;
    }
    lines = replaceLines(lines, pos, change, tier);
    delta += change.next.length - change.old.length;
  }
  return joinLines(lines, br, finalBreak);
}

function unifiedEdits(lines: string[], strict: boolean, moves: Moves): Edit[] {
  const edits: Edit[] = [];
  let i = 0;
  while (i < lines.length) {
    const sectionStart = i;
    const line = lines[i]!;
    let gitPaths: [string, string] = ['', ''];
    if (line.startsWith('diff --git ')) {
      const match = line.match(/^diff --git a\/(\S+) b\/(\S+)\s*$/);
      if (match === null) parseError(i + 1);
      gitPaths = [match[1]!, match[2]!];
      i++;
    } else if (!unifiedPair(lines, i)) {
      if (line.startsWith('@@')) parseError(i + 1);
      i++;
      continue;
    }

    let paths: [string | null, string | null] | undefined;
    let renameFrom: string | undefined;
    let renameTo: string | undefined;
    let create = false;
    let remove = false;
    while (i < lines.length) {
      const header = lines[i]!;
      if (header.startsWith('@@') || header.startsWith('diff --git ')) break;
      if (header.startsWith('--- ')) {
        if (!unifiedPair(lines, i)) parseError(i + 2);
        paths ??= [unifiedPath(header), unifiedPath(lines[i + 1]!)];
        i += 2;
        continue;
      }
      if (header.startsWith('rename from ')) renameFrom = header.slice('rename from '.length).trim();
      else if (header.startsWith('rename to ')) renameTo = header.slice('rename to '.length).trim();
      else if (header.startsWith('new file mode')) create = true;
      else if (header.startsWith('deleted file mode')) remove = true;
      i++;
    }
    const [oldPath, newPath] = paths ?? [renameFrom ?? gitPaths[0], renameTo ?? gitPaths[1]];
    if (oldPath === null && newPath === null) parseError(sectionStart + 1);

    const hunks: UnifiedHunk[] = [];
    while (i < lines.length && !lines[i]!.startsWith('diff --git ') && !unifiedPair(lines, i)) {
      const header = lines[i]!;
      if (!header.startsWith('@@')) {
        i++;
        continue;
      }
      const match = header.match(/^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/);
      if (match === null) parseError(i + 1);
      const start = ++i;
      while (i < lines.length && !unifiedPair(lines, i)) {
        const line = lines[i]!;
        if (line !== '' && !' +-\\'.includes(line[0]!)) break;
        i++;
      }
      let end = i;
      while (end > start && lines[end - 1] === '') end--;
      const body: UnifiedHunk['body'] = [];
      for (let j = start; j < end; j++) {
        if (!lines[j]!.startsWith('\\')) {
          body.push({ line: lines[j]!, noEol: j + 1 < end && lines[j + 1]!.startsWith('\\') });
        }
      }
      hunks.push({ oldStart: Number(match[1]), body });
    }

    edits.push((tree) => {
      if (oldPath !== null) checkPath(oldPath);
      if (newPath !== null) checkPath(newPath);
      if (newPath !== null && (oldPath === null || create)) {
        mustBeAbsent(tree, newPath);
        const added = hunks.flatMap(({ body }) => body.filter(({ line }) => line[0] === '+'));
        tree.now.set(newPath, joinLines(added.map(({ line }) => line.slice(1)), '\n', !added.at(-1)?.noEol));
      } else if (oldPath !== null) {
        const text = mustExist(tree, oldPath);
        if (newPath === null || remove) {
          tree.now.set(oldPath, null);
        } else {
          if (oldPath !== newPath) mustBeAbsent(tree, newPath);
          saveUpdate(tree, oldPath, newPath, applyUnifiedHunks(text, hunks, oldPath, strict), moves);
        }
      }
    });
  }
  if (edits.length === 0) parseError(1);
  return edits;
}

const SEARCH = '<<<<<<< SEARCH';
const SEPARATOR = '=======';
const REPLACE = '>>>>>>> REPLACE';

function findSearchMarker(lines: string[], from: number, wanted: string, search: number): number {
  for (let i = from; i < lines.length; i++) {
    const marker = lines[i]!.trimEnd();
    if (marker === wanted) return i;
    if (marker === SEARCH) break;
  }
  return parseError(search + 1);
}

function searchReplaceEdits(lines: string[], strict: boolean): Edit[] {
  const edits: Edit[] = [];
  let previousPath: string | undefined;
  let candidatePath: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trimEnd() !== SEARCH) {
      const trimmed = line.trim();
      if (trimmed !== '' && !trimmed.startsWith('```')) candidatePath = trimmed;
      continue;
    }
    const path = candidatePath ?? previousPath;
    if (path === undefined) parseError(i + 1);
    const separator = findSearchMarker(lines, i + 1, SEPARATOR, i);
    const end = findSearchMarker(lines, separator + 1, REPLACE, i);
    const old = lines.slice(i + 1, separator);
    const added = lines.slice(separator + 1, end);
    const change: LineChange = { old, next: added.map((text) => ({ text, ctx: false, oIndex: -1 })) };
    edits.push((tree) => {
      checkPath(path);
      if (old.length === 0) {
        mustBeAbsent(tree, path);
        tree.now.set(path, joinLines(added, '\n', true));
        return;
      }
      const { lines, br, finalBreak } = fileLines(mustExist(tree, path));
      const match = firstMatches(old, lines, strict);
      if (match === null) throw new Fail('no-match', path);
      if (match.positions.length > 1) throw new Fail('ambiguous', path);
      const updated = replaceLines(lines, match.positions[0]!, change, match.tier);
      tree.now.set(path, joinLines(updated, br, finalBreak));
    });
    previousPath = path;
    candidatePath = undefined;
    i = end;
  }
  if (edits.length === 0) parseError(1);
  return edits;
}

const V4A_SECTION = /^\*\*\* (Add|Delete|Update) File: /;
const V4A_MOVE = '*** Move to: ';
const V4A_EOF = '*** End of File';
type V4aChunk = LineChange & { anchor: string; eof: boolean };

function v4aUpdate(lines: string[], start: number, end: number, path: string, strict: boolean, moves: Moves): Edit {
  let i = start;
  let moveTo: string | undefined;
  if (i < end && lines[i]!.startsWith(V4A_MOVE)) {
    moveTo = lines[i]!.slice(V4A_MOVE.length).trim();
    i++;
  }
  while (i < end && blank(lines[i]!)) i++;

  const chunks: V4aChunk[] = [];
  let chunk: V4aChunk | undefined;
  for (; i < end; i++) {
    const line = lines[i]!;
    if (line.startsWith('@@')) {
      chunk = { anchor: line.slice(2).trim(), eof: false, old: [], next: [] };
      chunks.push(chunk);
    } else if (line === V4A_EOF) {
      if (chunk === undefined) parseError(i + 1);
      chunk.eof = true;
      chunk = undefined;
    } else if (blank(line) || ' +-'.includes(line[0]!)) {
      if (chunk === undefined) {
        if (blank(line)) continue;
        if (chunks.length > 0) parseError(i + 1);
        chunk = { anchor: '', eof: false, old: [], next: [] };
        chunks.push(chunk);
      }
      addBodyLine(chunk, blank(line) && !line.startsWith(' ') ? '' : line);
    } else {
      parseError(i + 1);
    }
  }
  if (chunks.length === 0 && moveTo === undefined) parseError(start);

  return (tree) => {
    checkPath(path);
    if (moveTo !== undefined) checkPath(moveTo);
    let { lines, br, finalBreak } = fileLines(mustExist(tree, path));
    if (moveTo !== undefined) mustBeAbsent(tree, moveTo);

    let cursor = 0;
    for (const chunk of chunks) {
      if (chunk.anchor !== '') {
        const anchor = firstMatches([chunk.anchor], lines, strict, cursor);
        if (anchor === null) throw new Fail('no-match', path);
        cursor = anchor.positions[0]! + 1;
      }
      let pos = chunk.eof ? lines.length : cursor;
      let tier: Tier = 0;
      if (chunk.old.length > 0) {
        const from = chunk.eof ? Math.max(cursor, lines.length - chunk.old.length) : cursor;
        const match = firstMatches(chunk.old, lines, strict, from);
        if (match === null) throw new Fail('no-match', path);
        pos = match.positions[0]!;
        tier = match.tier;
      }
      lines = replaceLines(lines, pos, chunk, tier);
      cursor = pos + chunk.next.length;
    }
    saveUpdate(tree, path, moveTo ?? path, joinLines(lines, br, finalBreak), moves);
  };
}

function v4aEdits(lines: string[], strict: boolean, moves: Moves): Edit[] {
  const first = lines.findIndex((line) => !blank(line));
  if (first === -1) parseError(1);
  if (lines[first]!.trim() !== '*** Begin Patch') parseError(first + 1);
  const last = lines.findLastIndex((line) => !blank(line));
  if (lines[last]!.trim() !== '*** End Patch') parseError(lines.length + 1);

  const edits: Edit[] = [];
  let i = first + 1;
  while (i < last) {
    const line = lines[i]!;
    if (blank(line)) {
      i++;
      continue;
    }
    const section = line.match(V4A_SECTION);
    if (section === null) parseError(i + 1);
    const path = line.slice(section[0].length).trim();
    const start = ++i;
    while (i < last && !V4A_SECTION.test(lines[i]!)) i++;
    let end = i;
    while (end > start && blank(lines[end - 1]!)) end--;

    if (section[1] === 'Add') {
      const added: string[] = [];
      for (let j = start; j < end; j++) {
        const line = lines[j]!;
        if (line !== '' && !line.startsWith('+')) parseError(j + 1);
        added.push(line.slice(1));
      }
      edits.push((tree) => {
        checkPath(path);
        mustBeAbsent(tree, path);
        tree.now.set(path, joinLines(added, '\n', true));
      });
    } else if (section[1] === 'Delete') {
      if (start < end) parseError(start + 1);
      edits.push((tree) => {
        checkPath(path);
        mustExist(tree, path);
        tree.now.set(path, null);
      });
    } else {
      edits.push(v4aUpdate(lines, start, end, path, strict, moves));
    }
  }
  if (edits.length === 0) parseError(1);
  return edits;
}

function run(args: string[]): { code: number; out: string[] } {
  let format: string | null = null;
  let check = false;
  let strict = false;
  const pos: string[] = [];
  let ended = false;
  for (const a of args) {
    if (!ended && a === '--') ended = true;
    else if (!ended && a.startsWith('-') && a !== '-') {
      if (a.startsWith('--format=') && format === null && FORMATS.includes(a.slice(9))) format = a.slice(9);
      else if (a === '--check' && !check) check = true;
      else if (a === '--strict' && !strict) strict = true;
      else return { code: 2, out: ['error: usage'] };
    } else pos.push(a);
  }
  if (pos.length > 1) return { code: 2, out: ['error: usage'] };
  const file = pos.length === 0 || pos[0] === '-' ? null : pos[0]!;
  let text = '';
  try {
    text = readFileSync(file ?? 0, 'utf8');
  } catch {
    if (file !== null) return { code: 2, out: ['error: no-patch'] };
  }
  const lines = patchLines(text);
  const kind = format === null || format === 'auto' ? detect(lines) : format;
  if (kind === null) return { code: 2, out: ['error: format'] };
  const moves: Moves = [];
  let edits: Edit[];
  try {
    switch (kind) {
      case 'json': edits = jsonEdits(text, lines); break;
      case 'unified': edits = unifiedEdits(lines, strict, moves); break;
      case 'search-replace': edits = searchReplaceEdits(lines, strict); break;
      case 'v4a': edits = v4aEdits(lines, strict, moves); break;
      default: edits = [];
    }
    if (edits.length === 0) throw new Exit2('error: parse 1');
  } catch (e) {
    if (e instanceof Exit2) return { code: 2, out: [e.line] };
    throw e;
  }
  const tree = new Tree();
  const fails: Fail[] = [];
  for (const edit of edits) {
    const before = new Map(tree.now);
    try {
      edit(tree);
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      tree.now.clear();
      for (const [k, v] of before) tree.now.set(k, v);
      fails.push(e);
    }
  }
  if (fails.length > 0) return { code: 1, out: [...fails.map((f) => `error: ${f.code} ${f.path}`), `failed: ${fails.length} of ${edits.length} edits`] };
  const renamedFrom = new Set<string>();
  const renamedTo = new Map<string, string>();
  for (const [oldPath, newPath] of moves) {
    if (renamedFrom.has(oldPath) || renamedTo.has(newPath)) continue;
    if (tree.original(oldPath) !== null && tree.get(oldPath) === null &&
        tree.original(newPath) === null && tree.get(newPath) !== null) {
      renamedFrom.add(oldPath);
      renamedTo.set(newPath, oldPath);
    }
  }
  const rows: string[] = [];
  for (const p of [...tree.now.keys()].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
    const was = tree.original(p);
    const now = tree.now.get(p)!;
    if (was === now) continue;
    const oldPath = renamedTo.get(p);
    if (oldPath !== undefined) rows.push(`R ${oldPath} -> ${p}`);
    else if (!renamedFrom.has(p)) rows.push(`${was === null ? 'A' : now === null ? 'D' : 'M'} ${p}`);
    if (check) continue;
    if (now === null) rmSync(p, { force: true });
    else {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, now);
    }
  }
  return { code: 0, out: [...rows, `ok: ${rows.length} ${rows.length === 1 ? 'file' : 'files'}`] };
}


const trialEnv = process.env.MAKEFUN_ENV_URL;
if (trialEnv !== undefined && trialEnv !== '') {
  // A trial: the kit's runner reads the checks from the env and runs this file on each one, without this variable.
  const { runTrial } = await import('./runner.ts');
  await runTrial(trialEnv);
} else {
  const r = run(process.argv.slice(2));
  writeSync(1, r.out.map((l) => `${l}\n`).join(''));
  process.exitCode = r.code;
}
