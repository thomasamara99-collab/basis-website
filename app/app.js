/* ============================================================
   BASIS — web app shell (home, path, profile, router)
   ------------------------------------------------------------
   Home is a port of app/(tabs)/index.tsx: ring avatar + greeting
   header, the one hero action, the Today card, the streak week,
   and the lesson path as nodes on a rail. Same structure, same
   order, same tokens (theme.css is generated from src/theme).

   The curriculum is NOT authored here — src/data/curriculum/ in
   the app repo is the single source of truth;
   `npm run generate:web-curriculum` emits curriculum-index.js
   and curriculum-lessons.js.
   ============================================================ */
import {
  state, save, session, setSession, isPremium, supabase, render, go, esc,
  setImmersive, syncNow, pushIdentity, consumeReturnHash, signOut, oauth,
  APP_STORE, TRACKS, LEVELS, levelFor, trackStats, orderedTracks,
  nextLessonIn, nextLessonOverall, xpToday, todayKey, mascot, countUp,
  applyTheme, AVATARS, avatarColor, BADGES, STOCKS, TRACK_STOCKS,
  earnedBadgeIds, primeBadgesSeen, dueReviews, scenarioDoneToday,
} from '/app/core.js';
import { viewOnboarding } from '/app/onboarding.js';
import { viewLesson } from '/app/lesson.js';
import { viewScenario } from '/app/scenario.js';
import { icon } from '/app/icons.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CHECK = '✓';
/** Collapsed tracks show the frontier plus two; opening reveals in batches. */
const PREVIEW = 3;
const BATCH = 8;

const expanded = {};   // trackId -> true
const revealed = {};   // trackId -> how many rows are shown while expanded

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** An SVG progress ring. `r` is the radius inside a 2*(r+pad) box. */
function ring(size, r, stroke, pct, extraClass = '') {
  const c = 2 * Math.PI * r;
  const mid = size / 2;
  return `<svg viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle class="ba-ring-track" cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}" />
    <circle class="ba-ring-fill ${extraClass}" cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}"
      stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - pct)).toFixed(1)}" />
  </svg>`;
}

// ── Shared chrome ───────────────────────────────────────────
function header() {
  const { current, next } = levelFor(state.xp);
  const goal = state.dailyGoal || 20;
  const done = xpToday();
  const met = done >= goal;
  return `
    <div class="ba-hd">
      <a class="ba-hd-ring" href="#/profile" aria-label="Your profile">
        ${ring(56, 25.5, 5, Math.min(1, done / goal), met ? 'met' : '')}
        <span class="ba-hd-disc"><img src="/mascot-happy.png" alt="" /></span>
      </a>
      <div class="ba-hd-text">
        <p class="ba-hd-greeting">${greeting()}</p>
        <p class="ba-hd-level">${esc(current.title)}</p>
        <p class="ba-hd-xp">${next
          ? `${state.xp.toLocaleString()} XP · ${(next.minXp - state.xp).toLocaleString()} to ${esc(next.title)}`
          : `${state.xp.toLocaleString()} XP · Max rank`}</p>
      </div>
      <div class="ba-hd-streak" title="Day streak">🔥 ${state.streak}</div>
    </div>`;
}

function footerCta() {
  return `
    <div class="ba-appcta">
      <p>Reminders, the daily market game and the full leaderboards live in the app.</p>
      <a class="ba-btn ba-btn-go" href="${APP_STORE}">Get Basis free</a>
    </div>`;
}

// ── The lesson path: nodes on a rail ────────────────────────
/** Mirrors stateFor() in the app: premium first, then done, then the single
 *  current lesson per track; everything beyond it is locked. */
function nodeState(track, module, lesson, currentId) {
  if (module.premium && !isPremium) return 'paywall';
  if (state.completed[lesson.id]) return 'done';
  if (lesson.id === currentId) return 'current';
  return 'locked';
}

const NODE_GLYPH = { done: '✓', current: '▶', paywall: '◆', locked: '' };

function nodeRow(track, module, lesson, kind, opts) {
  const { topSolid, bottomSolid, first, last, maxXp } = opts;
  const rail = (pos, solid) =>
    `<span class="ba-rail ${pos} ${solid ? 'solid' : ''}"></span>`;
  const score = state.scores[lesson.id];
  const tail =
    kind === 'done' ? `<span class="ba-node-score">${score !== undefined ? score + '%' : '+' + maxXp}</span>`
    : kind === 'current' ? `<span class="ba-pill">Start</span>`
    : kind === 'paywall' ? `<span class="ba-pill pro">Pro</span>`
    : '';

  const inner = `
    <span class="ba-rail-col">
      ${first ? '' : rail('top', topSolid)}
      ${last ? '' : rail('bottom', bottomSolid)}
      <span class="ba-node ${kind}">${NODE_GLYPH[kind]}</span>
    </span>
    <span class="ba-node-body">
      <span class="ba-node-title">${esc(lesson.title)}</span>
      ${lesson.subtitle ? `<span class="ba-node-sub">${esc(lesson.subtitle)}</span>` : ''}
    </span>
    ${tail}`;

  // Locked rows are inert; everything else navigates (a completed lesson
  // replays, a premium one lands on the paywall via the lesson route).
  return kind === 'locked'
    ? `<div class="ba-node-row locked">${inner}</div>`
    : `<a class="ba-node-row ${kind}" href="#/lesson/${esc(lesson.id)}">${inner}</a>`;
}

/** Flat [{lesson, module}] for a track, playable lessons only. */
function flatLessons(track) {
  return track.modules.flatMap((m) => m.lessons.filter((l) => !l.soon).map((l) => ({ lesson: l, module: m })));
}

function trackPath(track, { showMilestones, slice }) {
  const all = flatLessons(track);
  const current = nextLessonIn(track);
  const currentId = current ? current.lesson.id : null;
  const items = slice ? slice(all, currentId) : { rows: all, hidden: 0 };
  if (!items.rows.length) return '';

  const solid = track.color + '66';
  let html = '';
  items.rows.forEach((it, i) => {
    const prev = i > 0 ? items.rows[i - 1] : null;
    const kind = nodeState(track, it.module, it.lesson, currentId);
    const milestone = showMilestones && (!prev || prev.module.id !== it.module.id);
    const topSolid = prev ? !!state.completed[prev.lesson.id] : false;
    const bottomSolid = !!state.completed[it.lesson.id];

    if (milestone) {
      html += `
        <div class="ba-milestone">
          <span class="ba-rail-col">
            ${i > 0 ? `<span class="ba-rail top ${topSolid ? 'solid' : ''}"></span>` : ''}
            <span class="ba-rail bottom ${topSolid ? 'solid' : ''}"></span>
            <span class="ba-milestone-dot"></span>
          </span>
          <span class="ba-milestone-text">${esc(it.module.title)}</span>
          ${it.module.premium && !isPremium ? '<span class="ba-pro-tag">Pro</span>' : ''}
        </div>`;
    }
    html += nodeRow(track, it.module, it.lesson, kind, {
      topSolid, bottomSolid,
      first: i === 0 && !milestone,
      last: i === items.rows.length - 1 && !items.hidden,
      maxXp: it.lesson.xp,
    });
  });

  if (items.hidden > 0) {
    html += `
      <button class="ba-more" data-more="${esc(track.id)}">
        <span class="ba-rail-col"><span class="ba-rail top"></span><span class="ba-more-dot"></span></span>
        <span class="ba-more-text">+${items.hidden} more lesson${items.hidden === 1 ? '' : 's'}</span>
      </button>`;
  }
  return `<div class="ba-path" style="--tc:${esc(track.color)};--rail:${solid}">${html}</div>`;
}

/** Collected-stocks chip on a track header — the app's "📈 1/2". */
function stockChip(track) {
  const pool = TRACK_STOCKS[track.id] || [];
  if (!pool.length) return '';
  const owned = new Set(state.stockBadges || []);
  const got = pool.filter((s) => owned.has(s.id)).length;
  return `<span class="ba-stockchip ${got ? 'got' : ''}">${icon('stats-chart', 11)} ${got}/${pool.length}</span>`;
}

// ── Home ────────────────────────────────────────────────────
function viewHome() {
  setImmersive(false);
  const up = nextLessonOverall();
  const started = Object.keys(state.completed || {}).length > 0;
  const goal = state.dailyGoal || 20;
  const done = xpToday();
  const met = done >= goal;
  const due = dueReviews();
  const scenarioDone = scenarioDoneToday();

  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // Monday = 0
  const week = DAYS.map((d, i) => {
    const day = new Date(now);
    day.setDate(now.getDate() - (dow - i));
    const key = todayKey(day);
    const future = i > dow;
    const active = !future && (((state.dayXp || {})[key] || 0) > 0 || state.lastActiveDay === key);
    return `
      <div class="ba-day ${active ? 'done' : ''} ${i === dow ? 'today' : ''} ${future ? 'future' : ''}">
        <span class="ba-day-label">${d[0]}</span>
        <span class="ba-day-dot">${active ? '🔥' : ''}</span>
      </div>`;
  }).join('');

  render(`
    ${header()}
    <div class="ba-stagger">
      ${up ? `
        <a class="ba-hero" href="#/lesson/${esc(up.lesson.id)}" style="--tc:${esc(up.track.color)}">
          <span class="ba-hero-body">
            <span class="ba-hero-kicker">${started ? 'Continue' : 'Start here'}</span>
            <span class="ba-hero-title">${esc(up.lesson.title)}</span>
            <span class="ba-hero-meta">${esc(up.track.title)}${
              up.lesson.subtitle ? ' · ' + esc(up.lesson.subtitle) : ''}</span>
          </span>
          <span class="ba-hero-go">→</span>
        </a>` : `
        <div class="ba-card">
          <p class="ba-sub">You’ve finished every playable lesson. New content ships
            regularly — and The Floor resets daily.</p>
          <a class="ba-btn ba-btn-primary" href="/floor">Play today’s Floor</a>
        </div>`}

      <div class="ba-card">
        <div class="ba-today-head">
          <button class="ba-today-ring" id="goalring" aria-label="Change your daily goal">
            ${ring(44, 18, 4, Math.min(1, done / goal), met ? 'met' : '')}
            <span class="ba-today-ring-text ${met ? 'met' : ''}">${met ? '🎯' : done}</span>
          </button>
          <div class="ba-hd-text">
            <p class="ba-today-title">Today</p>
            <p class="ba-today-sub">${met
              ? 'Goal met — nice work'
              : `${done}/${goal} XP · tap the ring to adjust`}</p>
          </div>
        </div>
        <div class="ba-today-chips">
          <a class="ba-chip" href="/floor" style="--cc:var(--ba-success)">
            <span class="ba-chip-icon">${icon('trending-up', 15)}</span>
            <span class="ba-chip-label">The Floor</span>
          </a>
          <a class="ba-chip ${scenarioDone ? 'done' : ''}" href="#/scenario" style="--cc:var(--ba-primary)">
            <span class="ba-chip-icon">${scenarioDone ? CHECK : icon('pulse', 15)}</span>
            <span class="ba-chip-label">Scenario</span>
          </a>
          ${due.length
            ? `<a class="ba-chip" href="#/review" style="--cc:var(--ba-gold)">
                 <span class="ba-chip-icon">${icon('time', 15)}</span>
                 <span class="ba-chip-label">Review · ${due.length}</span>
               </a>`
            : `<span class="ba-chip done" style="--cc:var(--ba-gold)">
                 <span class="ba-chip-icon">${CHECK}</span>
                 <span class="ba-chip-label">Review</span>
               </span>`}
        </div>
      </div>

      <div class="ba-card">
        <div class="ba-streak-head">
          <span class="ba-streak-title">${state.streak} day${state.streak === 1 ? '' : 's'} streak</span>
          <span class="ba-streak-hint">${state.streak > 0 ? 'Don’t break it' : 'Start one today'}</span>
        </div>
        <div class="ba-week">${week}</div>
      </div>

      <h2 class="ba-section-title">Your path</h2>
      ${orderedTracks().map((t) => {
        const { done: d, total } = trackStats(t);
        const pct = total ? (d / total) * 100 : 0;
        const open = !!expanded[t.id];
        const allDone = total > 0 && d === total;
        return `
          <div class="ba-unit ${open ? 'open' : ''}" style="--tc:${esc(t.color)}">
            <button class="ba-unit-head" data-track="${esc(t.id)}">
              <span class="ba-unit-row">
                <span class="ba-unit-dot"></span>
                <span class="ba-unit-title">${esc(t.title)}</span>
                ${stockChip(t)}
                <span class="ba-unit-count">${d}/${total}</span>
                <span class="ba-unit-chev">▼</span>
              </span>
              <span class="ba-unit-bar">
                <span class="ba-unit-fill ${allDone ? 'all' : ''}" style="width:${pct}%"></span>
              </span>
            </button>
            ${allDone && !open ? `
              <div class="ba-path"><div class="ba-alldone">
                <span class="ba-alldone-icon">✓</span>
                <span class="ba-alldone-text">All lessons complete</span>
              </div></div>`
              : trackPath(t, {
                  showMilestones: open,
                  slice: (all, currentId) => {
                    if (open) {
                      const n = Math.min(revealed[t.id] || BATCH, all.length);
                      return { rows: all.slice(0, n), hidden: all.length - n };
                    }
                    let anchor = all.findIndex((x) => x.lesson.id === currentId);
                    if (anchor === -1) anchor = all.findIndex((x) => !state.completed[x.lesson.id]);
                    const rows = anchor === -1 ? all.slice(0, PREVIEW) : all.slice(anchor, anchor + PREVIEW);
                    return { rows, hidden: all.length - rows.length };
                  },
                })}
          </div>`;
      }).join('')}
    </div>
    ${footerCta()}`);

  document.querySelectorAll('[data-track]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.track;
      expanded[id] = !expanded[id];
      if (!expanded[id]) delete revealed[id];
      viewHome();
    }));
  document.querySelectorAll('[data-more]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.more;
      if (!expanded[id]) { expanded[id] = true; revealed[id] = BATCH; }
      else revealed[id] = (revealed[id] || BATCH) + BATCH;
      viewHome();
    }));
  const gr = document.getElementById('goalring');
  if (gr) gr.addEventListener('click', () => {
    const order = [10, 20, 30];
    state.dailyGoal = order[(order.indexOf(goal) + 1) % order.length];
    save();
    viewHome();
  });
}

// ── Track ───────────────────────────────────────────────────
function viewTrack(id) {
  setImmersive(false);
  const t = TRACKS.find((x) => x.id === id);
  if (!t) return go('#/');
  const { done, total } = trackStats(t);
  render(`
    <a class="ba-back" href="#/">← Your path</a>
    <div class="ba-card" style="--tc:${esc(t.color)}">
      <p class="ba-eyebrow">${done}/${total} complete</p>
      <h1 class="ba-h1">${esc(t.title)}</h1>
      <p class="ba-sub">${esc(t.description)}</p>
      <div class="ba-bar sm" style="--tc:${esc(t.color)}">
        <div class="ba-bar-fill" style="width:${total ? (done / total) * 100 : 0}%"></div>
      </div>
    </div>
    ${trackPath(t, { showMilestones: true })}
    ${footerCta()}`);
}

// ── Review ──────────────────────────────────────────────────
/** The spaced-repetition queue. Opening one replays its questions only —
 *  the teaching has already been read, which is what `recap` means. */
function viewReview() {
  setImmersive(false);
  const due = dueReviews();
  const lessonById = {};
  for (const t of TRACKS) for (const m of t.modules) for (const l of m.lessons) {
    lessonById[l.id] = { lesson: l, track: t };
  }

  render(`
    <a class="ba-back" href="#/">← Your path</a>
    <div class="ba-card">
      <p class="ba-eyebrow">Review</p>
      <h1 class="ba-h1">${due.length ? `${due.length} lesson${due.length === 1 ? '' : 's'} due` : 'Nothing due'}</h1>
      <p class="ba-sub">${due.length
        ? 'Questions only — you’ve already read the material. Score 80% or more and the next review moves further out.'
        : 'Reviews are scheduled as you finish lessons. Come back when one falls due.'}</p>
    </div>
    ${due.map((id) => {
      const e = lessonById[id];
      if (!e) return '';
      const r = (state.reviews || {})[id] || {};
      return `
        <a class="ba-lesson" href="#/review/${esc(id)}" style="--tc:${esc(e.track.color)}">
          <span class="ba-lesson-mark">${icon('time', 14)}</span>
          <span class="ba-lesson-title">${esc(e.lesson.title)}
            <em class="ba-lesson-track">${esc(e.track.title)}</em></span>
          <span class="ba-lesson-xp">${state.scores[id] !== undefined ? state.scores[id] + '%' : ''}</span>
        </a>`;
    }).join('')}
    ${footerCta()}`);
}

// ── Badges ──────────────────────────────────────────────────
function viewBadges() {
  setImmersive(false);
  const earned = new Set(earnedBadgeIds());
  const owned = new Set(state.stockBadges || []);

  const card = (b, got, sub) => `
    <div class="ba-badge ${got ? 'got' : ''}" style="--bc:${esc(b.color)}">
      <span class="ba-badge-disc">${icon(b.icon, 26, got ? b.color : undefined)}</span>
      <span class="ba-badge-title">${esc(b.title)}</span>
      <span class="ba-badge-desc">${esc(got ? b.description : (sub || b.description))}</span>
    </div>`;

  render(`
    <a class="ba-back" href="#/">← Your path</a>
    <div class="ba-card">
      <p class="ba-eyebrow">Trophy case</p>
      <h1 class="ba-h1">${earned.size}/${BADGES.length} badges</h1>
      <p class="ba-sub">${owned.size}/${STOCKS.length} stocks collected — stocks drop at random
        as you finish lessons in each track.</p>
    </div>

    <h2 class="ba-section-title">Achievements</h2>
    <div class="ba-badges">${BADGES.map((b) => card(b, earned.has(b.id))).join('')}</div>

    <h2 class="ba-section-title">Stock collection</h2>
    <div class="ba-badges">${STOCKS.map((st) =>
      card(st, owned.has(st.id), 'Not collected yet')).join('')}</div>
    ${footerCta()}`);
}

// ── Profile ─────────────────────────────────────────────────
function viewProfile() {
  setImmersive(false);
  const { current, next } = levelFor(state.xp);
  const lessonsDone = Object.keys(state.completed || {}).length;
  const scores = Object.values(state.scores || {});
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const theme = state.theme === 'light' ? 'light' : 'dark';

  render(`
    <a class="ba-back" href="#/">← Your path</a>
    <div class="ba-card ba-identity">
      <span class="ba-identity-disc" style="--ac:${esc(avatarColor(state.avatarId))}">
        <img src="/mascot-happy.png" alt="" />
      </span>
      <div>
        <h1 class="ba-h1 sm">${esc(state.username || 'Your profile')}</h1>
        <p class="ba-sub">${esc(current.title)} · ${state.xp.toLocaleString()} XP${isPremium ? ' · Pro' : ''}</p>
      </div>
    </div>

    <div class="ba-done-stats">
      <div class="ba-stat"><span class="ba-stat-v" id="s1">0</span><span class="ba-stat-l">Lessons</span></div>
      <div class="ba-stat"><span class="ba-stat-v" id="s2">0</span><span class="ba-stat-l">Day streak</span></div>
      <div class="ba-stat"><span class="ba-stat-v" id="s3">0</span><span class="ba-stat-l">Avg score</span></div>
    </div>

    <a class="ba-card ba-rowlink" href="#/badges">
      <span class="ba-rowlink-icon">${icon('trophy', 18, 'var(--ba-gold)')}</span>
      <span class="ba-rowlink-text">
        <strong>Trophy case</strong>
        <em>${earnedBadgeIds().length}/${BADGES.length} badges · ${(state.stockBadges || []).length}/${STOCKS.length} stocks</em>
      </span>
      <span class="ba-rowlink-chev">→</span>
    </a>

    <div class="ba-card">
      <h2 class="ba-h2">Career ladder</h2>
      ${LEVELS.map((lv) => `
        <div class="ba-ladder ${lv.id === current.id ? 'on' : ''} ${state.xp >= lv.minXp ? 'got' : ''}">
          <span>${esc(lv.title)}</span>
          <span class="ba-ladder-xp">${lv.minXp.toLocaleString()} XP</span>
        </div>`).join('')}
      ${next ? `<p class="ba-sub" style="margin-top:12px">${(next.minXp - state.xp).toLocaleString()} XP to ${esc(next.title)}</p>` : ''}
    </div>

    <div class="ba-card">
      <h2 class="ba-h2">Daily goal</h2>
      <div class="ba-goalpick">
        ${[10, 20, 30].map((g) => `
          <button class="ba-goalopt ${state.dailyGoal === g ? 'on' : ''}" data-g="${g}">${g} XP</button>`).join('')}
      </div>
    </div>

    <div class="ba-card">
      <h2 class="ba-h2">Avatar</h2>
      <div class="ba-ob-avatars">
        ${AVATARS.map((a) => `
          <button class="ba-ob-avatar ${state.avatarId === a.id ? 'on' : ''}"
                  style="--ac:${a.color}" data-av="${esc(a.id)}" aria-label="${esc(a.label)}">
            <img src="/mascot-happy.png" alt="" />
          </button>`).join('')}
      </div>
    </div>

    <div class="ba-card">
      <h2 class="ba-h2">Appearance</h2>
      <div class="ba-themepick">
        <button class="ba-themeopt ${theme === 'dark' ? 'on' : ''}" data-t="dark">Dark</button>
        <button class="ba-themeopt ${theme === 'light' ? 'on' : ''}" data-t="light">Light</button>
      </div>
    </div>

    <div class="ba-card">
      <h2 class="ba-h2">Account</h2>
      <p class="ba-sub">${session ? esc(session.user.email || 'Signed in') : 'Not signed in'}</p>
      ${session
        ? `<button class="ba-btn ba-btn-ghost" id="out">Sign out</button>`
        : `<button class="ba-btn ba-btn-oauth" data-p="google">Continue with Google</button>
           <button class="ba-btn ba-btn-oauth" data-p="apple">Continue with Apple</button>`}
    </div>
    ${footerCta()}`);

  countUp(document.getElementById('s1'), lessonsDone, 700);
  countUp(document.getElementById('s2'), state.streak, 700);
  countUp(document.getElementById('s3'), avg, 700, (v) => Math.round(v) + '%');

  document.querySelectorAll('.ba-goalopt').forEach((b) =>
    b.addEventListener('click', () => { state.dailyGoal = Number(b.dataset.g); save(); viewProfile(); }));
  document.querySelectorAll('[data-av]').forEach((b) =>
    b.addEventListener('click', async () => {
      state.avatarId = b.dataset.av; save(); viewProfile();
      if (session) { try { await supabase.rpc('set_avatar', { p_avatar_id: state.avatarId }); } catch {} }
    }));
  document.querySelectorAll('[data-t]').forEach((b) =>
    b.addEventListener('click', () => { applyTheme(b.dataset.t); viewProfile(); }));
  const out = document.getElementById('out');
  if (out) out.addEventListener('click', async () => { await signOut(); go('#/'); });
  document.querySelectorAll('[data-p]').forEach((b) =>
    b.addEventListener('click', () => oauth(b.dataset.p).catch(() => {})));
}

// ── Router ──────────────────────────────────────────────────
function route() {
  const h = window.location.hash || '#/';

  // Onboarding ends in an account, and the account is not optional: a browser
  // profile is far more disposable than a phone, so an unsigned learner would
  // lose their streak the first time they cleared site data.
  if (!state.onboarded) return viewOnboarding(false);
  if (!session) return viewOnboarding(true);

  if (h === '#/profile') return viewProfile();
  if (h === '#/badges') return viewBadges();
  if (h === '#/scenario') return viewScenario();
  if (h === '#/review') return viewReview();
  const review = h.match(/^#\/review\/(.+)$/);
  if (review) return viewLesson(review[1], true);   // recap: questions only
  const track = h.match(/^#\/track\/(.+)$/);
  if (track) return viewTrack(track[1]);
  const lesson = h.match(/^#\/lesson\/(.+)$/);
  if (lesson) return viewLesson(lesson[1]);
  viewHome();
}

window.addEventListener('hashchange', route);

supabase.auth.onAuthStateChange(async (_e, s) => {
  const had = !!session;
  setSession(s);
  if (!had && s) {
    try { await syncNow(); await pushIdentity(); } catch {}
    route();
  }
});

(async function start() {
  applyTheme(state.theme || 'dark');
  const { data } = await supabase.auth.getSession();
  setSession(data.session);
  if (data.session) {
    try { await syncNow(); await pushIdentity(); } catch {}
  }
  // A learner arriving with months of synced progress has already "earned"
  // most badges; record them as seen so only genuinely new ones celebrate.
  primeBadgesSeen(); save();
  const back = consumeReturnHash();
  if (back && back !== (window.location.hash || '')) {
    window.location.hash = back; // fires hashchange -> route()
    return;
  }
  route();
})();
