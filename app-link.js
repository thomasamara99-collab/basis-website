/* ============================================================
   App Store campaign tagging
   ------------------------------------------------------------
   Appends Apple's campaign parameters to every App Store link on
   the page, deriving the campaign token from the page's own path,
   so installs can be attributed to the article that produced them.

   Doing it here rather than in the markup means PROVIDER_TOKEN is
   one constant instead of a find-and-replace across 40 static
   files every time it changes.

   TO FINISH: set PROVIDER_TOKEN to the provider id from
   App Store Connect -> Analytics -> Campaign Links (sometimes
   called the "provider token" or pt value). Apple needs both pt
   and ct to attribute an install; until pt is set this adds ct
   only, which is harmless but is not yet tracked.
   ============================================================ */
(function () {
  var PROVIDER_TOKEN = '';

  /** /learn/what-is-beta -> web_learn_what-is-beta */
  function campaign() {
    var p = window.location.pathname.replace(/\.html$/, '').replace(/^\/|\/$/g, '');
    return 'web_' + (p ? p.replace(/\//g, '_') : 'home');
  }

  var ct = campaign();

  Array.prototype.forEach.call(
    document.querySelectorAll('a[href*="apps.apple.com"]'),
    function (a) {
      var href = a.getAttribute('href');
      if (!href || href.indexOf('ct=') !== -1) return;
      var url;
      try { url = new URL(href, window.location.origin); } catch (e) { return; }
      if (PROVIDER_TOKEN) url.searchParams.set('pt', PROVIDER_TOKEN);
      url.searchParams.set('ct', ct);
      url.searchParams.set('mt', '8');
      a.setAttribute('href', url.toString());
    }
  );
})();
