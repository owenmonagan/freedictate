(function(){
  document.documentElement.classList.add('js');
  var RM=matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------- scroll reveal (once, stagger <=4 x 40ms) ---------- */
  var rv=[].slice.call(document.querySelectorAll('.reveal'));
  if(RM.matches||!('IntersectionObserver' in window)){rv.forEach(function(n){n.classList.add('in')})}
  else{
    var io=new IntersectionObserver(function(es){
      var batch=es.filter(function(e){return e.isIntersecting});
      batch.forEach(function(e,i){e.target.style.setProperty('--d',Math.min(i,3)*40+'ms');e.target.classList.add('in');io.unobserve(e.target)});
    },{rootMargin:'0px 0px -8% 0px'});
    rv.forEach(function(n){io.observe(n)});
  }

  /* ---------- copy install command ---------- */
  var cb=document.getElementById('copyBtn');
  if(cb)cb.addEventListener('click',function(){
    var t=document.getElementById('installCmd').textContent;
    function ok(){cb.textContent='Copied';setTimeout(function(){cb.textContent='Copy'},1600)}
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(ok,fallback)}else fallback();
    function fallback(){var r=document.createRange();r.selectNodeContents(document.getElementById('installCmd'));var s=getSelection();s.removeAllRanges();s.addRange(r);try{document.execCommand('copy');ok()}catch(e){}}
  });

  /* ---------- hero loop ---------- */
  var SENTENCE="Let's move the design review to Thursday at four, and I'll send the deck tonight.";
  var hud=createHud(document.getElementById('heroStage'));
  var typed=document.getElementById('typed'), docText=typed.parentNode;
  var timers=[], playing=false, visible=true, levelTimer=0, typeTimer=0;
  function later(fn,ms){timers.push(setTimeout(fn,ms))}
  function clearAll(){timers.forEach(clearTimeout);timers=[];clearInterval(levelTimer);clearInterval(typeTimer)}
  // a speech-like level curve: syllable bursts with pauses
  function level(t){var s=Math.max(0,Math.sin(t*9.5))*.55+Math.max(0,Math.sin(t*3.1+1))*.35;var gap=(t%1.1)>.92?.1:1;return Math.min(1,(s*gap)*1.5+Math.random()*.08)}
  function runLoop(){
    if(!playing)return;
    clearAll();
    hud.setStateNow('listening',{mode:'hold'});
    var t0=performance.now();
    levelTimer=setInterval(function(){hud.setLevel(level((performance.now()-t0)/1000))},66);
    later(function(){clearInterval(levelTimer);hud.setLevel(0);hud.setStateNow('transcribing')},2400);
    later(function(){
      hud.setStateNow('done',{text:SENTENCE});
      var i=0;typeTimer=setInterval(function(){i++;typed.textContent=SENTENCE.slice(0,i);if(i>=SENTENCE.length)clearInterval(typeTimer)},1000/28);
    },3300);
    var typeMs=Math.ceil(SENTENCE.length/28*1000);
    later(function(){hud.setStateNow('hidden')},3300+Math.max(700,typeMs)+0);
    later(function(){docText.classList.add('clearing')},3300+Math.max(700,typeMs)+200+2000);
    later(function(){typed.textContent='';docText.classList.remove('clearing');runLoop()},3300+Math.max(700,typeMs)+200+2000+240);
  }
  function showStatic(){clearAll();typed.textContent=SENTENCE;hud.setStateNow('done',{text:SENTENCE})}
  function play(){if(playing)return;playing=true;typed.textContent='';runLoop()}
  function pause(){playing=false;clearAll();hud.setStateNow('hidden')}
  var ctl=document.getElementById('demoCtl');
  ctl.addEventListener('click',function(e){var a=e.target.dataset.act;if(a==='play')play();else if(a==='pause')pause();else if(a==='replay'){pause();setTimeout(play,220)}});
  function autoCheck(){
    if(RM.matches){ctl.hidden=false;if(!playing)showStatic();return}
    ctl.hidden=true;
    if(visible&&!document.hidden)play();else pause();
  }
  if('IntersectionObserver' in window){new IntersectionObserver(function(es){visible=es[0].isIntersecting;autoCheck()},{threshold:.05}).observe(document.getElementById('demo'))}
  document.addEventListener('visibilitychange',autoCheck);
  RM.addEventListener&&RM.addEventListener('change',function(){pause();autoCheck()});
  autoCheck();

  /* ---------- state simulator ---------- */
  var sim=createHud(document.getElementById('simStage'));
  var key=document.getElementById('simKey'), downAt=0, pendingT=0, simLvl=0, simT0=0, isDown=false;
  function simLevel(on){clearInterval(simLvl);if(on){simT0=performance.now();simLvl=setInterval(function(){sim.setLevel(level((performance.now()-simT0)/1000))},66)}else sim.setLevel(0)}
  var SAMPLE=["Sounds good, see you at four.","Can you send me the notes from today?","Ship it."];
  function finish(){if(sim.state!=='listening')return;simLevel(false);sim.setStateNow('transcribing');
    setTimeout(function(){sim.setStateNow('done',{text:SAMPLE[Math.floor(Math.random()*SAMPLE.length)]});setTimeout(function(){if(sim.state==='done')sim.setStateNow('hidden')},1400)},800)}
  function cancel(){if(sim.state!=='listening'&&sim.state!=='transcribing')return;simLevel(false);sim.setStateNow('cancelled');setTimeout(function(){if(sim.state==='cancelled')sim.setStateNow('hidden')},700)}
  function start(mode){simLevel(true);sim.setStateNow('listening',mode?{mode:mode}:undefined)}
  function down(){if(isDown)return;isDown=true;key.classList.add('down');
    if(sim.state==='listening'){return} // second tap ends on release
    downAt=performance.now();start();pendingT=setTimeout(function(){sim.setStateNow('listening',{mode:'hold'})},350)}
  function up(){if(!isDown)return;isDown=false;key.classList.remove('down');clearTimeout(pendingT);
    if(!downAt){finish();return}
    var held=performance.now()-downAt;downAt=0;
    if(held>=350)finish();else sim.setStateNow('listening',{mode:'tap'})}
  key.addEventListener('pointerdown',function(e){e.preventDefault();key.focus();key.setPointerCapture&&key.setPointerCapture(e.pointerId);down()});
  key.addEventListener('pointerup',up);key.addEventListener('pointercancel',up);
  key.addEventListener('keydown',function(e){if(e.code==='Space'){e.preventDefault();if(!e.repeat)down()}});
  key.addEventListener('keyup',function(e){if(e.code==='Space'){e.preventDefault();up()}});
  document.addEventListener('keydown',function(e){if(e.key==='Escape')cancel()});
  document.querySelector('.sim-btns').addEventListener('click',function(e){
    var a=e.target.dataset.sim;
    if(a==='start'){start('tap')}
    else if(a==='finish')finish();
    else if(a==='cancel')cancel();
    else if(a==='error'){simLevel(false);sim.setStateNow('error',{message:"Can't reach speech engine — restart it from the menu bar"});setTimeout(function(){if(sim.state==='error')sim.setStateNow('hidden')},2400)}
  });
})();
