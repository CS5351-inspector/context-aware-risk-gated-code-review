/** B 模块：用 ReadFileAtRef 为每个被审查文件收集附近代码与一种直接定义。
 * 去重重叠的局部窗口，裁剪超长定义，区分必要读取失败与可选上下文缺失。
 * 不决定风险/门禁，也不写 GitHub；A 在 context 模式下调用本入口。
 */
import type {
  Budget, CollectContext, ContextResult, ContextSnippet, Omission, ReadFileAtRef, ReviewInput,
} from './contracts.js';

interface ImportRef { name: string; specifier: string }
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

/** 提取命名、默认与命名空间导入；裸模块说明符会在解析阶段被跳过。 */
function parseImports(content: string): ImportRef[] {
  const refs: ImportRef[] = [];
  for (const row of splitLines(content)) {
    const named = /^import\s+\{([^}]*)\}\s+from\s+["']([^"']+)["']/.exec(row);
    if (named) {
      for (const part of named[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name) refs.push({ name, specifier: named[2] });
      }
      continue;
    }
    const def = /^import\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["']/.exec(row);
    if (def) { refs.push({ name: def[1], specifier: def[2] }); continue; }
    const ns = /^import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["']/.exec(row);
    if (ns) refs.push({ name: ns[1], specifier: ns[2] });
  }
  return refs;
}

/** 把相对导入解析为仓库内 .ts 路径；裸模块说明符返回 null。 */
function resolveImportPath(specifier: string, fromFile: string): string | null {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null;
  const dir = fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/')) : '';
  const parts = (dir ? dir.split('/') : []).concat(specifier.split('/'));
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') { resolved.pop(); continue; }
    resolved.push(part);
  }
  let path = resolved.join('/');
  if (/\.js$/.test(path)) path = `${path.slice(0, -3)}.ts`;
  else if (!/\.[A-Za-z0-9]+$/.test(path)) path = `${path}.ts`;
  return path;
}

function countBraces(line: string): number {
  let depth = 0;
  for (const ch of line) { if (ch === '{') depth++; else if (ch === '}') depth--; }
  return depth;
}

/** 定位导出函数的声明行并用花括号配对找到结束行；找不到返回 null。 */
function findFunctionDefinition(lines: string[], name: string): LineRange | null {
  const re = new RegExp(`^\\s*export\\s+(?:async\\s+)?function\\s+${name}\\b`);
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i])) continue;
    let depth = 0;
    for (let j = i; j < lines.length; j++) {
      depth += countBraces(lines[j]);
      if (depth <= 0) return { startLine: i + 1, endLine: j + 1 };
    }
    return null;
  }
  return null;
}

export const collectContext: CollectContext = async (
  input: ReviewInput, readFile: ReadFileAtRef, budget: Budget,
): Promise<ContextResult> => {
  const snippets: ContextSnippet[] = [];
  const omissions: Omission[] = [];
  let nextId = 0;

  for (const file of input.changedFiles) {
    if (!file.supported) continue;

    let headContent: string;
    try {
      headContent = await readFile(file.path, input.headSha);
    } catch {
      omissions.push({ file: file.path, stage: 'context', reason: 'FILE_READ_FAILED', required: true });
      continue;
    }

    const headLines = splitLines(headContent);
    const lineCount = contentLineCount(headLines);
    for (const { startLine, endLine } of localWindowRanges(file.patch, budget.localWindowLines, lineCount)) {
      snippets.push({
        id: `C${nextId++}`, file: file.path, ref: input.headSha,
        startLine, endLine, code: headLines.slice(startLine - 1, endLine).join('\n'), reason: 'local-window',
      });
    }

    let definitions = 0;
    for (const { name, specifier } of parseImports(headContent)) {
      if (definitions >= budget.maxDefinitionsPerFile) break;
      const targetPath = resolveImportPath(specifier, file.path);
      if (!targetPath) continue;

      let targetContent: string;
      try {
        targetContent = await readFile(targetPath, input.headSha);
      } catch {
        omissions.push({ file: targetPath, stage: 'context', reason: 'OPTIONAL_CONTEXT_UNAVAILABLE', required: false });
        continue;
      }

      const targetLines = splitLines(targetContent);
      const definition = findFunctionDefinition(targetLines, name);
      if (!definition) continue;
      if (definition.endLine - definition.startLine + 1 > budget.maxDefinitionLines) {
        omissions.push({ file: targetPath, stage: 'context', reason: 'CONTEXT_BUDGET', required: false });
        continue;
      }
      snippets.push({
        id: `C${nextId++}`, file: targetPath, ref: input.headSha,
        startLine: definition.startLine, endLine: definition.endLine,
        code: targetLines.slice(definition.startLine - 1, definition.endLine).join('\n'),
        reason: 'direct-definition',
      });
      definitions++;
    }
  }

  return { snippets, omissions };
};
