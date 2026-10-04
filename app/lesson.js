/* ============================================================
   BASIS web app — lesson player
   ------------------------------------------------------------
   A web port of app/lesson/[id].tsx + LessonCards.tsx. Same
   shape of experience, in the same order:

     teaching cards  ->  quiz  ->  explanation  ->  completion

   The teaching cards come first and carry the whole lesson,
   because the app's content rule is that the material must cover
   everything the quiz tests (see CLAUDE.md). The quiz is one
   question at a time on a 30s timer, each answer gets its own
   full-screen explanation with Bax, and the lesson ends on a
   celebration that actually counts something up.
   ============================================================ */
import {
  state, save, render, go, esc, rich, richBlocks, setImmersive, ensureLessons,
  supabase, session, isPremium, mascot, countUp, confetti,
  touchStreak, addDayXp, submitWeeklyXp, levelFor, lessonAfter, syncNow,
  XP_PER_CORRECT, QUESTION_TIME, scheduleReview, newlyEarnedBadges,
  rollStockBadge, STOCK_XP,
} from '/app/core.js';
import { diagram } from '/app/diagrams.js';
import { viewPaywall } from '/app/paywall.js';
import { celebrateBadge, celebratePromotion, runRewards } from '/app/celebrate.js';

// The illustration bundle is ~167 KB of SVG; the path and profile screens
// never draw one, so it's fetched when a lesson actually opens.
let art = { lessonArt: () => '', sectionArt: () => '' };
async function ensureArt() {
  if (art.loaded) return;
  try {
    const m = await import('/app/illustrations.js');
    art = { lessonArt: m.lessonArt, sectionArt: m.sectionArt, loaded: true };
  } catch { art.loaded = true; }   // lesson still reads fine without pictures
}

let timerId = null;
function clearTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

export async function viewLesson(id, recap = false) {
  clearTimer();
  setImmersive(true);
  render('<div class="ba-loading">Loading lesson…</div>');

  try {
    await Promise.all([ensureLessons(), ensureArt()]);
  } catch {
    return render(`<div class="ba-card"><p class="ba-sub">Couldn’t load the lesson.
      Check your connection and try again.</p></div>`);
  }

  let L = (window.__BASIS_LESSONS__ || {})[id];
  if (!L) return go('#/');

  // Premium bodies aren't in the public bundle — fetch them, gated.
  if (L.locked) {
    if (!session || !isPremium) return viewPaywall(L);
    render('<div class="ba-loading">Unlocking lesson…</div>');
    const { data, error } = await supabase.rpc('get_premium_lesson', { p_id: id });
    if (error || !data) return viewPaywall(L, error ? error.message : null);
    L = data;
  }

  play(L, recap);
}

function play(L, recap) {
  const sections = L.sections || [];
  const questions = L.questions || [];
  const total = questions.length;

  let card = 0;             // index into [lead, ...sections]
  let qi = 0;
  let selected = null;
  let correctCount = 0;
  let timedOut = false;
  let timeLeft = QUESTION_TIME;

  const cards = recap && total
    ? []
    : [{ kind: 'lead', body: L.intro }, ...sections.map((s) => ({ kind: 'section', ...s }))];

  // One progress scale for the whole lesson — teaching cards and questions are
  // steps in the same bar, so it never jumps when the quiz starts.
  const STEPS = cards.length + total;

  // ── Chrome ───────────────────────────────────────────────
  function frame(inner, step) {
    const n = Math.min(step + 1, STEPS);
    render(`
      <div class="ba-lp" style="--tc:${esc(L.color)}">
        <div class="ba-lp-top">
          <button class="ba-lp-close" id="ba-close" aria-label="Close lesson">✕</button>
          <div class="ba-lp-bar"><div class="ba-lp-fill" style="width:${(n / STEPS) * 100}%"></div></div>
          <span class="ba-lp-count">${n}/${STEPS}</span>
        </div>${inner}</div>`);
    const c = document.getElementById('ba-close');
    if (c) c.addEventListener('click', () => { clearTimer(); go('#/track/' + L.trackId); });
  }

  // ── Phase 1: teaching cards ──────────────────────────────
  function cardHtml(c, i) {
    if (c.kind === 'lead') {
      return `
        <article class="ba-tc lead"><div class="ba-tc-inner">
          <p class="ba-tc-eyebrow">${esc(L.trackTitle)}</p>
          <h1 class="ba-tc-title">${esc(L.title)}</h1>
          ${art.lessonArt(L.id)}
          <div class="ba-tc-lead">${richBlocks(c.body)}</div>
        </div></article>`;
    }
    return `
      <article class="ba-tc"><div class="ba-tc-inner">
        ${c.heading ? `<h2 class="ba-tc-heading">${esc(c.heading)}</h2>` : ''}
        ${c.visual ? diagram(c.visual, L.color) : art.sectionArt(L.id, i - 1)}
        <div class="ba-tc-body">${richBlocks(c.body)}</div>
        ${c.formula ? `<div class="ba-formula">${esc(c.formula)}</div>` : ''}
        ${c.bullets && c.bullets.length
          ? `<ul class="ba-bullets">${c.bullets.map((b, bi) =>
              `<li style="animation-delay:${180 + bi * 70}ms">${rich(b)}</li>`).join('')}</ul>`
          : ''}
      </div></article>`;
  }

  function showCards() {
    frame(`
      <div class="ba-tc-stage">
        <div class="ba-tc-track" id="tcTrack">${cards.map(cardHtml).join('')}</div>
      </div>
      <div class="ba-tc-foot">
        <div class="ba-tc-dots">${cards.map((_, i) =>
          `<span class="ba-tc-dot ${i === card ? 'on' : ''}" data-i="${i}"></span>`).join('')}</div>
        <div class="ba-tc-nav">
          <button class="ba-tc-prev" id="prev" aria-label="Previous card" ${card === 0 ? 'disabled' : ''}>←</button>
          <button class="ba-btn ba-btn-primary" id="next">${
            card === cards.length - 1
              ? (total ? 'Start questions' : 'Finish lesson')
              : 'Continue'}</button>
        </div>
      </div>`, card);

    position();
    document.getElementById('next').addEventListener('click', () => {
      if (card < cards.length - 1) { card++; showCards(); }
      else if (total) startQuiz();
      else finish();
    });
    document.getElementById('prev').addEventListener('click', () => {
      if (card > 0) { card--; showCards(); }
    });
    document.querySelectorAll('.ba-tc-dot').forEach((d) =>
      d.addEventListener('click', () => { card = Number(d.dataset.i); showCards(); }));

    bindSwipe(document.querySelector('.ba-tc-stage'), (dir) => {
      if (dir < 0 && card < cards.length - 1) { card++; showCards(); }
      if (dir > 0 && card > 0) { card--; showCards(); }
    });
  }

  function position() {
    const t = document.getElementById('tcTrack');
    if (t) t.style.transform = `translate3d(${-card * 100}%,0,0)`;
  }

  /** Horizontal drag/swipe, so the cards behave like the app's pager. */
  function bindSwipe(el, onSwipe) {
    if (!el) return;
    let x0 = null, y0 = null;
    el.addEventListener('touchstart', (e) => {
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    }, { passive: true });
    el.addEventListener('touchend', (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      const dy = e.changedTouches[0].clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) onSwipe(dx);
    }, { passive: true });
  }

  // ── Phase 2: quiz ────────────────────────────────────────
  function startQuiz() { qi = 0; selected = null; showQuestion(); }

  function showQuestion() {
    const q = questions[qi];
    timedOut = false;
    timeLeft = QUESTION_TIME;

    frame(`
      <div class="ba-q">
        <div class="ba-q-head">
          <span class="ba-q-kicker">Question ${qi + 1} of ${total}</span>
          <span class="ba-timer" id="timer"><span class="ba-timer-num" id="tnum">${QUESTION_TIME}</span></span>
        </div>
        <h2 class="ba-q-prompt">${rich(q.prompt)}</h2>
        <div class="ba-options">
          ${q.options.map((o, i) => `
            <button class="ba-opt" data-i="${i}">
              <span class="ba-opt-key">${'ABCD'[i]}</span><span>${esc(o)}</span>
            </button>`).join('')}
        </div>
      </div>
      <div class="ba-lp-foot">
        <button class="ba-btn ba-btn-primary" id="check" disabled>Check</button>
      </div>`, cards.length + qi);

    const checkBtn = document.getElementById('check');
    document.querySelectorAll('.ba-opt').forEach((b) =>
      b.addEventListener('click', () => {
        selected = Number(b.dataset.i);
        document.querySelectorAll('.ba-opt').forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
        checkBtn.disabled = false;
      }));
    checkBtn.addEventListener('click', () => check());

    startTimer();
  }

  function startTimer() {
    clearTimer();
    const num = document.getElementById('tnum');
    const ring = document.getElementById('timer');
    timerId = setInterval(() => {
      timeLeft--;
      if (num) num.textContent = Math.max(0, timeLeft);
      if (ring) {
        ring.style.setProperty('--p', String(timeLeft / QUESTION_TIME));
        ring.classList.toggle('low', timeLeft <= 5);
      }
      if (timeLeft <= 0) { clearTimer(); timedOut = true; check(true); }
    }, 1000);
  }

  function check(fromTimeout = false) {
    clearTimer();
    if (selected === null && !fromTimeout) return;
    const q = questions[qi];
    // Running out of time is wrong even if the right option happened to be
    // highlighted — nothing was submitted. (The app shows "Correct!" here but
    // still doesn't count it, which reads as a bug; this is the honest version.)
    const right = !fromTimeout && selected === q.correctIndex;
    if (right) correctCount++;
    showExplanation(q, right);
  }

  // ── Phase 3: explanation ─────────────────────────────────
  function showExplanation(q, right) {
    const title = right ? 'Correct!' : timedOut ? 'Time’s up!' : 'Not quite';
    const last = qi === total - 1;
    frame(`
      <div class="ba-ex ${right ? 'right' : 'wrong'}">
        <div class="ba-ex-head">
          ${mascot(right ? 'happy' : 'sad', 104)}
          <h2 class="ba-ex-title">${title}</h2>
        </div>
        ${right ? '' : `
          <div class="ba-ex-answer">
            <span class="ba-ex-answer-label">Correct answer</span>
            <p>${esc(q.options[q.correctIndex])}</p>
          </div>`}
        <div class="ba-ex-body">${richBlocks(q.explanation)}</div>
      </div>
      <div class="ba-lp-foot">
        <button class="ba-btn ${right ? 'ba-btn-go' : 'ba-btn-primary'}" id="cont">${
          last ? 'See results' : 'Continue'}</button>
      </div>`, cards.length + qi);

    document.getElementById('cont').addEventListener('click', () => {
      if (last) finish();
      else { qi++; selected = null; showQuestion(); }
    });
  }

  // ── Phase 4: completion ──────────────────────────────────
  function finish() {
    clearTimer();
    const isNew = !state.completed[L.id];
    const accuracy = total ? Math.round((correctCount / total) * 100) : 100;
    const xpGained = isNew ? correctCount * XP_PER_CORRECT : 0;

    const xpBefore = state.xp;
    const levelBefore = levelFor(xpBefore).current;

    state.completed[L.id] = true;
    state.scores[L.id] = Math.max(state.scores[L.id] || 0, accuracy);
    if (xpGained) {
      state.xp += xpGained;
      addDayXp(xpGained);
      submitWeeklyXp(xpGained, true);
    }
    const streakBefore = state.streak;
    touchStreak();
    // Spaced repetition: >=80% pushes the next review out, below that resets
    // it to tomorrow. Runs on replays too, which is the point of a recap.
    scheduleReview(L.id, correctCount, total);
    save();
    syncNow().catch(() => {});

    const levelAfter = levelFor(state.xp).current;
    const levelUp = isNew && levelAfter.id !== levelBefore.id ? levelAfter : null;
    const streakUp = state.streak > streakBefore;
    const lp = levelFor(state.xp);
    const pct = lp.next
      ? Math.min(100, ((state.xp - lp.current.minXp) / (lp.next.minXp - lp.current.minXp)) * 100)
      : 100;
    const nextId = lessonAfter(L.id);

    // Rewards are queued, not stacked: the app shows the completion screen
    // first, then badge, then stock, then promotion, each on its own screen.
    const rewards = [];
    for (const b of newlyEarnedBadges()) rewards.push(() => celebrateBadge(b));
    if (isNew) {
      const stock = rollStockBadge(L.trackId);
      if (stock) {
        state.xp += STOCK_XP;
        addDayXp(STOCK_XP);
        submitWeeklyXp(STOCK_XP);
        rewards.push(() => celebrateBadge(stock, { label: 'Stock collected', xpBonus: STOCK_XP }));
      }
    }
    if (levelUp) {
      rewards.push(() => celebratePromotion({
        from: levelBefore, to: levelAfter,
        correct: correctCount, total, xpGained, streak: state.streak,
      }));
    }
    if (rewards.length) { save(); syncNow().catch(() => {}); }

    render(`
      <div class="ba-lp done" style="--tc:${esc(L.color)}">
        <div class="ba-done" id="doneHost">
          ${mascot('happy', 128)}
          <h1 class="ba-done-title">${
            accuracy === 100 ? 'Perfect round.' : isNew ? 'Lesson complete.' : 'Reviewed.'}</h1>
          <p class="ba-done-sub">${esc(L.title)}</p>

          ${streakUp ? `<div class="ba-done-streak">🔥 ${state.streak}-day streak</div>` : ''}

          <div class="ba-done-stats">
            <div class="ba-stat"><span class="ba-stat-v">${correctCount}/${total}</span><span class="ba-stat-l">Score</span></div>
            <div class="ba-stat"><span class="ba-stat-v ${accuracy === 100 ? 'good' : ''}">${accuracy}%</span><span class="ba-stat-l">Accuracy</span></div>
            <div class="ba-stat"><span class="ba-stat-v accent" id="xpv">0</span><span class="ba-stat-l">${isNew ? 'XP earned' : 'XP (earned)'}</span></div>
          </div>

          ${levelUp ? `<div class="ba-promo">
              <span class="ba-promo-k">Promoted</span>
              <strong>${esc(levelUp.title)}</strong>
            </div>` : ''}

          <div class="ba-done-level">
            <div class="ba-bar"><div class="ba-bar-fill" style="width:${pct}%"></div></div>
            <p class="ba-done-levelt">${lp.next
              ? `${(lp.next.minXp - state.xp).toLocaleString()} XP to ${esc(lp.next.title)}`
              : esc(lp.current.title)}</p>
          </div>

          <div class="ba-lp-foot inline">
            ${nextId ? `<button class="ba-btn ba-btn-primary" id="nextl">Next lesson →</button>` : ''}
            <button class="ba-btn ${nextId ? 'ba-btn-ghost' : 'ba-btn-primary'}" id="back">Back to path</button>
          </div>
        </div>
      </div>`);

    countUp(document.getElementById('xpv'), xpGained, 900, (v) => '+' + Math.round(v));
    if (accuracy === 100 || levelUp) confetti(document.getElementById('doneHost'), 48);

    const after = (dest) => async () => { await runRewards(rewards); go(dest); };
    const nb = document.getElementById('nextl');
    if (nb) nb.addEventListener('click', after('#/lesson/' + nextId));
    document.getElementById('back').addEventListener('click', after('#/track/' + L.trackId));
  }

  // Keyboard: arrows page the cards, 1-4 pick an answer, Enter confirms.
  document.onkeydown = (e) => {
    if (!document.querySelector('.ba-lp')) { document.onkeydown = null; return; }
    if (document.querySelector('.ba-tc-stage')) {
      if (e.key === 'ArrowRight') document.getElementById('next')?.click();
      if (e.key === 'ArrowLeft') document.getElementById('prev')?.click();
      return;
    }
    const opts = [...document.querySelectorAll('.ba-opt')];
    if (opts.length && /^[1-4]$/.test(e.key)) opts[Number(e.key) - 1]?.click();
    if (e.key === 'Enter') {
      const b = document.getElementById('check') || document.getElementById('cont');
      if (b && !b.disabled) b.click();
    }
  };

  if (cards.length) showCards();
  else startQuiz();
}
