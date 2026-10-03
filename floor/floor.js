/* ============================================================
   THE FLOOR — web-playable daily session
   ------------------------------------------------------------
   Top-of-funnel surface for the Basis app: play today's session
   in the browser, share the result, download the app for streaks,
   leaderboards and the curriculum.

   Sessions are NOT computed here — floor-data.js ships plans
   precomputed by the app's real engine (scripts/generate-floor-web.ts
   in the app repo), so a web player provably gets the same five
   decisions as an app player. Economy maths below mirrors
   decisionDelta() in src/data/floor.ts.

   No leaderboard by design: the app's board is server-verified
   (submit_floor_day recomputes P&L), and anonymous browser results
   can't be trusted into it without breaking that guarantee.
   ============================================================ */
(function () {
  'use strict';

  var shell = document.getElementById('floor-shell');
  if (!shell) return;

  // ── Data ────────────────────────────────────────────────
  var DATA;
  try {
    DATA = JSON.parse(decodeURIComponent(escape(atob(window.__FLOOR_DATA__))));
  } catch (e) {
    try {
      DATA = JSON.parse(atob(window.__FLOOR_DATA__));
    } catch (e2) {
      return fail("Couldn't load today's session.");
    }
  }

  var R = DATA.rules;
  var STORE_KEY = 'basis-floor-web';

  // ── Helpers ─────────────────────────────────────────────
  function todayKey() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function money(n) {
    var neg = n < 0;
    var s = '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
    return neg ? '−' + s : s;
  }

  function signedMoney(n) {
    return (n >= 0 ? '+' : '−') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
  }

  /** Mirrors decisionDelta() in src/data/floor.ts. Stake is sized off the
   *  day's OPENING book, not the live one — sizing off the live book made a
   *  hot streak compound its own base and sent a perfect day exponential. */
  function decisionDelta(dayStartBook, stakePct, correct, hotBefore) {
    var stake = Math.round((dayStartBook * stakePct) / 100);
    if (!correct) return -stake;
    var mult = hotBefore >= R.HOT_STREAK_AT ? R.HOT_MULT : R.WIN_MULT;
    return Math.round(stake * mult);
  }

  // ── Reveal animation (ported from src/features/floor/RevealChart.tsx) ──
  var CHART_MS = 1600;
  var CHART_H = 130;
  var BREAK_AT = 0.62;   // where the random walk ends and the outcome begins
  var COUNT_MS = 700;    // CountUpMoney duration

  var reduceMotion = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function hashSeed(seed) {
    var h = 5381;
    for (var i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0;
    return h || 1;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Same geometry as the app: a neutral walk that breaks hard into the
   *  outcome, so the shape itself gives the result away a beat before the
   *  words do. Seeded, so a resumed reveal redraws identically. */
  function buildChart(seed, outcome) {
    var rand = mulberry32(hashSeed(seed + ':' + outcome));
    var N = 36;
    var split = Math.floor(N * BREAK_AT);
    var start = 0.42 + rand() * 0.16;
    var ys = [start];
    for (var i = 1; i < N; i++) {
      var prev = ys[i - 1];
      var next;
      if (i < split) {
        next = Math.min(0.72, Math.max(0.28, prev + (rand() - 0.5) * 0.09));
      } else {
        var drift = (outcome === 'up' ? -1 : 1) * (0.02 + rand() * 0.022);
        next = Math.min(0.94, Math.max(0.06, prev + drift + (rand() - 0.5) * 0.05));
      }
      ys.push(next);
    }
    var target = outcome === 'up'
      ? Math.min(ys[N - 1], start - 0.28)
      : Math.max(ys[N - 1], start + 0.28);
    ys[N - 1] = Math.min(0.92, Math.max(0.08, target));
    ys[N - 2] = (ys[N - 2] + ys[N - 1]) / 2;

    function pt(y, i) {
      return ((i / (N - 1)) * 100).toFixed(2) + ',' + (y * CHART_H).toFixed(1);
    }
    return {
      pre: ys.slice(0, split + 1).map(pt).join(' '),
      post: ys.slice(split).map(function (y, j) { return pt(y, split + j); }).join(' '),
      baselineY: start * CHART_H,
      endY: ys[N - 1] * CHART_H,
    };
  }

  /** Odometer readout, mirroring CountUpMoney's ease-out cubic. */
  function countUp(el, from, to, fmt, ms) {
    ms = ms || COUNT_MS;
    if (reduceMotion || from === to) { el.textContent = fmt(to); return; }
    var start = Date.now();
    var settled = false;
    function finish() {
      if (settled) return;
      settled = true;
      el.textContent = fmt(to);
    }
    (function tick() {
      if (settled) return;
      var t = Math.min(1, (Date.now() - start) / ms);
      var eased = 1 - Math.pow(1 - t, 3);
      el.textContent = fmt(from + (to - from) * eased);
      if (t < 1) requestAnimationFrame(tick); else finish();
    })();
    // rAF is suspended in background tabs, which would otherwise strand the
    // reader on the starting value — i.e. the wrong number, not just a missing
    // animation. Guarantee the final figure lands either way.
    setTimeout(finish, ms + 60);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fail(msg) {
    shell.innerHTML =
      '<div class="fl-card" style="text-align:center">' +
      '<p class="fl-sub">' + esc(msg) + '</p>' +
      '<p class="fl-sub" style="margin-top:12px">' +
      'The full Floor runs daily in the Basis app.</p>' +
      '<a class="fl-btn fl-btn-primary" style="margin-top:20px;text-decoration:none" ' +
      'href="https://apps.apple.com/app/basis-learn-finance-markets/id6784982377">Get Basis free</a>' +
      '</div>';
  }

  // ── Session state ───────────────────────────────────────
  var DAY = todayKey();
  var plan = DATA.days[DAY];

  if (!plan) {
    // Outside the precomputed window — better a clear dead end than a
    // session that doesn't match the app's.
    return fail("Today's session isn't available on the web yet.");
  }

  // Rebuild today's five scenarios from the plan.
  var scenarios = plan.d.map(function (entry) {
    var s = DATA.scenarios[entry[0]];
    var order = entry[1];
    var opts = order.map(function (i) { return s.opts[i]; });
    return {
      id: s.id,
      cat: s.cat,
      date: s.date,
      setup: s.setup,
      q: s.q,
      options: opts,
      correctIndex: opts.indexOf(s.opts[s.ci]),
      why: s.why,
      fact: s.fact,
    };
  });

  var state = load();

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        if (saved && saved.day === DAY) return saved;
      }
    } catch (e) { /* private mode / blocked storage — play unsaved */ }
    return { day: DAY, started: false, idx: 0, book: R.STARTING_BOOK, decisions: [], done: false };
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function hotBefore() {
    var run = 0;
    for (var i = state.decisions.length - 1; i >= 0; i--) {
      if (state.decisions[i].correct) run++; else break;
    }
    return run;
  }

  // ── Screens ─────────────────────────────────────────────
  function render() {
    if (state.done) return renderResult();
    if (!state.started) return renderOpening();
    renderDecision();
  }

  function renderOpening() {
    shell.innerHTML =
      '<div class="fl-card">' +
        '<p class="fl-label">Session #' + plan.n + '</p>' +
        '<h1 class="fl-h1">The market is open</h1>' +
        '<p class="fl-sub">Five real moments from market history — the closing calls are the ' +
        'hardest. Same session for everyone on Earth today. Size your conviction, then live with it.</p>' +
        '<div class="fl-book-box">' +
          '<div class="fl-book-label">Your book</div>' +
          '<div class="fl-book-value">' + money(R.STARTING_BOOK) + '</div>' +
        '</div>' +
        '<div class="fl-rules">' +
          rule('var(--success)', 'A right call pays ' + R.WIN_MULT + '× your stake.') +
          rule('#FB923C', 'Three right in a row — the hot hand pays ' + R.HOT_MULT + '×.') +
          rule('#F87171', 'Book under ' + money(R.MARGIN_CALL_FLOOR) + ' — margin call.') +
        '</div>' +
        '<button class="fl-btn fl-btn-primary" id="fl-start">Ring the opening bell</button>' +
      '</div>';
    document.getElementById('fl-start').addEventListener('click', function () {
      state.started = true;
      save();
      render();
      shell.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function rule(color, text) {
    return '<div class="fl-rule"><span class="fl-rule-dot" style="background:' + color + '"></span>' +
           '<span>' + text + '</span></div>';
  }

  /** `shownBook` lets the header lag the real book while the market is still
   *  "deciding" — otherwise the number spoils the outcome before the chart
   *  lands. Same trick as displayBook in the app. */
  function topbar(shownBook, settled) {
    var book = typeof shownBook === 'number' ? shownBook : state.book;
    var revealed = settled === undefined ? state.decisions.length : settled;
    var pnl = book - R.STARTING_BOOK;
    var pips = '';
    for (var i = 0; i < R.DECISIONS_PER_DAY; i++) {
      var cls = 'fl-pip';
      if (i < revealed) cls += state.decisions[i].correct ? ' win' : ' loss';
      else if (i === revealed) cls += ' now';
      pips += '<span class="' + cls + '"></span>';
    }
    return '<div class="fl-topbar">' +
      '<div><span class="fl-topbar-book" id="fl-topbook">' + money(book) + '</span> ' +
      '<span class="fl-topbar-pnl ' + (pnl >= 0 ? 'fl-up' : 'fl-down') + '" id="fl-toppnl">' +
      (pnl === 0 ? '' : signedMoney(pnl) + ' today') + '</span></div>' +
      '<div class="fl-pips">' + pips + '</div>' +
    '</div>';
  }

  function renderDecision() {
    var s = scenarios[state.idx];
    var hot = hotBefore() >= R.HOT_STREAK_AT;
    var stakeIdx = R.DEFAULT_STAKE_INDEX;
    var selected = null;

    shell.innerHTML =
      topbar() +
      '<div class="fl-card">' +
        '<div class="fl-tags">' +
          '<span class="fl-tag">' + esc(s.cat) + '</span>' +
          '<span class="fl-tag date">' + esc(s.date) + '</span>' +
          (state.idx >= 3 ? '<span class="fl-tag hard">Advanced</span>' : '') +
        '</div>' +
        '<p class="fl-setup">' + esc(s.setup) + '</p>' +
        '<h2 class="fl-question">' + esc(s.q) + '</h2>' +
        '<div class="fl-options" id="fl-options">' +
          s.options.map(function (opt, i) {
            return '<button class="fl-opt" data-i="' + i + '">' +
              '<span class="fl-opt-key">' + 'ABCD'[i] + '</span>' +
              '<span>' + esc(opt) + '</span></button>';
          }).join('') +
        '</div>' +
        (hot ? '<div class="fl-hot-banner">▲ Hot hand live — a right call here pays ' + R.HOT_MULT + '×</div>' : '') +
        '<div class="fl-conviction">' +
          '<div class="fl-conviction-head">' +
            '<span class="fl-conviction-label">Conviction</span>' +
            '<span class="fl-conviction-value' + (hot ? ' hot' : '') + '" id="fl-conv"></span>' +
          '</div>' +
          '<input class="fl-slider" type="range" id="fl-slider" min="0" max="' +
            (R.STAKE_STEPS.length - 1) + '" step="1" value="' + stakeIdx + '" ' +
            'aria-label="How much of your book to risk" />' +
          '<div class="fl-payouts">' +
            '<span class="fl-up" id="fl-win"></span>' +
            '<span class="fl-down" id="fl-lose"></span>' +
          '</div>' +
        '</div>' +
        '<button class="fl-btn fl-btn-primary" id="fl-lock" disabled>Lock it in</button>' +
      '</div>';

    var convEl = document.getElementById('fl-conv');
    var winEl = document.getElementById('fl-win');
    var loseEl = document.getElementById('fl-lose');
    var slider = document.getElementById('fl-slider');
    var lockBtn = document.getElementById('fl-lock');

    // Always follow the rendered control rather than assuming it still holds
    // DEFAULT_STAKE_INDEX — browsers can restore form values, and a desync here
    // would quietly stake a different amount than the payout preview shows.
    stakeIdx = parseInt(slider.value, 10) || 0;

    function paintStake() {
      var pct = R.STAKE_STEPS[stakeIdx];
      // Stake sizes off the OPENING book, matching the app.
      var stake = Math.round((R.STARTING_BOOK * pct) / 100);
      var win = Math.round(stake * (hot ? R.HOT_MULT : R.WIN_MULT));
      convEl.textContent = pct + '% · ' + money(stake);
      winEl.textContent = 'Right +' + money(win);
      loseEl.textContent = 'Wrong −' + money(stake);
    }
    paintStake();

    slider.addEventListener('input', function () {
      stakeIdx = parseInt(slider.value, 10);
      paintStake();
    });

    Array.prototype.forEach.call(shell.querySelectorAll('.fl-opt'), function (btn) {
      btn.addEventListener('click', function () {
        selected = parseInt(btn.getAttribute('data-i'), 10);
        Array.prototype.forEach.call(shell.querySelectorAll('.fl-opt'), function (b) {
          b.classList.toggle('selected', b === btn);
        });
        lockBtn.disabled = false;
      });
    });

    lockBtn.addEventListener('click', function () {
      if (selected === null) return;
      lockIn(s, selected, R.STAKE_STEPS[stakeIdx], hotBefore());
    });
  }

  function lockIn(s, choice, stakePct, hotRun) {
    var correct = choice === s.correctIndex;
    var delta = decisionDelta(R.STARTING_BOOK, stakePct, correct, hotRun);
    var bookBefore = state.book;
    state.book = Math.max(0, state.book + delta);
    state.decisions.push({
      // `id` and `choice` are what submit_floor_day() verifies against its
      // md5 answer key — it never trusts a client-computed P&L.
      id: s.id,
      choice: s.options[choice],
      cat: s.cat, date: s.date, stakePct: stakePct, correct: correct, delta: delta,
    });
    save();
    renderDeciding(s, choice, correct, delta, hotRun >= R.HOT_STREAK_AT, bookBefore);
  }

  /** The suspense beat: the price path draws itself left→right while the
   *  header still shows the pre-decision book. Only when it lands do the
   *  verdict and the new book appear. */
  function renderDeciding(s, choice, correct, delta, wasHot, bookBefore) {
    var outcome = correct ? 'up' : 'down';
    var c = buildChart(state.day + ':' + s.id, outcome);
    var settled = state.decisions.length - 1; // this one isn't revealed yet

    shell.innerHTML =
      topbar(bookBefore, settled) +
      '<div class="fl-card">' +
        '<div class="fl-chart" id="fl-chart">' +
          '<svg class="fl-chart-grid" viewBox="0 0 100 ' + CHART_H + '" preserveAspectRatio="none">' +
            '<line x1="0" y1="' + (CHART_H * 0.25) + '" x2="100" y2="' + (CHART_H * 0.25) + '" />' +
            '<line x1="0" y1="' + (CHART_H * 0.5) + '" x2="100" y2="' + (CHART_H * 0.5) + '" />' +
            '<line x1="0" y1="' + (CHART_H * 0.75) + '" x2="100" y2="' + (CHART_H * 0.75) + '" />' +
            '<line class="fl-chart-baseline" x1="0" y1="' + c.baselineY + '" x2="100" y2="' + c.baselineY + '" />' +
          '</svg>' +
          '<div class="fl-chart-mask" id="fl-chart-mask">' +
            '<svg viewBox="0 0 100 ' + CHART_H + '" preserveAspectRatio="none">' +
              '<polyline class="fl-chart-pre" points="' + c.pre + '" />' +
              '<polyline class="fl-chart-post ' + outcome + '" points="' + c.post + '" />' +
            '</svg>' +
          '</div>' +
          '<div class="fl-chart-dot ' + outcome + '" id="fl-chart-dot" ' +
            'style="left:100%;top:' + ((c.endY / CHART_H) * 100).toFixed(2) + '%"></div>' +
        '</div>' +
        '<p class="fl-deciding">The market is deciding…</p>' +
      '</div>';

    var mask = document.getElementById('fl-chart-mask');
    var dot = document.getElementById('fl-chart-dot');

    function land() {
      dot.classList.add('in');
      renderReveal(s, choice, correct, delta, wasHot, bookBefore);
    }

    if (reduceMotion) return land();

    // Width mask, same easing curve as the app's withTiming bezier. Driven by
    // a forced reflow rather than rAF so it still starts in a tab that isn't
    // compositing; `land` is on a timer regardless, so the reveal always
    // arrives even if the transition itself never paints.
    mask.style.transition = 'width ' + CHART_MS + 'ms cubic-bezier(0.25, 0.1, 0.35, 1)';
    void mask.offsetWidth;
    mask.style.width = '100%';
    setTimeout(land, CHART_MS + 80);
  }

  function renderReveal(s, choice, correct, delta, wasHot, bookBefore) {
    var word = correct ? (wasHot ? 'Hot hand!' : 'Good call') : 'Wrong side';
    var margined = state.book < R.MARGIN_CALL_FLOOR;
    var last = state.decisions.length >= R.DECISIONS_PER_DAY;

    shell.innerHTML =
      topbar() +
      '<div class="fl-card">' +
        '<div class="fl-verdict">' +
          '<div class="fl-verdict-word ' + (correct ? 'fl-up' : 'fl-down') + '">' + word + '</div>' +
          '<div class="fl-verdict-delta ' + (correct ? 'fl-up' : 'fl-down') + '" id="fl-delta">' +
            signedMoney(0) + '</div>' +
        '</div>' +
        '<div class="fl-options">' +
          s.options.map(function (opt, i) {
            var cls = 'fl-opt';
            if (i === s.correctIndex) cls += ' correct';
            else if (i === choice) cls += ' wrong';
            return '<button class="' + cls + '" disabled>' +
              '<span class="fl-opt-key">' + 'ABCD'[i] + '</span>' +
              '<span>' + esc(opt) + '</span></button>';
          }).join('') +
        '</div>' +
        '<div class="fl-why" style="margin-top:20px">' + esc(s.why) + '</div>' +
        '<div class="fl-why fl-fact">' +
          '<div class="fl-fact-label">What actually happened</div>' +
          esc(s.fact) +
        '</div>' +
        (margined ? '<div class="fl-hot-banner" style="background:rgba(248,113,113,0.12);' +
          'border-color:rgba(248,113,113,0.3);color:#F87171">Margin call — the desk has closed you out.</div>' : '') +
        '<button class="fl-btn fl-btn-go" id="fl-next">' +
          (last ? 'Closing bell' : 'Next decision') +
        '</button>' +
      '</div>';

    // Count the delta and the header book up together, so the number landing
    // is the moment the result registers — same beat as the app.
    var deltaEl = document.getElementById('fl-delta');
    if (deltaEl) countUp(deltaEl, 0, delta, signedMoney);
    var bookEl = document.getElementById('fl-topbook');
    if (bookEl && typeof bookBefore === 'number') countUp(bookEl, bookBefore, state.book, money);

    document.getElementById('fl-next').addEventListener('click', function () {
      if (last) { state.done = true; }
      else { state.idx++; }
      save();
      render();
      shell.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function renderResult() {
    var pnl = state.book - R.STARTING_BOOK;
    var pct = (pnl / R.STARTING_BOOK) * 100;
    var right = state.decisions.filter(function (d) { return d.correct; }).length;
    var up = pnl >= 0;

    shell.innerHTML =
      '<div class="fl-card">' +
        '<p class="fl-label">Closing bell · Session #' + plan.n + '</p>' +
        '<div class="fl-result-box' + (up ? '' : ' down') + '">' +
          '<div class="fl-result-label">Day P&amp;L</div>' +
          '<div class="fl-result-pnl ' + (up ? 'fl-up' : 'fl-down') + '">' + signedMoney(pnl) + '</div>' +
          '<div class="fl-result-meta">' +
            (up ? '▲ ' : '▼ ') + pct.toFixed(1) + '%  ·  ' +
            right + '/' + state.decisions.length + ' right  ·  Book ' + money(state.book) +
          '</div>' +
        '</div>' +
        '<div class="fl-tape">' +
          state.decisions.map(function (d) {
            return '<div class="fl-tape-row">' +
              '<span class="fl-tape-dot" style="background:' + (d.correct ? 'var(--success)' : '#F87171') + '"></span>' +
              '<span class="fl-tape-name">' + esc(d.cat) + ' · ' + esc(d.date) + '</span>' +
              '<span class="fl-tape-stake">' + d.stakePct + '%</span>' +
              '<span class="fl-tape-delta ' + (d.correct ? 'fl-up' : 'fl-down') + '">' + signedMoney(d.delta) + '</span>' +
            '</div>';
          }).join('') +
        '</div>' +
        '<div class="fl-actions">' +
          '<button class="fl-btn fl-btn-primary" id="fl-share">Share your result</button>' +
        '</div>' +
        '<div class="fl-share-toast" id="fl-toast"></div>' +
        // Filled by floor-auth.js — kept out of this file so the game still
        // works end to end if the auth module fails to load.
        '<div id="fl-save"></div>' +
        '<div class="fl-upsell">' +
          '<p>That was one session. Basis runs a new one every day — with streaks, ' +
          'a worldwide leaderboard, and 11 free tracks that teach the thinking behind these calls.</p>' +
          '<a class="fl-btn fl-btn-go" style="text-decoration:none" ' +
          'href="https://apps.apple.com/app/basis-learn-finance-markets/id6784982377">Get Basis free</a>' +
        '</div>' +
        '<p class="fl-next-session" id="fl-countdown"></p>' +
      '</div>';

    document.getElementById('fl-share').addEventListener('click', onShare);
    startCountdown();

    // Tell the auth module there's a finished session worth saving. Fired on
    // every result render (including a resumed one), so arriving back from an
    // OAuth redirect lands on a screen that can immediately offer the save.
    document.dispatchEvent(new CustomEvent('floor:result', {
      detail: { day: state.day, session: plan.n },
    }));
  }

  /** Wordle-style: the shape of the day, no spoilers. */
  function shareText() {
    var pnl = state.book - R.STARTING_BOOK;
    var pct = (pnl / R.STARTING_BOOK) * 100;
    var squares = state.decisions.map(function (d) {
      return d.correct ? '🟩' : '🟥';
    }).join('');
    return 'Basis · The Floor — Session #' + plan.n + '\n' +
      (pnl >= 0 ? '+' : '−') + Math.abs(pct).toFixed(1) + '%  ' + squares + '\n\n' +
      'Same five calls for everyone today.\n' +
      'basisfinance.app/floor';
  }

  function onShare() {
    var text = shareText();
    var toast = document.getElementById('fl-toast');
    if (navigator.share) {
      navigator.share({ text: text }).catch(function () { copy(text, toast); });
    } else {
      copy(text, toast);
    }
  }

  function copy(text, toast) {
    function done() { toast.textContent = 'Copied to clipboard'; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text, done); });
    } else {
      legacyCopy(text, done);
    }
  }

  function legacyCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) {}
    document.body.removeChild(ta);
  }

  function startCountdown() {
    var el = document.getElementById('fl-countdown');
    if (!el) return;
    function tick() {
      var now = new Date();
      var next = new Date(now);
      next.setHours(24, 0, 0, 0);
      var ms = next - now;
      var h = Math.floor(ms / 3600000);
      var m = Math.floor((ms % 3600000) / 60000);
      el.textContent = 'Next session opens in ' + h + 'h ' + m + 'm';
    }
    tick();
    setInterval(tick, 30000);
  }

  render();
})();
