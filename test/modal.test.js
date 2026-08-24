'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const PARSE_SRC = read('src/parse.js');
const MODAL_SRC = read('src/modal.js');
const CONTENT_SRC = read('src/content.js');
const FIXTURE = read('test/fixtures/search-page.html');

/**
 * Boot the extension's scripts inside a jsdom realm, exactly as the service
 * worker injects them: three plain scripts sharing one global.
 */
function boot(html = FIXTURE) {
  const dom = new JSDOM(html, {
    url: 'https://www.amazon.com/s?k=mechanical+keyboard',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;
  const copied = [];
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: (t) => { copied.push(t); return Promise.resolve(); } }
  });
  window.eval(PARSE_SRC);
  window.eval(MODAL_SRC);
  return { dom, window, copied, inject: () => window.eval(CONTENT_SRC) };
}

const shadow = (window) => window.document.getElementById('amazon-lister-root').shadowRoot;
const q = (window, sel) => shadow(window).querySelector(sel);
const payload = (window) => q(window, '[data-json]').textContent;

test('injecting the content script opens the panel over the page', () => {
  const { window, inject } = boot();
  assert.equal(window.document.getElementById('amazon-lister-root'), null);
  inject();
  assert.ok(window.document.getElementById('amazon-lister-root'), 'host element should exist');
  assert.ok(q(window, '[role="dialog"]'), 'dialog should be in the shadow root');
  assert.equal(q(window, '[role="dialog"]').getAttribute('aria-modal'), 'true');
});

test('the panel shows the parsed page, not a placeholder', () => {
  const { window, inject } = boot();
  inject();
  const data = JSON.parse(payload(window));
  assert.equal(data.query, 'mechanical keyboard');
  assert.equal(data.count, 3);
  assert.equal(q(window, '[data-tally]').textContent, '3 results');
  assert.match(q(window, '[data-context]').textContent, /mechanical keyboard/);
  assert.match(q(window, '[data-context]').textContent, /amazon\.com/);
});

test('a second injection closes the panel instead of stacking another', () => {
  const { window, inject } = boot();
  inject();
  inject();
  assert.equal(window.document.querySelectorAll('#amazon-lister-root').length, 0);
  inject();
  assert.equal(window.document.querySelectorAll('#amazon-lister-root').length, 1);
});

test('the slim toggle re-renders and strips links and images', () => {
  const { window, inject } = boot();
  inject();
  const before = payload(window);
  assert.ok(before.includes('media-amazon.com'), 'full payload should carry images');

  q(window, '[data-opt="slim"]').click();          // real activation, fires change

  const after = payload(window);
  assert.notEqual(after, before, 'payload should re-render on toggle');
  assert.equal(after.includes('media-amazon.com'), false);
  assert.equal(after.includes('"url"'), false);
  assert.ok(after.length < before.length);
  assert.doesNotThrow(() => JSON.parse(after));
});

test('the sponsored toggle drops sponsored rows and updates the tally', () => {
  const { window, inject } = boot();
  inject();
  assert.equal(JSON.parse(payload(window)).count, 3);

  q(window, '[data-opt="includeSponsored"]').click();  // unchecks it

  const data = JSON.parse(payload(window));
  assert.equal(data.count, 2);
  assert.equal(data.results.some((r) => r.sponsored), false);
  assert.equal(q(window, '[data-tally]').textContent, '2 results');
});

test('toggles compose and are reversible', () => {
  const { window, inject } = boot();
  inject();
  const original = payload(window);
  const slim = q(window, '[data-opt="slim"]');
  const sponsored = q(window, '[data-opt="includeSponsored"]');

  slim.click(); sponsored.click();
  assert.equal(JSON.parse(payload(window)).count, 2);
  slim.click(); sponsored.click();
  assert.equal(payload(window).replace(/"capturedAt":.*/, ''), original.replace(/"capturedAt":.*/, ''));
});

test('the size meter tracks the payload and stays inside the track', () => {
  const { window, inject } = boot();
  inject();
  const sizeText = () => q(window, '[data-size]').textContent;
  const fillPct = () => parseFloat(q(window, '[data-fill]').style.width);

  assert.match(sizeText(), /tokens/);
  const full = fillPct();
  q(window, '[data-opt="slim"]').click();
  assert.ok(fillPct() < full, 'slim payload should shrink the meter');
  assert.ok(fillPct() >= 0 && fillPct() <= 100, 'fill must stay within the track');
});

test('Copy JSON puts the visible payload on the clipboard verbatim', async () => {
  const { window, inject, copied } = boot();
  inject();
  q(window, '[data-copy]').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(copied.length, 1);
  assert.equal(copied[0], payload(window));
  assert.doesNotThrow(() => JSON.parse(copied[0]));
  assert.equal(q(window, '[data-copy]').textContent, 'Copied');
});

test('copying after a toggle copies the toggled payload, not the first render', async () => {
  const { window, inject, copied } = boot();
  inject();
  q(window, '[data-opt="slim"]').click();
  q(window, '[data-copy]').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(copied[0].includes('media-amazon.com'), false);
  assert.equal(copied[0], payload(window));
});

test('Escape closes the panel', () => {
  const { window, inject } = boot();
  inject();
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(window.document.getElementById('amazon-lister-root'), null);
});

test('clicking the backdrop closes the panel but clicking the panel does not', () => {
  const { window, inject } = boot();
  inject();
  q(window, '[role="dialog"]').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  assert.ok(window.document.getElementById('amazon-lister-root'), 'panel click must not close');

  shadow(window).querySelector('.scrim')
    .dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  assert.equal(window.document.getElementById('amazon-lister-root'), null);
});

test('the close button closes the panel', () => {
  const { window, inject } = boot();
  inject();
  q(window, '[data-close]').click();
  assert.equal(window.document.getElementById('amazon-lister-root'), null);
});

test('a page with no results still opens a usable, honest panel', () => {
  const { window, inject } = boot('<!doctype html><html><body></body></html>');
  inject();
  assert.equal(q(window, '[data-tally]').textContent, '0 results');
  const data = JSON.parse(payload(window));
  assert.equal(data.count, 0);
  assert.deepEqual(data.results, []);
});

test('the panel never leaves stray listeners or nodes behind after closing', () => {
  const { window, inject } = boot();
  inject();
  q(window, '[data-close]').click();
  // A stale Escape handler would throw if it still pointed at removed nodes.
  assert.doesNotThrow(() => {
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  assert.equal(window.document.querySelectorAll('#amazon-lister-root').length, 0);
});
