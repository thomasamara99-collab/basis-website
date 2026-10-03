/* ============================================================
   BASIS web app — reward screens
   ------------------------------------------------------------
   Ports of src/features/lesson/BadgeCelebration.tsx and
   PromotionScreen.tsx. One at a time, full screen, each waiting
   on a tap — the lesson player chains them in the app's order:

     completion -> badge -> stock -> promotion

   so a big run doesn't bury three rewards behind one another.
   ============================================================ */
import { render, esc, mascot, confetti, setImmersive } from '/app/core.js';
import { icon } from '/app/icons.js';

/**
 * Badge / stock celebration. Resolves when the learner taps through, so the
 * caller can simply `await` each reward in turn.
 */
export function celebrateBadge(badge, { label = 'Badge unlocked', xpBonus } = {}) {
  setImmersive(true);
  return new Promise((resolve) => {
    render(`
      <div class="ba-celebrate" id="celebrateHost" style="--bc:${esc(badge.color)}">
        <p class="ba-celebrate-eyebrow">${esc(label)}</p>
        <div class="ba-celebrate-disc">${icon(badge.icon, 56, badge.color)}</div>
        <h1 class="ba-celebrate-title">${esc(badge.title)}</h1>
        <p class="ba-celebrate-desc">${esc(badge.description)}</p>
        ${xpBonus != null ? `<p class="ba-celebrate-xp">+${xpBonus} XP</p>` : ''}
        <button class="ba-btn ba-celebrate-btn" id="celebrateGo">Awesome!</button>
      </div>`);
    confetti(document.getElementById('celebrateHost'), 36);
    document.getElementById('celebrateGo').addEventListener('click', () => resolve(), { once: true });
  });
}

/** Promotion to the next career level. */
export function celebratePromotion({ from, to, correct, total, xpGained, streak }) {
  setImmersive(true);
  return new Promise((resolve) => {
    render(`
      <div class="ba-promo-screen" id="promoHost">
        <p class="ba-celebrate-eyebrow">Promotion unlocked</p>
        <div class="ba-promo-mascot">${mascot('happy', 118)}</div>
        <p class="ba-promo-label">You’ve been promoted to</p>
        <h1 class="ba-promo-title">${esc(to.title)}</h1>
        <p class="ba-promo-from">
          <span>${esc(from.title)}</span> → <strong>${esc(to.title)}</strong>
        </p>
        ${to.blurb ? `<p class="ba-promo-blurb">${esc(to.blurb)}</p>` : ''}
        <div class="ba-done-stats">
          <div class="ba-stat"><span class="ba-stat-v">${correct}/${total}</span><span class="ba-stat-l">Score</span></div>
          <div class="ba-stat"><span class="ba-stat-v accent">+${xpGained}</span><span class="ba-stat-l">XP earned</span></div>
          <div class="ba-stat"><span class="ba-stat-v">${streak}</span><span class="ba-stat-l">Day streak</span></div>
        </div>
        <button class="ba-btn ba-btn-primary" id="promoGo">Continue</button>
        <button class="ba-btn ba-btn-ghost" id="promoShare">Share your promotion</button>
      </div>`);
    confetti(document.getElementById('promoHost'), 48);
    document.getElementById('promoGo').addEventListener('click', () => resolve(), { once: true });

    const share = document.getElementById('promoShare');
    share.addEventListener('click', async () => {
      const text = `I just got promoted to ${to.title} on Basis! `
        + `${to.blurb || ''} Master finance, one concept at a time. 🎓`;
      const url = 'https://www.basisfinance.app/app';
      try {
        if (navigator.share) { await navigator.share({ text, url }); return; }
        await navigator.clipboard.writeText(text + ' ' + url);
        share.textContent = 'Copied ✓';
      } catch { /* dismissed, or no clipboard permission — nothing to recover */ }
    });
  });
}

/** Runs a queue of reward screens in order, then resolves. */
export async function runRewards(rewards) {
  for (const r of rewards) await r();
}
