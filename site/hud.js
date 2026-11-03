/* FreeDictate HUD module (site copy). Same state/transition table as app/hud per DESIGN.md §3 + MOTION.md §1.
   createHud(stageEl) -> {setState(state,payload), setLevel(x), EXIT_MS}. Animates transform/opacity/stroke-dashoffset only. */
(function(){
  var CSS = `
.dh{position:absolute;left:50%;top:50%;height:var(--hud-h);margin-top:calc(var(--hud-h)/-2);opacity:0;pointer-events:none;font-family:var(--font)}
.dh-shell{position:absolute;left:0;top:0;height:100%;transform-origin:center;filter:drop-shadow(0 8px 12px rgba(0,0,0,.28)) drop-shadow(0 2px 3px rgba(0,0,0,.18))}
.dh-bg{position:absolute;inset:0;opacity:.78}
.dh-l,.dh-r,.dh-m{position:absolute;top:0;height:100%;background:var(--hud-solid);will-change:transform}
.dh-l{left:0;width:20px;border-radius:20px 0 0 20px}
.dh-r{left:0;width:20px;border-radius:0 20px 20px 0}
.dh-m{left:19px;width:102px;transform-origin:left center}
.dh-c{position:absolute;left:0;top:0;height:100%;display:flex;align-items:center;gap:8px;padding:0 14px;color:var(--hud-fg);font-size:var(--fs-body);font-weight:var(--fw-medium);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden}
.dh-g{flex:0 0 auto;display:flex;align-items:center;gap:4px}
.dh-dot{width:8px;height:8px;border-radius:50%;background:var(--hud-record)}
.dh-meter{display:flex;align-items:center;gap:3px;height:24px}
.dh-meter i{width:3px;height:24px;border-radius:1.5px;background:var(--hud-fg);opacity:.92;transform:scaleY(.17);will-change:transform}
.dh-t{overflow:hidden;text-overflow:ellipsis;min-width:0}
.dh-t2{color:var(--hud-fg-2)}
.dh-key{font-size:11px;font-weight:var(--fw-semibold);color:var(--hud-fg-2);border:1px solid rgba(255,255,255,.22);border-radius:4px;padding:1px 5px;margin-left:auto}
.dh-shim{background:linear-gradient(90deg,var(--hud-fg-2) 0 40%,var(--hud-fg) 50%,var(--hud-fg-2) 60% 100%);background-size:250% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:dhsh var(--dur-shimmer) linear infinite}
@keyframes dhsh{from{background-position:100% 0}to{background-position:-150% 0}}
.dh-spin{animation:dhsp .9s linear infinite}
@keyframes dhsp{to{transform:rotate(360deg)}}
.dh svg{display:block;fill:none;stroke-linecap:round;stroke-linejoin:round}
.dh-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
@media (prefers-reduced-motion:reduce){.dh-shim{animation:none;color:var(--hud-fg-2);background:none}.dh-spin{animation:none}}`;
  if(!document.getElementById('dh-css')){var s=document.createElement('style');s.id='dh-css';s.textContent=CSS;document.head.appendChild(s);}

  var RM = matchMedia('(prefers-reduced-motion: reduce)');
  var root=getComputedStyle(document.documentElement);
  function tok(n,f){var v=root.getPropertyValue(n).trim();return v||f}
  var linOK = window.CSS && CSS.supports && CSS.supports('transition-timing-function','linear(0,1)');
  var SPRING = linOK ? tok('--spring-morph','ease') : 'cubic-bezier(0.2,0,0,1)';
  var SNAPPY = linOK ? tok('--spring-snappy','ease') : 'cubic-bezier(0.16,1,0.3,1)';
  var STD='cubic-bezier(0.2,0,0,1)', ENTER='cubic-bezier(0.16,1,0.3,1)', EXIT='cubic-bezier(0.4,0,1,1)';
  var PROFILE=[.45,.7,.9,1,.9,.7,.45];

  var G = {
    lock:'<svg width="10" height="10" viewBox="0 0 10 10" stroke="var(--hud-fg-2)" stroke-width="1.5"><rect x="1.5" y="4.5" width="7" height="4.5" rx="1"/><path d="M3 4.5V3a2 2 0 0 1 4 0v1.5"/></svg>',
    spin:'<svg class="dh-spin" width="14" height="14" viewBox="0 0 14 14" stroke="var(--hud-fg-2)" stroke-width="2"><path d="M7 1.5A5.5 5.5 0 1 1 1.5 7"/></svg>',
    check:'<svg width="16" height="16" viewBox="0 0 16 16" stroke="var(--hud-success)" stroke-width="2"><path pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>',
    ring:'<svg width="14" height="14" viewBox="0 0 14 14" stroke="var(--hud-fg-3)" stroke-width="1.5"><circle cx="7" cy="7" r="5.5"/></svg>',
    x:'<svg width="12" height="12" viewBox="0 0 12 12" stroke="var(--hud-fg-2)" stroke-width="1.75"><path d="M3 3l6 6M9 3 3 9"/></svg>',
    warn:'<svg width="14" height="14" viewBox="0 0 14 14" stroke="var(--hud-warning)" stroke-width="1.5"><path d="M7 1.8 12.8 12H1.2z"/><path d="M7 5.5v3M7 10.3v.1"/></svg>'
  };
  function esc(t){return String(t).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
  function preview(t){t=String(t||'').trim().replace(/\s+/g,' ');if(t.length<=24)return t;var c=t.slice(0,24),i=c.lastIndexOf(' ');return(i>8?c.slice(0,i):c).replace(/[\s.,;:]+$/,'')+'…'}

  window.createHud=function(stage){
    var el=document.createElement('div');el.className='dh';
    el.innerHTML='<div class="dh-shell"><div class="dh-bg"><div class="dh-l"></div><div class="dh-m"></div><div class="dh-r"></div></div><div class="dh-c"></div></div><div class="dh-sr" role="status" aria-live="polite"></div>';
    stage.appendChild(el);
    var shell=el.firstChild, bgl=shell.firstChild, mid=bgl.children[1], right=bgl.children[2], content=shell.children[1], sr=el.lastChild;
    var meas=document.createElement('div');meas.className='dh-c';meas.style.cssText='visibility:hidden;position:absolute;left:-9999px';el.appendChild(meas);
    var cur={state:'hidden',w:176,visible:false}, bars=[], raf=0, target=0, disp=0, vel=0, lastSample=0, jit=[1,1,1,1,1,1,1], lastRM=0, coalesce=0;

    function freeze(node,props){node.getAnimations().forEach(function(a){if(props&&a.effect&&a.effect.getKeyframes){var kf=a.effect.getKeyframes()[0]||{};if(!props.some(function(p){return p in kf}))return}try{a.commitStyles()}catch(e){}a.cancel()})}
    function anim(node,to,dur,ease,delay){
      freeze(node,Object.keys(to));
      if(RM.matches && to.transform && !to.opacity){node.style.transform=to.transform;return}
      var from={};for(var k in to)from[k]=getComputedStyle(node)[k];
      var a=node.animate([from,to],{duration:dur,easing:ease,delay:delay||0,fill:'forwards'});
      a.onfinish=function(){try{a.commitStyles()}catch(e){}a.cancel()};
      return a;
    }
    function setWidth(w,dur,ease){
      var d=RM.matches?0:dur;
      el.style.width=w+'px';
      anim(el,{transform:'translateX('+(-w/2)+'px)'},d,ease);
      anim(mid,{transform:'scaleX('+((w-38)/102)+')'},d,ease);
      anim(right,{transform:'translateX('+(w-20)+'px)'},d,ease);
      content.style.width=w+'px';
      cur.w=w;
      if(d===0){el.style.transform='translateX('+(-w/2)+'px)';mid.style.transform='scaleX('+((w-38)/102)+')';right.style.transform='translateX('+(w-20)+'px)'}
    }
    function swap(html,label,dur){
      sr.textContent=label;
      var out=Math.round((dur||300)*.4);
      content.style.transition='none';
      freeze(content);
      if(RM.matches||!cur.visible){content.innerHTML=html;content.style.opacity=1;afterSwap();return}
      var a=content.animate([{opacity:getComputedStyle(content).opacity},{opacity:0}],{duration:out,easing:'ease-out',fill:'forwards'});
      a.onfinish=function(){a.cancel();content.innerHTML=html;afterSwap();content.animate([{opacity:0},{opacity:1}],{duration:Math.round((dur||300)*.6),easing:'ease-out'})};
    }
    function afterSwap(){bars=[].slice.call(content.querySelectorAll('.dh-meter i'));
      var p=content.querySelector('path[stroke-dashoffset]');
      if(p){if(RM.matches)p.setAttribute('stroke-dashoffset','0');else{p.animate([{strokeDashoffset:1},{strokeDashoffset:0}],{duration:240,delay:90,easing:ENTER,fill:'forwards'});
        p.parentNode.animate([{transform:'scale(.8)'},{transform:'scale(1)'}],{duration:300,easing:SNAPPY})}}}
    function fitW(html,min,max){meas.innerHTML=html;var w=Math.ceil(meas.scrollWidth)+2;return Math.max(min,Math.min(max,w))}
    function meterHTML(){return '<span class="dh-meter">'+'<i></i>'.repeat(7)+'</span>'}

    function loop(t){
      raf=requestAnimationFrame(loop);
      if(t-lastSample>70) target*=.85;
      var dt=1/60,w=40;var acc=w*w*(target-disp)-2*w*vel;vel+=acc*dt;disp+=vel*dt;
      if(RM.matches){if(t-lastRM<200)return;lastRM=t;var q=target<.04?0:target<.4?.33:target<.75?.66:1;paint(q);return}
      paint(disp);
    }
    function paint(d){var v=d<.04?0:d;for(var i=0;i<bars.length;i++){var h=4+20*v*PROFILE[i]*jit[i];bars[i].style.transform='scaleY('+(Math.min(24,h)/24).toFixed(3)+')'}}
    function startLoop(){if(!raf)raf=requestAnimationFrame(loop)}
    function stopLoop(){cancelAnimationFrame(raf);raf=0}

    function enter(){
      cur.visible=true;
      anim(el,{opacity:'1'},160,'ease-out');
      if(RM.matches){shell.style.transform='none';return}
      anim(shell,{transform:'translateY(0px) scale(1)'},280,SPRING);
    }
    function apply(state,p){
      p=p||{};var prev=cur.state;cur.state=state;
      if(state!=='listening')stopLoop();
      if(state==='hidden'){
        cur.visible=false;sr.textContent='';
        anim(el,{opacity:'0'},prev==='cancelled'?150:180,EXIT);
        if(!RM.matches)anim(shell,{transform:'translateY(0px) scale(.96)'},180,EXIT);
        return;
      }
      if(!cur.visible){
        if(!RM.matches && getComputedStyle(el).opacity==='0'){shell.style.transform='translateY(6px) scale(.92)'}
      }
      var html,label,w,dur=300,ease=SPRING;
      if(state==='listening'){
        var tap=p.mode==='tap';
        html='<span class="dh-g"><span class="dh-dot"></span>'+(tap?G.lock:'')+'</span>'+meterHTML()+(tap?'<span class="dh-key">esc</span>':'');
        label=tap?'Listening, hands-free':'Listening';w=tap?216:176;
        startLoop();
        if(prev==='listening'){ // mode resolved: only glyph/width change
          content.innerHTML=html;afterSwap();
          if(tap){[].forEach.call(content.querySelectorAll('.dh-g svg,.dh-key'),function(n){if(!RM.matches)n.animate([{opacity:0,transform:'translateX(4px)'},{opacity:1,transform:'none'}],{duration:140,delay:80,easing:STD,fill:'backwards'})})}
          setWidth(w,300,SPRING);
          if(!RM.matches)anim(shell,{transform:'translateY(0px) scale('+(p.mode==='hold'?.97:1)+')'},140,STD);
          sr.textContent=label;return;
        }
      }else if(state==='transcribing'){
        html='<span class="dh-g">'+G.spin+'</span><span class="dh-t dh-shim">Transcribing…</span>';label='Transcribing';w=168;
      }else if(state==='done'){
        var pv=preview(p.text);
        if(!pv){html='<span class="dh-g">'+G.ring+'</span><span class="dh-t dh-t2">Nothing heard</span>';label='Nothing heard';w=148;dur=240;ease=STD}
        else{html='<span class="dh-g">'+G.check+'</span><span class="dh-t">Pasted<span class="dh-t2"> · “'+esc(pv)+'”</span></span>';label='Pasted';w=fitW(html,120,264)}
      }else if(state==='cancelled'){
        html='<span class="dh-g">'+G.x+'</span><span class="dh-t dh-t2">Cancelled</span>';label='Cancelled';w=132;dur=150;ease=EXIT;
        if(prev==='listening'&&!RM.matches){stopLoop();el.animate([{translate:'0px 0px'},{translate:'-4px 0px'},{translate:'4px 0px'},{translate:'-4px 0px'},{translate:'4px 0px'},{translate:'0px 0px'}],{duration:120,easing:'linear'})}
      }else if(state==='error'){
        var m=p.message||'Something went wrong';
        html='<span class="dh-g">'+G.warn+'</span><span class="dh-t">'+esc(m)+'</span>';label=m;w=fitW(html,120,264);dur=240;ease=STD;
      }else return;
      var wasHidden=!cur.visible;
      if(wasHidden){setWidth(w,0,STD)}else setWidth(w,dur,ease);
      swap(html,label,dur);
      if(wasHidden)enter();
      else if(!RM.matches)anim(shell,{transform:'translateY(0px) scale(1)'},dur,ease);
    }
    setWidth(176,0,STD);
    return{
      EXIT_MS:200,
      setState:function(s,p){clearTimeout(coalesce);coalesce=setTimeout(function(){apply(s,p)},0)},
      setStateNow:apply,
      setLevel:function(x){target=Math.max(0,Math.min(1,+x||0));lastSample=performance.now();for(var i=0;i<7;i++)jit[i]=.92+Math.random()*.16},
      get state(){return cur.state}
    };
  };
})();
