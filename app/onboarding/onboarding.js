/* FreeDictate setup checklist. Lua drives it:
 *   window.onInit({keyLabel, serverOk, accessibility, microphone, launchAtLogin})  — repeatable, idempotent
 *   window.onKeyChanged(label)
 * Actions go to Lua via webkit.messageHandlers.dictate.postMessage({action}).
 * Without window.webkit (plain browser) a small simulator answers instead. */
(function () {
  'use strict';
  var CHECKS = ['microphone', 'accessibility', 'launchAtLogin', 'serverOk'];
  var bridge = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.dictate;
  var state = {};          // last applied value per check: true | false | null
  var first = true;
  var pending = null, timer = 0;

  var $ = function (s) { return document.querySelector(s); };
  var summary = $('#summary'), done = $('#done'), keyLabel = $('#keyLabel'), keyRow = $('[data-row="key"]');

  function norm(v) { return v === true ? true : v === false ? false : null; }

  function applyRow(name, v) {
    var row = document.querySelector('[data-row="' + name + '"]');
    var next = v === true ? 'ok' : v === false ? 'off' : 'unknown';
    if (row.dataset.state === next) return;
    if (first) { row.classList.add('instant'); requestAnimationFrame(function () { requestAnimationFrame(function () { row.classList.remove('instant'); }); }); }
    // keep focus off a button that is about to disappear
    if (next === 'ok' && row.contains(document.activeElement)) done.focus();
    row.dataset.state = next;
    var btn = row.querySelector('.btn');
    btn.setAttribute('aria-hidden', next === 'ok' ? 'true' : 'false');
    btn.tabIndex = next === 'ok' ? -1 : 0;
    row.setAttribute('aria-label', row.querySelector('.title').textContent + ': ' +
      (next === 'ok' ? 'done' : next === 'off' ? 'needs attention' : 'not checked'));
  }

  function setSummary(text) {
    if (summary.textContent === text) return;
    if (first) { summary.textContent = text; return; }
    summary.classList.add('swap');
    setTimeout(function () { summary.textContent = text; summary.classList.remove('swap'); }, 140);
  }

  function refreshFooter() {
    var left = CHECKS.filter(function (k) { return state[k] !== true; }).length;
    var all = left === 0;
    done.classList.toggle('primary', all);
    done.textContent = all ? "You're set" : 'Done';
    setSummary(all ? 'All set. Hold your button and talk in any app.'
      : left === 1 ? '1 thing left to set up.' : left + ' things left to set up.');
  }

  function setKey(label) {
    keyRow.classList.remove('capturing');
    $('#changeKey').textContent = 'Change';
    if (!label || keyLabel.textContent === label) return;
    keyLabel.textContent = label;
    keyRow.setAttribute('aria-label', 'Your button: ' + label);
    if (!first) { keyLabel.classList.remove('pop'); void keyLabel.offsetWidth; keyLabel.classList.add('pop'); }
  }

  function flush() {
    timer = 0;
    var d = pending; pending = null;
    CHECKS.forEach(function (k) {
      if (!(k in d)) return;           // field omitted → keep last known
      state[k] = norm(d[k]);
      applyRow(k, state[k]);
    });
    if (d.keyLabel) setKey(d.keyLabel);
    refreshFooter();
    first = false;
  }

  // Coalesce bursts (<16ms) so the last call wins.
  window.onInit = function (d) {
    pending = Object.assign(pending || {}, d || {});
    if (!timer) timer = setTimeout(flush, 16);
  };
  window.onKeyChanged = function (label) { setKey(label); };

  function send(action) {
    if (action === 'setKey') { keyRow.classList.add('capturing'); $('#changeKey').textContent = 'Press a key…'; }
    if (bridge) bridge.postMessage({ action: action });
    else simulate(action);
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-action]');
    if (b) send(b.dataset.action);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && keyRow.classList.contains('capturing')) setKey(null);
  });

  // Re-check whenever the window comes back (e.g. returning from System Settings).
  var lastRecheck = 0;
  function recheck() {
    var now = Date.now();
    if (now - lastRecheck < 500) return;
    lastRecheck = now; send('recheck');
  }
  window.addEventListener('focus', recheck);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) recheck(); });

  // ── Browser simulator ──────────────────────────────────────────────
  var sim = { keyLabel: 'Mouse 4', serverOk: true, accessibility: false, microphone: false, launchAtLogin: false };
  var simMap = { openMicrophone: 'microphone', openAccessibility: 'accessibility', launchAtLogin: 'launchAtLogin', startServer: 'serverOk' };
  var simKeys = ['Mouse 4', 'Mouse 5', 'Right ⌥', 'fn', 'F13'];
  function simulate(action) {
    if (simMap[action]) { sim[simMap[action]] = true; setTimeout(function () { window.onInit(sim); }, 600); }
    else if (action === 'recheck') setTimeout(function () { window.onInit(sim); }, 120);
    else if (action === 'setKey') setTimeout(function () {
      sim.keyLabel = simKeys[(simKeys.indexOf(sim.keyLabel) + 1) % simKeys.length];
      window.onKeyChanged(sim.keyLabel);
    }, 1200);
    else if (action === 'close') console.log('[sim] close');
  }
  window.__sim = sim;
  if (!bridge) window.onInit(sim);
})();
