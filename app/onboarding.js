/* ============================================================
   BASIS web app — onboarding
   ------------------------------------------------------------
   A web port of app/onboarding.tsx: same seven steps, same copy,
   same placement quiz keyed on the learner's starting point, and
   the same personalisation output (starting point, interested
   tracks, daily goal, handle + avatar).

   One deliberate difference from the app: signing in is the last
   step and it is REQUIRED. The app can fall back to guest mode on
   local storage; a browser profile is far more disposable than a
   phone, so an unsigned web learner would lose their streak the
   first time they cleared site data.
   ============================================================ */
import {
  state, save, render, go, esc, setImmersive, oauth, baxBubble, mascot,
  TRACKS, reduceMotion,
} from '/app/core.js';

// ── Static data — kept in step with src/data + app/onboarding.tsx ──────────
const STARTING_POINTS = [
  { id: 'new', title: 'New to finance', sub: 'Start from the very basics' },
  { id: 'basics', title: 'I know the basics', sub: 'Shares, bonds, interest rates' },
  { id: 'studying', title: 'Studying finance', sub: 'At university or doing CFA' },
  { id: 'interviews', title: 'Prepping for interviews', sub: 'Targeting a front-office role' },
];

const TOPICS = [
  { id: 't1', label: 'Stocks & markets', trackIds: ['t1'] },
  { id: 't2', label: 'Company finance', trackIds: ['t2'] },
  { id: 't3', label: 'Economics & rates', trackIds: ['t3', 't8'] },
  { id: 't4', label: 'Investing & portfolios', trackIds: ['t4'] },
  { id: 't5', label: 'Sustainable investing', trackIds: ['t5'] },
  { id: 't6', label: 'Derivatives & risk', trackIds: ['t6'] },
  { id: 't7', label: 'Credit & bonds', trackIds: ['t7', 't11'] },
  { id: 't9', label: 'Private equity & deals', trackIds: ['t9'] },
  { id: 't10', label: 'Reading financial statements', trackIds: ['t10'] },
];

const GOALS = [
  { val: 10, label: 'Casual', sub: '~5 min a day' },
  { val: 20, label: 'Regular', sub: '~10 min a day' },
  { val: 30, label: 'Intense', sub: '~15 min a day' },
];

const AVATARS = [
  { id: 'mascot_violet', label: 'Violet', color: '#7C3AED' },
  { id: 'mascot_indigo', label: 'Indigo', color: '#6366F1' },
  { id: 'mascot_gold', label: 'Gold', color: '#F4B23C' },
  { id: 'mascot_teal', label: 'Teal', color: '#0F766E' },
  { id: 'mascot_coral', label: 'Coral', color: '#DC2626' },
  { id: 'mascot_green', label: 'Green', color: '#059669' },
];

const BAX_CORRECT = [
  'Yes! That’s exactly right.',
  'Nailed it. You’re sharper than you think.',
  'Three in and you’re already thinking like an analyst.',
];
const BAX_WRONG = [
  'Not this time — but that’s exactly why I’m here.',
  'This one trips a lot of people up. I’ll fix that.',
  'One to work on. You’ll know this cold by next week.',
];

const QUIZ_SETS = {
  new: [
    {
      prompt: 'When a company pays you a "dividend", what is it doing?',
      options: [
        'Sharing a portion of its profits with you as a shareholder',
        'Charging you a fee for holding its shares',
        'Borrowing money from shareholders to fund its growth',
        'Giving shareholders extra voting rights on company decisions',
      ],
      correctIndex: 0,
      explanation: 'Dividends are cash payments companies make directly to shareholders from their profits — a way of returning value to the people who own a slice of the business.',
    },
    {
      prompt: 'You invest £1,000 in a fund that returns 7% per year. After one year, how much do you have?',
      options: [
        '£1,700 — 7% compounds very quickly in the first year',
        '£1,070 — 7% of £1,000 is £70, added to your investment',
        '£1,007 — annual returns are divided by ten for safety',
        '£930 — the 7% is deducted as a management fee first',
      ],
      correctIndex: 1,
      explanation: '7% of £1,000 = £70. After one year you have £1,070. This is simple interest — the foundation of almost every return calculation you’ll ever do in finance.',
    },
    {
      prompt: 'A share price rises from £10 to £15. What return has the investor made?',
      options: [
        '5% — the price went up by £5',
        '15% — the new price is £15',
        '150% — the new price relative to the original',
        '50% — the £5 gain divided by the £10 cost',
      ],
      correctIndex: 3,
      explanation: 'Return = gain ÷ original investment. £5 ÷ £10 = 50%. Always measure returns relative to what you invested — the absolute gain alone tells you nothing without that context.',
    },
  ],
  basics: [
    {
      prompt: 'A stock has a P/E ratio of 20. What does this tell you?',
      options: [
        'Investors are paying £20 for every £1 of the company’s annual earnings',
        'The company grew its earnings by 20% last year',
        'The stock costs exactly £20 per share to buy',
        'The company has been profitable for 20 consecutive years',
      ],
      correctIndex: 0,
      explanation: 'P/E = Price ÷ Earnings per share. A P/E of 20 means you’re paying £20 today for each £1 of annual profit. A higher P/E signals higher growth expectations baked into the price.',
    },
    {
      prompt: 'A central bank raises interest rates. What typically happens to bond prices?',
      options: [
        'They rise — bonds now pay out higher income to holders',
        'They stay the same — bond prices are set at issuance and locked in',
        'They fall — new bonds offer better rates, making old ones less attractive',
        'They double — investors rush to lock in existing rates before they disappear',
      ],
      correctIndex: 2,
      explanation: 'Bond prices and yields move in opposite directions. When rates rise, newly issued bonds pay more — so older bonds paying a lower fixed rate become less valuable and their prices fall to compensate.',
    },
    {
      prompt: 'What is the core difference between equity and debt financing?',
      options: [
        'Equity sells ownership stakes; debt must be repaid with interest but ownership stays intact',
        'Equity must be repaid with interest; debt permanently transfers ownership to lenders',
        'Equity only works for start-ups; debt is reserved for established businesses',
        'They are identical — both raise capital without any ongoing obligations',
      ],
      correctIndex: 0,
      explanation: 'Equity (shares) raises money by selling part of the business — no repayment, but ownership is diluted. Debt (loans/bonds) must be repaid with interest, but founders keep full control. This trade-off sits at the heart of corporate finance.',
    },
  ],
  studying: [
    {
      prompt: 'A stock has a beta of 1.5. If the market falls 10%, how much would you expect the stock to fall?',
      options: [
        '5% — beta acts as a dampener for larger moves in either direction',
        '15% — beta amplifies market moves proportionally',
        '10% — a beta close to 1.5 means it roughly tracks the market',
        '1.5% — beta is a small scaling adjustment, not a multiplier',
      ],
      correctIndex: 1,
      explanation: 'Beta measures a stock’s sensitivity to market moves. Beta of 1.5 means the stock moves 1.5× the market — market falls 10%, stock falls roughly 15%. High beta = amplified risk and reward in both directions.',
    },
    {
      prompt: 'EBITDA is £50m and Enterprise Value is £500m. What is the EV/EBITDA multiple?',
      options: [
        '10× — the standard M&A valuation multiple for this business',
        '0.1× — EBITDA divided by Enterprise Value inverted',
        '450 — the simple difference between EV and EBITDA',
        '5× — Enterprise Value divided by two times EBITDA',
      ],
      correctIndex: 0,
      explanation: 'EV/EBITDA = £500m ÷ £50m = 10×. It’s the most widely used valuation multiple in M&A — how many years of operating earnings you’re paying for the entire business, on a debt- and tax-neutral basis.',
    },
    {
      prompt: 'What does an inverted yield curve (short rates above long rates) historically signal?',
      options: [
        'The fastest economic growth phase in the cycle is about to begin',
        'The central bank has permanently stepped back from setting rates',
        'Bond markets expect rates to fall as economic growth weakens — a recession warning',
        'Inflation has been decisively beaten and will not return for a generation',
      ],
      correctIndex: 2,
      explanation: 'Yield curve inversion has preceded most US recessions since the 1970s. Short rates above long rates reflects bond markets pricing in eventual rate cuts as growth slows — the market’s way of saying this tightening cycle will eventually hurt.',
    },
  ],
  interviews: [
    {
      prompt: 'Walk me through the three core building blocks of a DCF valuation.',
      options: [
        'Revenue, COGS, and net income — the income statement inputs to model',
        'P/E ratio, EV/EBITDA, and P/B — the comps multiples framework',
        'Free cash flows, a terminal value, and a discount rate (WACC)',
        'Current assets, current liabilities, and working capital movements',
      ],
      correctIndex: 2,
      explanation: 'A DCF projects unlevered free cash flows over a forecast period, calculates a terminal value (what the business is worth beyond the forecast), then discounts both back to today using WACC. Know this cold — it comes up in virtually every front-office interview.',
    },
    {
      prompt: 'What IRR range does a private equity sponsor typically underwrite in an LBO?',
      options: [
        '5–10% — similar to public market returns, with lower risk from operational control',
        '20–30% over a 3–5 year hold, to justify the risk, illiquidity and fees',
        '50%+ minimum — any lower and the deal is automatically passed on',
        'IRR is irrelevant in PE — only cash-on-cash MOIC is tracked by sponsors',
      ],
      correctIndex: 1,
      explanation: '20–30% IRR over a 3–5 year hold is the standard PE return target. This is the hurdle that justifies the leverage, management fees, and illiquidity versus simply holding public equities. Know this number in interviews.',
    },
    {
      prompt: 'Starting EBIT margin is 10%. Revenue grows 20% but margin compresses 200bps. What is the new EBIT margin?',
      options: [
        '10% — the growth and compression cancel each other out exactly',
        '12% — the 20% revenue growth adds 200bps to the operating margin',
        '8% — the margin compresses from 10% down to 8%',
        'Cannot be determined without knowing the absolute revenue base',
      ],
      correctIndex: 2,
      explanation: '200 basis points = 2 percentage points. 10% minus 200bps = 8% EBIT margin. Margin changes in finance are always quoted in bps — 100bps = 1%. Knowing this instinctively separates candidates who’ve done the work from those who haven’t.',
    },
  ],
};

const ADJECTIVES = ['Macro', 'Delta', 'Gamma', 'Vega', 'Alpha', 'Sigma', 'Contrarian', 'Hawkish',
  'Dovish', 'Levered', 'Hedged', 'Quant', 'Momentum', 'Carry', 'Convex', 'Tail', 'Basis', 'Prime',
  'Liquid', 'Volatile'];
const NOUNS = ['Wolf', 'Falcon', 'Shark', 'Bull', 'Bear', 'Whale', 'Viper', 'Condor', 'Cobra',
  'Eagle', 'Puma', 'Raven', 'Lynx', 'Fox', 'Owl', 'Stag', 'Rhino', 'Tiger', 'Mantis', 'Jackal'];
const RESERVED = new Set(['admin', 'administrator', 'moderator', 'mod', 'support', 'basis',
  'staff', 'official', 'system', 'root', 'null', 'undefined', 'anonymous']);

function suggestUsername() {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return a + n + String(Math.floor(Math.random() * 1000)).padStart(3, '0');
}

/** Mirrors set_username's server rules so the error shows before the round trip. */
function usernameError(u) {
  if (u.length < 3 || u.length > 20) return '3–20 characters';
  if (!/^[a-zA-Z0-9_]+$/.test(u)) return 'letters, numbers and underscores only';
  if (RESERVED.has(u.toLowerCase())) return 'that username is reserved';
  return null;
}


// Provider marks as inline SVG: the Apple logo character (U+F8FF) only exists
// in Apple's own fonts, so it renders as nothing on Windows and Android.
const GOOGLE_MARK = `<svg class="ba-oauth-mark" viewBox="0 0 48 48" aria-hidden="true">
  <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2.5 24 .5 14.6.5 6.5 5.9 2.6 13.8l7.8 6.1C12.3 14 17.6 9.5 24 9.5z"/>
  <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.2-.4-4.7H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.3z"/>
  <path fill="#FBBC05" d="M10.4 28.1a14.5 14.5 0 0 1 0-8.2l-7.8-6.1a24 24 0 0 0 0 20.4l7.8-6.1z"/>
  <path fill="#34A853" d="M24 47.5c6.2 0 11.5-2 15.4-5.6l-7.5-5.8c-2.1 1.4-4.8 2.2-7.9 2.2-6.4 0-11.7-4.5-13.6-10.4l-7.8 6.1C6.5 42.1 14.6 47.5 24 47.5z"/>
</svg>`;

const APPLE_MARK = `<svg class="ba-oauth-mark" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
  <path d="M16.37 12.78c.02 2.6 2.28 3.47 2.3 3.48-.02.06-.36 1.24-1.19 2.46-.72 1.05-1.47 2.1-2.65 2.12-1.16.02-1.53-.69-2.86-.69-1.33 0-1.74.67-2.84.71-1.14.04-2-1.13-2.73-2.18-1.49-2.15-2.63-6.08-1.1-8.73a4.24 4.24 0 0 1 3.58-2.17c1.11-.02 2.17.75 2.85.75.68 0 1.96-.93 3.3-.79.57.02 2.16.23 3.18 1.73-.08.05-1.9 1.11-1.88 3.31M14.2 4.54c.6-.73 1.01-1.75.9-2.76-.87.03-1.92.58-2.55 1.31-.56.64-1.05 1.68-.92 2.67.97.08 1.96-.49 2.57-1.22"/>
</svg>`;

// ── Flow state (lives only while onboarding is on screen) ──────────────────
const draft = {
  step: 0,
  point: null,
  topicIds: [],
  goal: null,
  username: suggestUsername(),
  avatarId: 'mascot_violet',
  quizIdx: 0,
  quizSel: null,
  quizChecked: false,
  quizResults: [],
  quizDone: false,
};

const TOTAL_STEPS = 7;

function progressBar(current) {
  return `<div class="ba-ob-progress">${
    Array.from({ length: TOTAL_STEPS }, (_, i) => {
      const s = i + 1;
      const cls = s < current ? 'on past' : s === current ? 'on' : '';
      return `<span class="ba-ob-seg ${cls}"></span>`;
    }).join('')
  }</div>`;
}

function topBar(back, current) {
  return `
    <div class="ba-ob-top">
      ${back === null ? '<span class="ba-ob-back-sp"></span>'
        : `<button class="ba-ob-back" data-step="${back}" aria-label="Back">←</button>`}
      ${progressBar(current)}
    </div>`;
}

function screen(cls, inner) {
  render(`<div class="ba-ob ${cls}">${inner}</div>`);
  document.querySelectorAll('.ba-ob-back').forEach((b) =>
    b.addEventListener('click', () => { draft.step = Number(b.dataset.step); paint(); }));
}

const next = (s) => { draft.step = s; paint(); };

// ── Steps ──────────────────────────────────────────────────────────────────
function stepWelcome() {
  screen('dark welcome', `
    <div class="ba-ob-body center">
      ${mascot('happy', 132)}
      <h1 class="ba-ob-h1">Master finance,<br>one concept at a time.</h1>
      <p class="ba-ob-sub">Short daily lessons that take you from the basics to the
        questions they actually ask in front-office interviews.</p>
    </div>
    <div class="ba-ob-foot">
      <button class="ba-btn ba-btn-primary" id="go">Get started</button>
      <button class="ba-btn ba-btn-ghost" id="have">I already have an account</button>
    </div>`);
  document.getElementById('go').addEventListener('click', () => next(1));
  document.getElementById('have').addEventListener('click', () => { draft.step = 7; paint(); });
}

function stepWhy() {
  const stats = [
    { stat: '$9.6T', label: 'Changes hands in the global currency (FX) markets every single day — the largest financial market on Earth.', source: 'Source: BIS Triennial Survey, Apr 2025' },
    { stat: '2–3×', label: 'Finance professionals earn 2–3× more than their peers across industries.' },
    { stat: '2 weeks', label: 'Consistent daily practice is all it takes to feel noticeably more confident in finance conversations and interviews.' },
  ];
  screen('dark grid', `
    ${topBar(0, 1)}
    <div class="ba-ob-body">
      ${baxBubble('Every career move, salary negotiation and investment decision comes down to one thing.')}
      <h1 class="ba-ob-h2">Finance is the language of opportunity.</h1>
      <p class="ba-ob-sub">Basis makes learning it easy.</p>
      <div class="ba-ob-stats">
        ${stats.map((s, i) => `
          <div class="ba-ob-stat" style="animation-delay:${i * 110 + 120}ms">
            <span class="ba-ob-stat-num">${esc(s.stat)}</span>
            <span class="ba-ob-stat-label">${esc(s.label)}</span>
            ${s.source ? `<span class="ba-ob-stat-src">${esc(s.source)}</span>` : ''}
          </div>`).join('')}
      </div>
    </div>
    <div class="ba-ob-foot">
      <button class="ba-btn ba-btn-primary" id="go">Show me where to start →</button>
    </div>`);
  document.getElementById('go').addEventListener('click', () => next(2));
}

function stepPoint() {
  screen('', `
    ${topBar(1, 2)}
    <div class="ba-ob-body">
      ${baxBubble('No wrong answer here — it just decides where your path begins.')}
      <h1 class="ba-ob-h2">Where are you starting from?</h1>
      <p class="ba-ob-sub">We’ll pitch the first lessons at the right level.</p>
      <div class="ba-ob-options">
        ${STARTING_POINTS.map((p) => `
          <button class="ba-ob-option ${draft.point === p.id ? 'on' : ''}" data-id="${esc(p.id)}">
            <span class="ba-ob-radio"></span>
            <span class="ba-ob-option-text">
              <strong>${esc(p.title)}</strong>
              <em>${esc(p.sub)}</em>
            </span>
          </button>`).join('')}
      </div>
    </div>
    <div class="ba-ob-foot">
      <button class="ba-btn ba-btn-primary" id="go" ${draft.point ? '' : 'disabled'}>Continue</button>
    </div>`);
  document.querySelectorAll('.ba-ob-option').forEach((b) =>
    b.addEventListener('click', () => { draft.point = b.dataset.id; paint(); }));
  document.getElementById('go').addEventListener('click', () => { if (draft.point) next(3); });
}

function stepTopics() {
  screen('', `
    ${topBar(2, 3)}
    <div class="ba-ob-body">
      ${baxBubble('Pick anything that interests you. I’ll move those tracks to the top.')}
      <h1 class="ba-ob-h2">What do you want to learn?</h1>
      <p class="ba-ob-sub">Choose as many as you like — or skip and get the default order.</p>
      <div class="ba-ob-chips">
        ${TOPICS.map((t) => `
          <button class="ba-ob-chip ${draft.topicIds.includes(t.id) ? 'on' : ''}"
                  data-id="${esc(t.id)}">${esc(t.label)}</button>`).join('')}
      </div>
    </div>
    <div class="ba-ob-foot">
      <button class="ba-btn ba-btn-primary" id="go">Continue</button>
    </div>`);
  document.querySelectorAll('.ba-ob-chip').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.id;
      draft.topicIds = draft.topicIds.includes(id)
        ? draft.topicIds.filter((x) => x !== id) : [...draft.topicIds, id];
      b.classList.toggle('on');
    }));
  document.getElementById('go').addEventListener('click', () => next(4));
}

function stepQuiz() {
  const qs = QUIZ_SETS[draft.point || 'new'] || QUIZ_SETS.new;

  if (draft.quizDone) {
    const got = draft.quizResults.filter(Boolean).length;
    const line = got === 3 ? 'You already know more than you think.'
      : got === 0 ? 'Perfect starting point — everything here is learnable.'
      : 'Good baseline. The gaps are exactly what the path is for.';
    screen('', `
      ${topBar(3, 4)}
      <div class="ba-ob-body center">
        ${mascot(got >= 2 ? 'happy' : 'sad', 112)}
        <h1 class="ba-ob-h2">${got} of 3</h1>
        <p class="ba-ob-sub">${esc(line)}</p>
        <div class="ba-ob-dots big">
          ${draft.quizResults.map((ok) =>
            `<span class="ba-ob-dot ${ok ? 'right' : 'wrong'}">${ok ? '✓' : '✕'}</span>`).join('')}
        </div>
      </div>
      <div class="ba-ob-foot">
        <button class="ba-btn ba-btn-primary" id="go">Continue</button>
      </div>`);
    document.getElementById('go').addEventListener('click', () => next(5));
    return;
  }

  const q = qs[draft.quizIdx];
  const checked = draft.quizChecked;
  const right = draft.quizSel === q.correctIndex;

  if (checked) {
    const line = right ? BAX_CORRECT[draft.quizIdx] : BAX_WRONG[draft.quizIdx];
    screen('', `
      ${topBar(3, 4)}
      <div class="ba-ob-body center">
        ${mascot(right ? 'happy' : 'sad', 112)}
        <h2 class="ba-ob-verdict ${right ? 'right' : 'wrong'}">${right ? 'Correct!' : 'Not quite'}</h2>
        <p class="ba-ob-bax-line">${esc(line)}</p>
        <div class="ba-explain ${right ? 'right' : 'wrong'}">
          <div class="ba-explain-head">${right ? 'Why' : 'The answer'}</div>
          ${right ? '' : `<p class="ba-ob-answer">${esc(q.options[q.correctIndex])}</p>`}
          <p>${esc(q.explanation)}</p>
        </div>
      </div>
      <div class="ba-ob-foot">
        <button class="ba-btn ba-btn-primary" id="go">Continue</button>
      </div>`);
    document.getElementById('go').addEventListener('click', () => {
      draft.quizResults = [...draft.quizResults, right];
      if (draft.quizIdx === qs.length - 1) draft.quizDone = true;
      else { draft.quizIdx++; draft.quizSel = null; draft.quizChecked = false; }
      paint();
    });
    return;
  }

  screen('', `
    ${topBar(3, 4)}
    <div class="ba-ob-body">
      <p class="ba-ob-kicker">Quick check — question ${draft.quizIdx + 1} of ${qs.length}</p>
      <h1 class="ba-ob-h2 q">${esc(q.prompt)}</h1>
      <div class="ba-options">
        ${q.options.map((o, i) => `
          <button class="ba-opt ${draft.quizSel === i ? 'sel' : ''}" data-i="${i}">
            <span class="ba-opt-key">${'ABCD'[i]}</span><span>${esc(o)}</span>
          </button>`).join('')}
      </div>
    </div>
    <div class="ba-ob-foot">
      <button class="ba-btn ba-btn-primary" id="go" ${draft.quizSel === null ? 'disabled' : ''}>Check</button>
    </div>`);
  document.querySelectorAll('.ba-opt').forEach((b) =>
    b.addEventListener('click', () => { draft.quizSel = Number(b.dataset.i); paint(); }));
  document.getElementById('go').addEventListener('click', () => {
    if (draft.quizSel === null) return;
    draft.quizChecked = true;
    paint();
  });
}

function stepGoal() {
  screen('', `
    ${topBar(4, 5)}
    <div class="ba-ob-body">
      ${baxBubble('Pick something you’ll actually hit on a bad day. Streaks beat intensity.')}
      <h1 class="ba-ob-h2">Set a daily goal.</h1>
      <p class="ba-ob-sub">You can change this any time in your profile.</p>
      <div class="ba-ob-options">
        ${GOALS.map((g) => `
          <button class="ba-ob-option ${draft.goal === g.val ? 'on' : ''}" data-v="${g.val}">
            <span class="ba-ob-radio"></span>
            <span class="ba-ob-option-text">
              <strong>${esc(g.label)}</strong>
              <em>${g.val} XP · ${esc(g.sub)}</em>
            </span>
          </button>`).join('')}
      </div>
    </div>
    <div class="ba-ob-foot">
      <button class="ba-btn ba-btn-primary" id="go" ${draft.goal ? '' : 'disabled'}>Continue</button>
    </div>`);
  document.querySelectorAll('.ba-ob-option').forEach((b) =>
    b.addEventListener('click', () => { draft.goal = Number(b.dataset.v); paint(); }));
  document.getElementById('go').addEventListener('click', () => { if (draft.goal) next(6); });
}

function stepIdentity() {
  const err = draft.username.length ? usernameError(draft.username) : null;
  screen('', `
    ${topBar(5, 6)}
    <div class="ba-ob-body">
      ${baxBubble('Last thing — how should the leaderboards know you? Pick anything, change it anytime.')}
      <h1 class="ba-ob-h2">Choose your handle.</h1>
      <p class="ba-ob-sub">This is what friends and leaderboards see — not your email.</p>
      <input class="ba-ob-input ${err ? 'err' : ''}" id="u" maxlength="20"
             value="${esc(draft.username)}" autocomplete="off" autocapitalize="none"
             spellcheck="false" aria-label="Username" />
      <p class="ba-ob-err" id="uerr">${err ? esc(err) : ''}</p>
      <p class="ba-ob-label">Avatar</p>
      <div class="ba-ob-avatars">
        ${AVATARS.map((a) => `
          <button class="ba-ob-avatar ${draft.avatarId === a.id ? 'on' : ''}"
                  style="--ac:${a.color}" data-id="${esc(a.id)}" aria-label="${esc(a.label)}">
            <img src="/mascot-happy.png" alt="" />
          </button>`).join('')}
      </div>
    </div>
    <div class="ba-ob-foot">
      <button class="ba-btn ba-btn-primary" id="go" ${err || draft.username.length < 3 ? 'disabled' : ''}>Continue</button>
    </div>`);

  const input = document.getElementById('u');
  const errEl = document.getElementById('uerr');
  const btn = document.getElementById('go');
  input.addEventListener('input', () => {
    // Re-rendering on every keystroke would move the caret; update in place.
    draft.username = input.value.replace(/\s/g, '');
    if (input.value !== draft.username) input.value = draft.username;
    const e = draft.username.length ? usernameError(draft.username) : null;
    errEl.textContent = e || '';
    input.classList.toggle('err', !!e);
    btn.disabled = !!e || draft.username.length < 3;
  });
  document.querySelectorAll('.ba-ob-avatar').forEach((b) =>
    b.addEventListener('click', () => {
      draft.avatarId = b.dataset.id;
      document.querySelectorAll('.ba-ob-avatar').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
    }));
  btn.addEventListener('click', () => {
    if (usernameError(draft.username)) return;
    next(7);
  });
}

/** Step 7 — the account. Required: see the header note. */
function stepAccount() {
  const back = draft.point ? 6 : 0; // "I already have an account" jumps here from step 0
  screen('', `
    ${topBar(back, 7)}
    <div class="ba-ob-body">
      ${baxBubble('Create your account and your streak, XP and progress are safe — on this browser and on your phone.')}
      <h1 class="ba-ob-h2">Save your progress.</h1>
      <p class="ba-ob-sub">One account for the web and the iOS app. No password to remember.</p>
      <div class="ba-ob-authbox">
        <button class="ba-btn ba-btn-oauth" data-p="google">${GOOGLE_MARK}Continue with Google</button>
        <button class="ba-btn ba-btn-oauth" data-p="apple">${APPLE_MARK}Continue with Apple</button>
        <p class="ba-ob-err" id="autherr"></p>
      </div>
      <ul class="ba-ob-why">
        <li>Your streak survives a cleared browser</li>
        <li>Weekly XP and Floor leaderboards</li>
        <li>Pick up on your phone exactly where you stopped</li>
      </ul>
      <p class="ba-fineprint">By continuing you agree to our
        <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</p>
    </div>`);

  document.querySelectorAll('[data-p]').forEach((b) =>
    b.addEventListener('click', async () => {
      // Commit the answers BEFORE leaving for the provider: the redirect
      // reloads the page, and anything still only in `draft` would be lost.
      commit();
      b.disabled = true;
      try {
        await oauth(b.dataset.p);
      } catch (e) {
        b.disabled = false;
        document.getElementById('autherr').textContent =
          'Could not start sign-in. Please try again.';
      }
    }));
}

/** Writes the onboarding answers into persisted state. */
function commit() {
  const trackIds = TOPICS.filter((t) => draft.topicIds.includes(t.id)).flatMap((t) => t.trackIds);
  const known = new Set(TRACKS.map((t) => t.id));
  state.startingPoint = draft.point;
  state.topics = trackIds.filter((id) => known.has(id));
  state.dailyGoal = draft.goal || 20;
  state.username = draft.username;
  state.avatarId = draft.avatarId;
  state.onboarded = true;
  save();
}

const STEPS = [stepWelcome, stepWhy, stepPoint, stepTopics, stepQuiz, stepGoal, stepIdentity, stepAccount];

function paint() {
  setImmersive(true);
  (STEPS[draft.step] || stepWelcome)();
  if (!reduceMotion) {
    const b = document.querySelector('.ba-ob-body');
    if (b) { b.classList.add('ba-enter'); }
  }
}

/** Entry point. `resume` jumps a returning-but-signed-out learner straight to
 *  the account step rather than making them redo six screens. */
export function viewOnboarding(resume) {
  draft.step = resume ? 7 : draft.step;
  if (resume) {
    draft.point = state.startingPoint;
    draft.goal = state.dailyGoal;
    draft.username = state.username || draft.username;
    draft.avatarId = state.avatarId || draft.avatarId;
  }
  paint();
}

export { commit as commitOnboarding };
