/**
 * Injection entry point. Runs on every toolbar click, so it toggles:
 * a second click closes the panel instead of stacking another one.
 */
(function () {
  'use strict';

  var AL = globalThis.AmazonLister;
  if (!AL || !AL.parseSearchPage || !AL.openModal) return;

  if (AL.isOpen()) {
    AL.closeModal();
    return;
  }

  AL.openModal({
    extract: function (opts) {
      return AL.parseSearchPage(document, opts);
    }
  });
})();
