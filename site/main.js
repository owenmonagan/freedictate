(function(){
  var RM=matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------- copy install command ---------- */
  var cb=document.getElementById('copyBtn');
  if(cb)cb.addEventListener('click',function(){
    var t=document.getElementById('installCmd').textContent;
    function ok(){cb.textContent='Copied';setTimeout(function(){cb.textContent='Copy'},1600)}
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(ok,fallback)}else fallback();
    function fallback(){var r=document.createRange();r.selectNodeContents(document.getElementById('installCmd'));var s=getSelection();s.removeAllRanges();s.addRange(r);try{document.execCommand('copy');ok()}catch(e){}}
  });

  var stage=document.getElementById('heroStage');
  if(!stage)return;

  /* ---------- hero: the key drives the HUD and the Mail draft ---------- */
  var LINES=[
    "Hi Sam, let's move the design review to Thursday at four. I'll send the deck tonight.",
    "Sounds good. Can you send me the notes from today's call?",
    "Thanks for the quick turnaround, this looks great.",
    "I'm running ten minutes late, start without me."
  ];
  var hud=createHud(stage);
  var key=document.getElementById('talkKey'), led=document.getElementById('led');
  var typed=document.getElementById('typed'), docText=typed.parentNode;
  var timers=[], levelTimer=0, typeTimer=0, autoOn=false, visible=true, idleT=0, isDown=false, downAt=0, line=0;

  function later(fn,ms){timers.push(setTimeout(fn,ms))}
  function clearAll(){timers.forEach(clearTimeout);timers=[];clearInterval(levelTimer);clearInterval(typeTimer)}
  // a speech-like level curve: syllable bursts with pauses
  function level(t){var s=Math.max(0,Math.sin(t*9.5))*.55+Math.max(0,Math.sin(t*3.1+1))*.35;var gap=(t%1.1)>.92?.1:1;return Math.min(1,(s*gap)*1.5+Math.random()*.08)}
  function press(on){key.classList.toggle('down',on);led.classList.toggle('on',on)}
  function listen(){
    hud.setStateNow('starting');
    later(function(){
      hud.setStateNow('listening',{mode:'hold'});
      var t0=performance.now();
      levelTimer=setInterval(function(){hud.setLevel(level((performance.now()-t0)/1000))},66);
    },RM.matches?0:260);
  }
  // transcribe, then type the line into the draft; resolves after the pill hides
  function paste(text,then){
    clearInterval(levelTimer);hud.setLevel(0);hud.setStateNow('transcribing');
    later(function(){
      hud.setStateNow('done',{text:text});
      if(RM.matches){typed.textContent=text}
      else{var i=0;typeTimer=setInterval(function(){i++;typed.textContent=text.slice(0,i);if(i>=text.length)clearInterval(typeTimer)},1000/40)}
      later(function(){hud.setStateNow('hidden');then&&then()},Math.max(900,text.length/40*1000));
    },RM.matches?300:800);
  }
  function clearDoc(then){
    if(!typed.textContent||RM.matches){typed.textContent='';then();return}
    docText.classList.add('clearing');
    later(function(){typed.textContent='';docText.classList.remove('clearing');then()},260);
  }

  // attract loop: the key presses itself until someone touches it
  function autoLoop(){
    if(!autoOn)return;
    clearAll();
    clearDoc(function(){
      later(function(){
        press(true);listen();
        later(function(){press(false);paste(LINES[0],function(){later(autoLoop,2600)})},2600);
      },500);
    });
  }
  function startAuto(){if(autoOn||RM.matches||!visible||document.hidden)return;autoOn=true;autoLoop()}
  function stopAuto(){autoOn=false;clearAll();press(false);hud.setStateNow('hidden')}

  // the visitor's own press
  function down(){
    if(isDown)return;isDown=true;clearTimeout(idleT);
    stopAuto();
    press(true);downAt=performance.now();
    clearDoc(listen);
  }
  function up(){
    if(!isDown)return;isDown=false;press(false);
    var held=performance.now()-downAt;
    clearAll();
    if(held<200){clearInterval(levelTimer);hud.setLevel(0);hud.setStateNow('done',{text:''});later(function(){hud.setStateNow('hidden')},900);scheduleIdle();return}
    line=line%(LINES.length-1)+1;
    paste(LINES[line],scheduleIdle);
  }
  function cancel(){
    if(!isDown&&hud.state!=='listening'&&hud.state!=='starting')return;
    isDown=false;press(false);clearAll();hud.setLevel(0);hud.setStateNow('cancelled');
    later(function(){hud.setStateNow('hidden')},700);scheduleIdle();
  }
  function scheduleIdle(){clearTimeout(idleT);idleT=setTimeout(function(){idleT=0;startAuto()},9000)}

  key.addEventListener('pointerdown',function(e){if(e.button)return;e.preventDefault();key.focus();key.setPointerCapture&&key.setPointerCapture(e.pointerId);down()});
  key.addEventListener('pointerup',up);key.addEventListener('pointercancel',up);
  key.addEventListener('keydown',function(e){if(e.code==='Space'||e.key==='Enter'){e.preventDefault();if(!e.repeat)down()}});
  key.addEventListener('keyup',function(e){if(e.code==='Space'||e.key==='Enter'){e.preventDefault();up()}});
  key.addEventListener('blur',function(){if(isDown)up()});
  key.addEventListener('contextmenu',function(e){e.preventDefault()});
  document.addEventListener('keydown',function(e){if(e.key==='Escape')cancel()});

  function autoCheck(){
    if(RM.matches){stopAuto();if(!typed.textContent)typed.textContent=LINES[0];return}
    if(visible&&!document.hidden){if(!isDown&&!idleT)startAuto()}else{stopAuto()}
  }
  if('IntersectionObserver' in window){new IntersectionObserver(function(es){visible=es[0].isIntersecting;autoCheck()},{threshold:.05}).observe(document.getElementById('demo'))}
  document.addEventListener('visibilitychange',autoCheck);
  RM.addEventListener&&RM.addEventListener('change',function(){stopAuto();autoCheck()});
  autoCheck();
})();
