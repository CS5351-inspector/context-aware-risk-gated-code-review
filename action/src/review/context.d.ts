/** B 模块：用 ReadFileAtRef 为每个被审查文件收集附近代码与一种直接定义。
 * 去重重叠的局部窗口，裁剪超长定义，区分必要读取失败与可选上下文缺失。
 * 不决定风险/门禁，也不写 GitHub；A 在 context 模式下调用本入口。
 */
import type { CollectContext } from './contracts.js';
export declare const collectContext: CollectContext;
