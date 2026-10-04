/* ============================================================
   BASIS web app — shared core
   ------------------------------------------------------------
   State, storage, Supabase, sync and render/route primitives.
   Everything else (onboarding, lesson player, paywall) imports
   from here, so there is exactly one progress record and one
   auth session in the page.

   Progress uses the SAME shapes and the SAME profiles row as
   the iOS app (xp, streak, last_active_day, completed, scores),
   so a signed-in learner's web and app progress are one record,
   merged union-of-completed / max-of-xp exactly like SyncBridge.
   ============================================================ */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const SUPABASE_URL = 'https://qggmevyefongdmimwpzj.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFnZ21ldnllZm9uZ2RtaW13cHpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3MjM3NDUsImV4cCI6MjA5NzI5OTc0NX0.8ZkEHoa5DxaDrMERfbKZkdHJSMx4Y1nlLz3hULuykB8';

export const APP_STORE = 'https://apps.apple.com/app/basis-learn-finance-markets/id6784982377';
export const XP_PER_CORRECT = 10;      // mirrors src/data/lessons.ts
export const QUESTION_TIME = 30;       // mirrors app/lesson/[id].tsx

const STORE_KEY = 'basis-web-progress';
const LESSONS_SRC = '/app/curriculum-lessons.js';

export const TRACKS = window.__BASIS_TRACKS__ || [];
export const LEVELS = window.__BASIS_LEVELS__ || [];

// Gamification data — generated from src/data by `npm run generate:web-data`.
export const SCENARIOS = window.__BASIS_SCENARIOS__ || [];
export const SCENARIO_XP = window.__BASIS_SCENARIO_XP__ || 30;
export const BADGES = window.__BASIS_BADGES__ || [];
export const STOCKS = window.__BASIS_STOCKS__ || [];

/** trackId -> its stock badges, same shape as TRACK_STOCKS in the app. */
export const TRACK_STOCKS = {};
for (const s of STOCKS) (TRACK_STOCKS[s.trackId] ||= []).push(s);

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { detectSessionInUrl: true, persistSession: true, flowType: 'pkce' },
});

// `let` exports are live bindings — importers always read the current value.
export let session = null;
export let isPremium = false;

export const shell = document.getElementById('ba-shell');

// ── Text helpers ────────────────────────────────────────────
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The app writes **bold** in lesson bodies; render it, escape everything else. */
export function rich(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

/** Paragraph breaks are authored as blank lines, same as LessonCards' RichText. */
export function richBlocks(s) {
  return String(s ?? '').split(/\n{2,}/).map((p) => `<p>${rich(p)}</p>`).join('');
}

export function todayKey(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
    + '-' + String(d.getDate()).padStart(2, '0');
}

export function yesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return todayKey(d);
}

export const reduceMotion =
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Progress state ──────────────────────────────────────────
// Field names deliberately mirror the app's ProgressSnapshot, plus the
// onboarding answers the app keeps in useProgressStore.
const blank = () => ({
  xp: 0,
  streak: 0,
  lastActiveDay: null,
  completed: {},
  scores: {},
  // Onboarding
  onboarded: false,
  startingPoint: null,   // 'new' | 'basics' | 'studying' | 'interviews'
  topics: null,          // track ids the learner picked
  dailyGoal: 20,
  username: null,
  avatarId: 'mascot_violet',
  theme: 'dark',        // matches the app's default (useThemeStore)
  dayXp: {},             // { 'YYYY-MM-DD': xp } — powers the daily goal ring
  // Spaced repetition: lessonId -> { nextReview, interval }, same shape and
  // same schedule rule as useProgressStore.scheduleReview.
  reviews: {},
  stockBadges: [],       // unlocked stock badge ids
  badgesSeen: [],        // badge ids already celebrated, so they fire once
});

export let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return Object.assign(blank(), JSON.parse(raw));
  } catch { /* private mode */ }
  return blank();
}

export function save() {
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
    .select('xp, streak, last_active_day, completed, scores, is_premium, floor_handle, avatar_id')
    .eq('id', session.user.id)
    .maybeSingle();
  if (error || !data) return null;
  // Entitlement: the server's copy, written by RevenueCat. See billing.js for
  // the live check that also covers a purchase made seconds ago on this page.
  isPremium = !!data.is_premium;
  if (data.floor_handle) state.username = data.floor_handle;
  if (data.avatar_id) state.avatarId = data.avatar_id;
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

export async function syncNow() {
  const remote = await pull();
  if (remote) {
    Object.assign(state, merge(state, remote));
    save();
  }
  await push();
}

export function setPremium(v) { isPremium = !!v; }

/**
 * Mirror RevenueCat's verdict into profiles.is_premium.
 *
 * get_premium_lesson() reads that column, so without a writer a web purchase
 * unlocks the UI and then fails to fetch the lesson. The RevenueCat webhook is
 * the proper writer; until it's deployed this does what the iOS app already
 * does from src/lib/premiumSync.ts — same RPC, same trust model, so it adds no
 * attack surface that isn't already there. Once the webhook is live and
 * supabase/harden-premium.sql has revoked the grant this call simply no-ops,
 * which is why its failure is swallowed.
 */
export async function pushPremium(v) {
  if (!session) return;
  try { await supabase.rpc('set_premium_status', { p_premium: !!v }); } catch { /* webhook owns it now */ }
}

/** Push the onboarding-chosen handle/avatar once an account exists. Mirrors
 *  pushInitialIdentity in the app: never clobbers an existing handle, so a
 *  returning user keeps the name their leaderboard entries already carry. */
export async function pushIdentity() {
  if (!session || !state.username) return;
  const { data } = await supabase
    .from('profiles').select('floor_handle').eq('id', session.user.id).maybeSingle();
  if (data && data.floor_handle) return;
  try { await supabase.rpc('set_username', { p_username: state.username }); } catch {}
  try { await supabase.rpc('set_avatar', { p_avatar_id: state.avatarId }); } catch {}
}

/** Streak advances once per calendar day, resets if a day was missed. */
export function touchStreak() {
  const t = todayKey();
  if (state.lastActiveDay === t) return;
  state.streak = state.lastActiveDay === yesterdayKey() ? (state.streak || 0) + 1 : 1;
  state.lastActiveDay = t;
}

export function addDayXp(n) {
  const t = todayKey();
  state.dayXp = state.dayXp || {};
  state.dayXp[t] = (state.dayXp[t] || 0) + n;
  // Keep the map small — only the last fortnight is ever read.
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 14);
  const min = todayKey(cutoff);
  for (const k of Object.keys(state.dayXp)) if (k < min) delete state.dayXp[k];
}

// ── Spaced repetition ───────────────────────────────────────
/** >=80% doubles the interval (max 30 days); below that resets to 1 day. */
export function scheduleReview(lessonId, correct, total) {
  const existing = (state.reviews || {})[lessonId];
  const passed = total > 0 && correct / total >= 0.8;
  const interval = existing ? (passed ? Math.min(existing.interval * 2, 30) : 1) : 1;
  const d = new Date();
  d.setDate(d.getDate() + interval);
  state.reviews = { ...(state.reviews || {}), [lessonId]: { nextReview: todayKey(d), interval } };
}

/** Completed lessons whose nextReview has come round, soonest first. */
export function dueReviews() {
  const t = todayKey();
  return Object.entries(state.reviews || {})
    .filter(([id, r]) => state.completed[id] && r.nextReview <= t)
    .sort(([, a], [, b]) => a.nextReview.localeCompare(b.nextReview))
    .map(([id]) => id);
}

// ── Daily scenario ──────────────────────────────────────────
/** Deterministic per calendar day and identical for everyone, exactly like
 *  getDailyScenario in the app; the option ORDER is shuffled per client, which
 *  is what the app does too (the pool is authored correct-answer-first). */
export function dailyScenario(dateKey = todayKey()) {
  if (!SCENARIOS.length) return null;
  const n = parseInt(dateKey.replace(/-/g, ''), 10) || 0;
  const q = SCENARIOS[n % SCENARIOS.length];
  const correct = q.options[q.correctIndex];
  const options = [...q.options].sort(() => Math.random() - 0.5);
  return { ...q, options, correctIndex: options.indexOf(correct) };
}

export const scenarioKey = (d = todayKey()) => 'scenario:' + d;
export const scenarioDoneToday = () => !!state.completed[scenarioKey()];

// ── Badges ──────────────────────────────────────────────────
/** Mirrors badgeContext() in src/data/badges.ts. */
export function badgeContext() {
  const completed = state.completed || {};
  const ids = Object.keys(completed);
  return {
    xp: state.xp,
    streak: state.streak,
    completed,
    lessonsCompleted: ids.filter((k) => !k.startsWith('scenario:')).length,
    scenariosCompleted: ids.filter((k) => k.startsWith('scenario:')).length,
  };
}

/** The same evaluator as ruleMet() in the app — the rules come from there. */
export function ruleMet(rule, c) {
  switch (rule.kind) {
    case 'lessons': return c.lessonsCompleted >= rule.n;
    case 'streak': return c.streak >= rule.n;
    case 'xp': return c.xp >= rule.n;
    case 'scenarios': return c.scenariosCompleted >= rule.n;
    case 'ids-all': return rule.ids.every((id) => c.completed[id]);
    case 'ids-any': return rule.ids.some((id) => c.completed[id]);
    default: return false;
  }
}

export function earnedBadgeIds(ctx = badgeContext()) {
  return BADGES.filter((b) => ruleMet(b.rule, ctx)).map((b) => b.id);
}

/** Badges earned since the last check, marked seen so each fires once. */
export function newlyEarnedBadges() {
  const seen = new Set(state.badgesSeen || []);
  const fresh = earnedBadgeIds().filter((id) => !seen.has(id));
  state.badgesSeen = [...seen, ...fresh];
  return fresh.map((id) => BADGES.find((b) => b.id === id)).filter(Boolean);
}

/** Record every already-earned badge WITHOUT celebrating — used once, when a
 *  returning learner's synced progress would otherwise fire a dozen popups. */
export function primeBadgesSeen() {
  if ((state.badgesSeen || []).length) return;
  state.badgesSeen = earnedBadgeIds();
}

export const STOCK_DROP_CHANCE = 0.3;   // per new lesson, as in the app
export const STOCK_XP = 25;

/** 30% chance of an uncollected stock from this track's pool, as in the app. */
export function rollStockBadge(trackId) {
  const owned = new Set(state.stockBadges || []);
  const pool = (TRACK_STOCKS[trackId] || []).filter((s) => !owned.has(s.id));
  if (!pool.length || Math.random() >= STOCK_DROP_CHANCE) return null;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  state.stockBadges = [...(state.stockBadges || []), pick.id];
  return pick;
}

export function xpToday() {
  return (state.dayXp || {})[todayKey()] || 0;
}

/** Weekly XP board — same call the app makes after every XP grant. */
export function submitWeeklyXp(amount, isLesson = false) {
  if (!session || !amount) return;
  supabase.rpc('add_weekly_xp', {
    p_amount: amount, p_day: todayKey(), p_is_lesson: !!isLesson,
  }).then(() => {}, () => {});
}

// ── Derived helpers ─────────────────────────────────────────
export function levelFor(xp) {
  let current = LEVELS[0], next = null;
  for (let i = 0; i < LEVELS.length; i++) {
    if (xp >= LEVELS[i].minXp) { current = LEVELS[i]; next = LEVELS[i + 1] || null; }
  }
  return { current, next };
}

export function trackStats(t) {
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
export function orderedTracks() {
  if (!state.topics || !state.topics.length) return TRACKS;
  const picked = new Set(state.topics);
  return [...TRACKS].sort((a, b) => (picked.has(b.id) ? 1 : 0) - (picked.has(a.id) ? 1 : 0));
}

/** First playable, uncompleted lesson in a track — the app's "current" rule. */
export function nextLessonIn(t) {
  for (const m of t.modules) {
    for (const l of m.lessons) {
      if (l.soon) continue;
      if (!state.completed[l.id]) return { lesson: l, module: m, track: t };
    }
  }
  return null;
}

export function nextLessonOverall() {
  for (const t of orderedTracks()) {
    const n = nextLessonIn(t);
    if (n) return n;
  }
  return null;
}

/** The lesson after `id` in its own track, skipping completed ones. */
export function lessonAfter(id) {
  for (const t of TRACKS) {
    const flat = t.modules.flatMap((m) => m.lessons).filter((l) => !l.soon);
    const i = flat.findIndex((l) => l.id === id);
    if (i === -1) continue;
    return flat.slice(i + 1).find((l) => !state.completed[l.id])?.id ?? null;
  }
  return null;
}

let lessonsLoaded = false;
export async function ensureLessons() {
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

// ── Render / route ──────────────────────────────────────────
export function render(html) {
  shell.innerHTML = html;
  window.scrollTo(0, 0);
}

/** Full-bleed screens (onboarding, lesson player) opt out of the site chrome
 *  so the experience matches the app rather than sitting in a marketing page. */
export function setImmersive(on) {
  document.body.classList.toggle('ba-immersive', !!on);
}

export function go(hash) {
  if (window.location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else window.location.hash = hash;
}

// ── Auth ────────────────────────────────────────────────────
const RETURN_KEY = 'basis.app.return';

export async function oauth(provider) {
  // The route hash deliberately does NOT go into redirectTo: Supabase matches
  // the whole redirect URL against its allowlist, so every lesson route would
  // need allowlisting, and the ?code= it appends sits awkwardly beside an
  // existing fragment. Stash the route here and restore it on the way back —
  // only /app has to be allowlisted.
  try { sessionStorage.setItem(RETURN_KEY, window.location.hash || ''); } catch {}
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: window.location.origin + '/app' },
  });
  if (error) throw error;
}

export function consumeReturnHash() {
  let h = '';
  try {
    h = sessionStorage.getItem(RETURN_KEY) || '';
    sessionStorage.removeItem(RETURN_KEY);
  } catch { /* private mode — they just land on the path screen */ }
  return h;
}

export async function signOut() {
  await supabase.auth.signOut();
  session = null;
  isPremium = false;
}

export function setSession(s) { session = s; }

// ── Theme ───────────────────────────────────────────────────
/** Mirrors useThemeStore in the app: dark by default, toggled in Profile.
 *  theme.css carries the light palette under [data-theme='light']. */
export function applyTheme(mode) {
  const m = mode === 'light' ? 'light' : 'dark';
  state.theme = m;
  save();
  if (m === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
}

/** src/data/avatars.ts — colour-themed discs around the Bax mascot. */
export const AVATARS = [
  { id: 'mascot_violet', label: 'Violet', color: '#7C3AED' },
  { id: 'mascot_indigo', label: 'Indigo', color: '#6366F1' },
  { id: 'mascot_gold', label: 'Gold', color: '#F4B23C' },
  { id: 'mascot_teal', label: 'Teal', color: '#0F766E' },
  { id: 'mascot_coral', label: 'Coral', color: '#DC2626' },
  { id: 'mascot_green', label: 'Green', color: '#059669' },
];

export const avatarColor = (id) =>
  (AVATARS.find((a) => a.id === id) || AVATARS[0]).color;

// ── Small shared UI atoms ───────────────────────────────────
export function mascot(mood = 'happy', size = 96) {
  const src = mood === 'sad' ? '/mascot-sad.png' : '/mascot-happy.png';
  return `<img class="ba-mascot" src="${src}" width="${size}" height="${size}" alt="" />`;
}

export function baxBubble(text, mood = 'happy') {
  return `
    <div class="ba-bax">
      ${mascot(mood, 44)}
      <div class="ba-bubble">${esc(text)}</div>
    </div>`;
}

/** Count a number up into an element. Uses a timeout fallback so a tab that
 *  was backgrounded mid-animation still lands on the real figure. */
export function countUp(el, to, ms = 900, fmt = (v) => Math.round(v).toLocaleString()) {
  if (!el) return;
  if (reduceMotion) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  let done = false;
  const finish = () => { if (!done) { done = true; el.textContent = fmt(to); } };
  const tick = (now) => {
    const p = Math.min(1, (now - t0) / ms);
    el.textContent = fmt(to * (1 - Math.pow(1 - p, 3)));
    if (p < 1 && !done) requestAnimationFrame(tick); else finish();
  };
  requestAnimationFrame(tick);
  setTimeout(finish, ms + 120);
}

export function confetti(host, n = 40) {
  if (reduceMotion || !host) return;
  const colors = ['#6366F1', '#F4B23C', '#22C55E', '#FB923C', '#EC4899', '#14B8A6'];
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    p.className = 'ba-confetti';
    p.style.left = Math.random() * 100 + '%';
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = (Math.random() * 0.5).toFixed(2) + 's';
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    frag.appendChild(p);
  }
  host.appendChild(frag);
  setTimeout(() => host.querySelectorAll('.ba-confetti').forEach((e) => e.remove()), 3200);
}
