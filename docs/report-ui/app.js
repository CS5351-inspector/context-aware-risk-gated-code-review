(function () {
  'use strict';
  const examples = Array.isArray(window.INSPECTOR_REPORTS) ? window.INSPECTOR_REPORTS : [];
  const reports = examples.map(example => window.ReportParser.parse(example));
  const state = { slug: reports[0] ? reports[0].slug : null, view: 'overview' };
  const byId = id => document.getElementById(id);
  let toastTimer;

  function notify(message) {
    clearTimeout(toastTimer);
    byId('toast').textContent = message;
    byId('toast').classList.add('visible');
    toastTimer = setTimeout(() => byId('toast').classList.remove('visible'), 2200);
  }

  async function copyText(text, successMessage) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        textarea.remove();
        if (!copied) throw new Error('Copy command was rejected');
      }
      notify(successMessage);
    } catch {
      notify('Copy failed. Open Source Markdown and select the text manually.');
    }
  }

  function renderList(id, items, emptyText, emptyClass = true) {
    const list = byId(id);
    list.replaceChildren();
    const values = items.length ? items : [emptyText];
    for (const value of values) {
      const item = document.createElement('li');
      item.textContent = value;
      if (!items.length && emptyClass) item.className = 'empty';
      list.appendChild(item);
    }
  }

  function badge(text, tone) {
    const element = document.createElement('span');
    element.className = `badge ${tone || ''}`;
    element.textContent = text;
    return element;
  }

  function renderScenarios() {
    const container = byId('scenario-list');
    container.replaceChildren();
    reports.forEach((report, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'scenario-button';
      button.dataset.scenario = report.slug;
      button.setAttribute('aria-pressed', String(report.slug === state.slug));
      button.setAttribute('aria-label', `${report.title}: ${report.outcome.risk} risk, ${report.outcome.gate}, ${report.outcome.analysis}`);
      const dot = document.createElement('span');
      dot.className = `scenario-dot ${report.outcome.gate === 'PASS' ? 'pass' : report.outcome.gate === 'WAITING' ? 'waiting' : 'failed'}`;
      dot.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      const name = document.createElement('span');
      name.className = 'scenario-name';
      name.textContent = report.title;
      const meta = document.createElement('span');
      meta.className = 'scenario-meta';
      meta.textContent = `${report.outcome.gate} / ${report.outcome.analysis}`;
      text.append(name, meta);
      const number = document.createElement('span');
      number.className = 'scenario-index';
      number.textContent = String(index + 1).padStart(2, '0');
      button.append(dot, text, number);
      button.addEventListener('click', () => selectReport(report.slug));
      container.appendChild(button);
    });
  }

  function renderResources(report) {
    const grid = byId('resource-grid');
    grid.replaceChildren();
    if (!report.resources) return;
    const entries = [
      ['Model', report.resources.model],
      ['Duration', `${report.resources.durationMs} ms`],
      ['Calls incl. retries', String(report.resources.calls)],
      ['Input / output tokens', report.resources.tokens],
      ['Tokenizer', report.resources.tokenizer],
    ];
    for (const [label, value] of entries) {
      const group = document.createElement('div');
      const term = document.createElement('dt');
      const detail = document.createElement('dd');
      term.textContent = label;
      detail.textContent = value;
      group.append(term, detail);
      grid.appendChild(group);
    }
    byId('resource-note').textContent = report.resourceNotes.join(' ');
  }

  function renderReport() {
    const report = reports.find(item => item.slug === state.slug);
    if (!report) return;
    document.body.dataset.currentReport = report.slug;
    document.body.dataset.currentView = state.view;
    document.title = `${report.title} · Inspector Report Explorer`;
    byId('report-kicker').textContent = `RUN ${report.runId} / ${report.slug.toUpperCase()}`;
    byId('report-title').textContent = report.title;
    byId('report-description').textContent = report.description;
    byId('report-sha').textContent = report.sha;
    byId('decision-code').textContent = report.decision || 'No decision code recorded';
    byId('next-action').textContent = report.next;
    byId('markdown-source').textContent = report.report;

    const badges = byId('outcome-badges');
    badges.replaceChildren(
      badge(`${report.outcome.risk} RISK`, report.outcome.risk === 'LOW' ? 'pass' : report.outcome.risk === 'UNKNOWN' ? 'failed' : 'waiting'),
      badge(report.outcome.gate, report.outcome.gate === 'PASS' ? 'pass' : report.outcome.gate === 'WAITING' ? 'waiting' : 'failed'),
      badge(report.outcome.analysis, report.outcome.analysis === 'COMPLETE' ? 'pass' : report.outcome.analysis === 'FAILED' ? 'failed' : 'waiting'),
    );
    if (report.mode) badges.appendChild(badge(report.mode.toUpperCase()));

    document.querySelectorAll('[data-scenario]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.scenario === report.slug));
    });

    const publication = Boolean(report.publication);
    byId('publication-block').hidden = !publication;
    byId('coverage-block').hidden = publication;
    document.querySelector('.detail-grid').hidden = publication;
    byId('scope-details').hidden = publication;
    byId('resources-block').hidden = publication || !report.resources;
    if (publication) {
      const facts = byId('publication-facts');
      facts.replaceChildren();
      for (const [label, value] of [['Publication', report.publication.status],
        ['Last confirmed status', report.publication.commitStatus], ['Comment', report.publication.comment]]) {
        const group = document.createElement('div');
        const term = document.createElement('dt');
        const detail = document.createElement('dd');
        term.textContent = label;
        detail.textContent = value;
        group.append(term, detail);
        facts.appendChild(group);
      }
      return;
    }

    if (report.coverage) {
      const { analyzed, supported, excluded } = report.coverage;
      const percent = supported ? Math.round(analyzed / supported * 100) : 0;
      byId('coverage-ratio').textContent = `${analyzed} / ${supported} FILES`;
      byId('coverage-caption').textContent = `${percent}% of supported files analyzed · ${excluded} excluded from model analysis`;
      byId('coverage-meter').setAttribute('aria-valuenow', String(percent));
      byId('coverage-fill').style.width = '100%';
      byId('coverage-fill').style.transform = `scaleX(${supported ? analyzed / supported : 0})`;
    }
    renderList('findings-list', report.findings, report.findingNote || 'No itemized findings were returned.');
    byId('findings-count').textContent = String(report.findings.length).padStart(2, '0');
    renderList('evidence-list', report.evidence, 'No retrieved evidence was recorded.');
    byId('evidence-count').textContent = String(report.evidence.length).padStart(2, '0');
    renderList('checked-list', report.checked, 'No files completed model analysis.');
    renderList('skipped-list', report.skipped, 'No skipped files or omissions were recorded.');
    byId('stop-reason').textContent = report.stopped;
    renderResources(report);
  }

  function selectReport(slug) {
    if (!reports.some(report => report.slug === slug)) return;
    state.slug = slug;
    renderReport();
  }

  function setView(view) {
    if (!['overview', 'markdown'].includes(view)) return;
    state.view = view;
    document.body.dataset.currentView = view;
    for (const tab of document.querySelectorAll('[role="tab"]')) {
      const selected = tab.dataset.view === view;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    byId('overview-view').hidden = view !== 'overview';
    byId('markdown-view').hidden = view !== 'markdown';
  }

  document.querySelector('.view-tabs').addEventListener('keydown', event => {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const current = tabs.findIndex(tab => tab.dataset.view === state.view);
    let next = current;
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    setView(tabs[next].dataset.view);
    tabs[next].focus();
  });
  document.querySelectorAll('[role="tab"]').forEach(tab => tab.addEventListener('click', () => setView(tab.dataset.view)));
  byId('copy-report').addEventListener('click', () => {
    const report = reports.find(item => item.slug === state.slug);
    if (report) copyText(report.report, `${report.title} copied to clipboard.`);
  });
  byId('copy-sha').addEventListener('click', () => {
    const report = reports.find(item => item.slug === state.slug);
    if (report) copyText(report.sha, 'Reviewed SHA copied to clipboard.');
  });

  if (!reports.length) {
    byId('report-title').textContent = 'No report data available';
    byId('report-description').textContent = 'Run npm run examples:report from the repository root to generate synchronized UI data.';
    byId('copy-report').disabled = true;
    byId('copy-sha').disabled = true;
    return;
  }
  renderScenarios();
  renderReport();
  setView('overview');
  window.reportExplorer = { selectReport, setView, getState: () => ({ ...state }) };
})();
