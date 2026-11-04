export interface Review {
    lgtm: boolean;
    review_comment: string;
    hunk_header?: string;
}
export declare class InvalidReviewResponseError extends Error {
    constructor(reason: string);
}
export declare const parseReviewResponse: (content: string) => Review | Review[];
/** 共用 API 信封校验：有效 JSON 也必须正常结束，不能忽略截断或拒答。 */
export declare const readReviewContent: (response: unknown) => string;
export declare class Chat {
    private openai;
    private isAzure;
    private isGithubModels;
    private reasoningModels;
    private reasoningPrefixes;
    constructor(apikey: string);
    private get model();
    private get normalizedModel();
    private get isReasoningModel();
    private get reasoningEffortOption();
    private generatePrompt;
    /** 两种模式和旧接口共用同一套有效模型参数；运行记录不含 API Key。 */
    get effectiveParameters(): Record<string, unknown>;
    /** C 的可靠性调度器传入 signal/timeout/maxRetries=0，避免 SDK 隐藏重试突破总预算。
     * 旧 codeReview 不传第二参数，继续沿用原有调用约定。
     */
    completeReview: (prompt: string, options?: {
        signal: AbortSignal;
        timeout: number;
        maxRetries: number;
        maxOutputTokens: number;
    }) => Promise<unknown>;
    codeReview: (patch: string) => Promise<Review[] | Review>;
}
