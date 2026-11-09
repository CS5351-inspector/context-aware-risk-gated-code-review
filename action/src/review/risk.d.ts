import type { AnalysisResult, CalculateRisk } from './contracts.js';
/** Validate only the domain fields D consumes; this does not validate model metrics or prove a bug. */
export declare function isValidAnalysis(value: unknown): boolean;
/** COMPLETE 还必须有实际覆盖，不能仅相信一个状态字符串。 */
export declare function hasCompleteCoverage(analysis: AnalysisResult): boolean;
/** 全 PR 的规模与敏感路径都参与计算，包括未支持、删除、重命名前的路径。 */
export declare const calculateRisk: CalculateRisk;
