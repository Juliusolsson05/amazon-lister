/**
 * Service worker. Holds no state — its whole job is to inject the extractor
 * into whichever tab you clicked on.
 *
 * There are no host_permissions in the manifest on purpose: activeTab means
 * this extension can only ever read the one tab you deliberately clicked,
 * and only for that click.
 */
'use strict';

var AMAZON_HOST = /^https?:\/\/([a-z0-9-]+\.)*amazon\.[a-z.]+\//i;
var FILES = ['src/parse.js', 'src/modal.js', 'src/content.js'];

function flashBadge(tabId, text, title) {
  chrome.action.setBadgeText({ tabId: tabId, text: text });
  chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: '#a3341f' });
  if (title) chrome.action.setTitle({ tabId: tabId, title: title });
  setTimeout(function () {
    chrome.action.setBadgeText({ tabId: tabId, text: '' });
    chrome.action.setTitle({ tabId: tabId, title: 'Extract search results as JSON' });
  }, 2600);
}

chrome.action.onClicked.addListener(function (tab) {
  if (!tab || !tab.id) return;

  // tab.url is only readable once activeTab is granted by this very click.
  // If it's still hidden, attempt the injection anyway rather than refusing.
  if (tab.url && !AMAZON_HOST.test(tab.url)) {
    flashBadge(tab.id, '!', 'Amazon Lister works on Amazon search pages');
    return;
  }

  chrome.scripting
    .executeScript({ target: { tabId: tab.id }, files: FILES })
    .catch(function (err) {
      console.warn('[amazon-lister] injection failed:', err && err.message);
      flashBadge(tab.id, '!', 'Could not read this page — reload it and try again');
    });
});
