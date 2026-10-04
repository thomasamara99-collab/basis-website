/**
 * Ping IndexNow with the site's URLs so participating search engines recrawl
 * without waiting to rediscover the sitemap.
 *
 *   node scripts/indexnow.mjs                 # everything in sitemap.xml
 *   node scripts/indexnow.mjs /interview /interview/walk-me-through-a-dcf
 *
 * Run it AFTER a deploy, not before: the key file has to be reachable at
 * https://www.basisfinance.app/<key>.txt or the API answers 403.
 *
 * Worth knowing what this does and does not buy. IndexNow is supported by
 * Bing (and therefore Copilot), Yandex, Naver, Seznam and Yep. Google has
 * never adopted it — it has been "evaluating" since 2021 — so this speeds up
 * discovery on those engines and does nothing for Google, where the usual
 * route is the sitemap plus internal links.
 *
 * The key is public by design: it is served from the site root so the engines
 * can check it. It is not a secret and belongs in the repo.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = 'www.basisfinance.app';
const KEY = '19e1c6aab8654d9bbc017543b585e5a9';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const ORIGIN = `https://${HOST}`;

function urlsFromSitemap() {
  const xml = readFileSync(join(ROOT, 'sitemap.xml'), 'utf8');
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

/** Accepts full URLs or site-relative paths. */
function normalise(arg) {
  if (/^https?:\/\//i.test(arg)) return arg;
  return ORIGIN + (arg.startsWith('/') ? arg : '/' + arg);
}

const args = process.argv.slice(2);
const urlList = args.length ? args.map(normalise) : urlsFromSitemap();

const offSite = urlList.filter((u) => !u.startsWith(ORIGIN));
if (offSite.length) {
  // The API rejects the whole batch with a 422 if one URL is off-host, so it's
  // clearer to fail here and name the culprit.
  console.error('✖ not on ' + HOST + ':\n   ' + offSite.join('\n   '));
  process.exit(1);
}

console.log(`Submitting ${urlList.length} URL${urlList.length === 1 ? '' : 's'} for ${HOST}…`);

const res = await fetch('https://api.indexnow.org/IndexNow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList }),
});

const body = await res.text();

const WHY = {
  200: 'accepted',
  202: 'accepted, key validation pending',
  400: 'bad request — malformed JSON or URL list',
  403: `key not valid — check ${KEY_LOCATION} is live and contains exactly the key`,
  422: 'URLs do not belong to the host, or the key does not match',
  429: 'rate limited — too many submissions',
};

console.log(`${res.status} ${res.statusText} — ${WHY[res.status] ?? 'see https://www.indexnow.org/documentation'}`);
if (body.trim()) console.log(body.trim());

if (res.status === 200 || res.status === 202) {
  console.log('\nVerify in Bing Webmaster Tools → IndexNow, which lists what was received.');
}
process.exit(res.status === 200 || res.status === 202 ? 0 : 1);
