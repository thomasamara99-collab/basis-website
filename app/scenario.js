/* ============================================================
   BASIS web app — the daily scenario
   ------------------------------------------------------------
   A port of app/scenario.tsx. One market scenario a day, the
   same one for everyone (dailyScenario is date-keyed in core),
   worth SCENARIO_XP the first time it's answered that day.

   Answering is what counts, not answering correctly — the app
   awards the XP either way, because the point is the daily habit
   and the explanation you read afterwards.
   ============================================================ */
import {
  state, save, render, go, esc, richBlocks, setImmersive, mascot,
  dailyScenario, scenarioKey, SCENARIO_XP, todayKey,
  touchStreak, addDayXp, submitWeeklyXp, syncNow, newlyEarnedBadges,
} from '/app/core.js';
import { celebrateBadge, runRewards } from '/app/celebrate.js';

export function viewScenario() {
  setImmersive(true);
  const s = dailyScenario();
  if (!s) return go('#/');

  const key = scenarioKey();
  const alreadyDone = !!state.completed[key];
  let selected = null;

  function showQuestion() {
    render(`
      <div class="ba-lp">
        <div class="ba-lp-top">
          <button class="ba-lp-close" id="close" aria-label="Close">✕</button>
          <div class="ba-lp-bar"><div class="ba-lp-fill" style="width:50%"></div></div>
          <span class="ba-lp-count">${alreadyDone ? 'Done' : '+' + SCENARIO_XP}</span>
        </div>
        <div class="ba-q">
          <div class="ba-q-head">
            <span class="ba-q-kicker">Today’s scenario</span>
            <span class="ba-cat">${esc(s.category)}</span>
          </div>
          <h2 class="ba-q-prompt">${esc(s.prompt)}</h2>
          <div class="ba-options">
            ${s.options.map((o, i) => `
              <button class="ba-opt" data-i="${i}">
                <span class="ba-opt-key">${'ABCD'[i]}</span><span>${esc(o)}</span>
              </button>`).join('')}
          </div>
        </div>
        <div class="ba-lp-foot">
          <button class="ba-btn ba-btn-primary" id="check" disabled>Check</button>
        </div>
      </div>`);

    const check = document.getElementById('check');
    document.getElementById('close').addEventListener('click', () => go('#/'));
    document.querySelectorAll('.ba-opt').forEach((b) =>
      b.addEventListener('click', () => {
        selected = Number(b.dataset.i);
        document.querySelectorAll('.ba-opt').forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
        check.disabled = false;
      }));
    check.addEventListener('click', () => { if (selected !== null) showExplanation(); });
  }

  function showExplanation() {
    const right = selected === s.correctIndex;
    render(`
      <div class="ba-lp">
        <div class="ba-ex ${right ? 'right' : 'wrong'}">
          <div class="ba-ex-head">
            ${mascot(right ? 'happy' : 'sad', 104)}
            <h2 class="ba-ex-title">${right ? 'Nice call!' : 'Good to know'}</h2>
          </div>
          <p class="ba-ex-prompt">${esc(s.prompt)}</p>
          ${right ? '' : `
            <div class="ba-ex-answer">
              <span class="ba-ex-answer-label">Correct answer</span>
              <p>${esc(s.options[s.correctIndex])}</p>
            </div>`}
          <div class="ba-ex-body">${richBlocks(s.explanation)}</div>
        </div>
        <div class="ba-lp-foot">
          <button class="ba-btn ${right ? 'ba-btn-go' : 'ba-btn-primary'}" id="done">
            ${alreadyDone ? 'Done' : `Collect +${SCENARIO_XP} XP`}</button>
        </div>
      </div>`);
    document.getElementById('done').addEventListener('click', finish, { once: true });
  }

  async function finish() {
    const rewards = [];
    if (!alreadyDone) {
      state.completed[key] = true;
      state.xp += SCENARIO_XP;
      addDayXp(SCENARIO_XP);
      submitWeeklyXp(SCENARIO_XP);
      touchStreak();
      save();
      syncNow().catch(() => {});
      for (const b of newlyEarnedBadges()) {
        rewards.push(() => celebrateBadge(b));
      }
      save();
    }
    await runRewards(rewards);
    go('#/');
  }

  showQuestion();
}
