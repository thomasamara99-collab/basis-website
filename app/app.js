/* ============================================================
   BASIS — web app shell (home, path, profile, router)
   ------------------------------------------------------------
   The curriculum is NOT authored here. src/data/curriculum/ in
   the app repo is the single source of truth;
   `npm run generate:web-curriculum` emits curriculum-index.js
   and curriculum-lessons.js.

   Shared state lives in core.js; the three big surfaces are
   their own modules (onboarding.js, lesson.js, paywall.js).
   ============================================================ */
import {
  state, save, session, setSession, isPremium, supabase, render, go, esc,
  setImmersive, syncNow, pushIdentity, consumeReturnHash, signOut, oauth,
  APP_STORE, TRACKS, LEVELS, levelFor, trackStats, orderedTracks,
  nextLessonOverall, xpToday, todayKey, mascot, countUp,
} from '/app/core.js';
import { viewOnboarding } from '/app/onboarding.js';
import { viewLesson } from '/app/lesson.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ── Shared chrome ───────────────────────────────────────────
function header() {
  const { current, next } = levelFor(state.xp);
  const pct = next
    ? Math.min(100, ((state.xp - current.minXp) / (next.minXp - current.minXp)) * 100)
    : 100;
  return `
    <div class="ba-header">
      <div class="ba-header-row">
        <a class="ba-level" href="#/profile">
          <span class="ba-level-title">${esc(current.title)}</span>
          <span class="ba-level-xp">${state.xp.toLocaleString()} XP</span>
        </a>
        <div class="ba-streak" title="Day streak">🔥 ${state.streak}</div>
      </div>
      <div class="ba-bar"><div class="ba-bar-fill" style="width:${pct}%"></div></div>
      ${next ? `<p class="ba-next-level">${(next.minXp - state.xp).toLocaleString()} XP to ${esc(next.title)}</p>` : ''}
    </div>`;
}

function footerCta() {
  return `
    <div class="ba-appcta">
      <p>Reminders, the daily market game and the full leaderboards live in the app.</p>
      <a class="ba-btn ba-btn-go" href="${APP_STORE}">Get Basis free</a>
    </div>`;
}

/** The daily goal ring — the app's "Today" centrepiece. */
function goalRing() {
  const goal = state.dailyGoal || 20;
  const done = xpToday();
  const pct = Math.min(1, done / goal);
  const R = 34, C = 2 * Math.PI * R;
  const left = Math.max(0, goal - done);
  return `
    <div class="ba-goal">
      <div class="ba-goal-dial">
        <svg viewBox="0 0 80 80" class="ba-goal-ring" aria-hidden="true">
          <circle cx="40" cy="40" r="${R}" class="ba-goal-bg" />
          <circle cx="40" cy="40" r="${R}" class="ba-goal-fg"
            stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - pct)).toFixed(1)}" />
        </svg>
        <div class="ba-goal-text"><strong>${done}</strong><span>/${goal}</span></div>
      </div>
      <div class="ba-goal-copy">
        <p class="ba-goal-title">${pct >= 1 ? 'Daily goal hit 🎉' : 'Today’s goal'}</p>
        <p class="ba-sub">${pct >= 1
          ? 'Anything else today is a bonus.'
          : `${left} XP to go — about ${Math.max(1, Math.ceil(left / 10))} question${left > 10 ? 's' : ''}.`}</p>
      </div>
    </div>`;
}

/** Mon–Sun strip showing which days this week were active. */
function streakWeek() {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // Monday = 0
  const cells = DAYS.map((d, i) => {
    const day = new Date(now);
    day.setDate(now.getDate() - (dow - i));
    const key = todayKey(day);
    const future = i > dow;
    const active = !future
      && (((state.dayXp || {})[key] || 0) > 0 || state.lastActiveDay === key);
    return `<div class="ba-week-cell ${active ? 'on' : ''} ${i === dow ? 'today' : ''} ${future ? 'future' : ''}">
        <span>${d[0]}</span><i>${active ? '🔥' : ''}</i></div>`;
  }).join('');
  return `<div class="ba-week">${cells}</div>`;
}

// ── Home ────────────────────────────────────────────────────
function viewHome() {
  setImmersive(false);
  const up = nextLessonOverall();
  const started = Object.keys(state.completed || {}).length > 0;
  render(`
    ${header()}
    <div class="ba-card">${goalRing()}${streakWeek()}</div>

    ${up ? `
      <a class="ba-continue" href="#/lesson/${esc(up.lesson.id)}" style="--tc:${esc(up.track.color)}">
        <span class="ba-continue-k">${started ? 'Continue' : 'Start here'}</span>
        <strong>${esc(up.lesson.title)}</strong>
        <em>${esc(up.track.title)} · ${esc(up.module.title)} · +${up.lesson.xp} XP</em>
      </a>` : `
      <div class="ba-card"><p class="ba-sub">You’ve finished every playable lesson. New
        content ships regularly — and The Floor resets daily.</p>
        <a class="ba-btn ba-btn-primary" href="/floor">Play today’s Floor</a></div>`}

    <h2 class="ba-section-title">Your path</h2>
    ${orderedTracks().map((t) => {
      const { done, total } = trackStats(t);
      const pct = total ? Math.round((done / total) * 100) : 0;
      const picked = (state.topics || []).includes(t.id);
      return `
        <a class="ba-track" href="#/track/${esc(t.id)}" style="--tc:${esc(t.color)}">
          <div class="ba-track-top">
            <span class="ba-track-title">${esc(t.title)}</span>
            ${picked ? '<span class="ba-track-pick">For you</span>' : ''}
            <span class="ba-track-count">${done}/${total}</span>
          </div>
          <div class="ba-bar sm"><div class="ba-bar-fill" style="width:${pct}%"></div></div>
        </a>`;
    }).join('')}
    ${footerCta()}`);
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
    </div>
    ${t.modules.map((m) => `
      <div class="ba-module">
        <div class="ba-module-head">
          <h2 class="ba-module-title">${esc(m.title)}</h2>
          ${m.premium ? '<span class="ba-pro-tag">Pro</span>' : ''}
        </div>
        ${m.description ? `<p class="ba-sub">${esc(m.description)}</p>` : ''}
        ${m.lessons.map((l) => {
          const complete = !!state.completed[l.id];
          // Premium rows stay tappable — they lead to the paywall, or straight
          // into the lesson for a subscriber. Only unauthored ones are inert.
          const pro = m.premium && !isPremium;
          const cls = 'ba-lesson' + (complete ? ' done' : '')
            + (l.soon ? ' locked' : '') + (pro ? ' pro' : '');
          const badge = l.soon ? 'Soon' : (pro ? 'Pro' : '+' + l.xp + ' XP');
          const inner = `
            <span class="ba-lesson-mark">${complete ? '✓' : (l.soon ? '🔒' : (pro ? '★' : ''))}</span>
            <span class="ba-lesson-title">${esc(l.title)}</span>
            <span class="ba-lesson-xp">${badge}</span>`;
          return l.soon
            ? `<div class="${cls}">${inner}</div>`
            : `<a class="${cls}" href="#/lesson/${esc(l.id)}">${inner}</a>`;
        }).join('')}
      </div>`).join('')}
    ${footerCta()}`);
}

// ── Profile ─────────────────────────────────────────────────
function viewProfile() {
  setImmersive(false);
  const { current, next } = levelFor(state.xp);
  const lessonsDone = Object.keys(state.completed || {}).length;
  const scores = Object.values(state.scores || {});
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

  render(`
    <a class="ba-back" href="#/">← Your path</a>
    <div class="ba-card ba-identity">
      ${mascot('happy', 64)}
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
    b.addEventListener('click', () => {
      state.dailyGoal = Number(b.dataset.g);
      save();
      viewProfile();
    }));
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
  const { data } = await supabase.auth.getSession();
  setSession(data.session);
  if (data.session) {
    try { await syncNow(); await pushIdentity(); } catch {}
  }
  const back = consumeReturnHash();
  if (back && back !== (window.location.hash || '')) {
    window.location.hash = back; // fires hashchange -> route()
    return;
  }
  route();
})();
