/* FreeDictate setup assistant. Lua drives it:
 *   window.onInit({keyLabel, serverOk, accessibility, microphone, launchAtLogin})  — repeatable, idempotent
 *   window.onKeyChanged(label)
 *   window.onDictation({state:'listening'|'transcribing'|'done'|'cancelled'|'error', text?, message?})
 *   window.onLevel(x)   x in 0..1, ~15Hz while listening
 * Actions go to Lua via webkit.messageHandlers.dictate.postMessage({action}).
 * Without window.webkit (plain browser) a simulator answers instead; window.__sim drives it.
 * Motion: design/MOTION.md §0 and §5. */
(function () {
  'use strict';
  var NAMES = { welcome: 'Welcome', microphone: 'Microphone', accessibility: 'Accessibility', serverOk: 'Speech engine',
    launchAtLogin: 'Start at login', key: 'Your button', try: 'Try it' };
  var STEPS = ['welcome', 'microphone', 'accessibility', 'serverOk', 'launchAtLogin', 'key', 'try'];
  var CHECKS = ['microphone', 'accessibility', 'serverOk', 'launchAtLogin'];
  var LINES = {
    microphone: { ok: 'Microphone is on.', off: "Not allowed yet. This page updates when you come back.", unknown: 'Checking the microphone…' },
    accessibility: { ok: 'Accessibility is on.', off: "Not on yet. This page updates when you come back.", unknown: 'Checking…' },
    serverOk: { ok: 'The engine is running.', off: "The engine isn't running.", unknown: 'Checking the engine…' },
    launchAtLogin: { ok: 'FreeDictate starts at login.', off: 'Off for now.', unknown: 'Checking…' }
  };
  var bridge = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.dictate;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var app = $('#app'), tile = $('#tile'), badge = $('#badge'), ring = $('.ring'), back = $('#back');
  var dotsEl = $('#dots'), summary = $('#summary');
  var keyLabel = $('#keyLabel'), keyWell = $('#keyWell'), keyHint = $('#keyHint'), changeKey = $('#changeKey');
  var field = $('#field'), textarea = $('#tryField'), tryStatus = $('#tryStatus'), finishBtn = $('#finish');
  var bars = $$('.meter i');
  var keyRing = $('#keyRing'), tryGlow = $('#tryGlow'), tryH = $('#h-try');
  var hr = new Date().getHours();
  $('#h-welcome').textContent = hr < 5 ? 'Good evening.' : hr < 12 ? 'Good morning.' : hr < 18 ? 'Good afternoon.' : 'Good evening.';
  if (!bridge) document.documentElement.classList.add('nobridge');

  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var reduced = function () { return !!mq.matches; };
  var lin = window.CSS && CSS.supports && CSS.supports('animation-timing-function', 'linear(0, 1)');
  var EASE = {
    standard: 'cubic-bezier(0.2,0,0,1)', enter: 'cubic-bezier(0.16,1,0.3,1)', exit: 'cubic-bezier(0.4,0,1,1)',
    morph: lin ? 'linear(0, 0.25 8%, 0.6 20%, 0.85 34%, 0.96 50%, 1)' : 'cubic-bezier(0.16,1,0.3,1)',
    snappy: lin ? 'linear(0, 0.18 6%, 0.52 14%, 0.8 24%, 0.96 36%, 1.02 48%, 1.01 60%, 1)' : 'cubic-bezier(0.34,1.2,0.64,1)'
  };

  /* ---------- tween: always start from the current values (MOTION §0 interruption) ---------- */
  function freeze(el) {
    el.getAnimations().forEach(function (a) { try { a.commitStyles(); } catch (e) {} a.cancel(); });
  }
  function tween(el, to, dur, ease, delay) {
    freeze(el);
    var cs = getComputedStyle(el), from = {};
    Object.keys(to).forEach(function (k) { from[k] = el.style[k] || cs[k]; });
    if (!dur) { Object.keys(to).forEach(function (k) { el.style[k] = to[k]; }); return null; }
    var a = el.animate([from, to], { duration: dur, easing: ease || EASE.standard, delay: delay || 0, fill: 'both' });
    a.onfinish = function () { Object.keys(to).forEach(function (k) { el.style[k] = to[k]; }); try { a.cancel(); } catch (e) {} };
    return a;
  }

  /* ---------- state ---------- */
  var checks = {};                 // true | false | null per check
  var cur = -1, first = true, advanceTimer = 0, busyAction = null;
  var label = '…';

  function norm(v) { return v === true ? true : v === false ? false : null; }
  function word(v) { return v === true ? 'ok' : v === false ? 'off' : 'unknown'; }

  /* ---------- sidebar step list: done steps get a green check ---------- */
  var CHECK_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.4 8.3l2.4 2.4 4.8-5"/></svg>';
  var dotBtns = STEPS.map(function (s, i) {
    var li = document.createElement('li'), b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = '<span class="mk">' + CHECK_SVG + '<span class="n">' + (i + 1) + '</span></span><span class="nm"></span>';
    $('.nm', b).textContent = NAMES[s];
    b.addEventListener('click', function () { go(i); });
    li.appendChild(b); dotsEl.appendChild(li); return b;
  });
  function stepDone(j) {
    var s = STEPS[j];
    if (CHECKS.indexOf(s) >= 0) return checks[s] === true;
    if (s === 'try') return dict === 'done-ok';
    return j < cur;
  }
  function placeIndicator(i) {
    dotBtns.forEach(function (b, j) {
      b.classList.toggle('done', stepDone(j));
      if (j === i) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
  }

  /* ---------- hero: tint + glyph crossfade, badge, ring ---------- */
  var glyphs = {}; $$('.glyph').forEach(function (g) { glyphs[g.dataset.glyph] = g; });
  var curGlyph = null;
  function showGlyph(name, animate) {
    if (curGlyph === name) return;
    var out = glyphs[curGlyph], inn = glyphs[name], r = reduced() || !animate;
    if (out) tween(out, { opacity: '0', transform: 'scale(.82)' }, r ? (animate ? 120 : 0) : 140, EASE.exit);
    if (inn) {
      if (r) tween(inn, { opacity: '1', transform: 'scale(1)' }, animate ? 160 : 0, 'ease-out');
      else tween(inn, { opacity: '1', transform: 'scale(1)' }, 320, EASE.morph, 70);
    }
    curGlyph = name;
  }
  function setTint(name) {
    $$('.tint').forEach(function (t) { t.classList.toggle('on', t.dataset.tint === name); });
    $$('.glow i').forEach(function (t) { t.classList.toggle('on', t.dataset.tint === name); });
  }
  var badgeOn = false;
  function setBadge(on, celebrate) {
    if (on === badgeOn && !celebrate) return;
    badgeOn = on;
    var path = $('path', badge), r = reduced();
    if (on) {
      if (r || !celebrate) {
        tween(badge, { opacity: '1', transform: 'scale(1)' }, celebrate ? 160 : (first ? 0 : 140), 'ease-out');
        tween(path, { strokeDashoffset: '0' }, 0);
      } else {
        badge.style.opacity = '0'; badge.style.transform = 'scale(.5)'; path.style.strokeDashoffset = '1';
        tween(badge, { opacity: '1', transform: 'scale(1)' }, 360, EASE.snappy);
        tween(path, { strokeDashoffset: '0' }, 240, EASE.enter, 120);
        ring.style.opacity = '.7'; ring.style.transform = 'scale(1)';
        tween(ring, { opacity: '0', transform: 'scale(1.32)' }, 700, EASE.enter, 60);
        tween(tile, { transform: 'scale(1.04)' }, 160, EASE.standard);
        setTimeout(function () { tween(tile, { transform: 'scale(1)' }, 320, EASE.snappy); }, 160);
      }
    } else {
      tween(badge, { opacity: '0', transform: 'scale(.6)' }, first ? 0 : 140, EASE.exit);
    }
  }

  /* ---------- step change: MOTION §5 ---------- */
  function heroFor(i) {
    var s = STEPS[i];
    setTint(s);
    if (s !== 'try') { tile.classList.remove('live', 'spin'); showGlyph(s, !first); }
    else showGlyph(dict === 'transcribing' ? 'transcribing' : 'try', !first);
    setBadge(CHECKS.indexOf(s) >= 0 ? checks[s] === true : (s === 'try' && dict === 'done-ok'), false);
  }
  function go(i, opts) {
    if (i < 0 || i >= STEPS.length || i === cur) return;
    clearTimeout(advanceTimer);
    var dir = i > cur ? 1 : -1, prev = cur;
    var outEl = prev >= 0 ? $('.step[data-step="' + STEPS[prev] + '"]') : null;
    var inEl = $('.step[data-step="' + STEPS[i] + '"]');
    cur = i;
    app.dataset.step = STEPS[i];
    var instant = first || (opts && opts.instant);
    if (outEl) {
      outEl.classList.remove('active'); outEl.setAttribute('aria-hidden', 'true');
      outEl.style.visibility = 'visible';
      var a = reduced() || instant
        ? tween(outEl, { opacity: '0', transform: 'none' }, instant ? 0 : 200, 'ease-out')
        : tween(outEl, { opacity: '0', transform: 'translateX(' + (-16 * dir) + 'px)' }, 180, EASE.exit);
      var hide = function () { if (!outEl.classList.contains('active')) outEl.style.visibility = ''; };
      if (a) a.addEventListener('finish', hide); else hide();
    }
    inEl.classList.add('active'); inEl.removeAttribute('aria-hidden');
    if (reduced() || instant) {
      inEl.style.transform = 'none';
      if (!instant) inEl.style.opacity = '0';
      tween(inEl, { opacity: '1' }, instant ? 0 : 200, 'ease-out');
    } else {
      inEl.style.opacity = '0'; inEl.style.transform = 'translateX(' + (24 * dir) + 'px)';
      tween(inEl, { opacity: '1', transform: 'translateX(0px)' }, 420, EASE.enter, 120);
    }
    placeIndicator(i);
    heroFor(i);
    back.classList.toggle('on', i > 0);
    back.tabIndex = i > 0 ? 0 : -1;
    if (STEPS[i] === 'try') { setTimeout(function () { textarea.focus(); }, instant ? 0 : 200); }
    else if (!first) { var p = primaryOf(inEl); if (p) setTimeout(function () { p.focus({ preventScroll: true }); }, 140); }
  }
  function primaryOf(stepEl) {
    return $$('.btn.primary', stepEl).filter(function (b) { return !b.hidden; })[0];
  }
  function firstIncomplete() {
    for (var i = 1; i < STEPS.length; i++) if (CHECKS.indexOf(STEPS[i]) >= 0 && checks[STEPS[i]] !== true) return i;
    return STEPS.indexOf('key');
  }

  /* ---------- checks ---------- */
  function applyCheck(name, v, prevV) {
    var step = $('.step[data-step="' + name + '"]');
    step.dataset.ok = v === true ? 'true' : v === false ? 'false' : 'unknown';
    $$('[data-when]', step).forEach(function (b) {
      var show = (b.dataset.when === 'ok') === (v === true);
      if (b.hidden === !show) return;
      if (show) b.hidden = false; else { if (b === document.activeElement) setTimeout(focusPrimary, 0); b.hidden = true; }
    });
    var line = $('[data-state-line]', step), text = LINES[name][word(v)];
    if (line.textContent !== text) {
      if (first) line.textContent = text;
      else { line.classList.add('swap'); setTimeout(function () { line.textContent = text; line.classList.remove('swap'); }, 140); }
    }
    if (STEPS[cur] === name) {
      if (v === true && prevV !== true && !first) {
        // permission just turned green on the step you're looking at: celebrate, then move on
        setBadge(true, true);
        clearTimeout(advanceTimer);
        advanceTimer = setTimeout(function () { if (STEPS[cur] === name) go(cur + 1); }, reduced() ? 900 : 1100);
      } else setBadge(v === true, false);
    }
  }
  function focusPrimary() { var p = primaryOf($('.step.active')); if (p) p.focus({ preventScroll: true }); }

  function refreshSummary() {
    var ready = CHECKS.filter(function (k) { return checks[k] === true; }).length;
    summary.textContent = ready === CHECKS.length ? 'Everything is ready.' : ready + ' of ' + CHECKS.length + ' ready';
  }

  function setKeyLabel(l) {
    keyWell.classList.remove('capturing');
    changeKey.textContent = 'Change…'; changeKey.classList.remove('busy');
    keyHint.textContent = 'A key, a combo, or an extra mouse button.';
    if (!l || l === label) return;
    var was = label; label = l;
    var apply = function () {
      keyLabel.textContent = l;
      $$('[data-keylabel]').forEach(function (k) { k.textContent = l; });
      textarea.placeholder = 'Hold ' + l + ' and talk. Your words appear here.';
      keyLabel.classList.remove('swap');
      if (!first && was !== '…') {
        keyLabel.classList.remove('pop'); void keyLabel.offsetWidth; keyLabel.classList.add('pop');
        if (reduced()) { keyRing.style.transform = 'scale(1)'; keyRing.style.opacity = '.8'; tween(keyRing, { opacity: '0' }, 600, 'ease-out', 200); }
        else { keyRing.style.opacity = '.9'; keyRing.style.transform = 'scale(1)'; tween(keyRing, { opacity: '0', transform: 'scale(1.45)' }, 700, EASE.enter); }
      }
    };
    if (first || was === '…') apply();
    else { keyLabel.classList.add('swap'); setTimeout(apply, 140); }
  }

  var pending = null, timer = 0;
  function flush() {
    timer = 0;
    var d = pending; pending = null;
    CHECKS.forEach(function (k) {
      if (!(k in d)) return;            // omitted → keep last known
      var prevV = checks[k];
      checks[k] = norm(d[k]);
      applyCheck(k, checks[k], prevV);
      if (busyAction && busyMap[busyAction] === k) clearBusy();
    });
    if (d.keyLabel) setKeyLabel(d.keyLabel);
    refreshSummary();
    if (!first) placeIndicator(cur);
    if (first) { go(0); first = false; }
  }
  window.onInit = function (d) {
    pending = Object.assign(pending || {}, d || {});
    if (!timer) timer = setTimeout(flush, 16);   // coalesce bursts; last wins
  };
  window.onKeyChanged = function (l) { setKeyLabel(l); };

  // the big keycap sinks while your button is held
  function keyDown(on) { keyLabel.classList.toggle('down', !!on); }
  keyLabel.addEventListener('pointerdown', function () { keyDown(true); });
  window.addEventListener('pointerup', function () { if (dict !== 'listening') keyDown(false); });

  /* ---------- Try it: live dictation mirror ---------- */
  var dict = 'idle', baseline = '', insertTimer = 0;
  var statusTimer = 0, statusWant = null;
  function setStatus(text, good) {
    if (statusWant === null ? tryStatus.textContent === text : statusWant === text) return;
    statusWant = text;
    clearTimeout(statusTimer);   // a newer status replaces one still fading out
    tryStatus.classList.add('swap');
    statusTimer = setTimeout(function () {
      tryStatus.textContent = text; tryStatus.classList.toggle('good', !!good); tryStatus.classList.remove('swap'); statusWant = null;
    }, 120);
  }
  function insertText(t) {
    var v = textarea.value, s = textarea.selectionStart, e = textarea.selectionEnd;
    if (document.activeElement !== textarea) { s = e = v.length; }
    var pre = v.slice(0, s), sep = pre && !/\s$/.test(pre) ? ' ' : '';
    textarea.value = pre + sep + t + v.slice(e);
    var caret = (pre + sep + t).length;
    textarea.setSelectionRange(caret, caret);
  }
  function celebrateText() {
    var glow = $('.fieldglow', field);
    if (reduced()) {
      glow.style.opacity = '1'; tween(glow, { opacity: '0' }, 600, 'ease-out', 600);
    } else {
      glow.style.opacity = '0';
      var a = glow.animate([{ opacity: 0 }, { opacity: 1, offset: .25 }, { opacity: 0 }], { duration: 1400, easing: EASE.standard });
      a.onfinish = function () { glow.style.opacity = '0'; };
      textarea.animate([{ opacity: .35 }, { opacity: 1 }], { duration: 420, easing: EASE.enter });
    }
  }
  function setTryHeadline(t) {
    if (tryH.textContent === t) return;
    if (reduced() || first) { tryH.textContent = t; return; }
    freeze(tryH); tryH.textContent = t; tryH.style.opacity = '0';
    tween(tryH, { opacity: '1' }, 280, EASE.enter);
  }
  function glowOut() { tween(tryGlow, { opacity: '0', transform: 'scale(.6)' }, reduced() ? 120 : 280, EASE.exit); }

  window.onDictation = function (d) {
    d = d || {};
    var st = d.state;
    if (st === 'listening') {
      clearTimeout(insertTimer);
      if (dict !== 'listening') baseline = textarea.value;
      dict = 'listening';
      field.classList.add('listening');
      keyDown(true);
      if (STEPS[cur] === 'microphone') { showGlyph('try', true); tile.classList.add('live'); startMeter(); return; }
      if (STEPS[cur] !== 'try') return;
      showGlyph('try', true); tile.classList.add('live'); tile.classList.remove('spin');
      setBadge(false, false); startMeter();
      setStatus('Listening…');
    } else if (st === 'transcribing') {
      dict = 'transcribing';
      keyDown(false); glowOut();
      if (STEPS[cur] === 'microphone') { tile.classList.remove('live'); showGlyph('microphone', true); }
      field.classList.remove('listening'); stopMeter();
      tile.classList.remove('live'); tile.classList.add('spin');
      if (STEPS[cur] === 'try') showGlyph('transcribing', true);
      setStatus('Turning speech into text…');
    } else if (st === 'done') {
      field.classList.remove('listening'); stopMeter(); tile.classList.remove('live', 'spin');
      keyDown(false); glowOut();
      var text = (d.text || '').trim();
      if (STEPS[cur] === 'try') showGlyph('try', true);
      else if (STEPS[cur] === 'microphone') showGlyph('microphone', true);
      if (!text) { dict = 'idle'; setStatus("Didn't catch that. Hold your button and try again."); return; }
      dict = 'done-ok';
      clearTimeout(insertTimer);
      // The engine pastes into this field. If nothing landed, put the words in ourselves.
      insertTimer = setTimeout(function () {
        if (textarea.value === baseline) insertText(text);
        celebrateText();
      }, 300);
      if (STEPS[cur] === 'try') setBadge(true, true);
      setTryHeadline('That was you.');
      placeIndicator(cur);
      setStatus("It works. Use it anywhere you type.", true);
      finishBtn.textContent = "You're set";
    } else if (st === 'cancelled' || st === 'error' || st === 'hidden') {
      field.classList.remove('listening'); stopMeter(); tile.classList.remove('live', 'spin');
      keyDown(false); glowOut();
      if (STEPS[cur] === 'try') showGlyph('try', true);
      else if (STEPS[cur] === 'microphone') showGlyph('microphone', true);
      if (dict !== 'done-ok') dict = 'idle';
      if (st === 'cancelled') setStatus('Cancelled. Hold your button to try again.');
      if (st === 'error') setStatus(d.message || 'Something went wrong. Try again.');
    }
  };

  /* meter: MOTION §3 — spring follow, decay between samples, quantized under reduced motion */
  var PROFILE = [.45, .7, .9, 1, .9, .7, .45], jitter = PROFILE.map(function () { return 1; });
  var target = 0, display = 0, vel = 0, gotSample = false, raf = 0, lastT = 0, lastQ = 0;
  window.onLevel = function (x) {
    x = Math.max(0, Math.min(1, +x || 0));
    target = x; gotSample = true;
    jitter = jitter.map(function () { return 0.92 + Math.random() * 0.16; });
  };
  function draw(v) {
    for (var i = 0; i < bars.length; i++) {
      var h = v < 0.04 ? 8 : 8 + 30 * v * PROFILE[i] * jitter[i];   // 8px floor: a 5px bar shorter than that reads as a dash
      bars[i].style.transform = 'scaleY(' + (h / 40).toFixed(3) + ')';
    }
    if (dict === 'listening') {
      var g = Math.min(1, v);
      tryGlow.style.transform = 'scale(' + (0.6 + 0.7 * g).toFixed(3) + ')';
      tryGlow.style.opacity = (0.25 + 0.75 * g).toFixed(3);
    }
  }
  function frame(t) {
    raf = requestAnimationFrame(frame);
    var dt = Math.min(0.05, (t - (lastT || t)) / 1000); lastT = t;
    if (reduced()) {
      if (t - lastQ < 200) return; lastQ = t;
      draw(target < 0.04 ? 0 : target < 0.4 ? 0.3 : target < 0.7 ? 0.6 : 0.95);
    } else {
      var w = 40, a = w * w * (target - display) - 2 * w * vel;
      vel += a * dt; display += vel * dt;
      draw(Math.max(0, display));
    }
    if (!gotSample) target *= 0.85; gotSample = false;
  }
  function startMeter() { freeze(tryGlow); if (!raf) { lastT = 0; raf = requestAnimationFrame(frame); } }
  // At rest the meter holds a quiet waveform silhouette, so the idle tile reads as a glyph, not dots.
  function restScale(i) { return (0.14 + 0.36 * PROFILE[i] * PROFILE[i]).toFixed(3); }
  function stopMeter() {
    if (raf) cancelAnimationFrame(raf); raf = 0; target = display = vel = 0;
    bars.forEach(function (b, i) { tween(b, { transform: 'scaleY(' + restScale(i) + ')' }, reduced() ? 0 : 240, EASE.morph); });
  }
  bars.forEach(function (b, i) { b.style.transform = 'scaleY(' + restScale(i) + ')'; });

  /* ---------- actions ---------- */
  var busyMap = { startServer: 'serverOk', launchAtLogin: 'launchAtLogin' };
  function clearBusy() { $$('.btn.busy').forEach(function (b) { b.classList.remove('busy'); }); busyAction = null; }
  function send(action, btn) {
    if (action === 'setKey') {
      keyWell.classList.add('capturing'); changeKey.textContent = 'Press a key…'; changeKey.classList.add('busy');
      keyHint.textContent = 'Press your new button now. Esc cancels.';
    }
    if (busyMap[action] && btn) { btn.classList.add('busy'); busyAction = action; }
    if (bridge) bridge.postMessage({ action: action });
    else simulate(action);
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-action],[data-go]');
    if (!b) return;
    if (b.dataset.go === 'next') go(STEPS[cur] === 'welcome' ? firstIncomplete() : cur + 1);
    else send(b.dataset.action, b);
  });
  back.addEventListener('click', function () { go(cur - 1); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && keyWell.classList.contains('capturing')) { setKeyLabel(null); return; }
    if (e.target === textarea) return;
    if ((e.metaKey && e.key === '[') || (e.key === 'ArrowLeft' && !e.target.closest('.dots'))) { e.preventDefault(); go(cur - 1); }
    else if (e.key === 'ArrowRight' && !e.target.closest('.dots') && STEPS[cur] !== 'try') { e.preventDefault(); go(cur + 1); }
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

  /* ---------- browser simulator ---------- */
  var sim = { keyLabel: '⌥Space', serverOk: true, accessibility: false, microphone: false, launchAtLogin: false };
  var simMap = { openMicrophone: 'microphone', openAccessibility: 'accessibility', launchAtLogin: 'launchAtLogin', startServer: 'serverOk' };
  var simKeys = ['⌥Space', 'Mouse 4', 'Right ⌥', 'Fn', 'F13'];
  var simTimers = [];
  function simulate(action) {
    if (simMap[action]) { sim[simMap[action]] = true; setTimeout(function () { window.onInit(sim); }, 900); }
    else if (action === 'recheck') setTimeout(function () { window.onInit(sim); }, 120);
    else if (action === 'setKey') setTimeout(function () {
      sim.keyLabel = simKeys[(simKeys.indexOf(sim.keyLabel) + 1) % simKeys.length];
      window.onKeyChanged(sim.keyLabel);
    }, 1200);
    else if (action === 'close') console.log('[sim] close');
  }
  // __sim.say(text, {paste:true|false, ms}) plays listening → levels → transcribing → done.
  function say(text, opts) {
    opts = opts || {};
    simTimers.forEach(clearTimeout); simTimers = [];
    var ms = opts.ms || 1600, t0 = 0, at = function (dt, fn) { simTimers.push(setTimeout(fn, dt)); };
    window.onDictation({ state: 'listening' });
    for (t0 = 0; t0 < ms; t0 += 66) (function (t) {
      at(t, function () { window.onLevel(0.35 + 0.35 * Math.sin(t / 140) * Math.sin(t / 370) + Math.random() * 0.25); });
    })(t0);
    at(ms, function () { window.onDictation({ state: 'transcribing' }); });
    at(ms + 700, function () {
      if (opts.paste !== false && text && document.activeElement === textarea) insertText(text); // what a real ⌘V would do
      window.onDictation({ state: 'done', text: text });
    });
  }
  window.__sim = {
    state: sim,
    init: function (d) { Object.assign(sim, d || {}); window.onInit(sim); },
    grant: function (k) { sim[k] = true; window.onInit(sim); },
    revoke: function (k) { sim[k] = false; window.onInit(sim); },
    key: function (l) { sim.keyLabel = l; window.onKeyChanged(l); },
    go: function (s) { go(typeof s === 'number' ? s : STEPS.indexOf(s)); },
    say: say,
    level: function (x) { window.onLevel(x); },
    dictation: function (d) { window.onDictation(d); },
    steps: STEPS
  };
  $('#simSay').addEventListener('click', function () { say('Hello from FreeDictate, this is working.'); });
  if (!bridge) window.onInit(sim);
})();
