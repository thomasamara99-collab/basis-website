/* ============================================================
   BASIS — web app (lessons, quizzes, progress, profile)
   ------------------------------------------------------------
   The curriculum is NOT authored here. src/data/curriculum/ in
   the app repo is the single source of truth;
   `npm run generate:web-curriculum` emits curriculum-index.js
   and curriculum-lessons.js. Only the player lives in this file.

   Progress uses the SAME shapes and the SAME profiles row as the
   iOS app (xp, streak, last_active_day, completed, scores), so a
   signed-in learner's web and app progress are one record, merged
   union-of-completed / max-of-xp exactly like SyncBridge does.
   ============================================================ */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://qggmevyefongdmimwpzj.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFnZ21ldnllZm9uZ2RtaW13cHpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3MjM3NDUsImV4cCI6MjA5NzI5OTc0NX0.8ZkEHoa5DxaDrMERfbKZkdHJSMx4Y1nlLz3hULuykB8';

const APP_STORE = 'https://apps.apple.com/app/basis-learn-finance-markets/id6784982377';
const STORE_KEY = 'basis-web-progress';
const LESSONS_SRC = '/app/curriculum-lessons.js';

const TRACKS = window.__BASIS_TRACKS__ || [];
const LEVELS = window.__BASIS_LEVELS__ || [];

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { detectSessionInUrl: true, persistSession: true, flowType: 'pkce' },
});

const shell = document.getElementById('ba-shell');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The app writes **bold** in lesson bodies; render it, escape everything else. */
function rich(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function todayKey(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
    + '-' + String(d.getDate()).padStart(2, '0');
}

function yesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return todayKey(d);
}

// ── Progress state ──────────────────────────────────────────
// Field names deliberately mirror the app's ProgressSnapshot.
const blank = () => ({
  xp: 0,
  streak: 0,
  lastActiveDay: null,
  completed: {},
  scores: {},
  topics: null,      // chosen in onboarding; null = not onboarded yet
  onboarded: false,
});

let state = load();
let session = null;
let lessonsLoaded = false;

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return Object.assign(blank(), JSON.parse(raw));
  } catch { /* private mode */ }
  return blank();
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
}

/** Union completed, keep the best score, take the higher xp/streak — the same
 *  rule SyncBridge applies, so neither surface can clobber the other. */
function merge(a, b) {
  const completed = Object.assign({}, a.completed, b.completed);
  const scores = Object.assign({}, a.scores);
  for (const [k, v] of Object.entries(b.scores || {})) {
    scores[k] = Math.max(scores[k] ?? 0, v);
  }
  return {
    xp: Math.max(a.xp || 0, b.xp || 0),
    streak: Math.max(a.streak || 0, b.streak || 0),
    lastActiveDay: [a.lastActiveDay, b.lastActiveDay].filter(Boolean).sort().pop() ?? null,
    completed,
    scores,
  };
}

async function pull() {
  if (!session) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('xp, streak, last_active_day, completed, scores')
    .eq('id', session.user.id)
    .maybeSingle();
  if (error || !data) return null;
  return {
    xp: data.xp ?? 0,
    streak: data.streak ?? 0,
    lastActiveDay: data.last_active_day ?? null,
    completed: data.completed ?? {},
    scores: data.scores ?? {},
  };
}

async function push() {
  if (!session) return;
  await supabase.from('profiles').upsert({
    id: session.user.id,
    xp: state.xp,
    streak: state.streak,
    last_active_day: state.lastActiveDay,
    completed: state.completed,
    scores: state.scores,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });
}

async function syncNow() {
  const remote = await pull();
  if (remote) {
    const merged = merge(state, remote);
    Object.assign(state, merged);
    save();
  }
  await push();
}

/** Streak advances once per calendar day, resets if a day was missed. */
function touchStreak() {
  const t = todayKey();
  if (state.lastActiveDay === t) return;
  state.streak = state.lastActiveDay === yesterdayKey() ? (state.streak || 0) + 1 : 1;
  state.lastActiveDay = t;
}

// ── Derived helpers ─────────────────────────────────────────
const allLessons = () => TRACKS.flatMap((t) =>
  t.modules.flatMap((m) => m.lessons.map((l) => ({ ...l, track: t, module: m }))));

function levelFor(xp) {
  let current = LEVELS[0], next = null;
  for (let i = 0; i < LEVELS.length; i++) {
    if (xp >= LEVELS[i].minXp) { current = LEVELS[i]; next = LEVELS[i + 1] || null; }
  }
  return { current, next };
}

function trackStats(t) {
  let done = 0, total = 0;
  t.modules.forEach((m) => m.lessons.forEach((l) => {
    if (l.soon) return;
    total++;
    if (state.completed[l.id]) done++;
  }));
  return { done, total };
}

/** Tracks the learner picked in onboarding come first; the rest keep their
 *  authored order. This IS the "custom lesson plan". */
function orderedTracks() {
  if (!state.topics || !state.topics.length) return TRACKS;
  const picked = new Set(state.topics);
  return [...TRACKS].sort((a, b) => (picked.has(b.id) ? 1 : 0) - (picked.has(a.id) ? 1 : 0));
}

function nextLessonIn(t) {
  for (const m of t.modules) {
    for (const l of m.lessons) {
      if (!l.soon && !state.completed[l.id]) return { lesson: l, module: m };
    }
  }
  return null;
}

async function ensureLessons() {
  if (lessonsLoaded || window.__BASIS_LESSONS__) { lessonsLoaded = true; return; }
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = LESSONS_SRC;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  lessonsLoaded = true;
}

// ── Chrome ──────────────────────────────────────────────────
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

function render(html) {
  shell.innerHTML = html;
  window.scrollTo({ top: 0, behavior: 'auto' });
}

// ── Views ───────────────────────────────────────────────────
function viewOnboarding() {
  render(`
    <div class="ba-card ba-onboard">
      <p class="ba-eyebrow">Welcome</p>
      <h1 class="ba-h1">What do you want to learn?</h1>
      <p class="ba-sub">Pick anything that interests you and we'll put those tracks first.
        Skip it and you'll get the default order — you can change your mind later.</p>
      <div class="ba-topics">
        ${TRACKS.map((t) => `
          <button class="ba-topic" data-id="${esc(t.id)}" style="--tc:${esc(t.color)}">
            <span class="ba-topic-dot"></span>${esc(t.title)}
          </button>`).join('')}
      </div>
      <button class="ba-btn ba-btn-primary" id="ba-onb-go">Start learning</button>
      <button class="ba-btn ba-btn-ghost" id="ba-onb-skip">Skip</button>
    </div>`);

  const picked = new Set();
  shell.querySelectorAll('.ba-topic').forEach((b) => {
    b.addEventListener('click', () => {
      const id = b.dataset.id;
      if (picked.has(id)) { picked.delete(id); b.classList.remove('on'); }
      else { picked.add(id); b.classList.add('on'); }
    });
  });
  const finish = () => {
    state.topics = [...picked];
    state.onboarded = true;
    save();
    go('#/');
  };
  shell.querySelector('#ba-onb-go').addEventListener('click', finish);
  shell.querySelector('#ba-onb-skip').addEventListener('click', finish);
}

function viewHome() {
  const tracks = orderedTracks();
  const first = tracks.find((t) => nextLessonIn(t));
  const cont = first ? nextLessonIn(first) : null;

  render(`
    ${header()}
    ${cont ? `
      <a class="ba-continue" href="#/lesson/${esc(cont.lesson.id)}">
        <div>
          <p class="ba-eyebrow">Continue</p>
          <p class="ba-continue-title">${esc(cont.lesson.title)}</p>
          <p class="ba-continue-sub">${esc(first.title)} · +${cont.lesson.xp} XP</p>
        </div>
        <span class="ba-continue-arrow">→</span>
      </a>` : `
      <div class="ba-card"><p class="ba-sub">You've completed every lesson available. More coming.</p></div>`}

    <h2 class="ba-section-title">Your path</h2>
    <div class="ba-tracks">
      ${tracks.map((t) => {
        const { done, total } = trackStats(t);
        const pct = total ? (done / total) * 100 : 0;
        const starred = state.topics && state.topics.includes(t.id);
        return `
          <a class="ba-track" href="#/track/${esc(t.id)}" style="--tc:${esc(t.color)}">
            <div class="ba-track-top">
              <span class="ba-track-dot"></span>
              <span class="ba-track-name">${esc(t.title)}</span>
              ${starred ? '<span class="ba-pick">picked</span>' : ''}
              <span class="ba-track-count">${done}/${total}</span>
            </div>
            <div class="ba-bar sm"><div class="ba-bar-fill" style="width:${pct}%"></div></div>
          </a>`;
      }).join('')}
    </div>
    ${footerCta()}`);
}

function viewTrack(id) {
  const t = TRACKS.find((x) => x.id === id);
  if (!t) return go('#/');
  render(`
    ${header()}
    <a class="ba-back" href="#/">← Your path</a>
    <h1 class="ba-h1" style="--tc:${esc(t.color)}">${esc(t.title)}</h1>
    ${t.description ? `<p class="ba-sub">${esc(t.description)}</p>` : ''}
    ${t.modules.map((m) => `
      <div class="ba-module">
        <div class="ba-module-head">
          <h3>${esc(m.title)}</h3>
          ${m.premium ? '<span class="ba-lock">Pro</span>' : ''}
        </div>
        ${m.lessons.map((l) => {
          const done = !!state.completed[l.id];
          const locked = l.soon || m.premium;
          const cls = 'ba-lesson' + (done ? ' done' : '') + (locked ? ' locked' : '');
          const inner = `
            <span class="ba-lesson-mark">${done ? '✓' : (locked ? '🔒' : '')}</span>
            <span class="ba-lesson-title">${esc(l.title)}</span>
            <span class="ba-lesson-xp">${l.soon ? 'Soon' : (m.premium ? 'Pro' : '+' + l.xp + ' XP')}</span>`;
          return locked
            ? `<div class="${cls}">${inner}</div>`
            : `<a class="${cls}" href="#/lesson/${esc(l.id)}">${inner}</a>`;
        }).join('')}
      </div>`).join('')}
    ${footerCta()}`);
}

function footerCta() {
  return `
    <div class="ba-appcta">
      <p>Streaks, reminders, the daily market game and the leaderboard live in the app.</p>
      <a class="ba-btn ba-btn-go" href="${APP_STORE}">Get Basis free</a>
    </div>`;
}

// ── Lesson player ───────────────────────────────────────────
async function viewLesson(id) {
  render('<div class="ba-loading">Loading lesson…</div>');
  try {
    await ensureLessons();
  } catch {
    return render('<div class="ba-card"><p class="ba-sub">Couldn\'t load the lesson. Check your connection and try again.</p></div>');
  }
  const L = (window.__BASIS_LESSONS__ || {})[id];
  if (!L) return go('#/');

  // phase: teaching sections first, then one question at a time — the app's
  // rule is that the material must cover everything the quiz tests.
  let step = 0;
  const sections = L.sections || [];
  const total = sections.length + L.questions.length;
  let qIndex = 0;
  let correctCount = 0;

  function chrome(inner, progressAt) {
    return `
      <div class="ba-lesson-top">
        <a class="ba-close" href="#/track/${esc(L.trackId)}" aria-label="Close lesson">✕</a>
        <div class="ba-bar sm wide"><div class="ba-bar-fill" style="width:${(progressAt / total) * 100}%"></div></div>
        <span class="ba-lesson-count">${Math.min(progressAt + 1, total)}/${total}</span>
      </div>
      <div class="ba-card" style="--tc:${esc(L.color)}">${inner}</div>`;
  }

  function showSection() {
    const s = sections[step];
    render(chrome(`
      <p class="ba-eyebrow">${esc(L.trackTitle)}</p>
      ${step === 0 ? `<h1 class="ba-h1">${esc(L.title)}</h1><p class="ba-lead">${rich(L.intro)}</p>` : ''}
      ${s.heading ? `<h2 class="ba-h2">${esc(s.heading)}</h2>` : ''}
      <p class="ba-body">${rich(s.body)}</p>
      ${s.formula ? `<div class="ba-formula">${esc(s.formula)}</div>` : ''}
      ${s.bullets && s.bullets.length
        ? `<ul class="ba-bullets">${s.bullets.map((b) => `<li>${rich(b)}</li>`).join('')}</ul>`
        : ''}
      <button class="ba-btn ba-btn-primary" id="ba-next">
        ${step === sections.length - 1 ? 'Start questions' : 'Continue'}
      </button>`, step));
    shell.querySelector('#ba-next').addEventListener('click', () => { step++; advance(); });
  }

  function showQuestion() {
    const q = L.questions[qIndex];
    let chosen = null;
    render(chrome(`
      <p class="ba-eyebrow">Quick check</p>
      <h2 class="ba-h2">${rich(q.prompt)}</h2>
      <div class="ba-options" id="ba-opts">
        ${q.options.map((o, i) => `
          <button class="ba-opt" data-i="${i}">
            <span class="ba-opt-key">${'ABCD'[i]}</span><span>${esc(o)}</span>
          </button>`).join('')}
      </div>
      <button class="ba-btn ba-btn-primary" id="ba-check" disabled>Check answer</button>`, step));

    const check = shell.querySelector('#ba-check');
    shell.querySelectorAll('.ba-opt').forEach((b) => {
      b.addEventListener('click', () => {
        chosen = +b.dataset.i;
        shell.querySelectorAll('.ba-opt').forEach((x) => x.classList.toggle('sel', x === b));
        check.disabled = false;
      });
    });
    check.addEventListener('click', () => {
      if (chosen === null) return;
      const right = chosen === q.correctIndex;
      if (right) correctCount++;
      shell.querySelectorAll('.ba-opt').forEach((x, i) => {
        x.disabled = true;
        if (i === q.correctIndex) x.classList.add('right');
        else if (i === chosen) x.classList.add('wrong');
      });
      check.outerHTML = `
        <div class="ba-explain ${right ? 'right' : 'wrong'}">
          <p class="ba-explain-head">${right ? '✓ Correct' : 'Not quite'}</p>
          <p>${rich(q.explanation)}</p>
        </div>
        <button class="ba-btn ba-btn-go" id="ba-next">
          ${qIndex === L.questions.length - 1 ? 'Finish lesson' : 'Next question'}
        </button>`;
      shell.querySelector('#ba-next').addEventListener('click', () => {
        qIndex++; step++; advance();
      });
    });
  }

  async function finish() {
    const firstTime = !state.completed[L.id];
    const score = Math.round((correctCount / L.questions.length) * 100);
    state.completed[L.id] = true;
    state.scores[L.id] = Math.max(state.scores[L.id] ?? 0, score);
    if (firstTime) state.xp += L.xp;   // XP is awarded once, as in the app
    touchStreak();
    save();

    render(`
      <div class="ba-card ba-done">
        <p class="ba-done-mark">✓</p>
        <h1 class="ba-h1">${firstTime ? 'Lesson complete' : 'Reviewed'}</h1>
        <p class="ba-sub">${correctCount}/${L.questions.length} correct${firstTime ? ` · +${L.xp} XP` : ' · already earned'}</p>
        <div class="ba-done-actions">
          <a class="ba-btn ba-btn-primary" href="#/track/${esc(L.trackId)}">Back to ${esc(L.trackTitle)}</a>
          <a class="ba-btn ba-btn-ghost" href="#/">Your path</a>
        </div>
        <div id="ba-save"></div>
      </div>`);

    renderSavePrompt();
    if (session) { try { await syncNow(); } catch {} }
  }

  function advance() {
    if (step < sections.length) return showSection();
    if (qIndex < L.questions.length) return showQuestion();
    finish();
  }

  advance();
}

// ── Account ─────────────────────────────────────────────────
function renderSavePrompt() {
  const el = document.getElementById('ba-save');
  if (!el) return;
  if (session) {
    el.innerHTML = `<p class="ba-saved">✓ Saved to your account — it's on your phone too.</p>`;
    return;
  }
  el.innerHTML = `
    <div class="ba-savebox">
      <p class="ba-savebox-title">Don't lose this</p>
      <p class="ba-sub">Sign in free and your XP, streak and progress follow you to the app.</p>
      <button class="ba-btn ba-btn-oauth" data-p="google">Continue with Google</button>
      <button class="ba-btn ba-btn-oauth" data-p="apple">Continue with Apple</button>
    </div>`;
  el.querySelectorAll('[data-p]').forEach((b) =>
    b.addEventListener('click', () => oauth(b.dataset.p)));
}

async function oauth(provider) {
  await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: window.location.origin + '/app' + window.location.hash },
  });
}

function viewProfile() {
  const { current, next } = levelFor(state.xp);
  const done = Object.keys(state.completed).length;
  const totalLessons = allLessons().filter((l) => !l.soon).length;
  render(`
    ${header()}
    <a class="ba-back" href="#/">← Your path</a>
    <div class="ba-card">
      <h1 class="ba-h1">${esc(current.title)}</h1>
      <p class="ba-sub">${esc(current.blurb || '')}</p>
      <div class="ba-stats">
        <div><strong>${state.xp.toLocaleString()}</strong><span>Total XP</span></div>
        <div><strong>${state.streak}</strong><span>Day streak</span></div>
        <div><strong>${done}/${totalLessons}</strong><span>Lessons</span></div>
      </div>
      ${next ? `<p class="ba-sub">${(next.minXp - state.xp).toLocaleString()} XP to ${esc(next.title)}.</p>` : '<p class="ba-sub">Top of the ladder.</p>'}
    </div>

    <div class="ba-card">
      <h2 class="ba-h2">Career ladder</h2>
      ${LEVELS.map((l) => `
        <div class="ba-rung ${state.xp >= l.minXp ? 'on' : ''}">
          <span>${esc(l.title)}</span><span>${l.minXp.toLocaleString()} XP</span>
        </div>`).join('')}
    </div>

    <div class="ba-card">
      <h2 class="ba-h2">Account</h2>
      <div id="ba-save"></div>
      ${session ? `<button class="ba-btn ba-btn-ghost" id="ba-signout">Sign out</button>` : ''}
      <button class="ba-btn ba-btn-ghost" id="ba-redo">Redo onboarding</button>
    </div>
    ${footerCta()}`);

  renderSavePrompt();
  const out = shell.querySelector('#ba-signout');
  if (out) out.addEventListener('click', async () => {
    await supabase.auth.signOut();
    go('#/profile');
  });
  shell.querySelector('#ba-redo').addEventListener('click', () => {
    state.onboarded = false;
    save();
    go('#/onboarding');
  });
}

// ── Router ──────────────────────────────────────────────────
function go(hash) {
  if (window.location.hash === hash) route();
  else window.location.hash = hash;
}

function route() {
  const h = window.location.hash || '#/';
  if (!state.onboarded && h !== '#/onboarding') return go('#/onboarding');
  if (h === '#/onboarding') return viewOnboarding();
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
  session = s;
  if (!had && s) { try { await syncNow(); } catch {} route(); }
});

(async function start() {
  const { data } = await supabase.auth.getSession();
  session = data.session;
  if (session) { try { await syncNow(); } catch {} }
  route();
})();
