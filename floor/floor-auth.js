/* ============================================================
   THE FLOOR (web) — save your session to a Basis account
   ------------------------------------------------------------
   Anonymous play needs no account; that's the point of the page.
   But a finished session is the moment someone actually has
   something to lose, so that's where we offer the account.

   Results go through the SAME server-verified RPC the app uses
   (submit_floor_day): the client submits raw decisions — scenario
   id, the exact option text chosen, stake % — and Postgres
   recomputes the P&L against an md5 answer key. A browser can't
   inflate a result, which is why signed-in web play can safely
   share one leaderboard with the app.

   Loaded as a module and fully optional: if this file fails, the
   game above it still plays and shares normally.
   ============================================================ */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Anon key — public by design, every request is still gated by RLS.
const SUPABASE_URL = 'https://qggmevyefongdmimwpzj.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFnZ21ldnllZm9uZ2RtaW13cHpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3MjM3NDUsImV4cCI6MjA5NzI5OTc0NX0.8ZkEHoa5DxaDrMERfbKZkdHJSMx4Y1nlLz3hULuykB8';

const STORE_KEY = 'basis-floor-web';
const REDIRECT_TO = window.location.origin + '/floor';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { detectSessionInUrl: true, persistSession: true, flowType: 'pkce' },
});

const $ = (id) => document.getElementById(id);

function readState() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
  } catch {
    return null;
  }
}

function writeState(s) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch { /* private mode — the save still lands server-side */ }
}

/** A session can only be submitted if it carries what the RPC verifies.
 *  Sessions played before this shipped won't have id/choice — those get the
 *  account pitch without a false promise that today's result will save. */
function submittable(state) {
  return !!state
    && state.done
    && Array.isArray(state.decisions)
    && state.decisions.length > 0
    && state.decisions.every((d) => d.id && d.choice && d.stakePct);
}

function money(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

// ── Rendering ───────────────────────────────────────────────
function box(inner, cls) {
  const el = $('fl-save');
  if (!el) return;
  el.innerHTML = '<div class="fl-save-box' + (cls ? ' ' + cls : '') + '">' + inner + '</div>';
}

function renderSignedOut(state) {
  const legacy = !submittable(state);
  box(
    '<p class="fl-save-title">Keep this result</p>' +
    '<p class="fl-save-sub">' +
      (legacy
        ? 'Create a free account to save future sessions, your streak and your place on the leaderboard.'
        : 'Save today\'s session to a free Basis account — your book, your streak and your place on the worldwide leaderboard carry over to the app.') +
    '</p>' +
    '<div class="fl-save-actions">' +
      '<button class="fl-btn fl-btn-oauth" id="fl-google">Continue with Google</button>' +
      '<button class="fl-btn fl-btn-oauth" id="fl-apple">Continue with Apple</button>' +
    '</div>' +
    '<p class="fl-save-status" id="fl-save-status"></p>',
  );

  $('fl-google').addEventListener('click', () => oauth('google'));
  $('fl-apple').addEventListener('click', () => oauth('apple'));
}

function status(msg, kind) {
  const el = $('fl-save-status');
  if (el) {
    el.textContent = msg;
    el.className = 'fl-save-status' + (kind ? ' ' + kind : '');
  }
}

function renderSaved(book, weekPnl, handle) {
  box(
    '<p class="fl-save-title saved">✓ Saved to your account</p>' +
    '<p class="fl-save-sub">Your book is now <strong>' + money(book) + '</strong>' +
      (typeof weekPnl === 'number'
        ? ' · this week ' + (weekPnl >= 0 ? '+' : '−') + Math.abs(weekPnl).toFixed(1) + '%'
        : '') +
      (handle ? ' · ' + handle : '') +
    '</p>' +
    '<p class="fl-save-sub">Open Basis on your phone with the same account and it\'s all there — ' +
      'plus streaks, reminders and the full curriculum.</p>',
    'saved',
  );
}

function renderAlreadyPlayed() {
  box(
    '<p class="fl-save-title saved">✓ Already logged today</p>' +
    '<p class="fl-save-sub">This account has already submitted today\'s session — ' +
      'one session per day, same as in the app. Come back tomorrow.</p>',
    'saved',
  );
}

function renderSignedInUnsaved(state) {
  box(
    '<p class="fl-save-title">Save this result</p>' +
    '<p class="fl-save-sub">You\'re signed in. Save today\'s session to your account.</p>' +
    '<button class="fl-btn fl-btn-primary" id="fl-save-now">Save my session</button>' +
    '<p class="fl-save-status" id="fl-save-status"></p>',
  );
  $('fl-save-now').addEventListener('click', () => submit(state));
}

// ── Auth ────────────────────────────────────────────────────
async function oauth(provider) {
  status('Redirecting…');
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: REDIRECT_TO },
  });
  if (error) status(error.message, 'err');
}

// ── Submission ──────────────────────────────────────────────
async function submit(state) {
  if (!submittable(state)) return;
  status('Saving…');

  const payload = state.decisions.map((d) => ({
    id: d.id,
    choice: d.choice,
    stake: d.stakePct,
  }));

  const { data, error } = await supabase.rpc('submit_floor_day', {
    p_day: state.day,
    p_decisions: payload,
  });

  if (error) {
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('already submitted')) {
      state.saved = true;
      writeState(state);
      return renderAlreadyPlayed();
    }
    // Anything else is worth showing honestly rather than pretending it saved.
    return status(
      'Could not save: ' + (error.message || 'unknown error') + '. Try again?',
      'err',
    );
  }

  state.saved = true;
  writeState(state);

  // The server replays your calls against YOUR book, which may differ from
  // the $100k demo book this page plays with — so show the server's numbers,
  // not ours.
  renderSaved(data?.book ?? 0, data?.week_pnl, null);
}

// ── Wiring ──────────────────────────────────────────────────
async function refresh() {
  if (!$('fl-save')) return;

  const state = readState();
  if (!state || !state.done) return;

  const { data: { session } } = await supabase.auth.getSession();

  if (!session) return renderSignedOut(state);
  if (state.saved) return renderAlreadyPlayed();
  if (!submittable(state)) {
    return box(
      '<p class="fl-save-title saved">✓ Signed in</p>' +
      '<p class="fl-save-sub">Future sessions will save to your account automatically.</p>',
      'saved',
    );
  }
  // Signed in with an unsaved, submittable session — that's the case after an
  // OAuth round-trip, so save it without making them click twice.
  await submit(state);
}

document.addEventListener('floor:result', refresh);
supabase.auth.onAuthStateChange(() => refresh());
refresh();
