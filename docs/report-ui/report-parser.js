(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ReportParser = api;
})(typeof window === 'object' ? window : globalThis, function () {
  function clean(value) {
    return (value || '').replace(/\\([\\`*_{}\[\]()#!|~])/g, '$1').replace(/@\u200b/g, '@')
      .replace(/\*\*/g, '').replace(/`/g, '').trim();
  }

  function sections(markdown) {
    const result = { preamble: [] };
    let current = 'preamble';
    for (const line of markdown.split('\n')) {
      if (line.startsWith('### ')) {
        current = line.slice(4);
        result[current] = [];
      } else if (line.trim()) {
        result[current].push(line);
      }
    }
    return result;
  }

  function list(lines) {
    return (lines || []).filter(line => line.startsWith('- ')).map(line => clean(line.slice(2)));
  }

  function parse(example) {
    const markdown = example.report;
    const outcome = /\*\*(LOW|MEDIUM|HIGH|UNKNOWN) risk · (PASS|WAITING|ERROR|STALE) · (COMPLETE|PARTIAL|FAILED|NOT_APPLICABLE)\*\*/.exec(markdown);
    const coverage = /Coverage: (\d+)\/(\d+) supported files analyzed; (\d+) excluded/.exec(markdown);
    const publication = /Publication: (PUBLISHED|STALE|FAILED) · Last confirmed commit status: ([^·]+) · Comment: ([^.]+)\./.exec(markdown);
    const model = /Model: ([^·]+) · Duration: (\d+) ms · Calls including retries: (\d+)/.exec(markdown);
    const tokens = /^Input\/output tokens: ([^·\r\n]+) · Tokenizer: ([^\r\n]+)/m.exec(markdown);
    const parts = sections(markdown);
    const preamble = parts.preamble.join('\n');
    const value = (regex, source = preamble) => clean((regex.exec(source) || [])[1]);
    return {
      ...example,
      outcome: outcome ? { risk: outcome[1], gate: outcome[2], analysis: outcome[3] } : null,
      sha: value(/Reviewed SHA: `([^`]+)`/),
      runId: value(/Run: `([^`]+)`/),
      mode: value(/Mode: ([^·\n]+)/),
      decision: value(/Decision: ([^\n]+)/) || value(/Publication error: ([^\n]+)/),
      next: value(/Next action: ([^\n]+)/),
      coverage: coverage ? { analyzed: Number(coverage[1]), supported: Number(coverage[2]), excluded: Number(coverage[3]) } : null,
      publication: publication ? { status: publication[1], commitStatus: clean(publication[2]), comment: clean(publication[3]) } : null,
      checked: list(parts['What was checked']),
      skipped: list(parts['What was skipped and why']),
      stopped: clean((parts['Why the run stopped'] || []).join(' ')),
      findings: list(parts.Findings),
      findingNote: (parts.Findings || []).filter(line => !line.startsWith('- ')
        && !line.startsWith('Validation confirms')).map(clean).join(' '),
      evidence: list(parts.Evidence),
      resources: model ? { model: clean(model[1]), durationMs: Number(model[2]), calls: Number(model[3]),
        tokens: tokens ? clean(tokens[1]) : 'unknown/unknown',
        tokenizer: tokens ? clean(tokens[2]).replace(/\.$/, '') : 'unknown' } : null,
      resourceNotes: (parts['Analysis resources'] || []).filter(line => !line.startsWith('Model:')
        && !line.startsWith('Input/output tokens:') && !line.startsWith('Effective parameters:')).map(clean),
    };
  }

  return { clean, parse, sections };
});
