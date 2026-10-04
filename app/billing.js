/* ============================================================
   BASIS web app — RevenueCat Web Billing
   ------------------------------------------------------------
   Why this works across app and web with no extra plumbing:
   the iOS app calls Purchases.logIn(supabaseUser.id) (see
   app/_layout.tsx in the app repo), so a user's RevenueCat app
   user ID *is* their Supabase user ID. Configuring the Web SDK
   with the same id puts both surfaces on one RevenueCat customer
   — an App Store subscriber is entitled here immediately, and a
   web subscriber is entitled in the app.

   Dormant without a key, the same convention as Supabase/Sentry/
   PostHog in the app repo: with RC_PUBLIC_KEY empty the paywall
   falls back to "subscribe in the app" and nothing is loaded.

   ── Dashboard checklist ────────────────────────────────────
   1. RevenueCat -> Project -> Apps -> + New -> Web Billing.
      Copy the public API key (starts with `rcb_`) into
      RC_PUBLIC_KEY below.
   2. Attach the SAME entitlement, "Basis Finance Pro", to the
      Web Billing products, or a web purchase won't unlock the
      app.
   3. Offering "default" with $rc_monthly and $rc_annual
      packages, same identifiers the app uses.
   4. Store URL: add basisfinance.app to the allowed domains.
   5. Webhook -> the Supabase edge function in
      supabase/functions/revenuecat-webhook (app repo), so
      profiles.is_premium is written by RevenueCat rather than
      by the client. get_premium_lesson() reads that column.
   ============================================================ */

/** Public Web Billing API key — starts with `rcb_`. Empty = billing off. */
export const RC_PUBLIC_KEY = 'rcb_yvmSdDfdSSoqtQlSsfXSXtyBJIZD';

/** Must match the RevenueCat dashboard exactly (and src/lib/purchases.ts). */
export const ENTITLEMENT_ID = 'Basis Finance Pro';

const SDK_URL = 'https://esm.sh/@revenuecat/purchases-js@1.67.1';

let sdk = null;
let instance = null;
let configuredFor = null;

export function isBillingConfigured() {
  return !!RC_PUBLIC_KEY;
}

async function loadSdk() {
  if (!sdk) sdk = await import(/* @vite-ignore */ SDK_URL);
  return sdk;
}

/**
 * Configure (or re-point) the SDK for a signed-in user. Returns null when
 * billing is off or the SDK can't load, so every caller degrades rather than
 * throwing into the paywall.
 */
export async function initBilling(appUserId) {
  if (!RC_PUBLIC_KEY || !appUserId) return null;
  if (instance && configuredFor === appUserId) return instance;
  try {
    const { Purchases } = await loadSdk();
    if (instance && configuredFor !== appUserId) {
      // The SDK may only be configured once per page; switch users in place.
      await instance.changeUser(appUserId);
    } else {
      instance = Purchases.configure({ apiKey: RC_PUBLIC_KEY, appUserId });
    }
    configuredFor = appUserId;
    return instance;
  } catch (e) {
    console.warn('[basis] RevenueCat init failed', e);
    instance = null;
    return null;
  }
}

/** Monthly + annual packages from the current offering, or null. */
export async function getPackages() {
  if (!instance) return null;
  try {
    const offerings = await instance.getOfferings();
    const current = offerings.current;
    if (!current) return null;
    return {
      monthly: current.monthly ?? null,
      annual: current.annual ?? null,
      all: current.availablePackages ?? [],
    };
  } catch (e) {
    console.warn('[basis] getOfferings failed', e);
    return null;
  }
}

/** Price as the store formats it, e.g. "£7.99". */
export function priceString(pkg) {
  try {
    const p = pkg?.webBillingProduct ?? pkg?.rcBillingProduct ?? pkg?.product;
    return p?.currentPrice?.formattedPrice ?? p?.price?.formattedPrice ?? null;
  } catch { return null; }
}

/** Opens RevenueCat's hosted checkout. Resolves true when entitled. */
export async function purchase(pkg, customerEmail) {
  if (!instance || !pkg) return { ok: false, cancelled: false, error: 'Billing unavailable' };
  try {
    const { customerInfo } = await instance.purchase({
      rcPackage: pkg,
      ...(customerEmail ? { customerEmail } : {}),
    });
    return { ok: ENTITLEMENT_ID in (customerInfo?.entitlements?.active ?? {}), cancelled: false };
  } catch (e) {
    const cancelled = String(e?.errorCode ?? e?.code ?? '').toLowerCase().includes('cancel')
      || /cancel/i.test(String(e?.message ?? ''));
    return { ok: false, cancelled, error: cancelled ? null : (e?.message || 'Purchase failed') };
  }
}

/**
 * Live entitlement check. This is the authority for what the *page* shows;
 * profiles.is_premium (written by the webhook) is the authority for what the
 * *server* hands out in get_premium_lesson. They converge within seconds of a
 * purchase, and this call is what lets the UI unlock immediately.
 */
export async function checkEntitlement() {
  if (!instance) return null;
  try {
    const info = await instance.getCustomerInfo();
    return ENTITLEMENT_ID in (info?.entitlements?.active ?? {});
  } catch {
    return null;
  }
}
