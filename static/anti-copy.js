/* Global anti-copy / anti-paste protection. Loaded on every page. */
(function () {
  'use strict';

  const blockedKeys = new Set(['c', 'x', 'v']);

  function blockClipboard(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    return false;
  }

  // Block browser/context-menu copy routes and clipboard events everywhere.
  document.addEventListener('copy', blockClipboard, true);
  document.addEventListener('cut', blockClipboard, true);
  document.addEventListener('paste', blockClipboard, true);
  document.addEventListener('contextmenu', blockClipboard, true);

  // Block Ctrl/Cmd+C, Ctrl/Cmd+X, Ctrl/Cmd+V and the equivalent Insert shortcuts.
  document.addEventListener('keydown', function (e) {
    const key = String(e.key || '').toLowerCase();
    const modifier = e.ctrlKey || e.metaKey;

    if (modifier && blockedKeys.has(key)) {
      blockClipboard(e);
      return;
    }

    // Windows/Linux: Ctrl+Insert = Copy, Shift+Insert = Paste.
    if ((e.ctrlKey && e.key === 'Insert') || (e.shiftKey && e.key === 'Insert')) {
      blockClipboard(e);
    }
  }, true);

  // Prevent dragging selected page content to another location/app.
  document.addEventListener('dragstart', function (e) {
    e.preventDefault();
  }, true);
})();
