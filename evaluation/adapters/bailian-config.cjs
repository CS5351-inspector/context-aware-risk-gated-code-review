'use strict';
const MODEL = 'deepseek-v4.1-flash-1017';
const REGIONS = Object.freeze(['cn-beijing','us-east-1','ap-southeast-1','eu-central-1','ap-northeast-1','cn-hongkong']);
// Validate the literal URL before credentials are read; no userinfo, port, query,
// encoded path, redirect host, shared endpoint or RelayCore fallback is accepted.
function validateBaseURL(baseURL) {
  if (typeof baseURL !== 'string') throw new Error('Explicit official Bailian workspace HTTPS endpoint required');
  const match = /^https:\/\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.([a-z0-9-]+)\.maas\.aliyuncs\.com\/compatible-mode\/v1\/?$/.exec(baseURL);
  if (!match || !REGIONS.includes(match[2])) throw new Error('Official Bailian workspace endpoint and supported region required');
  return { baseURL: baseURL.replace(/\/$/, ''), region: match[2] };
}
const EFFECTIVE_PARAMETERS = Object.freeze({ model:MODEL, enable_thinking:false,
  response_format:Object.freeze({type:'json_object'}), max_tokens:800, maxRetries:0 });
module.exports={MODEL,REGIONS,EFFECTIVE_PARAMETERS,validateBaseURL};
