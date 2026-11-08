'use strict';
// Plumbing control only. It has no gold access and deliberately reports no defects.
module.exports = {
  metadata: { kind: 'scripted', version: 'empty-response-control-v1', context_kind: 'none' },
  countInputTokens: () => 0, // No real model request; NEVER used as a live tokenizer.
  createClient: () => ({ effectiveParameters: { model: 'scripted-empty-control', temperature: 0 },
    completeReview: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '{"reviews":[]}' } }], usage: { prompt_tokens:0, completion_tokens:0 } }) }),
};
