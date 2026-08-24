# Amazon Lister

One click turns the Amazon search results you're looking at into clean JSON, sized for pasting into an LLM.

There are plenty of Amazon scrapers in the Chrome Web Store. They're built for
lead-gen and price research: freemium row caps, spreadsheet-shaped output, and
JSON that's really a CSV with braces — `"$24.99"` as a string, every null key
spelled out, and 900-character tracking URLs. This one is built for a different
job: hand a language model the smallest, cleanest description of a results page
that still says everything useful.

## What you get

Click the toolbar button on any Amazon search page. A panel opens over the page
with the JSON, a live size readout, and a copy button.

```json
{
  "source": "amazon.com",
  "query": "mechanical keyboard",
  "page": 1,
  "resultsSummary": "1-16 of over 2,000 results for \"mechanical keyboard\"",
  "capturedAt": "2026-08-24T10:00:00.000Z",
  "count": 22,
  "results": [
    {
      "pos": 1,
      "asin": "B0H47Z2J3T",
      "title": "Razer Huntsman V3 HE Magnetic TKL 8KHz Wired Gaming Keyboard",
      "url": "https://www.amazon.com/dp/B0H47Z2J3T",
      "price": 139.99,
      "listPrice": 249.99,
      "currency": "USD",
      "rating": 4.4,
      "reviews": 1204,
      "boughtPastMonth": "300+",
      "badge": "Overall Pick",
      "sponsored": true,
      "delivery": "FREE delivery Wed, Aug 26",
      "stock": "Only 7 left in stock (more on the way).",
      "image": "https://m.media-amazon.com/images/I/71A9y3eYngL.jpg"
    }
  ]
}
```

Decisions that make this cheaper to paste than a generic export:

- **Prices are numbers, currency is separate.** `139.99` + `"USD"`, not `"$139.99"`.
  The currency comes from the marketplace, not the symbol, so `$` on `amazon.ca`
  is correctly `CAD`.
- **Absent fields are absent.** No `"badge": null` on twenty rows.
- **URLs are canonical.** `/dp/ASIN`, not the `/sspa/click?...` redirect, which
  can run 900 characters on sponsored rows.
- **Images point at the full-size render**, with Amazon's `._AC_UY218_.` resize
  suffix stripped.
- **Sponsored rows are labelled**, so you can tell the model to weigh them
  differently — or drop them before copying.

## The panel

- **Size meter** — a live `≈ tokens · KB` readout, green while the payload
  pastes comfortably, amber as it grows, rust past ~8k tokens. It reacts as you
  toggle, so you can see what each option costs you.
- **Sponsored results** — off drops ad rows and renumbers `pos`.
- **Slim** — drops `url`, `image`, `delivery`, `stock` and `listPrice`. Roughly
  halves the payload when you only care about what's ranking and for how much.
- Escape, the backdrop, or the toolbar button again closes it.

## Install

Not on the Web Store — load it unpacked:

1. `git clone` this repo
2. Visit `chrome://extensions`, turn on **Developer mode**
3. **Load unpacked**, pick the repo folder
4. Open an Amazon search page and click the toolbar button

## Permissions

`activeTab` and `scripting`, and deliberately **no `host_permissions`**. The
extension has no standing access to Amazon or anything else: clicking the
toolbar button grants access to that one tab, for that one click. Nothing is
sent anywhere — parsing happens in the page and the result goes to your
clipboard.

## Development

```bash
npm install          # note: NODE_ENV=production in your shell will skip devDeps
npm test             # 29 tests, node:test + jsdom
npm run icons        # regenerate icons/ from tools/make-icons.mjs
```

Preview the panel without loading the extension:

```bash
python3 -m http.server 8749
open http://localhost:8749/tools/preview.html
```

### Layout

| Path | What it does |
|---|---|
| `src/parse.js` | DOM → JSON. Pure and null-tolerant; also `require()`-able by the tests. |
| `src/modal.js` | The panel, in a shadow root so Amazon's CSS can't reach it. |
| `src/content.js` | Injection entry point. Toggles the panel. |
| `src/background.js` | Service worker. Injects the three files on toolbar click. |
| `tools/make-icons.mjs` | Writes the PNG icons from scratch via `node:zlib`. |
| `tools/preview.html` | Panel preview against mock data. |

### On selector rot

Amazon changes this markup. The selectors here were read off live
`amazon.com` search results in August 2026 and verified against them —
22/22 rows for title, price, delivery and image.

Every field read is independently null-tolerant, so a layout change costs you
one field, not the whole page. Two things are worth knowing if you go fixing it:

- Review count is read from the ratings **link**, not the first `a[aria-label]`
  in the reviews block — the star popover comes first in the DOM and its label
  reads `"4.4 out of 5 stars, rating details"`, which parses to `4`. The filter
  is structural (skip anchors wrapping `.a-icon-alt`) so it survives locale changes.
- Sponsored detection keys on the `/sspa/click` href rather than the word
  "Sponsored", which is translated on every non-English marketplace.

`test/fixtures/search-page.html` mirrors the real markup — class names,
`data-cy` hooks, aria-labels and nesting are the live ones. When Amazon moves,
update the fixture and the tests will tell you what broke.

## Licence

MIT
