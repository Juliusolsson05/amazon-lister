/**
 * Pure DOM -> JSON extraction for Amazon search result pages.
 *
 * Loaded two ways:
 *   - injected as a plain content script (attaches to globalThis.AmazonLister)
 *   - required() from Node tests (module.exports)
 *
 * Selectors here were read off live amazon.com search markup. Amazon changes
 * these; every read is null-tolerant so a layout change degrades a field
 * rather than throwing away the whole page.
 */
(function () {
  'use strict';

  // TLD -> currency. Amazon shows locale-formatted prices with ambiguous
  // symbols ($ is USD, CAD, AUD, MXN...), so trust the marketplace, not the glyph.
  var CURRENCY_BY_HOST = {
    'amazon.com': 'USD',
    'amazon.ca': 'CAD',
    'amazon.com.mx': 'MXN',
    'amazon.com.br': 'BRL',
    'amazon.co.uk': 'GBP',
    'amazon.de': 'EUR',
    'amazon.fr': 'EUR',
    'amazon.it': 'EUR',
    'amazon.es': 'EUR',
    'amazon.nl': 'EUR',
    'amazon.be': 'EUR',
    'amazon.ie': 'EUR',
    'amazon.pl': 'PLN',
    'amazon.se': 'SEK',
    'amazon.com.tr': 'TRY',
    'amazon.co.jp': 'JPY',
    'amazon.in': 'INR',
    'amazon.sg': 'SGD',
    'amazon.com.au': 'AUD',
    'amazon.ae': 'AED',
    'amazon.sa': 'SAR',
    'amazon.eg': 'EGP'
  };

  /** "www.amazon.co.uk" -> "amazon.co.uk" */
  function marketplace(hostname) {
    var m = String(hostname || '').match(/amazon\.[a-z.]+$/i);
    return m ? m[0].toLowerCase() : null;
  }

  function currencyFor(hostname) {
    return CURRENCY_BY_HOST[marketplace(hostname)] || null;
  }

  /** Collapse whitespace; return null rather than an empty string. */
  function text(node) {
    if (!node) return null;
    // innerText respects layout (real browser); textContent is the jsdom fallback.
    var raw = typeof node.innerText === 'string' && node.innerText ? node.innerText : node.textContent;
    raw = String(raw || '').replace(/\s+/g, ' ').trim();
    return raw || null;
  }

  function attr(node, name) {
    if (!node) return null;
    var v = node.getAttribute(name);
    return v == null || v === '' ? null : v;
  }

  /**
   * Parse a localised money string to a Number.
   * Handles "$1,234.56", "1.234,56 EUR", "1 234,56 kr", "JPY1,234".
   * Rule: the last , or . is the decimal point unless exactly three digits
   * follow it and it is the only separator kind (then it's a thousands mark).
   */
  function parseAmount(str) {
    if (str == null) return null;
    var cleaned = String(str).replace(/[\s   ]/g, '');
    var m = cleaned.match(/\d[\d.,]*/);
    if (!m) return null;
    var s = m[0].replace(/[.,]+$/, '');
    var lastComma = s.lastIndexOf(',');
    var lastDot = s.lastIndexOf('.');
    var lastSep = Math.max(lastComma, lastDot);
    var n;
    if (lastSep === -1) {
      n = Number(s);
    } else if (s.length - lastSep - 1 === 3 && !(lastComma > -1 && lastDot > -1)) {
      n = Number(s.replace(/[.,]/g, '')); // 1.234 / 1,234 -> 1234
    } else {
      n = Number(s.slice(0, lastSep).replace(/[.,]/g, '') + '.' + s.slice(lastSep + 1));
    }
    return Number.isFinite(n) ? n : null;
  }

  /** "4.4 out of 5 stars" / "4,2 von 5 Sternen" -> 4.4 */
  function parseRating(str) {
    if (str == null) return null;
    var m = String(str).match(/(\d+([.,]\d+)?)/);
    if (!m) return null;
    var n = Number(m[1].replace(',', '.'));
    return Number.isFinite(n) && n >= 0 && n <= 5 ? n : null;
  }

  /** "(1,234)" / "1 234 ratings" -> 1234 */
  function parseCount(str) {
    if (str == null) return null;
    var m = String(str).replace(/[\s ]/g, '').match(/\d[\d.,]*/);
    if (!m) return null;
    var n = Number(m[0].replace(/[.,]/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  /** Canonical, tracking-free product URL. Sponsored hrefs are /sspa/click redirects. */
  function productUrl(origin, asin) {
    return asin ? origin.replace(/\/$/, '') + '/dp/' + asin : null;
  }

  /** Strip Amazon's image resize suffix so the URL points at the full-size render. */
  function fullSizeImage(src) {
    if (!src) return null;
    return src.replace(/\._[A-Z0-9_,]+_\.(jpg|png|gif|webp)$/i, '.$1');
  }

  /** Drop null/undefined/empty-string keys — every absent key is saved LLM tokens. */
  function compact(obj) {
    var out = {};
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      if (v === null || v === undefined || v === '') return;
      if (Array.isArray(v) && v.length === 0) return;
      out[k] = v;
    });
    return out;
  }

  /** One search result card -> a plain object. */
  function parseCard(card, ctx) {
    var origin = ctx.origin;
    var asin = attr(card, 'data-asin');
    if (!asin) return null;

    var titleEl = card.querySelector('h2');
    var title = text(titleEl);

    // First non-struck .a-price is what you'd pay; .a-text-price is the crossed-out list price.
    var priceEl = card.querySelector('.a-price:not([data-a-strike="true"]) .a-offscreen') ||
                  card.querySelector('.a-price .a-offscreen');
    var listEl = card.querySelector('.a-text-price .a-offscreen') ||
                 card.querySelector('.a-price[data-a-strike="true"] .a-offscreen');

    var reviewsBlock = card.querySelector('[data-cy="reviews-block"]');
    var scope = reviewsBlock || card;
    var ratingEl = scope.querySelector('.a-icon-alt');

    // The ratings count sits in an aria-label ("230 ratings"). The star popover
    // trigger is ALSO an a[aria-label] and comes first ("4.2 out of 5 stars,
    // rating details") — exclude it structurally: it wraps the star icon.
    var countEl = Array.prototype.slice
      .call(scope.querySelectorAll('a[aria-label]'))
      .filter(function (a) {
        return !a.querySelector('.a-icon-alt') && !/a-popover-trigger/.test(a.className || '');
      })[0] || null;
    var countText = countEl ? (attr(countEl, 'aria-label') || text(countEl)) : null;
    if (countText == null && reviewsBlock) {
      var paren = text(reviewsBlock);
      var pm = paren && paren.match(/\(([\d.,\s]+)\)/);
      countText = pm ? pm[1] : null;
    }

    var deliveryBlock = card.querySelector('[data-cy="delivery-recipe"]');
    var deliveryRows = deliveryBlock ? deliveryBlock.querySelectorAll('.a-row') : [];

    var bought = null;
    var boughtSource = text(reviewsBlock) || text(card) || '';
    var bm = boughtSource.match(/([\d.,]+K?\+?)\s+bought in past month/i);
    if (bm) bought = bm[1];

    return compact({
      pos: ctx.pos,
      asin: asin,
      title: title,
      url: productUrl(origin, asin),
      price: parseAmount(text(priceEl)),
      listPrice: parseAmount(text(listEl)),
      currency: ctx.currency,
      rating: parseRating(text(ratingEl)),
      reviews: parseCount(countText),
      boughtPastMonth: bought,
      badge: text(card.querySelector('.a-badge-text')),
      // Sponsored links always route through /sspa/click — language-independent, unlike the "Sponsored" label.
      sponsored: !!card.querySelector('a[href*="/sspa/"]') || undefined,
      delivery: deliveryRows.length ? text(deliveryRows[0]) : null,
      stock: deliveryRows.length > 1 ? text(deliveryRows[1]) : null,
      image: fullSizeImage(attr(card.querySelector('.s-image'), 'src'))
    });
  }

  /** Strip heavy/low-signal fields so the payload fits a small context window. */
  function slim(result) {
    var drop = { image: 1, delivery: 1, stock: 1, listPrice: 1, url: 1 };
    var out = {};
    Object.keys(result).forEach(function (k) {
      if (!drop[k]) out[k] = result[k];
    });
    return out;
  }

  /**
   * @param {Document} doc
   * @param {{origin?:string, hostname?:string, search?:string, now?:string,
   *          includeSponsored?:boolean, slim?:boolean}} [options]
   */
  function parseSearchPage(doc, options) {
    var opts = options || {};
    var loc = doc.defaultView && doc.defaultView.location;
    var origin = opts.origin || (loc && loc.origin) || 'https://www.amazon.com';
    var hostname = opts.hostname || (loc && loc.hostname) || origin.replace(/^https?:\/\//, '');
    var search = opts.search != null ? opts.search : (loc && loc.search) || '';
    var params = new URLSearchParams(search);

    var currency = currencyFor(hostname);
    var cards = Array.prototype.slice.call(
      doc.querySelectorAll('[data-component-type="s-search-result"][data-asin]')
    );

    var results = [];
    cards.forEach(function (card) {
      var parsed = parseCard(card, { origin: origin, currency: currency, pos: results.length + 1 });
      if (!parsed || !parsed.title) return;                       // skip placeholder/ad shells
      if (parsed.sponsored && opts.includeSponsored === false) return;
      parsed.pos = results.length + 1;                            // renumber after filtering
      results.push(opts.slim ? slim(parsed) : parsed);
    });

    var queryEl = doc.querySelector('#twotabsearchtextbox');

    var envelope = compact({
      source: marketplace(hostname),
      query: params.get('k') || (queryEl && queryEl.value) || null,
      page: Number(params.get('page')) || 1,
      sortedBy: params.get('s') || null,
      resultsSummary: text(doc.querySelector('[data-component-type="s-result-info-bar"]')),
      capturedAt: opts.now || new Date().toISOString()
    });
    // count/results are assigned after compact(): a zero-result page must still
    // emit "count": 0 and "results": [], not drop them as empty.
    envelope.count = results.length;
    envelope.results = results;
    return envelope;
  }

  var api = {
    parseSearchPage: parseSearchPage,
    parseCard: parseCard,
    parseAmount: parseAmount,
    parseRating: parseRating,
    parseCount: parseCount,
    fullSizeImage: fullSizeImage,
    marketplace: marketplace,
    currencyFor: currencyFor,
    compact: compact,
    slim: slim
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof globalThis !== 'undefined') {
    globalThis.AmazonLister = Object.assign(globalThis.AmazonLister || {}, api);
  }
})();
