export declare const DEEPSEEK_TOKENIZER_REVISION = "08c8657f02291e11b6f6b63e0e16014f8e748518";
/** 使用匹配模型的词表统计消息正文，缺少或损坏时在模型请求前失败。 */
export declare function createDeepSeekContentCounter(): (prompt: string) => number;
