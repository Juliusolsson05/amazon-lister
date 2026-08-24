'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const P = require('../src/parse.js');

const html = fs.readFileSync(path.join(__dirname, 'fixtures/search-page.html'), 'utf8');
const OPTS = {
  origin: 'https://www.amazon.com',
  hostname: 'www.amazon.com',
  search: '?k=mechanical+keyboard&page=2',
  now: '2026-08-24T10:00:00.000Z'
};

function parse(extra) {
  const dom = new JSDOM(html);
  return P.parseSearchPage(dom.window.document, { ...OPTS, ...extra });
}

test('parseAmount handles localised money formats', () => {
  assert.equal(P.parseAmount('$1,234.56'), 1234.56);
  assert.equal(P.parseAmount('1.234,56 EUR'), 1234.56);
  assert.equal(P.parseAmount('1 234,56 kr'), 1234.56);
  assert.equal(P.parseAmount('￥1,234'), 1234);
  assert.equal(P.parseAmount('19,99 €'), 19.99);
  assert.equal(P.parseAmount('$139.99'), 139.99);
  assert.equal(P.parseAmount(null), null);
  assert.equal(P.parseAmount('no digits here'), null);
});

test('parseRating reads decimal comma locales and rejects out-of-range', () => {
  assert.equal(P.parseRating('4.4 out of 5 stars'), 4.4);
  assert.equal(P.parseRating('4,2 von 5 Sternen'), 4.2);
  assert.equal(P.parseRating('9.9 out of 5 stars'), null);
  assert.equal(P.parseRating(''), null);
});

test('currency comes from the marketplace, not the symbol', () => {
  assert.equal(P.currencyFor('www.amazon.com'), 'USD');
  assert.equal(P.currencyFor('www.amazon.ca'), 'CAD');
  assert.equal(P.currencyFor('www.amazon.co.uk'), 'GBP');
  assert.equal(P.currencyFor('www.amazon.se'), 'SEK');
  assert.equal(P.currencyFor('example.com'), null);
});

test('fullSizeImage strips the resize suffix', () => {
  assert.equal(
    P.fullSizeImage('https://m.media-amazon.com/images/I/71A9y3eYngL._AC_UY218_.jpg'),
    'https://m.media-amazon.com/images/I/71A9y3eYngL.jpg'
  );
  assert.equal(P.fullSizeImage(null), null);
});

test('page-level metadata is read from the URL', () => {
  const out = parse();
  assert.equal(out.source, 'amazon.com');
  assert.equal(out.query, 'mechanical keyboard');
  assert.equal(out.page, 2);
  assert.equal(out.capturedAt, '2026-08-24T10:00:00.000Z');
  assert.match(out.resultsSummary, /2,000 results/);
});

test('cards without a title are skipped and positions are 1-based and contiguous', () => {
  const out = parse();
  assert.equal(out.count, 3);
  assert.equal(out.results.length, 3);
  assert.deepEqual(out.results.map((r) => r.pos), [1, 2, 3]);
});

test('sponsored card extracts every field correctly', () => {
  const [first] = parse().results;
  assert.deepEqual(first, {
    pos: 1,
    asin: 'B0H47Z2J3T',
    title: 'Razer Huntsman V3 HE Magnetic TKL 8KHz Wired Gaming Keyboard',
    url: 'https://www.amazon.com/dp/B0H47Z2J3T',
    price: 139.99,
    listPrice: 249.99,
    currency: 'USD',
    rating: 4.4,
    reviews: 1204,
    boughtPastMonth: '300+',
    badge: 'Overall Pick',
    sponsored: true,
    delivery: 'FREE delivery Wed, Aug 26',
    stock: 'Only 7 left in stock (more on the way).',
    image: 'https://m.media-amazon.com/images/I/71A9y3eYngL.jpg'
  });
});

test('review count is the ratings link, not the star popover aria-label', () => {
  // Regression: the popover trigger reads "4.4 out of 5 stars, rating details"
  // and appears first in the DOM; parsing it would yield 4 reviews.
  const [first, second] = parse().results;
  assert.equal(first.reviews, 1204);
  assert.equal(second.reviews, 230);
});

test('organic cards carry no sponsored key at all', () => {
  const [, second] = parse().results;
  assert.equal('sponsored' in second, false);
  assert.equal(second.url, 'https://www.amazon.com/dp/B09TQK1LKZ');
  assert.equal(second.price, 94);
  assert.equal('listPrice' in second, false);
  assert.equal('badge' in second, false);
  assert.equal('stock' in second, false);
});

test('missing fields are omitted rather than emitted as null', () => {
  const third = parse().results[2];
  assert.deepEqual(Object.keys(third).sort(), ['asin', 'currency', 'pos', 'price', 'title', 'url'].sort());
  assert.equal(JSON.stringify(third).includes('null'), false);
});

test('includeSponsored:false drops sponsored results and renumbers', () => {
  const out = parse({ includeSponsored: false });
  assert.equal(out.count, 2);
  assert.equal(out.results[0].asin, 'B09TQK1LKZ');
  assert.deepEqual(out.results.map((r) => r.pos), [1, 2]);
});

test('slim mode drops the heavy fields', () => {
  const [first] = parse({ slim: true }).results;
  for (const k of ['image', 'delivery', 'stock', 'listPrice', 'url']) {
    assert.equal(k in first, false, `${k} should be dropped in slim mode`);
  }
  assert.equal(first.title, 'Razer Huntsman V3 HE Magnetic TKL 8KHz Wired Gaming Keyboard');
  assert.equal(first.price, 139.99);
  assert.equal(first.rating, 4.4);
});

test('slim output sheds the URL and image payload entirely', () => {
  const lean = JSON.stringify(parse({ slim: true }));
  const full = JSON.stringify(parse());
  assert.equal(lean.includes('media-amazon.com'), false);
  assert.equal(lean.includes('/dp/'), false);
  assert.ok(full.includes('media-amazon.com'), 'full output should keep images');
  assert.ok(lean.length < full.length);
});

test('a page with no results yields an empty, valid payload', () => {
  const dom = new JSDOM('<!doctype html><html><body><div class="s-main-slot"></div></body></html>');
  const out = P.parseSearchPage(dom.window.document, OPTS);
  assert.equal(out.count, 0);
  assert.deepEqual(out.results, []);
  assert.equal(out.query, 'mechanical keyboard');
});

test('non-amazon hostname still parses without a currency', () => {
  const dom = new JSDOM(html);
  const out = P.parseSearchPage(dom.window.document, { ...OPTS, hostname: 'example.com' });
  assert.equal('source' in out, false);
  assert.equal('currency' in out.results[0], false);
});
