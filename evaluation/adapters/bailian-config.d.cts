export const MODEL: 'deepseek-v4.1-flash-1017';
export const REGIONS: readonly string[];
export const EFFECTIVE_PARAMETERS: Readonly<{model: typeof MODEL; enable_thinking:false; response_format:Readonly<{type:'json_object'}>; max_tokens:800; maxRetries:0}>;
export function validateBaseURL(baseURL:unknown): {baseURL:string;region:string};
