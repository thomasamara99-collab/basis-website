/* ============================================================
   BASIS web app — paywall
   ------------------------------------------------------------
   Shown instead of a Career Accelerator lesson. Two modes:

   • Web Billing configured  -> real checkout, right here, via
     RevenueCat. The purchase lands on the same RevenueCat
     customer as the iOS app (same Supabase user id), so it
     unlocks both surfaces.
   • Not configured yet      -> honest fallback: subscribe in the
     app, then sign in here.

   The perk list is read from the shipped curriculum index rather
   than written by hand, so it can never promise a lesson that
   doesn't exist.
   ============================================================ */
import {
  render, go, esc, setImmersive, APP_STORE, TRACKS, session, setPremium,
  oauth, syncNow, pushPremium,
} from '/app/core.js';
import {
  isBillingConfigured, initBilling, getPackages, priceString, purchase,
  checkEntitlement,
} from '/app/billing.js';

function premiumModules() {
  const out = [];
  for (const t of TRACKS) for (const m of t.modules) if (m.premium) out.push(m);
  return out;
}

const premiumLessonCount = () =>
  premiumModules().reduce((n, m) => n + m.lessons.length, 0);

export async function viewPaywall(L, failure) {
  setImmersive(false);
  let plan = 'annual';
  let pkgs = null;
  let busy = false;

  // A subscriber may have bought on iOS seconds ago — ask RevenueCat directly
  // rather than trusting the profiles row we synced at page load.
  if (session && isBillingConfigured()) {
    await initBilling(session.user.id);
    const entitled = await checkEntitlement();
    if (entitled) {
      setPremium(true);
      await pushPremium(true);        // the server gate reads profiles.is_premium
      return go('#/lesson/' + L.id);  // re-enter, now unlocked
    }
    pkgs = await getPackages();
  }

  const canBuy = !!(pkgs && (pkgs.monthly || pkgs.annual));
  const monthlyStr = (pkgs && priceString(pkgs.monthly)) || '£7.99';
  const annualStr = (pkgs && priceString(pkgs.annual)) || '£49.99';

  function paint() {
    render(`
      <a class="ba-back" href="#/track/${esc(L.trackId)}">← ${esc(L.trackTitle)}</a>
      <div class="ba-card ba-paywall">
        <p class="ba-eyebrow gold">Career Accelerator</p>
        <h1 class="ba-h1">${esc(L.title)}</h1>
        <p class="ba-sub">${esc(L.intro)}</p>

        ${premiumModules().map((m) => `
          <p class="ba-perk-head">${esc(m.title)}</p>
          <ul class="ba-perks">${m.lessons.map((l) =>
            `<li>${esc(l.title)}</li>`).join('')}</ul>`).join('')}
        <p class="ba-pro-count">${premiumLessonCount()} Career Accelerator lessons
          · one subscription, app and web</p>

        <div class="ba-prices${canBuy ? ' pick' : ''}">
          <button class="ba-price ${plan === 'monthly' ? 'best' : ''}" data-plan="monthly"
                  ${canBuy ? '' : 'disabled'}>
            <span>Monthly</span><strong>${esc(monthlyStr)}</strong><em>per month</em>
          </button>
          <button class="ba-price ${plan === 'annual' ? 'best' : ''}" data-plan="annual"
                  ${canBuy ? '' : 'disabled'}>
            <span>Annual</span><strong>${esc(annualStr)}</strong><em>best value · save ~48%</em>
          </button>
        </div>

        <p class="ba-paywall-err" id="perr" ${failure ? '' : 'hidden'}>${failure ? esc(failure) : ''}</p>

        ${renderCta()}
      </div>`);

    document.querySelectorAll('[data-plan]').forEach((b) =>
      b.addEventListener('click', () => { plan = b.dataset.plan; paint(); }));
    bindCta();
  }

  function renderCta() {
    if (!session) {
      return `
        <div class="ba-savebox">
          <p class="ba-savebox-title">Sign in to continue</p>
          <p class="ba-sub">Your subscription is tied to your account — sign in and
            it unlocks here and in the app.</p>
          <button class="ba-btn ba-btn-oauth" data-p="google">Continue with Google</button>
          <button class="ba-btn ba-btn-oauth" data-p="apple">Continue with Apple</button>
        </div>`;
    }
    if (canBuy) {
      return `
        <button class="ba-btn ba-btn-gold" id="buy">Unlock the Career Accelerator</button>
        <p class="ba-fineprint">Recurring subscription, cancel any time from your profile.
          Payment is taken by RevenueCat; prices are shown in your local currency where
          available. Already subscribed on iPhone? It unlocks here automatically.</p>`;
    }
    return `
      <a class="ba-btn ba-btn-gold" href="${APP_STORE}">Subscribe in the app</a>
      <p class="ba-fineprint">Billed through your Apple ID; cancel anytime in Settings.
        Prices shown in GBP — your App Store charges in your own currency.
        Web checkout is coming; for now subscribe in the app and your Pro lessons
        unlock here on the same account.</p>
      <p class="ba-fineprint">Signed in as ${esc(session.user.email || 'your account')}
        — no active subscription found.</p>`;
  }

  function bindCta() {
    document.querySelectorAll('[data-p]').forEach((b) =>
      b.addEventListener('click', () => oauth(b.dataset.p).catch(() => {})));

    const buy = document.getElementById('buy');
    if (!buy) return;
    buy.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      buy.disabled = true;
      buy.textContent = 'Opening checkout…';
      const pkg = plan === 'annual' ? pkgs.annual : pkgs.monthly;
      const res = await purchase(pkg, session.user.email);
      busy = false;
      if (res.ok) {
        setPremium(true);
        // get_premium_lesson() gates on profiles.is_premium, so that column has
        // to be true before we re-enter the lesson or the unlock bounces right
        // back here. Write it, then re-read so page and server agree.
        await pushPremium(true);
        await syncNow().catch(() => {});
        return go('#/lesson/' + L.id);
      }
      buy.disabled = false;
      buy.textContent = 'Unlock the Career Accelerator';
      if (!res.cancelled) {
        const err = document.getElementById('perr');
        if (err) { err.hidden = false; err.textContent = res.error || 'Purchase failed.'; }
      }
    });
  }

  paint();
}
