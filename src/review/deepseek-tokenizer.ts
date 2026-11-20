import { Tokenizer } from '@huggingface/tokenizers';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

// DeepSeek 官方 Flash 快照。压缩资源让构建与模型试跑共享同一份数据。
export const DEEPSEEK_TOKENIZER_REVISION = '08c8657f02291e11b6f6b63e0e16014f8e748518';
const assetDigests = {
  'tokenizer.json': 'c90dfa01249db1be4245780a052ede752e1361c612ac6d08e2bdada7d599476b',
  'tokenizer_config.json': '6ac8c8dc065ed118161d02dd532749ae3f52c243deac27872134fae2f50d8547',
} as const;

function readAsset(name: keyof typeof assetDigests): object {
  const bytes = gunzipSync(readFileSync(join('assets', 'deepseek', name + '.gz')));
  if (createHash('sha256').update(bytes).digest('hex') !== assetDigests[name]) throw new Error('DeepSeek tokenizer checksum mismatch');
  return JSON.parse(bytes.toString('utf8'));
}

let tokenizer: Tokenizer | undefined;

/** 使用匹配模型的词表统计消息正文，缺少或损坏时在模型请求前失败。 */
export function createDeepSeekContentCounter(): (prompt: string) => number {
  try {
    tokenizer ??= new Tokenizer(readAsset('tokenizer.json'), readAsset('tokenizer_config.json'));
    const encoder = tokenizer;
    return (prompt) => encoder.encode(prompt, { add_special_tokens: false }).ids.length;
  } catch {
    throw new Error('DeepSeek tokenizer is unavailable or invalid. Run from a complete repository checkout.');
  }
}
