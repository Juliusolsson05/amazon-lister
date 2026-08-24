/**
 * The in-page panel. Renders into a closed-off shadow root so Amazon's
 * stylesheet can't reach in and ours can't leak out.
 *
 * Design note: the whole panel is set in the system monospace face, not just
 * the JSON well — a tool whose output is JSON should read like its output.
 * The only saturated colour in the panel is the payload meter, because that
 * colour encodes something real (how comfortably this pastes into a chat).
 */
(function () {
  'use strict';

  var HOST_ID = 'amazon-lister-root';
  // Rough industry heuristic: ~4 characters per token. Good enough to steer a decision.
  var CHARS_PER_TOKEN = 4;
  // A "comfortable paste" ceiling. The meter fills against this.
  var TOKEN_BUDGET = 8000;

  var CSS = [
    ':host{all:initial}',
    '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}',

    '.scrim{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;',
    'padding:24px;background:rgba(18,20,26,.55);backdrop-filter:blur(3px);',
    'font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;',
    'animation:fade .16s ease-out}',

    '.panel{--ink:#12141a;--paper:#f4f2ed;--rule:#d9d5cc;--muted:#6b6862;',
    '--ok:#2f7d5c;--warn:#a86a10;--over:#a3341f;',
    'width:min(720px,100%);max-height:min(760px,100%);display:flex;flex-direction:column;',
    'background:var(--paper);color:var(--ink);border-radius:10px;',
    'box-shadow:0 24px 64px -12px rgba(18,20,26,.5),0 0 0 1px rgba(18,20,26,.12);',
    'overflow:hidden;animation:rise .2s cubic-bezier(.2,.8,.3,1)}',

    '@keyframes fade{from{opacity:0}to{opacity:1}}',
    '@keyframes rise{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:none}}',
    '@media (prefers-reduced-motion:reduce){.scrim,.panel{animation:none}}',

    /* header */
    '.head{display:flex;align-items:baseline;gap:12px;padding:14px 16px 10px}',
    '.mark{font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}',
    '.tally{font-size:11px;color:var(--muted);letter-spacing:.04em}',
    '.spacer{flex:1}',
    '.close{appearance:none;border:0;background:transparent;color:var(--muted);cursor:pointer;',
    'font:inherit;font-size:14px;line-height:1;padding:4px 6px;border-radius:5px}',
    '.close:hover{background:rgba(18,20,26,.07);color:var(--ink)}',

    '.context{padding:0 16px 12px;font-size:11.5px;color:var(--muted);',
    'letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.context b{color:var(--ink);font-weight:600}',

    /* the dark well holding the payload */
    '.well{flex:1;min-height:120px;margin:0 16px;border-radius:7px;background:var(--ink);',
    'overflow:auto;-webkit-overflow-scrolling:touch}',
    '.well pre{padding:14px 16px;font-family:inherit;font-size:11.5px;line-height:1.65;',
    'color:#dfe3ea;white-space:pre;tab-size:2}',
    '.well::-webkit-scrollbar{width:10px;height:10px}',
    '.well::-webkit-scrollbar-thumb{background:#333844;border-radius:6px;border:3px solid var(--ink)}',

    /* meter — the one place colour is allowed to mean something */
    '.meter{display:flex;align-items:center;gap:10px;padding:12px 16px 0}',
    '.track{flex:1;height:3px;background:var(--rule);border-radius:2px;overflow:hidden}',
    '.fill{height:100%;width:0;border-radius:2px;transition:width .18s ease-out,background .18s}',
    '@media (prefers-reduced-motion:reduce){.fill{transition:none}}',
    '.size{font-size:11px;letter-spacing:.03em;white-space:nowrap;font-variant-numeric:tabular-nums}',

    /* footer */
    '.foot{display:flex;align-items:center;gap:16px;padding:12px 16px 14px;flex-wrap:wrap}',
    '.opt{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);',
    'letter-spacing:.03em;cursor:pointer;user-select:none}',
    '.opt input{accent-color:var(--ink);margin:0;cursor:pointer;width:13px;height:13px}',
    '.opt:hover{color:var(--ink)}',

    '.copy{appearance:none;border:0;font:inherit;font-size:11.5px;font-weight:600;',
    'letter-spacing:.06em;text-transform:uppercase;color:var(--paper);background:var(--ink);',
    'padding:9px 18px;border-radius:6px;cursor:pointer;transition:opacity .12s}',
    '.copy:hover{opacity:.86}',
    '.copy[data-done="1"]{background:var(--ok)}',

    ':focus-visible{outline:2px solid var(--ink);outline-offset:2px}',
    '.well:focus-visible{outline-offset:-2px}',

    '@media (max-width:560px){.panel{max-height:100%}.foot{gap:10px}}'
  ].join('');

  function approxTokens(str) {
    return Math.max(1, Math.round(str.length / CHARS_PER_TOKEN));
  }

  function humanBytes(n) {
    return n < 1024 ? n + ' B' : (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  }

  function humanTokens(n) {
    return n < 1000 ? String(n) : (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  }

  function copyText(str) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(str);
    }
    // execCommand fallback for pages where the async clipboard is unavailable.
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = str;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy blocked'));
    });
  }

  /**
   * @param {{ extract: (opts:{includeSponsored:boolean,slim:boolean}) => object }} source
   */
  function openModal(source) {
    closeModal();

    var state = { includeSponsored: true, slim: false };
    var payload = '';
    var lastFocus = document.activeElement;

    var host = document.createElement('div');
    host.id = HOST_ID;
    var root = host.attachShadow({ mode: 'open' });

    var style = document.createElement('style');
    style.textContent = CSS;

    var scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.innerHTML =
      '<div class="panel" role="dialog" aria-modal="true" aria-label="Extracted search results">' +
        '<div class="head">' +
          '<span class="mark">Amazon Lister</span>' +
          '<span class="tally" data-tally></span>' +
          '<span class="spacer"></span>' +
          '<button class="close" data-close aria-label="Close">&#10005;</button>' +
        '</div>' +
        '<div class="context" data-context></div>' +
        '<div class="well" tabindex="0"><pre data-json></pre></div>' +
        '<div class="meter">' +
          '<div class="track"><div class="fill" data-fill></div></div>' +
          '<span class="size" data-size></span>' +
        '</div>' +
        '<div class="foot">' +
          '<label class="opt"><input type="checkbox" data-opt="includeSponsored" checked>Sponsored results</label>' +
          '<label class="opt"><input type="checkbox" data-opt="slim">Slim — drop links &amp; images</label>' +
          '<span class="spacer"></span>' +
          '<button class="copy" data-copy>Copy JSON</button>' +
        '</div>' +
      '</div>';

    root.append(style, scrim);
    document.documentElement.appendChild(host);

    var $ = function (sel) { return root.querySelector(sel); };
    var jsonEl = $('[data-json]');
    var sizeEl = $('[data-size]');
    var fillEl = $('[data-fill]');
    var copyBtn = $('[data-copy]');

    function render() {
      var data = source.extract(state);
      payload = JSON.stringify(data, null, 2);

      jsonEl.textContent = payload;
      $('[data-tally]').textContent =
        data.count + (data.count === 1 ? ' result' : ' results');
      $('[data-context]').innerHTML =
        (data.query ? '<b>' + escapeHtml(data.query) + '</b>' : '<b>search results</b>') +
        ' &middot; ' + escapeHtml(data.source || 'amazon') +
        ' &middot; page ' + data.page;

      var tokens = approxTokens(payload);
      var pct = Math.min(100, (tokens / TOKEN_BUDGET) * 100);
      var ratio = tokens / TOKEN_BUDGET;
      var colour = ratio < 0.5 ? 'var(--ok)' : ratio < 1 ? 'var(--warn)' : 'var(--over)';
      fillEl.style.width = pct + '%';
      fillEl.style.background = colour;
      sizeEl.style.color = colour;
      sizeEl.textContent = '≈' + humanTokens(tokens) + ' tokens · ' + humanBytes(payload.length);
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }

    root.querySelectorAll('[data-opt]').forEach(function (box) {
      box.addEventListener('change', function () {
        state[box.getAttribute('data-opt')] = box.checked;
        render();
      });
    });

    copyBtn.addEventListener('click', function () {
      copyText(payload).then(function () {
        copyBtn.textContent = 'Copied';
        copyBtn.setAttribute('data-done', '1');
        setTimeout(function () {
          copyBtn.textContent = 'Copy JSON';
          copyBtn.removeAttribute('data-done');
        }, 1600);
      }, function () {
        copyBtn.textContent = 'Press ⌘C';
        // Selecting the text lets the user finish the copy themselves.
        var range = document.createRange();
        range.selectNodeContents(jsonEl);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      });
    });

    $('[data-close]').addEventListener('click', closeModal);
    scrim.addEventListener('mousedown', function (e) {
      if (e.target === scrim) closeModal();
    });

    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); closeModal(); }
    }
    root.addEventListener('keydown', onKey);
    document.addEventListener('keydown', onKey, true);
    host.__cleanup = function () {
      document.removeEventListener('keydown', onKey, true);
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    };

    render();
    copyBtn.focus();
  }

  function closeModal() {
    var existing = document.getElementById(HOST_ID);
    if (!existing) return false;
    if (existing.__cleanup) existing.__cleanup();
    existing.remove();
    return true;
  }

  function isOpen() {
    return !!document.getElementById(HOST_ID);
  }

  var api = { openModal: openModal, closeModal: closeModal, isOpen: isOpen, approxTokens: approxTokens };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof globalThis !== 'undefined') {
    globalThis.AmazonLister = Object.assign(globalThis.AmazonLister || {}, api);
  }
})();
