/* ==========================================================================
   PulseMind — Respiratory Risk Monitoring (Prototype)

   Standalone vanilla-JS implementation. All data is simulated sample data;
   the "Simulate next update" button steps through three pre-scripted
   monitoring snapshots (Low → Medium → High risk).
   ========================================================================== */

(function () {
  'use strict';

  // ---- State ---------------------------------------------------------------

  const state = {
    screen: 'overview',   // 'overview' | 'detail'
    step: 0,              // index into STEPS
    win: '6h',            // active trend window
    panelOpen: false,     // patient context drawer
    reviewed: {},         // { stepIndex: true } once marked reviewed
    query: '',            // overview search query
    riskFilter: 'All',    // overview risk filter
  };

  const WINDOW_POINTS = { '1h': 12, '6h': 16, '12h': 20, '24h': 26 };
  const WINDOWS = ['1h', '6h', '12h', '24h'];

  const LEVEL_CLASS = { Low: 'risk-low', Medium: 'risk-medium', High: 'risk-high' };

  // ---- Simulated monitoring snapshots ---------------------------------------

  const STEPS = [
    {
      t: '08:20', clock: '08:20:12', level: 'Low', trend: 'Stable', trendArrow: '→', trendColor: '#6b7177',
      badge: 'Monitoring — no pattern',
      explanation: 'No risk pattern detected. Respiratory parameters are stable and within expected ranges. Routine monitoring continues.',
      ventStatus: 'Connected', ventDot: '#4f7e62', labs: '07:52',
      abg: 'pH 7.42 · PaO₂ 92 · PaCO₂ 41 · HCO₃⁻ 25',
      why: [
        { title: 'Parameters stable', sub: 'No notable change over the monitored window', tone: 'neutral', tag: '—' },
        { title: 'Oxygenation within range', sub: 'S/F ratio steady over the last 6 h', tone: 'neutral', tag: '—' },
        { title: 'Support unchanged', sub: 'FiO₂ and PEEP settings stable', tone: 'neutral', tag: '—' },
      ],
      series: { spo2: [0.72, 0.70], fio2: [0.34, 0.35], peep: [0.5, 0.5], rr: [0.4, 0.42] },
      vals: { spo2: '96', fio2: '40', peep: '8', rr: '18' },
      arrows: { spo2: ['→', '#6b7177'], fio2: ['→', '#6b7177'], peep: ['→', '#6b7177'], rr: ['→', '#6b7177'] },
    },
    {
      t: '10:45', clock: '10:45:31', level: 'Medium', trend: 'Worsening', trendArrow: '↗', trendColor: '#9a7400',
      badge: 'Risk pattern detected',
      explanation: 'Early risk pattern detected — S/F ratio drifting down over the last 2 h while FiO₂ requirement rises. Review suggested.',
      ventStatus: 'Delayed · 41s', ventDot: '#9a7400', labs: '10:12',
      abg: 'pH 7.38 · PaO₂ 78 · PaCO₂ 45 · HCO₃⁻ 24',
      why: [
        { title: 'S/F ratio decreasing', sub: 'Gradual decline over the last 2 h', tone: 'med', tag: 'Med' },
        { title: 'FiO₂ requirement increasing', sub: 'Oxygen support demand rising', tone: 'med', tag: 'Med' },
        { title: 'Respiratory rate rising slightly', sub: 'Mild upward drift over 2 h', tone: 'neutral', tag: 'Low' },
      ],
      series: { spo2: [0.70, 0.54], fio2: [0.35, 0.55], peep: [0.5, 0.54], rr: [0.42, 0.56] },
      vals: { spo2: '94', fio2: '50', peep: '8', rr: '23' },
      arrows: { spo2: ['↘', '#9a7400'], fio2: ['↗', '#9a7400'], peep: ['→', '#6b7177'], rr: ['↗', '#9a7400'] },
    },
    {
      t: '12:10', clock: '12:10:08', level: 'High', trend: 'Worsening', trendArrow: '↗', trendColor: '#b1473c',
      badge: 'Risk pattern detected',
      explanation: 'Emerging worsening hypoxemia — oxygenation falling while support and respiratory rate rise. Review suggested.',
      ventStatus: 'Connected', ventDot: '#4f7e62', labs: '11:48',
      abg: 'pH 7.31 · PaO₂ 68 · PaCO₂ 52 · HCO₃⁻ 24',
      why: [
        { title: 'S/F ratio decreasing', sub: 'Sustained decline over the last 2 h', tone: 'high', tag: 'High' },
        { title: 'FiO₂ requirement increasing', sub: 'Rising oxygen support demand', tone: 'high', tag: 'High' },
        { title: 'Respiratory rate increasing', sub: 'Elevated breathing effort', tone: 'med', tag: 'Med' },
        { title: 'Recent ABG worse', sub: 'Suggests worsening oxygenation', tone: 'med', tag: 'Med' },
      ],
      series: { spo2: [0.62, 0.28], fio2: [0.45, 0.80], peep: [0.54, 0.60], rr: [0.56, 0.76] },
      vals: { spo2: '89', fio2: '65', peep: '10', rr: '29' },
      arrows: { spo2: ['↘', '#b1473c'], fio2: ['↗', '#b1473c'], peep: ['→', '#6b7177'], rr: ['↗', '#b1473c'] },
    },
  ];

  const SIGNAL_DEFS = [
    { key: 'spo2', name: 'SpO₂', unit: '%', wig: 0.045, seed: 1 },
    { key: 'fio2', name: 'FiO₂', unit: '%', wig: 0.04, seed: 2 },
    { key: 'peep', name: 'PEEP', unit: 'cmH₂O', wig: 0.03, seed: 3 },
    { key: 'rr', name: 'Resp. rate', unit: '/min', wig: 0.045, seed: 4 },
  ];

  // Bed 7 (risk === null) is the simulated patient driven by STEPS.
  const BEDS = [
    ['Bed 1', 'ICU-2284', '1 d 06 h', 'Low'], ['Bed 2', 'ICU-2287', '0 d 18 h', 'Low'],
    ['Bed 3', 'ICU-2288', '5 d 02 h', 'Medium'], ['Bed 4', 'ICU-2289', '2 d 11 h', 'Low'],
    ['Bed 5', 'ICU-2290', '0 d 09 h', 'Low'], ['Bed 6', 'ICU-2286', '4 d 21 h', 'Low'],
    ['Bed 7', 'ICU-2291', '3 d 14 h', null], ['Bed 8', 'ICU-2292', '1 d 15 h', 'Low'],
  ];

  const TIMELINE_LEVELS = [
    { t: '08:20', label: 'Low risk', dot: '#4f7e62' },
    { t: '10:45', label: 'Medium risk pattern detected', dot: '#9a7400' },
    { t: '12:10', label: 'High risk pattern detected', dot: '#b1473c' },
  ];

  // ---- Sparkline series generator -------------------------------------------

  function mkSeries(s, e, wig, seed, n) {
    const W = 240, H = 62, padX = 5, padY = 8;
    const pts = [];
    let lx = 0, ly = 0;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const base = s + (e - s) * (t * t * (3 - 2 * t)); // smoothstep for a gentler curve
      const noise = Math.sin(i * 1.3 + seed) * wig + Math.sin(i * 0.55 + seed * 1.7) * wig * 0.45;
      const v = Math.max(0.05, Math.min(0.95, base + noise));
      const x = padX + t * (W - 2 * padX);
      const y = padY + (1 - v) * (H - 2 * padY);
      pts.push(x.toFixed(1) + ',' + y.toFixed(1));
      lx = x; ly = y;
    }
    return { points: pts.join(' '), lx: lx.toFixed(1), ly: ly.toFixed(1) };
  }

  // ---- Screen 1 — ICU overview ----------------------------------------------

  function renderOverview() {
    const S = STEPS[state.step];

    const visibleBeds = BEDS.filter(function (b) {
      const flagged = b[3] === null;
      const level = flagged ? S.level : b[3];
      const text = (b[0] + ' ' + b[1]).toLowerCase();
      const matchesQuery = text.indexOf(state.query.toLowerCase()) !== -1;
      const matchesRisk = state.riskFilter === 'All' || level === state.riskFilter;
      return matchesQuery && matchesRisk;
    });

    const riskCounts = BEDS.reduce(function (counts, b) {
      const level = b[3] === null ? S.level : b[3];
      counts[level] = (counts[level] || 0) + 1;
      return counts;
    }, {});

    const rows = visibleBeds.map(function (b) {
      const flagged = b[3] === null;
      const level = flagged ? S.level : b[3];
      const cls = LEVEL_CLASS[level];
      const mrn = 4410 + parseInt(b[0].slice(4), 10);
      const highlight = flagged && state.step >= 1;
      return (
        '<div class="bed-grid bed-row ' + cls + (flagged ? ' clickable" data-action="open-detail" role="link" tabindex="0" aria-label="Open details for ' + b[0] + '"' : '"') +
          (highlight ? ' style="background:var(--chip)"' : '') + '>' +
          '<span class="bed-name">' + b[0] + '</span>' +
          '<span class="bed-pid">' + b[1] + ' · MRN ••••' + mrn + '</span>' +
          '<span class="bed-vent">' + b[2] + '</span>' +
          '<span class="bed-risk">' +
            '<span class="chip"><span class="dot"></span>' + level + '</span>' +
            (highlight ? '<span class="trending-tag">↗ trending</span>' : '') +
          '</span>' +
          '<span class="bed-action">' + (flagged ? 'View detail →' : '—') + '</span>' +
        '</div>'
      );
    }).join('') || '<div class="overview-empty">No patients match the current search and risk filter.</div>';

    return (
      '<section class="overview">' +
        '<div class="overview-head">' +
          '<div>' +
            '<div class="overview-title">ICU Overview — Ventilated Patients</div>' +
            '<div class="overview-sub">Pod B · 8 monitored beds</div>' +
          '</div>' +
          '<div class="overview-tools">' +
            '<label class="search-control" aria-label="Search patients">' +
              '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="6" stroke="currentColor" stroke-width="1.7"></circle><path d="m16 16 4 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"></path></svg>' +
              '<input type="search" data-control="patient-search" placeholder="Search by bed or patient" value="' + state.query + '">' +
            '</label>' +
            '<label class="filter-control"><span>Risk</span><select data-control="risk-filter">' +
              ['All', 'High', 'Medium', 'Low'].map(function (level) { return '<option' + (state.riskFilter === level ? ' selected' : '') + '>' + level + '</option>'; }).join('') +
            '</select></label>' +
          '</div>' +
        '</div>' +
        '<div class="summary-strip">' +
          '<div class="summary-stat"><span class="summary-icon summary-blue">▤</span><p><strong>8</strong><b>Monitored beds</b><small>Receiving data</small></p></div>' +
          '<div class="summary-stat"><span class="summary-icon summary-amber">!</span><p><strong>' + ((riskCounts.Medium || 0) + (riskCounts.High || 0)) + '</strong><b>Needs attention</b><small>Medium or high risk</small></p></div>' +
          '<div class="summary-stat"><span class="summary-icon summary-green">✓</span><p><strong>' + (riskCounts.Low || 0) + '</strong><b>Low risk</b><small>Routine monitoring</small></p></div>' +
        '</div>' +
        '<div class="card patient-table">' +
          '<div class="bed-grid table-head">' +
            '<span class="mono-label">Bed</span><span class="mono-label">Patient</span><span class="mono-label">Ventilation</span><span class="mono-label">Respiratory risk</span><span class="mono-label action-label">Action</span>' +
          '</div>' +
          '<div>' + rows + '</div>' +
          '<p class="overview-note">Risk chips summarise pattern detection from incoming ventilator, monitor and lab data. A flagged bed is a prompt for clinician review — not a diagnosis or treatment instruction.</p>' +
        '</div>' +
      '</section>'
    );
  }

  // ---- Screen 2 — patient risk detail ----------------------------------------

  function renderDetail() {
    const S = STEPS[state.step];
    const cls = LEVEL_CLASS[S.level];
    const pending = state.step >= 1 && !state.reviewed[state.step];

    // Sparklines for the active window
    const n = WINDOW_POINTS[state.win];
    const trendCards = SIGNAL_DEFS.map(function (d) {
      const range = S.series[d.key];
      const ser = mkSeries(range[0], range[1], d.wig, d.seed, n);
      const arrow = S.arrows[d.key];
      return (
        '<div class="trend-card">' +
          '<div class="trend-top">' +
            '<span class="trend-name">' + d.name + '</span>' +
            '<span class="trend-reading">' +
              '<span class="trend-value">' + S.vals[d.key] + '</span>' +
              '<span class="trend-unit">' + d.unit + '</span>' +
              '<span class="trend-arrow" style="color:' + arrow[1] + '">' + arrow[0] + '</span>' +
            '</span>' +
          '</div>' +
          '<svg class="sparkline" viewBox="0 0 240 62" preserveAspectRatio="none">' +
            '<line x1="4" y1="21" x2="236" y2="21" stroke="#eef0f1" stroke-width="1"></line>' +
            '<line x1="4" y1="42" x2="236" y2="42" stroke="#eef0f1" stroke-width="1"></line>' +
            '<polyline points="' + ser.points + '" fill="none" stroke="#646b71" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></polyline>' +
            '<circle cx="' + ser.lx + '" cy="' + ser.ly + '" r="2.5" fill="#2b3034"></circle>' +
          '</svg>' +
        '</div>'
      );
    }).join('');

    const winTabs = WINDOWS.map(function (w) {
      return '<button class="win-tab' + (w === state.win ? ' active' : '') + '" data-action="set-win" data-win="' + w + '">' + w + '</button>';
    }).join('');

    const whyItems = S.why.map(function (w) {
      return (
        '<div class="why-item tone-' + w.tone + '">' +
          '<span class="dot"></span>' +
          '<div class="why-body">' +
            '<div class="why-title">' + w.title + '</div>' +
            '<div class="why-sub">' + w.sub + '</div>' +
          '</div>' +
          '<span class="why-tag">' + w.tag + '</span>' +
        '</div>'
      );
    }).join('');

    // Timeline: monitoring start plus one entry per elapsed step
    const events = [{ t: '06:05', label: 'Monitoring started', info: true }];
    for (let i = 0; i <= state.step; i++) {
      events.push(Object.assign({ idx: i }, TIMELINE_LEVELS[i]));
    }
    const timelineRows = events.map(function (ev, j) {
      const last = j === events.length - 1;
      let statusHtml = '';
      if (!ev.info) {
        if (ev.idx === 0) statusHtml = '<span class="timeline-status routine">Routine</span>';
        else if (state.reviewed[ev.idx]) statusHtml = '<span class="timeline-status reviewed">Reviewed</span>';
        else statusHtml = '<span class="timeline-status pending">Pending review</span>';
      }
      return (
        '<div class="timeline-row">' +
          '<div class="timeline-rail">' +
            (ev.info
              ? '<span class="timeline-dot info"></span>'
              : '<span class="timeline-dot" style="background:' + ev.dot + '"></span>') +
            '<span class="timeline-line"></span>' +
          '</div>' +
          '<div class="timeline-body">' +
            '<span class="timeline-time">' + ev.t + '</span>' +
            '<div class="timeline-main">' +
              '<span class="timeline-label' + (last && !ev.info ? ' current' : '') + '">' + ev.label + '</span>' +
              statusHtml +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    const reviewBtn = pending
      ? '<button class="review-btn pending" data-action="mark-reviewed">Mark as reviewed</button>'
      : '<button class="review-btn done">' + (state.step >= 1 ? 'Reviewed ✓' : 'No review needed') + '</button>';
    const statusDot = pending ? '#b1473c' : '#4f7e62';
    const statusLabel = pending ? 'Pending review' : (state.step >= 1 ? 'Reviewed' : 'Routine monitoring');

    const drawer = !state.panelOpen ? '' : (
      '<div class="drawer-overlay" data-action="toggle-panel"></div>' +
      '<aside class="drawer">' +
        '<div class="drawer-head">' +
          '<div class="drawer-title">Patient Context &amp; Data</div>' +
          '<button class="drawer-close" data-action="toggle-panel">Close ✕</button>' +
        '</div>' +
        '<div>' +
          '<div class="drawer-section-label">Patient Context</div>' +
          '<div class="context-grid">' +
            '<div><div class="context-label">Age</div><div class="context-value">64 years</div></div>' +
            '<div><div class="context-label">Sex</div><div class="context-value">Male</div></div>' +
            '<div><div class="context-label">Ventilation duration</div><div class="context-value">3 d 14 h</div></div>' +
            '<div><div class="context-label">Admitted</div><div class="context-value">12 Jul 2026</div></div>' +
          '</div>' +
          '<div class="context-label">Main diagnosis <span class="placeholder-mark">[placeholder]</span></div>' +
          '<div class="placeholder-box">ARDS — community-acquired pneumonia</div>' +
          '<div class="context-label">Relevant history <span class="placeholder-mark">[placeholder]</span></div>' +
          '<div class="placeholder-box">COPD · Type 2 diabetes · Hypertension</div>' +
          '<div class="context-label">Recent ABG summary <span class="placeholder-mark">(' + S.labs + ')</span></div>' +
          '<div class="placeholder-box mono">' + S.abg + '</div>' +
        '</div>' +
        '<div>' +
          '<div class="drawer-section-label">Data Quality</div>' +
          '<div class="quality-row"><span class="quality-name">Ventilator data</span><span class="quality-state" style="color:' + S.ventDot + '"><span class="dot" style="background:' + S.ventDot + '"></span>' + S.ventStatus + '</span></div>' +
          '<div class="quality-row"><span class="quality-name">Bedside monitor</span><span class="quality-state" style="color:#4f7e62"><span class="dot dot-green"></span>Connected</span></div>' +
          '<div class="quality-row"><span class="quality-name">Lab / ABG data</span><span class="quality-state" style="color:#6b7177"><span class="dot dot-grey"></span>Updated ' + S.labs + '</span></div>' +
          '<div class="quality-row"><span class="quality-name">Medical history</span><span class="quality-state" style="color:#4f7e62"><span class="dot dot-green"></span>Available</span></div>' +
          '<p class="panel-footnote">PulseMind output depends on data completeness. Delayed or missing inputs reduce confidence in pattern detection.</p>' +
        '</div>' +
      '</aside>'
    );

    return (
      '<div class="detail">' +

        '<div class="card breadcrumb-bar">' +
          '<div class="breadcrumb-left">' +
            '<button class="btn btn-light" data-action="back">← ICU Overview</button>' +
            '<div class="bed-title">Bed 7 · Pod B <span>· ICU-2291 · MRN ••••4417</span></div>' +
          '</div>' +
          '<div class="status-strip">' +
            '<span class="status-item"><span class="dot" style="background:' + S.ventDot + '"></span>Ventilator: ' + S.ventStatus + '</span>' +
            '<span class="status-item"><span class="dot dot-green"></span>Monitor: Connected</span>' +
            '<span class="status-item"><span class="dot dot-grey"></span>Labs: updated ' + S.labs + '</span>' +
            '<button class="btn btn-outline" data-action="toggle-panel">Patient context &amp; data ▸</button>' +
          '</div>' +
        '</div>' +

        '<section class="risk-card ' + cls + '">' +
          '<div class="risk-level-col">' +
            '<div class="mono-label">Current Respiratory Risk</div>' +
            '<div class="risk-level">' + S.level + '</div>' +
            '<div class="risk-trend">' +
              '<span class="mono-label">Trend</span>' +
              '<span class="risk-trend-pill" style="color:' + S.trendColor + '">' + S.trendArrow + ' ' + S.trend + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="risk-explain-col">' +
            '<span class="risk-badge">' + S.badge + '</span>' +
            '<p class="risk-explanation">' + S.explanation + '</p>' +
            '<div class="risk-disclaimer">Requires clinician assessment. PulseMind is read-only — it does not act on the patient or the ventilator.</div>' +
          '</div>' +
          '<div class="risk-action-col">' +
            '<div class="mono-label">Clinician action</div>' +
            reviewBtn +
            '<div class="review-status"><span class="dot" style="background:' + statusDot + '"></span>Status: ' + statusLabel + '</div>' +
          '</div>' +
        '</section>' +

        '<div class="panels">' +

          '<section class="card panel why-panel">' +
            '<div class="panel-title">Why this was flagged</div>' +
            '<div class="panel-sub">Signals associated with current risk</div>' +
            '<div class="why-list">' + whyItems + '</div>' +
            '<p class="panel-footnote">Signals are <strong>associated</strong> with rising risk. Association does not indicate cause.</p>' +
          '</section>' +

          '<section class="card panel">' +
            '<div class="trends-head">' +
              '<div>' +
                '<div class="panel-title">Parameter Trends</div>' +
                '<div class="panel-sub">Change over time</div>' +
              '</div>' +
              '<div class="win-tabs">' + winTabs + '</div>' +
            '</div>' +
            '<div class="trend-grid">' + trendCards + '</div>' +
          '</section>' +

          '<section class="card panel">' +
            '<div class="panel-title" style="margin-bottom:12px">Risk Timeline</div>' +
            '<div class="timeline">' + timelineRows + '</div>' +
          '</section>' +

        '</div>' +
        drawer +
      '</div>'
    );
  }

  // ---- Render + events -------------------------------------------------------

  function render() {
    const S = STEPS[state.step];

    document.getElementById('sim-clock').textContent = S.clock;
    document.getElementById('demo-btn').textContent =
      state.step < 2 ? 'Simulate next update → ' + STEPS[state.step + 1].t : 'Restart demo ↺';

    document.getElementById('screen').innerHTML =
      state.screen === 'overview' ? renderOverview() : renderDetail();
  }

  const actions = {
    'advance': function () {
      if (state.step < 2) {
        state.step += 1;
      } else {
        state.step = 0;
        state.reviewed = {};
      }
    },
    'open-detail': function () { state.screen = 'detail'; },
    'back': function () { state.screen = 'overview'; state.panelOpen = false; },
    'toggle-panel': function () { state.panelOpen = !state.panelOpen; },
    'mark-reviewed': function () { state.reviewed[state.step] = true; },
    'set-win': function (el) { state.win = el.dataset.win; },
  };

  document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const handler = actions[el.dataset.action];
    if (!handler) return;
    handler(el);
    render();
  });

  document.addEventListener('input', function (e) {
    if (e.target.matches('[data-control="patient-search"]')) {
      state.query = e.target.value;
      render();
      const input = document.querySelector('[data-control="patient-search"]');
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }
  });

  document.addEventListener('change', function (e) {
    if (e.target.matches('[data-control="risk-filter"]')) {
      state.riskFilter = e.target.value;
      render();
    }
  });

  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-action="open-detail"]')) {
      e.preventDefault();
      actions['open-detail']();
      render();
    }
  });

  render();
})();
