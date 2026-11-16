import { parse } from '@babel/parser';
import { posix } from 'node:path';
import type {
  Budget, CollectContext, ContextResult, ContextSnippet, Omission, ReadFileAtRef, ReviewInput,
} from './contracts.js';

interface ImportRef { name: string | null; specifier: string }
interface LineRange { startLine: number; endLine: number }

function splitLines(content: string): string[] {
  return content.replace(/\r\n/g, '\n').split('\n');
}

/** 去掉末尾换行产生的空字符串元素，得到真实内容行数。 */
function contentLineCount(lines: string[]): number {
  return lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
}

/** 解析 patch 的新侧 hunk 范围，向两侧扩展窗口并合并重叠范围。 */
function localWindowRanges(patch: string | null, windowLines: number, lineCount: number): LineRange[] {
  if (!patch) return [];
  const ranges: LineRange[] = [];
  for (const row of splitLines(patch)) {
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(row);
    if (!header) continue;
    const newStart = Number(header[1]);
    const newCount = header[2] === undefined ? 1 : Number(header[2]);
    if (!Number.isSafeInteger(newStart) || newStart < 1 || newCount < 1) continue;
    const startLine = Math.max(1, newStart - windowLines);
    const endLine = Math.min(lineCount, newStart + newCount - 1 + windowLines);
    if (endLine >= startLine) ranges.push({ startLine, endLine });
  }
  ranges.sort((a, b) => a.startLine - b.startLine);
  const merged: LineRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.startLine <= last.endLine) last.endLine = Math.max(last.endLine, range.endLine);
    else merged.push({ ...range });
  }
  return merged;
}

type Statement = ReturnType<typeof parse>['program']['body'][number];
interface ModuleIndex { imports: ImportRef[]; exports: Map<string, LineRange> }

const MAX_LOCAL_WINDOWS_PER_FILE = 8;
const MAX_LOCAL_LINES_PER_FILE = 256;

/** Index static, top-level imports and direct exports without executing reviewed code. */
function indexModule(content: string, file: string): ModuleIndex | null {
  let statements: Statement[];
  try {
    statements = parse(content, {
      sourceType: 'unambiguous', plugins: file.endsWith('.ts') ? ['typescript'] : [],
    }).program.body;
  } catch {
    return null;
  }

  const imports: ImportRef[] = [];
  const exports = new Map<string, LineRange>();
  const locals = new Map<string, LineRange>();
  const aliases = new Map<string, string>();
  for (const statement of statements) {
    if (!statement.loc) continue;
    const range = { startLine: statement.loc.start.line, endLine: statement.loc.end.line };
    if (statement.type === 'ImportDeclaration') {
      for (const spec of statement.specifiers) {
        let name: string | null = null;
        if (spec.type === 'ImportSpecifier') {
          name = spec.imported.type === 'Identifier' ? spec.imported.name : spec.imported.value;
        } else if (spec.type === 'ImportDefaultSpecifier') name = 'default';
        imports.push({ name, specifier: statement.source.value });
      }
      continue;
    }
    if (statement.type === 'ExportDefaultDeclaration') {
      exports.set('default', range);
      if (statement.declaration.type === 'Identifier') aliases.set('default', statement.declaration.name);
      continue;
    }
    const namedExport = statement.type === 'ExportNamedDeclaration';
    const declaration = namedExport ? statement.declaration : statement;
    if (namedExport && !statement.source) {
      for (const spec of statement.specifiers) {
        if (spec.type === 'ExportSpecifier' && spec.exported.type === 'Identifier') {
          aliases.set(spec.exported.name, spec.local.name);
        }
      }
    }
    if ((declaration?.type === 'FunctionDeclaration' || declaration?.type === 'ClassDeclaration') && declaration.id) {
      locals.set(declaration.id.name, range);
      if (namedExport) exports.set(declaration.id.name, range);
    }
    if (declaration?.type === 'VariableDeclaration') {
      for (const { id, init } of declaration.declarations) {
        if (id.type === 'Identifier') {
          locals.set(id.name, range);
          if (namedExport) exports.set(id.name, range);
        }
        if (init?.type !== 'CallExpression' || init.callee.type !== 'Identifier' || init.callee.name !== 'require'
          || init.arguments.length !== 1 || init.arguments[0].type !== 'StringLiteral') continue;
        const specifier = init.arguments[0].value;
        if (id.type === 'ObjectPattern') {
          for (const prop of id.properties) {
            if (prop.type === 'ObjectProperty' && !prop.computed && prop.key.type === 'Identifier') {
              imports.push({ name: prop.key.name, specifier });
            }
          }
        } else {
          imports.push({ name: 'default', specifier });
        }
      }
    }
    if (statement.type !== 'ExpressionStatement' || statement.expression.type !== 'AssignmentExpression'
      || statement.expression.operator !== '=') continue;
    const { left, right } = statement.expression;
    if (left.type !== 'MemberExpression' || left.computed || left.property.type !== 'Identifier') continue;
    const obj = left.object;
    let name: string;
    if (obj.type === 'Identifier' && obj.name === 'exports') name = left.property.name;
    else if (obj.type === 'Identifier' && obj.name === 'module' && left.property.name === 'exports') name = 'default';
    else if (obj.type === 'MemberExpression' && !obj.computed && obj.object.type === 'Identifier'
      && obj.object.name === 'module' && obj.property.type === 'Identifier' && obj.property.name === 'exports') {
      name = left.property.name;
    } else continue;
    exports.set(name, range);
    if (right.type === 'Identifier') aliases.set(name, right.name);
    else aliases.delete(name);
  }
  for (const [name, local] of aliases) {
    const range = locals.get(local);
    if (range) exports.set(name, range);
  }
  return { imports, exports };
}

function resolveCandidates(specifier: string, fromFile: string): string[] {
  if ((!specifier.startsWith('./') && !specifier.startsWith('../')) || /[\\\0\r\n]/.test(specifier)) return [];
  const target = posix.join(posix.dirname(fromFile), specifier);
  if (target === '..' || target.startsWith('../') || target === '.') return [];
  if (!posix.extname(target)) {
    return fromFile.endsWith('.ts') ? [target + '.ts', target + '.js'] : [target + '.js'];
  }
  if (target.endsWith('.js') && fromFile.endsWith('.ts')) {
    return [target, target.slice(0, -3) + '.ts'];
  }
  return /\.(ts|js)$/.test(target) ? [target] : [];
}

type Source = { lines: string[]; index: ModuleIndex | null };
type ReadResult = { source: Source } | { missing: boolean };

function missingFile(error: unknown): boolean {
  const value = error as { code?: string; status?: number } | null;
  return value?.code === 'ENOENT' || value?.status === 404;
}

/** Collect bounded local windows and static direct definitions at one immutable head SHA. */
export const collectContext: CollectContext = async (
  input: ReviewInput, readFile: ReadFileAtRef, budget: Budget,
): Promise<ContextResult> => {
  const snippets: ContextSnippet[] = [];
  const omissions: Omission[] = [];
  if (input.mode !== 'context') return { snippets, omissions };

  // This cache belongs to exactly one snapshot. Both successful and failed reads count.
  const reads = new Map<string, ReadResult>();
  const omitted = new Set<string>();
  const emitted = new Set<string>();
  async function read(path: string): Promise<ReadResult> {
    const known = reads.get(path);
    if (known) return known;
    let result: ReadResult;
    try {
      const content = await readFile(path, input.headSha);
      result = { source: { lines: splitLines(content), index: indexModule(content, path) } };
    } catch (error) {
      result = { missing: missingFile(error) };
    }
    reads.set(path, result);
    return result;
  }
  function omit(file: string, reason: Omission['reason'], required = false) {
    const key = JSON.stringify([file, reason, required]);
    if (omitted.has(key)) return;
    omitted.add(key);
    omissions.push({ file, stage: 'context', reason, required });
  }
  function emit(file: string, lines: string[], range: LineRange, reason: ContextSnippet['reason']) {
    const { startLine, endLine } = range;
    const key = JSON.stringify([file, startLine, endLine]);
    if (emitted.has(key)) return;
    emitted.add(key);
    snippets.push({
      id: `C${snippets.length}`, file, ref: input.headSha, startLine, endLine,
      code: lines.slice(startLine - 1, endLine).join('\n'), reason,
    });
  }

  let fileCount = 0;
  for (const file of input.changedFiles) {
    if (!file.supported) continue;
    if (++fileCount > budget.maxFiles) { omit(file.path, 'FILE_BUDGET', true); continue; }
    const root = await read(file.path);
    if (!('source' in root)) { omit(file.path, 'FILE_READ_FAILED', true); continue; }
    const { lines, index } = root.source;
    // A single large hunk or many disjoint hunks must not exhaust the entire prompt.
    let localLinesLeft = MAX_LOCAL_LINES_PER_FILE;
    const windows = localWindowRanges(file.patch, budget.localWindowLines, contentLineCount(lines));
    for (const [i, range] of windows.entries()) {
      if (i >= MAX_LOCAL_WINDOWS_PER_FILE || localLinesLeft === 0) { omit(file.path, 'CONTEXT_BUDGET'); break; }
      const endLine = Math.min(range.endLine, range.startLine + localLinesLeft - 1);
      if (endLine < range.endLine) omit(file.path, 'CONTEXT_BUDGET');
      emit(file.path, lines, { startLine: range.startLine, endLine }, 'local-window');
      localLinesLeft -= endLine - range.startLine + 1;
    }

    if (!index) { omit(file.path, 'OPTIONAL_CONTEXT_UNAVAILABLE'); continue; }
    const attempted = new Set<string>();
    for (const { name, specifier } of index.imports) {
      const candidates = resolveCandidates(specifier, file.path);
      if (!candidates.length) {
        if (specifier.startsWith('./') || specifier.startsWith('../')) omit(file.path, 'OPTIONAL_CONTEXT_UNAVAILABLE');
        continue;
      }
      const key = JSON.stringify([name, candidates]);
      if (attempted.has(key)) continue;
      if (attempted.size >= budget.maxDefinitionsPerFile) { omit(file.path, 'CONTEXT_BUDGET'); break; }
      attempted.add(key);
      if (name === null) { omit(candidates[0], 'OPTIONAL_CONTEXT_UNAVAILABLE'); continue; }
      for (const [i, path] of candidates.entries()) {
        const target = await read(path);
        if (!('source' in target)) {
          // A denied or interrupted read is not evidence that a different module was imported.
          if (target.missing && i + 1 < candidates.length) continue;
          omit(path, 'OPTIONAL_CONTEXT_UNAVAILABLE');
        } else {
          const range = target.source.index?.exports.get(name);
          if (!range) omit(path, 'OPTIONAL_CONTEXT_UNAVAILABLE');
          else if (range.endLine - range.startLine + 1 > budget.maxDefinitionLines) omit(path, 'CONTEXT_BUDGET');
          else emit(path, target.source.lines, range, 'direct-definition');
        }
        break;
      }
    }
  }
  return { snippets, omissions };
};
