/// <reference types="node" />
import type { ContextSnippet, ModelAnalysis, ModelBudget, ModelInput } from './model-types.js';
export declare const PROMPT_VERSION = "inspector-c-v1";
/** 注入适配器使离线测试无需 API Key；真实 Chat 结构上满足该接口。 */
export interface ModelClient {
    readonly effectiveParameters: Record<string, unknown>;
    completeReview(prompt: string, options: {
        signal: AbortSignal;
        timeout: number;
        maxRetries: number;
        maxOutputTokens: number;
    }): Promise<unknown>;
}
/** A 负责精确 token 计算与已消耗时间；不提供计数器时拒绝调用，不能把字节当 token。 */
export interface ReviewRuntime {
    countInputTokens(prompt: string): number;
    remainingMs?: number;
}
/** 共用同一个 prompt 主体，唯一实验变量是 context 数组内容。
 * JSON 编码使片段边界清晰；提示约束不能从理论上消除 prompt injection。
 */
export declare function buildModelPrompt(file: string, patch: string, snippets: ContextSnippet[]): string;
export declare function reviewFiles(client: ModelClient, input: ModelInput, snippets: ContextSnippet[], budget: ModelBudget, runtime: ReviewRuntime): Promise<ModelAnalysis>;
/** A 汇总时还要合并 B 的 required omissions；无支持文件暂不自行新增 NOT_APPLICABLE。 */
export declare function deriveModelStatus(input: ModelInput, result: ModelAnalysis, contextOmissions?: Array<{
    required: boolean;
}>): 'COMPLETE' | 'PARTIAL' | 'FAILED';
