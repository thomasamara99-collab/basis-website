/* ============================================================
   Interview drill — the playable half of an interview-prep page
   ------------------------------------------------------------
   Deliberately needs no account and no download: an article that
   answers the question is replaceable, one that then makes you
   answer it is not. Questions come from drill-data.js, generated
   from the app's own free curriculum.
   ============================================================ */
(function () {
  var host = document.getElementById('drill');
  if (!host) return;

  var topic = host.dataset.topic;
  var pool = (window.__BASIS_DRILLS__ || {})[topic];
  if (!pool || !pool.questions.length) { host.remove(); return; }

  var COUNT = Math.min(Number(host.dataset.count || 6), pool.questions.length);
  var APP_STORE = 'https://apps.apple.com/app/basis-learn-finance-markets/id6784982377';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** Fisher-Yates — `sort(() => Math.random() - 0.5)` is not a fair shuffle. */
  function shuffle(a) {
    var out = a.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  }

  /** Options are authored correct-first, so they have to be re-ordered. */
  function withShuffledOptions(q) {
    var correct = q.options[q.correctIndex];
    var opts = shuffle(q.options);
    return {
      prompt: q.prompt, options: opts, correctIndex: opts.indexOf(correct),
      explanation: q.explanation, source: q.source,
    };
  }

  var questions = shuffle(pool.questions).slice(0, COUNT).map(withShuffledOptions);
  var index = 0;
  var selected = null;
  var checked = false;
  var correct = 0;

  function render() {
    if (index >= questions.length) return renderResult();
    var q = questions[index];
    host.innerHTML =
      '<div class="dr-head">' +
        '<span class="dr-count">Question ' + (index + 1) + ' of ' + questions.length + '</span>' +
        '<span class="dr-score">' + correct + ' correct</span>' +
      '</div>' +
      '<div class="dr-bar"><i style="width:' + ((index / questions.length) * 100) + '%"></i></div>' +
      '<p class="dr-prompt">' + esc(q.prompt) + '</p>' +
      '<div class="dr-options">' +
        q.options.map(function (o, i) {
          var cls = 'dr-opt';
          if (checked) {
            if (i === q.correctIndex) cls += ' right';
            else if (i === selected) cls += ' wrong';
          } else if (i === selected) cls += ' sel';
          return '<button class="' + cls + '" data-i="' + i + '"' + (checked ? ' disabled' : '') + '>' +
            '<span class="dr-key">' + 'ABCD'[i] + '</span><span>' + esc(o) + '</span></button>';
        }).join('') +
      '</div>' +
      (checked
        ? '<div class="dr-explain ' + (selected === q.correctIndex ? 'right' : 'wrong') + '">' +
            '<p class="dr-verdict">' + (selected === q.correctIndex ? 'Correct' : 'Not quite') + '</p>' +
            '<p>' + esc(q.explanation) + '</p>' +
            (q.source ? '<p class="dr-source">Covered in the Basis lesson &ldquo;' + esc(q.source) + '&rdquo;</p>' : '') +
          '</div>'
        : '') +
      '<button class="btn btn-primary dr-go"' + (selected === null ? ' disabled' : '') + '>' +
        (checked ? (index === questions.length - 1 ? 'See result' : 'Next question') : 'Check answer') +
      '</button>';

    Array.prototype.forEach.call(host.querySelectorAll('.dr-opt'), function (b) {
      b.addEventListener('click', function () {
        if (checked) return;
        selected = Number(b.dataset.i);
        render();
      });
    });
    host.querySelector('.dr-go').addEventListener('click', function () {
      if (selected === null) return;
      if (!checked) {
        checked = true;
        if (selected === questions[index].correctIndex) correct++;
      } else {
        index++; selected = null; checked = false;
      }
      render();
    });
  }

  function renderResult() {
    var pct = Math.round((correct / questions.length) * 100);
    var verdict = pct === 100 ? 'Interview-ready on this one.'
      : pct >= 70 ? 'Solid — a few gaps to close.'
      : 'Worth drilling properly before the interview.';
    host.innerHTML =
      '<div class="dr-result">' +
        '<p class="dr-result-score">' + correct + '/' + questions.length + '</p>' +
        '<p class="dr-result-verdict">' + verdict + '</p>' +
        '<p class="dr-result-sub">These questions come from the Basis curriculum — ' +
          'the full set runs to 449 across 98 lessons, with the teaching that goes with them.</p>' +
        '<div class="dr-result-actions">' +
          '<button class="btn btn-ghost dr-again">Try another set</button>' +
          '<a class="btn btn-primary" href="/app">Start learning free</a>' +
        '</div>' +
        '<p class="dr-result-app">Prefer your phone? <a href="' + APP_STORE + '">Get the iOS app</a>.</p>' +
      '</div>';
    host.querySelector('.dr-again').addEventListener('click', function () {
      questions = shuffle(pool.questions).slice(0, COUNT).map(withShuffledOptions);
      index = 0; selected = null; checked = false; correct = 0;
      render();
      host.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  render();
})();
