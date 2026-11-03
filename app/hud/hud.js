/* Dictate HUD runtime. Contract: window.setState(state, payload?), window.setLevel(x), window.EXIT_MS.
   Implements design/DESIGN.md §3 and design/MOTION.md §0-4. */
(function () {
  'use strict';
  window.EXIT_MS = 200;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var body = document.body;
  var hud = $('#hud'), press = $('#press'), shake = $('#shake');
  var lcap = $('.lcap'), slab = $('.slab'), rcap = $('.rcap');
  var faces = {};
  document.querySelectorAll('.face').forEach(function (f) { faces[f.dataset.face] = f; });
  var bars = Array.prototype.slice.call(document.querySelectorAll('.meter i'));
  var dot = $('.dot'), lock = $('.lock'), kbd = $('.kbd');
  var checkPath = $('.check path'), checkSvg = $('.check');
  var spinner = $('.spinner'), shimmerLabel = $('.shimmer'), ell = $('.ell');
  var previewEl = $('.preview'), msgEl = $('.msg'), live = $('#live');

  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var reduced = function () { return !!mq.matches; };

  var supportsLinear = window.CSS && CSS.supports && CSS.supports('animation-timing-function', 'linear(0, 1)');
  var EASE = {
    standard: 'cubic-bezier(0.2,0,0,1)',
    enter: 'cubic-bezier(0.16,1,0.3,1)',
    exit: 'cubic-bezier(0.4,0,1,1)',
    fade: 'ease-out',
    morph: supportsLinear ? 'linear(0, 0.25 8%, 0.6 20%, 0.85 34%, 0.96 50%, 1)' : 'cubic-bezier(0.16,1,0.3,1)',
    snappy: supportsLinear ? 'linear(0, 0.18 6%, 0.52 14%, 0.8 24%, 0.96 36%, 1.02 48%, 1.01 60%, 1)' : 'cubic-bezier(0.34,1.2,0.64,1)'
  };
  var SLAB_BASIS = 224, MAX_W = 264, MIN_DONE = 120;

  /* ---------- tween engine: interrupt from current values ---------- */
  function freeze(el) {
    el.getAnimations().forEach(function (a) {
      try { a.commitStyles(); } catch (e) {}
      a.cancel();
    });
  }
  // props: {transform?, opacity?, strokeDashoffset?}; animates from current inline/computed values
  function tween(el, props, dur, ease, delay) {
    freeze(el);
    var cs = getComputedStyle(el), from = {}, to = {};
    Object.keys(props).forEach(function (k) {
      from[k] = el.style[k] || (k === 'transform' ? (cs.transform === 'none' ? 'none' : cs.transform) : cs[k]);
      to[k] = props[k];
    });
    if (!dur) { Object.keys(props).forEach(function (k) { el.style[k] = props[k]; }); return null; }
    var a = el.animate([from, to], { duration: dur, easing: ease || EASE.standard, delay: delay || 0, fill: 'both' });
    a.onfinish = function () {
      Object.keys(props).forEach(function (k) { el.style[k] = props[k]; });
      try { a.cancel(); } catch (e) {}
    };
    return a;
  }
  function setNow(el, props) { freeze(el); Object.keys(props).forEach(function (k) { el.style[k] = props[k]; }); }

  /* ---------- capsule width morph ---------- */
  var curW = 176;
  function shapeTo(w, dur, ease) {
    curW = w;
    var half = w / 2;
    if (reduced()) dur = 0;
    tween(lcap, { transform: 'translateX(' + (-half) + 'px)' }, dur, ease);
    tween(slab, { transform: 'scaleX(' + ((w - 40) / SLAB_BASIS) + ')' }, dur, ease);
    tween(rcap, { transform: 'translateX(' + (half - 21) + 'px)' }, dur, ease);
  }
  function shapeSnap(w) { curW = w; var h = w / 2;
    setNow(lcap, { transform: 'translateX(' + (-h) + 'px)' });
    setNow(slab, { transform: 'scaleX(' + ((w - 40) / SLAB_BASIS) + ')' });
    setNow(rcap, { transform: 'translateX(' + (h - 21) + 'px)' });
  }
  function fitWidth(face) {
    // measure once, before the morph
    var prevOp = face.style.opacity, prevVis = face.style.visibility;
    face.style.visibility = 'hidden';
    var w = Math.ceil(face.getBoundingClientRect().width);
    face.style.visibility = prevVis; face.style.opacity = prevOp;
    return w;
  }

  /* ---------- content crossfade (XF) ---------- */
  var activeFace = null;
  function showFace(name, morphMs) {
    var inc = faces[name];
    Object.keys(faces).forEach(function (k) {
      var f = faces[k];
      if (f === inc) return;
      var op = parseFloat(getComputedStyle(f).opacity);
      if (op > 0 || f.getAnimations().length) {
        if (reduced()) tween(f, { opacity: '0' }, 120, EASE.exit);
        else tween(f, { opacity: '0' }, Math.max(60, morphMs * 0.4), EASE.exit);
      }
    });
    if (activeFace !== inc) {
      if (reduced()) tween(inc, { opacity: '1' }, 160, EASE.fade);
      else tween(inc, { opacity: '1' }, morphMs * 0.6, EASE.fade, morphMs * 0.3);
    }
    activeFace = inc;
  }

  /* ---------- level meter ---------- */
  var PROFILE = [.45, .7, .9, 1, .9, .7, .45];
  var jitter = PROFILE.map(function () { return 1; });
  var target = 0, display = 0, vel = 0, fresh = false, raf = 0, lastT = 0;
  var lastRmUpdate = 0, frozen = false;
  function renderBars(level) {
    for (var i = 0; i < bars.length; i++) {
      var h = level < 0.04 ? 4 : 4 + 20 * level * PROFILE[i] * jitter[i];
      bars[i].style.transform = 'scaleY(' + (Math.min(24, h) / 24).toFixed(4) + ')';
    }
  }
  function loop(t) {
    raf = 0;
    if (state !== 'listening' || frozen) return;
    var dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 1 / 60;
    lastT = t;
    if (reduced()) {
      if (t - lastRmUpdate >= 200) {
        lastRmUpdate = t;
        var q = target < 0.04 ? 0 : target < 0.35 ? 0.25 : target < 0.7 ? 0.6 : 1;
        renderBars(q);
      }
    } else {
      if (!fresh) target *= 0.85; else fresh = false;
      var w = 40, acc = -2 * w * vel - w * w * (display - target);
      vel += acc * dt; display += vel * dt;
      if (display < 0) { display = 0; vel = 0; }
      renderBars(display);
    }
    raf = requestAnimationFrame(loop);
  }
  function startLoop() { frozen = false; if (!raf) { lastT = 0; raf = requestAnimationFrame(loop); } }
  function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

  window.setLevel = function (x) {
    x = +x; if (!isFinite(x)) return;
    target = Math.max(0, Math.min(1, x)); fresh = true;
    for (var i = 0; i < jitter.length; i++) jitter[i] = 0.92 + Math.random() * 0.16;
  };

  /* ---------- reduced-motion ellipsis stepper ---------- */
  var ellTimer = 0;
  function startEll() {
    stopEll(); var n = 0;
    ell.textContent = '.';
    ellTimer = setInterval(function () { n = (n + 1) % 3; ell.textContent = ['.', '..', '...'][n]; }, 500);
  }
  function stopEll() { if (ellTimer) clearInterval(ellTimer); ellTimer = 0; ell.textContent = '…'; }

  /* ---------- copy helpers ---------- */
  function previewText(text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    if (t.length > 24) {
      var cut = t.slice(0, 24), sp = cut.lastIndexOf(' ');
      t = (sp > 8 ? cut.slice(0, sp) : cut).replace(/[\s.,;:!?-]+$/, '') + '…';
    }
    return '“' + t + '”';
  }
  function announce(s) { live.textContent = s; }

  /* ---------- state machine ---------- */
  var state = 'hidden', mode = null, visible = false;

  function enter() {
    // hidden -> listening, or re-entry mid-exit (retarget from current values)
    var midExit = hud.getAnimations().length > 0 || parseFloat(getComputedStyle(hud).opacity) > 0.01;
    if (reduced()) {
      setNow(hud, { transform: 'none' });
      tween(hud, { opacity: '1' }, 160, EASE.fade);
      return;
    }
    if (!midExit) setNow(hud, { opacity: '0', transform: 'translateY(6px) scale(.92)' });
    tween(hud, { transform: 'translateY(0px) scale(1)' }, 280, EASE.morph);
    // opacity on its own element would be cleaner; animate both on #hud with a separate animation
    hud.animate([{ opacity: getComputedStyle(hud).opacity }, { opacity: 1 }], { duration: 160, easing: EASE.fade, fill: 'both' })
      .onfinish = function () { hud.style.opacity = '1'; };
    if (!midExit) {
      // bars rise from their stub in 3 centre-out groups, 30ms apart
      var groups = [[3], [2, 4], [0, 1, 5, 6]];
      groups.forEach(function (g, gi) {
        g.forEach(function (i) {
          bars[i].animate([{ opacity: 0 }, { opacity: .92 }], { duration: 140, delay: gi * 30, easing: EASE.fade, fill: 'backwards' });
        });
      });
    }
  }

  function exit(dur) {
    stopLoop(); stopEll();
    if (reduced()) { tween(hud, { opacity: '0' }, 120, EASE.exit); return; }
    var ms = dur || 180;
    tween(hud, { transform: 'translateY(0px) scale(.96)' }, ms, EASE.exit);
    hud.animate([{ opacity: getComputedStyle(hud).opacity }, { opacity: 0 }], { duration: ms, easing: EASE.exit, fill: 'both' })
      .onfinish = function () { hud.style.opacity = '0'; };
  }

  function setPressed(on, dur) {
    if (reduced()) { setNow(press, { transform: 'none' }); return; }
    tween(press, { transform: on ? 'scale(.97)' : 'scale(1)' }, dur, EASE.standard);
  }

  function applyMode(m) {
    body.dataset.mode = m || 'pending';
    var tap = m === 'tap';
    if (tap) {
      if (reduced()) { setNow(lock, { opacity: '1', transform: 'none' }); setNow(kbd, { opacity: '1', transform: 'none' }); }
      else {
        setNow(lock, { opacity: '0', transform: 'translateX(4px)' }); setNow(kbd, { opacity: '0', transform: 'translateX(4px)' });
        tween(lock, { opacity: '1', transform: 'translateX(0px)' }, 140, EASE.standard, 80);
        tween(kbd, { opacity: '1', transform: 'translateX(0px)' }, 140, EASE.standard, 80);
      }
    } else { setNow(lock, { opacity: '0' }); setNow(kbd, { opacity: '0' }); }
  }

  function apply(next, payload) {
    payload = payload || {};
    var prev = state;
    var newMode = payload.mode === 'tap' || payload.mode === 'hold' ? payload.mode : null;
    body.dataset.state = next;

    switch (next) {
      case 'hidden':
        if (prev === 'hidden') { setNow(hud, { opacity: '0' }); break; }
        exit(prev === 'cancelled' ? 150 : 180);
        announce('');
        break;

      case 'listening': {
        frozen = false;
        if (prev === 'listening') {
          // retarget in place, never re-enter
          if (newMode && newMode !== mode) {
            mode = newMode; applyMode(mode);
            if (mode === 'hold') setPressed(true, 140);
            else { setPressed(false, 140); shapeTo(216, 300, EASE.morph); }
          }
          break;
        }
        mode = newMode;
        target = display = vel = 0; renderBars(0);
        applyMode(mode);
        setNow(dot, { opacity: '1' });
        bars.forEach(function (b) { setNow(b, { opacity: '.92' }); });
        var w = mode === 'tap' ? 216 : 176;
        if (prev === 'hidden' || parseFloat(getComputedStyle(hud).opacity) < 0.02) {
          shapeSnap(w);
          Object.keys(faces).forEach(function (k) { setNow(faces[k], { opacity: '0' }); });
          setNow(faces.listening, { opacity: '1' }); activeFace = faces.listening;
          setNow(press, { transform: mode === 'hold' && !reduced() ? 'scale(.97)' : 'scale(1)' });
        } else {
          shapeTo(w, 280, EASE.morph); showFace('listening', 280);
          setPressed(mode === 'hold', 140);
        }
        setNow(shake, { transform: 'none' });
        enter();
        startLoop();
        announce(mode === 'tap' ? 'Listening. Press the talk key again to finish.' : 'Listening');
        break;
      }

      case 'transcribing':
        stopLoop();
        setPressed(false, 300);
        if (!reduced()) {
          bars.forEach(function (b) { tween(b, { transform: 'scaleY(.1667)', opacity: '0' }, 120, EASE.exit); });
          tween(dot, { opacity: '0' }, 120, EASE.exit);
        }
        shapeTo(168, 300, EASE.morph);
        showFace('transcribing', 300);
        if (reduced()) startEll(); else stopEll();
        if (prev === 'hidden') { shapeSnap(168); enterBare(); }
        announce('Transcribing');
        break;

      case 'done': {
        stopLoop(); stopEll();
        setPressed(false, 240);
        var text = String(payload.text || '').replace(/\s+/g, ' ').trim();
        if (text) {
          faces.done.style.width = '';
          previewEl.textContent = ' · ' + previewText(text);
          var fw = Math.max(MIN_DONE, Math.min(MAX_W, fitWidth(faces.done)));
          faces.done.style.width = fw + 'px';
          shapeTo(fw, 300, EASE.morph);
          showFace('done', 300);
          // check: draw + scale with 2% overshoot
          if (reduced()) { setNow(checkPath, { strokeDashoffset: '0' }); setNow(checkSvg, { transform: 'none' }); }
          else {
            setNow(checkPath, { strokeDashoffset: '1' });
            tween(checkPath, { strokeDashoffset: '0' }, 240, EASE.enter, 90);
            setNow(checkSvg, { transform: 'scale(.8)' });
            tween(checkSvg, { transform: 'scale(1)' }, 300, EASE.snappy, 90);
          }
          announce('Pasted: ' + text);
        } else {
          shapeTo(148, 240, EASE.standard);
          showFace('empty', 240);
          announce('Nothing heard');
        }
        if (prev === 'hidden') enterBare();
        break;
      }

      case 'cancelled':
        frozen = true; stopLoop(); stopEll(); // bars freeze where they are
        var fromListening = prev === 'listening';
        shapeTo(132, fromListening ? 150 : 150, EASE.exit);
        if (reduced()) showFace('cancelled', 0);
        else {
          // label XF in 80ms
          Object.keys(faces).forEach(function (k) { if (k !== 'cancelled') tween(faces[k], { opacity: '0' }, 80, EASE.exit); });
          tween(faces.cancelled, { opacity: '1' }, 80, EASE.fade); activeFace = faces.cancelled;
          if (fromListening) {
            freeze(shake);
            shake.animate([
              { transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' },
              { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }
            ], { duration: 120, easing: 'linear' });
          }
        }
        setPressed(false, 150);
        if (prev === 'hidden') enterBare();
        announce('Cancelled');
        break;

      case 'error': {
        stopLoop(); stopEll();
        var msg = String(payload.message || '').trim() || 'Something went wrong';
        msgEl.textContent = msg;
        faces.error.style.width = '';
        var ew = Math.min(MAX_W, fitWidth(faces.error));
        faces.error.style.width = ew + 'px';
        shapeTo(ew, 240, EASE.standard);
        showFace('error', 240);
        setPressed(false, 240);
        setNow(shake, { transform: 'none' });
        if (prev === 'hidden') enterBare();
        announce(msg);
        break;
      }
      default: return;
    }
    state = next;
  }

  // entrance for non-listening states shown from hidden (e.g. Lua sends error first)
  function enterBare() {
    if (reduced()) { tween(hud, { opacity: '1' }, 160, EASE.fade); return; }
    if (parseFloat(getComputedStyle(hud).opacity) < 0.02) setNow(hud, { opacity: '0', transform: 'translateY(6px) scale(.92)' });
    tween(hud, { transform: 'translateY(0px) scale(1)' }, 280, EASE.morph);
    hud.animate([{ opacity: getComputedStyle(hud).opacity }, { opacity: 1 }], { duration: 160, easing: EASE.fade, fill: 'both' })
      .onfinish = function () { hud.style.opacity = '1'; };
  }

  /* coalesce calls under 16ms apart: last one wins */
  var STATES = { hidden: 1, listening: 1, transcribing: 1, done: 1, cancelled: 1, error: 1 };
  var lastApply = 0, pending = null, pendingTimer = 0;
  window.setState = function (s, payload) {
    if (!STATES[s]) return;
    var now = performance.now();
    if (now - lastApply >= 16 && !pendingTimer) { lastApply = now; apply(s, payload); return; }
    pending = [s, payload];
    if (!pendingTimer) pendingTimer = setTimeout(function () {
      pendingTimer = 0; lastApply = performance.now();
      var p = pending; pending = null; apply(p[0], p[1]);
    }, Math.max(0, 16 - (now - lastApply)));
  };
  window.getState = function () { return { state: state, mode: mode, width: curW }; };

  /* dev harness bridge (preview.html over file:// is cross-origin): postMessage in, state out */
  if (window.parent !== window) {
    window.addEventListener('message', function (e) {
      var d = e.data || {};
      if (d.hud === 'setState') window.setState(d.state, d.payload);
      else if (d.hud === 'setLevel') window.setLevel(d.level);
    });
    setInterval(function () { try { window.parent.postMessage({ hudState: window.getState(), EXIT_MS: window.EXIT_MS }, '*'); } catch (e) {} }, 100);
  }

  // initial
  shapeSnap(176);
  hud.style.opacity = '0';
  if (mq.addEventListener) mq.addEventListener('change', function () { if (state === 'listening') startLoop(); });
})();
