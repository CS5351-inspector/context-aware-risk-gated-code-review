import type { ContextSnippet, Finding, ModelInput, Omission, Side } from './model-types.js';
/** 解析 unified diff 的两侧可见行；只允许 patch 内真实出现的行，不猜测 hunk 首行。
 * 同时验证 hunk 声明长度，防止截断的 patch 被当成完整必要输入。
 */
export declare function patchLines(patch: string): Record<Side, Set<number>>;
/** 逐条验证结构与来源；保留有效发现，并将混杂的无效条目标为必要遗漏。 */
export declare function convertFindings(completion: unknown, input: ModelInput, file: string, patch: string, snippets: ContextSnippet[]): {
    findings: Finding[];
    omissions: Omission[];
};
