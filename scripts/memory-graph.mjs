#!/usr/bin/env node
// memory-graph — render the Chronos memory as an interactive TEMPORAL network you can watch
// change over time. Derives a self-contained HTML (no external libraries, no CDN) from the vault.
//
// The differentiator over Obsidian's graph view: a TIME SCRUBBER. Drag it (or hit play) and typed
// facts fade in at their valid_from and expire at their valid_to — the memory network growing and
// rewiring across dates. Structural note↔note wiki-links are the stable cortex underneath.
//
// Usage:  node scripts/memory-graph.mjs        (writes memory/.graph/graph.html + graph.body.html)
// Open:   memory/.graph/graph.html in any browser (double-click). Rebuildable; gitignored.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex } from '../lib/server/memoryGraph.js';
import { buildGraphView } from '../lib/server/memoryGraphView.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const VAULT = resolve(process.env.CHRONOS_VAULT || join(HERE, '..', 'memory'));
const OUT = join(VAULT, '.graph');

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === '.graph' || name === '.obsidian') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (name.endsWith('.md')) acc.push(full);
  }
  return acc;
}

// ---------------------------------------------------------------------------
// The viewer — CSS, markup, and JS as plain strings (no template literals in the embedded JS,
// so it can use backticks/${} freely without escaping headaches).
// ---------------------------------------------------------------------------

const STYLE = [
  '<style>',
  ':root{--bg:#0a0d13;--bg2:#0d111a;--panel:rgba(16,21,31,.82);--ink:#e9edf6;--muted:#8b94a7;',
  '  --line:rgba(255,255,255,.09);--glow:#3ee6d0;--g-knowledge:#5b8cff;--g-timeline:#c792ea;',
  '  --g-decisions:#ffb454;--g-people:#ff6b8b;--g-meta:#3ee6d0;--g-entity:#7ee0c0;--g-value:#6b7689;}',
  '*{box-sizing:border-box}',
  '.wrap{position:fixed;inset:0;background:radial-gradient(1200px 800px at 70% -10%,#131a29 0%,var(--bg) 60%);',
  '  color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow:hidden;}',
  'canvas{position:absolute;inset:0;display:block;cursor:grab}',
  'canvas.drag{cursor:grabbing}',
  '.mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace}',
  '.topbar{position:absolute;top:0;left:0;right:0;display:flex;align-items:baseline;gap:16px;',
  '  padding:16px 20px;pointer-events:none;z-index:5}',
  '.title{font-size:15px;font-weight:650;letter-spacing:.02em}',
  '.title small{color:var(--muted);font-weight:450;margin-left:8px}',
  '.stats{margin-left:auto;display:flex;gap:18px;font-size:12px;color:var(--muted)}',
  '.stats b{color:var(--ink);font-weight:600}',
  '.legend{position:absolute;top:56px;left:20px;background:var(--panel);backdrop-filter:blur(10px);',
  '  border:1px solid var(--line);border-radius:12px;padding:12px 14px;z-index:5;max-width:210px}',
  '.legend h4{margin:0 0 8px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:600}',
  '.legend .row{display:flex;align-items:center;gap:8px;font-size:12px;padding:2px 0;color:var(--ink)}',
  '.dot{width:9px;height:9px;border-radius:50%;flex:none;box-shadow:0 0 8px currentColor}',
  '.toggles{margin-top:10px;padding-top:10px;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:7px}',
  '.tg{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink);cursor:pointer;user-select:none}',
  '.tg input{accent-color:var(--glow);width:13px;height:13px}',
  '.scrubber{position:absolute;left:50%;bottom:22px;transform:translateX(-50%);width:min(680px,calc(100vw - 40px));',
  '  background:var(--panel);backdrop-filter:blur(10px);border:1px solid var(--line);border-radius:14px;',
  '  padding:14px 18px 16px;z-index:5}',
  '.scrub-head{display:flex;align-items:baseline;gap:12px;margin-bottom:10px}',
  '.date{font-size:22px;font-weight:600;letter-spacing:.01em}',
  '.scrub-head .sub{font-size:11px;color:var(--muted)}',
  '.scrub-head .sub b{color:var(--glow);font-weight:600}.scrub-head .sub .exp{color:var(--g-people)}',
  '.scrub-ctl{display:flex;align-items:center;gap:12px}',
  '.play{flex:none;width:38px;height:38px;border-radius:50%;border:1px solid var(--line);background:#141a27;',
  '  color:var(--ink);font-size:14px;cursor:pointer;display:grid;place-items:center;transition:.15s}',
  '.play:hover{border-color:var(--glow);color:var(--glow);box-shadow:0 0 14px rgba(62,230,208,.3)}',
  'input[type=range]{-webkit-appearance:none;appearance:none;flex:1;height:4px;border-radius:3px;',
  '  background:linear-gradient(90deg,var(--glow) 0%,var(--glow) var(--pct,50%),#2a3446 var(--pct,50%));outline:none}',
  'input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;',
  '  background:var(--ink);border:3px solid var(--glow);cursor:pointer;box-shadow:0 0 10px rgba(62,230,208,.5)}',
  'input[type=range]::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:var(--ink);border:3px solid var(--glow);cursor:pointer}',
  '.ends{display:flex;justify-content:space-between;margin-top:7px;font-size:10px;color:var(--muted)}',
  '.tip{position:absolute;z-index:9;max-width:280px;background:rgba(10,13,19,.96);border:1px solid var(--line);',
  '  border-radius:10px;padding:10px 12px;font-size:12px;pointer-events:none;opacity:0;transition:opacity .12s;',
  '  box-shadow:0 12px 40px rgba(0,0,0,.5)}',
  '.tip.on{opacity:1}.tip .t-title{font-weight:650;margin-bottom:6px}',
  '.tip .fct{color:var(--muted);padding:3px 0;line-height:1.4}.tip .fct b{color:var(--ink)}',
  '.tip .win{color:var(--glow)}.tip .win.exp{color:var(--g-people)}',
  '.hint{position:absolute;right:20px;bottom:26px;font-size:11px;color:var(--muted);z-index:5;text-align:right;line-height:1.6;pointer-events:none}',
  '@media (max-width:640px){.legend{display:none}.stats{display:none}.hint{display:none}}',
  '@media (prefers-reduced-motion:reduce){.play{transition:none}}',
  '</style>',
].join('\n');

const MARKUP = [
  '<div class="wrap" id="wrap">',
  '  <canvas id="cv"></canvas>',
  '  <div class="topbar">',
  '    <div class="title">Chronos <small>temporal memory network</small></div>',
  '    <div class="stats mono"><span><b id="s-notes">0</b> notes</span><span><b id="s-links">0</b> links</span><span><b id="s-facts">0</b> facts</span></div>',
  '  </div>',
  '  <div class="legend" id="legend"><h4>Node types</h4>',
  '    <div class="row"><span class="dot" style="color:var(--g-knowledge)"></span>Knowledge</div>',
  '    <div class="row"><span class="dot" style="color:var(--g-timeline)"></span>Timeline</div>',
  '    <div class="row"><span class="dot" style="color:var(--g-decisions)"></span>Decisions</div>',
  '    <div class="row"><span class="dot" style="color:var(--g-people)"></span>People</div>',
  '    <div class="row"><span class="dot" style="color:var(--g-meta)"></span>Meta / system</div>',
  '    <div class="row"><span class="dot" style="color:var(--g-value)"></span>Fact value</div>',
  '    <div class="toggles">',
  '      <label class="tg"><input type="checkbox" id="t-links" checked>Wiki-links</label>',
  '      <label class="tg"><input type="checkbox" id="t-facts" checked>Temporal facts</label>',
  '      <label class="tg"><input type="checkbox" id="t-exp">Show expired facts</label>',
  '    </div>',
  '  </div>',
  '  <div class="tip" id="tip"></div>',
  '  <div class="hint">drag nodes · hover to focus · scrub time below</div>',
  '  <div class="scrubber">',
  '    <div class="scrub-head"><span class="date mono" id="date">—</span>',
  '      <span class="sub mono"><b id="c-act">0</b> active · <span class="exp" id="c-exp">0</span> expired · <span id="c-fut">0</span> not yet known</span></div>',
  '    <div class="scrub-ctl"><button class="play" id="play" aria-label="Play timeline">▶</button>',
  '      <input type="range" id="slider" min="0" max="1000" value="1000"></div>',
  '    <div class="ends mono"><span id="d-from">—</span><span>drag to travel through time →</span><span id="d-to">—</span></div>',
  '  </div>',
  '</div>',
].join('\n');

const SCRIPT = [
  '(function(){',
  'var GC={knowledge:"#5b8cff",timeline:"#c792ea",decisions:"#ffb454",people:"#ff6b8b",meta:"#3ee6d0",entity:"#7ee0c0",value:"#6b7689"};',
  'var cv=document.getElementById("cv"),ctx=cv.getContext("2d");',
  'var wrap=document.getElementById("wrap"),tip=document.getElementById("tip");',
  'var slider=document.getElementById("slider"),playBtn=document.getElementById("play");',
  'var dateEl=document.getElementById("date");',
  'var nodes=DATA.nodes.map(function(n){return{id:n.id,label:n.label,group:n.group,type:n.type,degree:n.degree,facts:n.facts||[],x:0,y:0,vx:0,vy:0};});',
  'var byId={};nodes.forEach(function(n){byId[n.id]=n;});',
  'var links=DATA.links.filter(function(l){return byId[l.source]&&byId[l.target];});',
  'document.getElementById("s-notes").textContent=DATA.counts.notes;',
  'document.getElementById("s-links").textContent=DATA.counts.links;',
  'document.getElementById("s-facts").textContent=DATA.counts.facts;',
  'function toMs(d){var p=d.split("-");return Date.UTC(+p[0],+p[1]-1,+p[2]);}',
  'function fromMs(ms){var d=new Date(ms);function z(x){return(x<10?"0":"")+x;}return d.getUTCFullYear()+"-"+z(d.getUTCMonth()+1)+"-"+z(d.getUTCDate());}',
  'var fromMsV=toMs(DATA.dateRange.from),toMsV=toMs(DATA.dateRange.to);if(toMsV<=fromMsV)toMsV=fromMsV+86400000;',
  'document.getElementById("d-from").textContent=DATA.dateRange.from;',
  'document.getElementById("d-to").textContent=DATA.dateRange.to;',
  'var curDate=DATA.dateRange.to;',
  'function factState(l){if(!l.valid_from)return"active";if(l.valid_from>curDate)return"future";if(l.valid_to&&curDate>=l.valid_to)return"expired";return"active";}',
  'var showLinks=true,showFacts=true,showExp=false;',
  'function linkVisible(l){if(l.kind==="link")return showLinks;if(!showFacts)return false;var s=factState(l);if(s==="future")return false;if(s==="expired")return showExp;return true;}',
  'function computeVisible(){var vis={};links.forEach(function(l){if(linkVisible(l)){vis[l.source]=1;vis[l.target]=1;}});nodes.forEach(function(n){if(n.type==="note"||n.type==="entity")vis[n.id]=1;});return vis;}',
  'var W=0,H=0,dpr=Math.min(window.devicePixelRatio||1,2);',
  'function resize(){W=wrap.clientWidth;H=wrap.clientHeight;cv.width=W*dpr;cv.height=H*dpr;cv.style.width=W+"px";cv.style.height=H+"px";ctx.setTransform(dpr,0,0,dpr,0,0);}',
  'window.addEventListener("resize",function(){resize();alpha=Math.max(alpha,.3);});',
  '(function seed(){var cx=(window.innerWidth||900)/2,cy=(window.innerHeight||600)/2;nodes.forEach(function(n,i){var a=i*2.399963;var r=30+Math.sqrt(i)*26;n.x=cx+Math.cos(a)*r;n.y=cy+Math.sin(a)*r;});})();',
  'resize();',
  'var alpha=1,reduce=window.matchMedia&&window.matchMedia("(prefers-reduced-motion:reduce)").matches;',
  'function radius(n){if(n.type==="value")return 3.2;if(n.type==="entity")return 4.5;return 4+Math.min(n.degree,10)*0.9;}',
  'function tick(){',
  '  var vis=computeVisible();var k=0.9;',
  '  for(var i=0;i<nodes.length;i++){var a=nodes[i];if(!vis[a.id])continue;',
  '    for(var j=i+1;j<nodes.length;j++){var b=nodes[j];if(!vis[b.id])continue;',
  '      var dx=a.x-b.x,dy=a.y-b.y,d2=dx*dx+dy*dy||0.01;if(d2>90000)continue;var d=Math.sqrt(d2);var f=1400/d2;',
  '      var fx=dx/d*f,fy=dy/d*f;a.vx+=fx;a.vy+=fy;b.vx-=fx;b.vy-=fy;}}',
  '  for(var l=0;l<links.length;l++){var L=links[l];if(!linkVisible(L))continue;var s=byId[L.source],t=byId[L.target];',
  '    var dist=L.kind==="link"?70:34;var dx=t.x-s.x,dy=t.y-s.y,d=Math.sqrt(dx*dx+dy*dy)||0.01;var f=(d-dist)*0.02;',
  '    var fx=dx/d*f,fy=dy/d*f;s.vx+=fx;s.vy+=fy;t.vx-=fx;t.vy-=fy;}',
  '  var cx=W/2,cy=H/2;',
  '  for(var m=0;m<nodes.length;m++){var n=nodes[m];if(!vis[n.id])continue;if(n===dragNode)continue;',
  '    n.vx+=(cx-n.x)*0.0016;n.vy+=(cy-n.y)*0.0016;n.vx*=k;n.vy*=k;n.x+=n.vx*alpha*2;n.y+=n.vy*alpha*2;}',
  '  alpha*=0.985;if(alpha<0.01)alpha=0.01;',
  '}',
  'function nodeActive(n){for(var i=0;i<links.length;i++){var L=links[i];if(L.kind!=="fact")continue;if(L.target===n.id||L.source===n.id){return factState(L)==="active";}}return true;}',
  'function draw(){',
  '  ctx.clearRect(0,0,W,H);',
  '  for(var l=0;l<links.length;l++){var L=links[l];if(!linkVisible(L))continue;var s=byId[L.source],t=byId[L.target];',
  '    var focused=hoverNode&&(L.source===hoverNode.id||L.target===hoverNode.id);',
  '    if(L.kind==="link"){ctx.strokeStyle=focused?"rgba(233,237,246,.5)":"rgba(255,255,255,.07)";ctx.lineWidth=focused?1.4:0.8;}',
  '    else{var st=factState(L);if(st==="expired"){ctx.strokeStyle="rgba(120,131,153,.28)";ctx.lineWidth=0.8;}',
  '      else{ctx.strokeStyle=focused?"rgba(62,230,208,.9)":"rgba(62,230,208,.42)";ctx.lineWidth=focused?1.8:1.1;}}',
  '    ctx.beginPath();ctx.moveTo(s.x,s.y);ctx.lineTo(t.x,t.y);ctx.stroke();}',
  '  var vis=computeVisible();',
  '  for(var i=0;i<nodes.length;i++){var n=nodes[i];if(!vis[n.id])continue;',
  '    var col=GC[n.group]||"#888";var r=radius(n);',
  '    var dim=hoverNode&&hoverNode!==n&&!isNeighbor(hoverNode,n);',
  '    ctx.globalAlpha=dim?0.28:1;',
  '    if(n.type==="value"){var active=nodeActive(n);ctx.globalAlpha=dim?0.18:(active?1:0.4);}',
  '    ctx.beginPath();ctx.arc(n.x,n.y,r,0,6.2832);ctx.fillStyle=col;',
  '    if(!dim&&(n.type!=="value"||nodeActive(n))){ctx.shadowColor=col;ctx.shadowBlur=n.type==="value"?6:12;}else{ctx.shadowBlur=0;}',
  '    ctx.fill();ctx.shadowBlur=0;',
  '    if((n.degree>=5||n===hoverNode||(n.type==="note"&&r>6))&&n.type!=="value"){',
  '      ctx.globalAlpha=dim?0.3:0.92;ctx.fillStyle="#cfd6e6";ctx.font="11px ui-monospace,Menlo,monospace";',
  '      ctx.fillText(n.label.length>22?n.label.slice(0,21)+"…":n.label,n.x+r+4,n.y+3.5);}',
  '  }',
  '  ctx.globalAlpha=1;',
  '}',
  'var neigh={};(function(){links.forEach(function(L){(neigh[L.source]=neigh[L.source]||{})[L.target]=1;(neigh[L.target]=neigh[L.target]||{})[L.source]=1;});})();',
  'function isNeighbor(a,b){return neigh[a.id]&&neigh[a.id][b.id];}',
  'function loop(){tick();draw();requestAnimationFrame(loop);}loop();',
  'var hoverNode=null,dragNode=null,mx=0,my=0;',
  'function pick(x,y){var best=null,bd=225;for(var i=0;i<nodes.length;i++){var n=nodes[i];var dx=n.x-x,dy=n.y-y,d=dx*dx+dy*dy;if(d<bd){bd=d;best=n;}}return best;}',
  'cv.addEventListener("mousemove",function(e){var rect=cv.getBoundingClientRect();mx=e.clientX-rect.left;my=e.clientY-rect.top;',
  '  if(dragNode){dragNode.x=mx;dragNode.y=my;dragNode.vx=0;dragNode.vy=0;alpha=Math.max(alpha,.2);return;}',
  '  var n=pick(mx,my);hoverNode=n;if(n){showTip(n,e.clientX,e.clientY);}else{tip.classList.remove("on");}});',
  'cv.addEventListener("mousedown",function(e){var rect=cv.getBoundingClientRect();var n=pick(e.clientX-rect.left,e.clientY-rect.top);if(n){dragNode=n;cv.classList.add("drag");}});',
  'window.addEventListener("mouseup",function(){dragNode=null;cv.classList.remove("drag");});',
  'cv.addEventListener("mouseleave",function(){hoverNode=null;tip.classList.remove("on");});',
  'function esc(s){return String(s).replace(/[&<>]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;"}[c];});}',
  'function fmtFact(f){var st=factState(f);var win=f.valid_to?(f.valid_from+" → "+f.valid_to):("since "+f.valid_from);var cls=st==="expired"?"win exp":"win";',
  '  return "<div class=\\"fct\\"><b>"+esc(f.predicate)+"</b> → "+esc(f.object)+" <span class=\\""+cls+"\\">["+win+"]</span></div>";}',
  'function showTip(n,cx,cy){var h="<div class=\\"t-title\\">"+esc(n.label)+"</div>";',
  '  if(n.type==="value"){var owner=null;for(var i=0;i<links.length;i++){if(links[i].target===n.id){owner=links[i];break;}}if(owner)h+=fmtFact(owner);}',
  '  else if(n.facts&&n.facts.length){for(var j=0;j<n.facts.length;j++){h+=fmtFact(n.facts[j]);}}',
  '  else{h+="<div class=\\"fct\\">"+(n.type==="note"?"note":"entity")+" · "+n.degree+" connections</div>";}',
  '  tip.innerHTML=h;tip.classList.add("on");var tw=tip.offsetWidth,th=tip.offsetHeight;',
  '  var x=cx+14,y=cy+14;if(x+tw>window.innerWidth-8)x=cx-tw-14;if(y+th>window.innerHeight-8)y=cy-th-14;',
  '  tip.style.left=x+"px";tip.style.top=y+"px";}',
  'function setDateFromSlider(){var pct=+slider.value/1000;var ms=fromMsV+(toMsV-fromMsV)*pct;curDate=fromMs(ms);dateEl.textContent=curDate;',
  '  slider.style.setProperty("--pct",(pct*100)+"%");updateCounts();alpha=Math.max(alpha,.12);}',
  'function updateCounts(){var a=0,e=0,f=0;links.forEach(function(L){if(L.kind!=="fact")return;var s=factState(L);if(s==="active")a++;else if(s==="expired")e++;else f++;});',
  '  document.getElementById("c-act").textContent=a;document.getElementById("c-exp").textContent=e;document.getElementById("c-fut").textContent=f;}',
  'slider.addEventListener("input",function(){stopPlay();setDateFromSlider();});',
  'var playing=false,pint=null;',
  'function stopPlay(){playing=false;playBtn.textContent="▶";if(pint){clearInterval(pint);pint=null;}}',
  'function startPlay(){playing=true;playBtn.textContent="❚❚";if(+slider.value>=1000)slider.value=0;',
  '  pint=setInterval(function(){var v=+slider.value+7;if(v>=1000){v=1000;slider.value=v;setDateFromSlider();stopPlay();return;}slider.value=v;setDateFromSlider();},60);}',
  'playBtn.addEventListener("click",function(){playing?stopPlay():startPlay();});',
  'document.getElementById("t-links").addEventListener("change",function(e){showLinks=e.target.checked;alpha=Math.max(alpha,.2);});',
  'document.getElementById("t-facts").addEventListener("change",function(e){showFacts=e.target.checked;alpha=Math.max(alpha,.2);});',
  'document.getElementById("t-exp").addEventListener("change",function(e){showExp=e.target.checked;alpha=Math.max(alpha,.2);});',
  'setDateFromSlider();',
  '})();',
].join('\n');

function renderBody(dataLiteral) {
  return STYLE + '\n' + MARKUP + '\n<script>\nconst DATA = ' + dataLiteral + ';\n' + SCRIPT + '\n</script>';
}

// --- main -----------------------------------------------------------------
const today = new Date().toISOString().slice(0, 10);
const notes = walk(VAULT).map((f) => ({ path: relative(VAULT, f).replace(/\\/g, '/'), text: readFileSync(f, 'utf8') }));
const view = buildGraphView(buildIndex(notes), { today });
const DATA = JSON.stringify(view).replace(/</g, '\\u003c');

const body = renderBody(DATA);
const standalone = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<title>Chronos — Memory Network</title></head><body>' + body + '</body></html>';

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'graph.html'), standalone);
writeFileSync(join(OUT, 'graph.body.html'), body);
console.log('Chronos memory-graph');
console.log('  nodes ' + view.nodes.length + ' · links ' + view.links.length
  + ' · facts ' + view.counts.facts + ' · span ' + view.dateRange.from + ' → ' + view.dateRange.to);
console.log('  wrote ' + relative(process.cwd(), join(OUT, 'graph.html')) + ' (open in a browser)');
