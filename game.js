/* =====================================================
 * 怒砸KPI · 微信小游戏版 —— 三消宣泄版 v4
 * 8×8 三消 · 30步刷分 · 无倒计时
 * 单文件 game.js，无 DOM 依赖
 * ===================================================== */
(function(){
'use strict';

/* ============ 基础 ============ */
var canvas=wx.createCanvas();
var ctx=canvas.getContext('2d');
var sys={}; try{ sys=wx.getWindowInfo(); }catch(e){ try{ sys=wx.getSystemInfoSync(); }catch(_){} }
var DPR=sys.pixelRatio||2, W=sys.windowWidth||390, H=sys.windowHeight||844;

var ROWS=8, COLS=8, NTYPES=5, MOVES=30;
var SPRKEY=['kpi','zhoubao','jiafang','fangdai','kafei'];
var EMOJI=['📊','📝','👔','🏠','☕'];

var state='start', score=0, moves=MOVES, cascade=0;
var board=[], phase='idle', phaseT=0, pend=null, lastFocus=null, selTile=null;
var parts=[], popups=[], hammers=[], rings=[], bigTexts=[];
var flashA=0, shakeT=0;
var bx=0, by=0, cell=40, hudH=96;
var bg=null;
var startBtn={x:0,y:0,w:0,h:0}, againBtn={x:0,y:0,w:0,h:0};
var SPR={};

var store={
  _m:0,
  get:function(){ try{ var v=wx.getStorageSync('nkpi_best'); return parseInt(v||'0',10)||0; }catch(e){ return this._m; } },
  set:function(v){ this._m=v; try{ wx.setStorageSync('nkpi_best', String(v)); }catch(e){} }
};

/* ============ 音频（WebAudio 合成，无资源） ============ */
var actx=null;
function ensureAudio(){
  if(actx) return actx;
  try{ if(wx.createWebAudioContext){ actx=wx.createWebAudioContext().context; } }catch(e){}
  try{ if(actx&&actx.resume) actx.resume(); }catch(e){}
  return actx;
}
function tone(f0,f1,dur,type,vol,delay){
  var ac=ensureAudio(); if(!ac) return;
  try{
    var t=ac.currentTime+(delay||0);
    var o=ac.createOscillator(), g=ac.createGain();
    o.type=type||'sine';
    o.frequency.setValueAtTime(f0,t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1,f1),t+dur);
    g.gain.setValueAtTime(vol||0.2,t);
    g.gain.exponentialRampToValueAtTime(0.001,t+dur+0.03);
    o.connect(g); g.connect(ac.destination);
    o.start(t); o.stop(t+dur+0.05);
  }catch(e){}
}
function sPop(c){ var f=340+Math.min(c,10)*45; tone(f,f*0.5,0.14,'sine',0.22); }
function sSwap(){ tone(300,540,0.09,'triangle',0.12); }
function sDeny(){ tone(190,120,0.13,'sawtooth',0.09); }
function sSelect(){ tone(660,660,0.05,'sine',0.07); }
function sSmash(){ tone(220,660,0.22,'square',0.10); tone(140,70,0.2,'sawtooth',0.12,0.02); noiseBurst(0.28,0.28,800); }
function noiseBurst(dur,vol,fc){
  var ac=ensureAudio(); if(!ac) return;
  try{
    var len=Math.max(1,Math.floor(ac.sampleRate*dur));
    var buf=ac.createBuffer(1,len,ac.sampleRate);
    var d=buf.getChannelData(0);
    for(var i=0;i<len;i++) d[i]=(Math.random()*2-1)*(1-i/len);
    var src=ac.createBufferSource(); src.buffer=buf;
    var f=ac.createBiquadFilter(); f.type='lowpass'; f.frequency.value=fc||1200;
    var g=ac.createGain(); g.gain.value=vol||0.25;
    src.connect(f); f.connect(g); g.connect(ac.destination);
    src.start();
  }catch(e){}
}
function sFanfare(){ var ns=[523,659,784,1046],i; for(i=0;i<ns.length;i++) tone(ns[i],ns[i],0.28,'triangle',0.18,i*0.12); }

/* ============ 布局 ============ */
function layout(){
  canvas.width=Math.round(W*DPR); canvas.height=Math.round(H*DPR);
  ctx.setTransform(DPR,0,0,DPR,0,0);
  cell=Math.min((W-24)/COLS,(H-hudH-150)/ROWS);
  var bw=cell*COLS;
  bx=(W-bw)/2; by=hudH+8;
  makeBG();
  var btw=Math.min(240,W*0.62), bth=58;
  startBtn={x:(W-btw)/2,y:H*0.68,w:btw,h:bth};
  againBtn={x:(W-btw)/2,y:H*0.70,w:btw,h:bth};
}
function makeBG(){
  try{
    bg=wx.createCanvas(); bg.width=Math.round(W*DPR); bg.height=Math.round(H*DPR);
    var b=bg.getContext('2d'); b.setTransform(DPR,0,0,DPR,0,0);
    var g=b.createRadialGradient(W/2,0,10,W/2,0,H*0.75);
    g.addColorStop(0,'#23233a'); g.addColorStop(1,'#14141f');
    b.fillStyle=g; b.fillRect(0,0,W,H);
  }catch(e){ bg=null; }
}

/* ============ 绘制 helpers ============ */
function rr(x,y,w,h,r){
  r=Math.min(r,w/2,h/2);
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);     ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}
function txt(s,x,y,size,color,align,weight){
  ctx.font=(weight||700)+' '+size+'px sans-serif';
  ctx.textAlign=align||'center'; ctx.textBaseline='middle';
  ctx.fillStyle=color||'#fff';
  ctx.fillText(s,x,y);
}
function inRect(x,y,r){ return x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h; }
function spaced(s){ return s.split('').join(' '); }
function cellXY(r,c){ return {x:bx+c*cell+cell/2, y:by+r*cell+cell/2}; }
function cellFromXY(x,y){
  var c=Math.floor((x-bx)/cell), r=Math.floor((y-by)/cell);
  if(r<0||r>=ROWS||c<0||c>=COLS) return null;
  return {r:r,c:c};
}

/* ============ 立绘 ============ */
function loadSprites(){
  ['kpi','zhoubao','jiafang','fangdai','kafei','laoban','hammer_item'].forEach(function(k){
    try{
      var img=canvas.createImage();
      img.onload=function(){ SPR[k]=img; };
      img.onerror=function(){};
      img.src='assets/'+k+'.png';
    }catch(e){}
  });
  try{
    var bgi=canvas.createImage();
    bgi.onload=function(){ SPR['bg']=bgi; };
    bgi.onerror=function(){};
    bgi.src='assets/bg.jpg';
  }catch(e){}
}

/* ============ 棋盘模型 ============ */
function mkTile(t){ return {t:t,x:0,y:0,tx:0,ty:0,pop:0}; }
function randType(){ return (Math.random()*NTYPES)|0; }
function tileAt(r,c){ if(r<0||r>=ROWS||c<0||c>=COLS) return null; return board[r][c]; }
function isSpecial(t){ return t&&(t.t==='H'||t.t==='B'); }

function findMatches(){
  var seen={}, groups=[], r, c, k;
  for(r=0;r<ROWS;r++){ c=0;
    while(c<COLS){
      var t=tileAt(r,c);
      if(!t||t.pop||isSpecial(t)){ c++; continue; }
      var len=1, t2;
      while(c+len<COLS){ t2=tileAt(r,c+len); if(t2&&!t2.pop&&!isSpecial(t2)&&t2.t===t.t) len++; else break; }
      if(len>=3){ var g={cells:[],len:len};
        for(k=0;k<len;k++){ var key=r+':'+(c+k); if(!seen[key]){ seen[key]=1; g.cells.push({r:r,c:c+k}); } }
        groups.push(g); }
      c+=len;
    }
  }
  for(c=0;c<COLS;c++){ r=0;
    while(r<ROWS){
      var u=tileAt(r,c);
      if(!u||u.pop||isSpecial(u)){ r++; continue; }
      var ln=1, u2;
      while(r+ln<ROWS){ u2=tileAt(r+ln,c); if(u2&&!u2.pop&&!isSpecial(u2)&&u2.t===u.t) ln++; else break; }
      if(ln>=3){ var g2={cells:[],len:ln};
        for(k=0;k<ln;k++){ var key2=(r+k)+':'+c; if(!seen[key2]){ seen[key2]=1; g2.cells.push({r:r+k,c:c}); } }
        groups.push(g2); }
      r+=ln;
    }
  }
  var cells=[];
  for(var key3 in seen){ var p=key3.split(':'); cells.push({r:+p[0],c:+p[1]}); }
  return {cells:cells,groups:groups};
}

function hasValidMove(){
  var dirs=[[0,1],[1,0]];
  for(var r=0;r<ROWS;r++) for(var c=0;c<COLS;c++){
    var t=board[r][c]; if(!t||isSpecial(t)) continue;
    for(var d=0;d<2;d++){
      var r2=r+dirs[d][0], c2=c+dirs[d][1];
      var t2=tileAt(r2,c2); if(!t2||isSpecial(t2)) continue;
      board[r][c]=t2; board[r2][c2]=t;
      var hit=findMatches().cells.length>0;
      board[r][c]=t; board[r2][c2]=t2;
      if(hit) return true;
    }
  }
  return false;
}

function newBoard(){
  var guard=0;
  do{
    for(var r=0;r<ROWS;r++){ board[r]=[];
      for(var c=0;c<COLS;c++){
        var t=mkTile(randType()), p=cellXY(r,c);
        t.x=p.x; t.y=p.y; t.tx=p.x; t.ty=p.y;
        board[r][c]=t;
      }
    }
    guard++;
  }while((findMatches().cells.length>0||!hasValidMove())&&guard<300);
}

function shuffleBoard(){
  var pool=[], r, c;
  for(r=0;r<ROWS;r++) for(c=0;c<COLS;c++){ var t=board[r][c]; if(t&&!isSpecial(t)) pool.push(t.t); }
  var guard=0, ok=false;
  while(!ok&&guard<200){
    guard++;
    for(var i=pool.length-1;i>0;i--){ var j=(Math.random()*(i+1))|0, tmp=pool[i]; pool[i]=pool[j]; pool[j]=tmp; }
    var k=0;
    for(r=0;r<ROWS;r++) for(c=0;c<COLS;c++){ var t2=board[r][c]; if(t2&&!isSpecial(t2)) t2.t=pool[k++]; }
    ok=findMatches().cells.length===0&&hasValidMove();
  }
}

/* ============ 特效 ============ */
function burst(x,y,big){
  var n=big?22:10, cols=big?['#ffd54a','#ff9100','#ffffff']:['#ff8a80','#ffd54a','#ffffff'];
  for(var i=0;i<n;i++){ var a=Math.random()*Math.PI*2, s=(big?3.5:2)+Math.random()*3;
    parts.push({x:x,y:y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-1.5,life:1,
      c:cols[(Math.random()*cols.length)|0],r:2+Math.random()*3}); }
}
function addPopup(x,y,text,color,size){ popups.push({x:x,y:y,text:text,color:color,size:size||18,life:1}); }

/* ============ 流程 ============ */
function startGame(){
  ensureAudio();
  state='playing'; score=0; moves=MOVES; cascade=0;
  parts=[]; popups=[]; hammers=[]; rings=[]; bigTexts=[];
  flashA=0; shakeT=0; selTile=null; pend=null; lastFocus=null;
  phase='idle'; phaseT=0;
  newBoard();
}

function trySwap(r1,c1,r2,c2){
  if(phase!=='idle'||state!=='playing') return;
  var a=board[r1][c1], b=board[r2][c2];
  if(!a||!b) return;
  if(isSpecial(a)||isSpecial(b)){ sDeny(); return; }
  board[r1][c1]=b; board[r2][c2]=a;
  var p1=cellXY(r1,c1), p2=cellXY(r2,c2);
  a.tx=p2.x; a.ty=p2.y; b.tx=p1.x; b.ty=p1.y;
  pend={a:a,b:b,r1:r1,c1:c1,r2:r2,c2:c2};
  lastFocus={r:r2,c:c2};
  cascade=0;
  phase='swap'; phaseT=0.16; sSwap();
}

function afterSwap(){
  var m=findMatches(), p=pend; pend=null;
  if(!m.cells.length){
    board[p.r1][p.c1]=p.a; board[p.r2][p.c2]=p.b;
    var q1=cellXY(p.r1,p.c1), q2=cellXY(p.r2,p.c2);
    p.a.tx=q1.x; p.a.ty=q1.y; p.b.tx=q2.x; p.b.ty=q2.y;
    phase='back'; phaseT=0.16; sDeny();
  } else {
    doPop(m,lastFocus);
  }
}

function doPop(m,focus){
  cascade++;
  var now=Date.now(), i, j;
  var best=null;
  for(i=0;i<m.groups.length;i++) if(!best||m.groups[i].len>best.len) best=m.groups[i];
  var cnt={};
  for(i=0;i<m.groups.length;i++){ var g=m.groups[i];
    for(j=0;j<g.cells.length;j++){ var kk=g.cells[j].r+':'+g.cells[j].c; cnt[kk]=(cnt[kk]||0)+1; } }
  var lshape=false; for(var kk2 in cnt) if(cnt[kk2]>1) lshape=true;
  var power=null;
  if(best&&(best.len>=5||lshape)) power='B';
  else if(best&&best.len===4) power='H';
  var pcell=null;
  if(power){
    var inM=false;
    if(focus) for(i=0;i<m.cells.length;i++)
      if(m.cells[i].r===focus.r&&m.cells[i].c===focus.c){ inM=true; break; }
    if(inM) pcell={r:focus.r,c:focus.c};
    else { var mc=best.cells[(best.cells.length/2)|0]; pcell={r:mc.r,c:mc.c}; }
  }
  var gained=0;
  for(i=0;i<m.cells.length;i++){
    var cc=m.cells[i], t=board[cc.r][cc.c];
    if(!t||t.pop) continue;
    var pp=cellXY(cc.r,cc.c);
    if(pcell&&cc.r===pcell.r&&cc.c===pcell.c){
      t.t=power; t.pop=0;
      rings.push({x:pp.x,y:pp.y,t0:now,big:true,color:power==='B'?'#ffd54a':'#ff9f1c'});
      addPopup(pp.x,pp.y-8,power==='B'?'老板炸弹!':'锤子!',power==='B'?'#ffd54a':'#ff9f1c',16);
      burst(pp.x,pp.y,true);
    } else {
      t.pop=now; gained+=10*cascade;
      burst(pp.x,pp.y,false);
    }
  }
  if(best&&best.len>=4) gained+=(best.len>=5||lshape?150:50)*cascade;
  if(gained>0){
    score+=gained;
    var fp=focus?cellXY(focus.r,focus.c):{x:W/2,y:H/2};
    addPopup(fp.x,fp.y-4,'+'+gained,'#ffd54a',19);
  }
  if(cascade>1) bigTexts.push({text:'连锁 x'+cascade+'!',color:'#69f0ae',t0:now});
  sPop(Math.min(cascade,8));
  phase='pop'; phaseT=0.30;
}

function collapse(){
  for(var c=0;c<COLS;c++){
    var r;
    for(r=0;r<ROWS;r++) if(board[r][c]&&board[r][c].pop) board[r][c]=null;
    var write=ROWS-1;
    for(r=ROWS-1;r>=0;r--){
      var t=board[r][c];
      if(t){
        if(write!==r){ board[write][c]=t; board[r][c]=null;
          var p=cellXY(write,c); t.tx=p.x; t.ty=p.y; }
        write--;
      }
    }
    var missing=write+1;
    for(r=write;r>=0;r--){
      var nt=mkTile(randType()), p2=cellXY(r,c);
      nt.tx=p2.x; nt.ty=p2.y;
      nt.x=p2.x; nt.y=p2.y-missing*cell;
      board[r][c]=nt;
    }
  }
}

function allSettled(){
  for(var r=0;r<ROWS;r++) for(var c=0;c<COLS;c++){
    var t=board[r][c];
    if(!t||t.pop) continue;
    if(Math.abs(t.x-t.tx)>1.5||Math.abs(t.y-t.ty)>1.5) return false;
  }
  return true;
}
function snapTiles(){
  for(var r=0;r<ROWS;r++) for(var c=0;c<COLS;c++){
    var t=board[r][c];
    if(t&&!t.pop){ t.x=t.tx; t.y=t.ty; }
  }
}

function onSettled(){
  var m=findMatches();
  if(m.cells.length) doPop(m,lastFocus);
  else endMove();
}

function endMove(){
  moves--;
  cascade=0; lastFocus=null; selTile=null;
  if(moves<=0){ endGame(); return; }
  if(!hasValidMove()){
    shuffleBoard();
    bigTexts.push({text:'无路可走，洗牌!',color:'#9fb0ff',t0:Date.now()});
  }
  phase='idle';
}

function activateSpecial(r,c){
  if(phase!=='idle'||state!=='playing') return;
  var t=board[r][c];
  if(!t||!isSpecial(t)) return;
  var now=Date.now(), p=cellXY(r,c);
  lastFocus={r:r,c:c}; cascade=0;
  if(t.t==='H'){
    t.pop=now;
    for(var dr=-1;dr<=1;dr++) for(var dc=-1;dc<=1;dc++){
      var t2=tileAt(r+dr,c+dc);
      if(t2&&!t2.pop&&!isSpecial(t2)){ t2.pop=now; score+=15; var q=cellXY(r+dr,c+dc); burst(q.x,q.y,true); }
    }
    hammers.push({x:p.x,y:p.y,t0:now});
    rings.push({x:p.x,y:p.y,t0:now,big:true,color:'#ff9f1c'});
    shakeT=0.22; sSmash();
    addPopup(p.x,p.y-cell,'锤爆 3×3!', '#ff9f1c', 20);
    phase='pop'; phaseT=0.32;
  } else {
    t.pop=now;
    var cnt=[0,0,0,0,0], rr2, cc2;
    for(rr2=0;rr2<ROWS;rr2++) for(cc2=0;cc2<COLS;cc2++){
      var u=board[rr2][cc2]; if(u&&!u.pop&&!isSpecial(u)) cnt[u.t]++;
    }
    var mt=0;
    for(var i=1;i<NTYPES;i++) if(cnt[i]>cnt[mt]) mt=i;
    var n=0;
    for(rr2=0;rr2<ROWS;rr2++) for(cc2=0;cc2<COLS;cc2++){
      var v=board[rr2][cc2];
      if(v&&!v.pop&&!isSpecial(v)&&v.t===mt){ v.pop=now; score+=20; n++;
        var w=cellXY(rr2,cc2); burst(w.x,w.y,false); }
    }
    flashA=0.30; shakeT=0.25;
    bigTexts.push({text:'老板清场! ×'+n,color:'#ffd54a',t0:now});
    sSmash(); tone(880,1320,0.3,'triangle',0.15,0.05);
    phase='pop'; phaseT=0.34;
  }
}

function endGame(){
  state='end'; sFanfare();
  try{ if(score>store.get()) store.set(score); }catch(e){}
}

/* ============ 输入 ============ */
function handleTap(x,y){
  if(phase!=='idle'||state!=='playing') return;
  var cc=cellFromXY(x,y);
  if(!cc) { selTile=null; return; }
  var t=board[cc.r][cc.c];
  if(!t){ selTile=null; return; }
  if(isSpecial(t)){ activateSpecial(cc.r,cc.c); selTile=null; return; }
  if(!selTile){ selTile={r:cc.r,c:cc.c}; sSelect(); return; }
  if(selTile.r===cc.r&&selTile.c===cc.c){ selTile=null; return; }
  var dr=Math.abs(selTile.r-cc.r), dc=Math.abs(selTile.c-cc.c);
  if(dr+dc===1){ var s0=selTile; selTile=null; trySwap(s0.r,s0.c,cc.r,cc.c); }
  else { selTile={r:cc.r,c:cc.c}; sSelect(); }
}

var tS=null;
try{
  wx.onTouchStart(function(e){
    var t=e.touches&&e.touches[0];
    if(t){ tS={x:t.clientX,y:t.clientY}; ensureAudio(); }
  });
  wx.onTouchEnd(function(e){
    var t=e.changedTouches&&e.changedTouches[0], s0=tS; tS=null;
    if(!t||!s0) return;
    if(state==='start'){ if(inRect(t.clientX,t.clientY,startBtn)) startGame(); return; }
    if(state==='end'){ if(inRect(t.clientX,t.clientY,againBtn)) startGame(); return; }
    if(phase!=='idle') return;
    var dx=t.clientX-s0.x, dy=t.clientY-s0.y;
    if(Math.abs(dx)>24||Math.abs(dy)>24){
      var cc=cellFromXY(s0.x,s0.y);
      if(!cc) return;
      var dr=0, dc=0;
      if(Math.abs(dx)>Math.abs(dy)) dc=dx>0?1:-1; else dr=dy>0?1:-1;
      var r2=cc.r+dr, c2=cc.c+dc;
      if(r2<0||r2>=ROWS||c2<0||c2>=COLS) return;
      selTile=null;
      trySwap(cc.r,cc.c,r2,c2);
    } else {
      handleTap(t.clientX,t.clientY);
    }
  });
}catch(e){}

/* ============ 绘制 ============ */
function drawBG(){
  var ok=false;
  if(bg){ try{ ctx.drawImage(bg,0,0,W,H); ok=true; }catch(e){} }
  if(!ok){ ctx.fillStyle='#14141f'; ctx.fillRect(0,0,W,H); }
  var bgi=SPR['bg'];
  if(bgi&&bgi.width){
    var iw=bgi.width, ih=bgi.height;
    var sc=Math.max(W/iw,H/ih), dw=iw*sc, dh=ih*sc;
    ctx.save(); ctx.globalAlpha=0.36;
    ctx.drawImage(bgi,(W-dw)/2,(H-dh)/2,dw,dh);
    ctx.restore();
    ctx.fillStyle='rgba(15,15,27,0.45)'; ctx.fillRect(0,0,W,H);
  }
}

function drawHUD(){
  var urgent=moves<=5&&state==='playing';
  txt('步数',20,20,13,'#9fb0ff','left',700);
  var mc=urgent?'#ff5a5a':'#ffd54a';
  if(urgent) ctx.save(), ctx.globalAlpha=0.55+0.45*Math.sin(Date.now()/150);
  txt(String(moves),20,50,36,mc,'left',900);
  if(urgent) ctx.restore();
  txt('分数',W-20,20,13,'#9fb0ff','right',700);
  txt(String(score),W-20,50,30,'#ffffff','right',900);
  var best=store.get();
  if(best>0) txt('最佳 '+Math.max(best,score),W-20,76,12,'#8a8aa8','right',600);
}

function drawBoard(){
  var bw=cell*COLS;
  ctx.fillStyle='rgba(255,255,255,0.045)';
  rr(bx-6,by-6,bw+12,bw+12,18); ctx.fill();
  ctx.strokeStyle='rgba(140,150,220,0.15)'; ctx.lineWidth=1.5;
  rr(bx-6,by-6,bw+12,bw+12,18); ctx.stroke();
  var r,c;
  for(r=0;r<ROWS;r++) for(c=0;c<COLS;c++){
    var t=board[r][c]; if(t) drawTile(t);
  }
  txt('滑动交换 · 凑3连消 · 4连掉锤子 5连掉炸弹',W/2,by+bw+30,12.5,'#8a8aa8','center',600);
}

function drawTile(t){
  var now=Date.now(), s=cell*0.90;
  var sc=1, alpha=1;
  if(t.pop){
    var pt=(now-t.pop)/300;
    if(pt>=1) return;
    sc=1+pt*0.8; alpha=1-pt;
  }
  ctx.save();
  ctx.globalAlpha=Math.max(0,alpha);
  ctx.translate(t.x,t.y); ctx.scale(sc,sc);
  if(t.t==='H'){
    var ih=SPR['hammer_item'];
    ctx.save(); rr(-s/2,-s/2,s,s,12); ctx.clip();
    if(ih) ctx.drawImage(ih,-s/2,-s/2,s,s);
    else { ctx.fillStyle='#2c2c44'; ctx.fillRect(-s/2,-s/2,s,s);
      ctx.font=(s*0.60)+'px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('🔨',0,2); }
    ctx.restore();
    ctx.strokeStyle='#ff9f1c'; ctx.lineWidth=2.5; rr(-s/2,-s/2,s,s,12); ctx.stroke();
  } else if(t.t==='B'){
    var ib=SPR['laoban'];
    ctx.save(); rr(-s/2,-s/2,s,s,12); ctx.clip();
    if(ib) ctx.drawImage(ib,-s/2,-s/2,s,s);
    else { ctx.fillStyle='#3a3220'; ctx.fillRect(-s/2,-s/2,s,s); }
    ctx.restore();
    ctx.strokeStyle='#ffd54a'; ctx.lineWidth=3; rr(-s/2,-s/2,s,s,12); ctx.stroke();
  } else {
    var im=SPR[SPRKEY[t.t]];
    ctx.save(); rr(-s/2,-s/2,s,s,12); ctx.clip();
    if(im) ctx.drawImage(im,-s/2,-s/2,s,s);
    else { ctx.font=(s*0.55)+'px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
           ctx.fillText(EMOJI[t.t],0,2); }
    ctx.restore();
  }
  if(selTile&&board[selTile.r]&&board[selTile.r][selTile.c]===t){
    ctx.strokeStyle='#ffd54a'; ctx.lineWidth=3;
    rr(-s/2-4,-s/2-4,s+8,s+8,15); ctx.stroke();
  }
  ctx.restore();
}

function drawParts(){
  var i;
  for(i=parts.length-1;i>=0;i--){ var p=parts[i];
    p.x+=p.vx; p.y+=p.vy; p.vy+=0.22; p.life-=0.035;
    if(p.life<=0){ parts.splice(i,1); continue; }
    ctx.globalAlpha=Math.max(0,p.life); ctx.fillStyle=p.c;
    ctx.beginPath(); ctx.arc(p.x,p.y,p.r*p.life+0.5,0,7); ctx.fill(); ctx.globalAlpha=1; }
  for(i=popups.length-1;i>=0;i--){ var t=popups[i];
    t.y-=1.4; t.life-=0.03;
    if(t.life<=0){ popups.splice(i,1); continue; }
    ctx.globalAlpha=Math.max(0,Math.min(1,t.life*1.6));
    txt(t.text,t.x,t.y,t.size,t.color,'center',900); ctx.globalAlpha=1; }
}

function drawHammer(h,now){
  var t=(now-h.t0)/340, ang, alpha=1;
  if(t<0.30){ var k=t/0.30; ang=1.15-1.30*k*k*k; }
  else { var k2=(t-0.30)/0.70; ang=-0.15+0.15*k2; alpha=1-k2*k2; }
  ang+=Math.PI/2;
  var L=64;
  ctx.save();
  ctx.globalAlpha=Math.max(0,alpha);
  ctx.translate(h.x+L,h.y);
  ctx.rotate(ang);
  var hg=ctx.createLinearGradient(-7,0,7,0);
  hg.addColorStop(0,'#8a5a2b'); hg.addColorStop(0.5,'#d09a55'); hg.addColorStop(1,'#8a5a2b');
  ctx.fillStyle=hg; rr(-7,5,14,L-10,7); ctx.fill();
  ctx.fillStyle='#5e3a1a'; rr(-7,-4,14,11,5); ctx.fill();
  ctx.fillStyle='#98a2b3'; rr(-26,L-13,52,26,8); ctx.fill();
  ctx.fillStyle='#c3ccd9'; rr(-26,L-13,52,10,8); ctx.fill();
  ctx.restore();
}
function drawHammers(now){
  for(var i=hammers.length-1;i>=0;i--){
    if((now-hammers[i].t0)/340>=1){ hammers.splice(i,1); continue; }
    drawHammer(hammers[i],now);
  }
}
function drawRings(now){
  for(var i=rings.length-1;i>=0;i--){ var r=rings[i];
    var t=(now-r.t0)/380;
    if(t>=1){ rings.splice(i,1); continue; }
    var rad=(r.big?96:56)*(1-Math.pow(1-t,2.2));
    ctx.save();
    ctx.globalAlpha=(1-t)*0.85;
    ctx.strokeStyle=r.color; ctx.lineWidth=r.big?6:3.5;
    ctx.beginPath(); ctx.arc(r.x,r.y,Math.max(1,rad),0,7); ctx.stroke();
    ctx.restore();
  }
}
function drawBigTexts(now){
  for(var i=bigTexts.length-1;i>=0;i--){ var b=bigTexts[i];
    var t=(now-b.t0)/1100;
    if(t>=1){ bigTexts.splice(i,1); continue; }
    var k=Math.min(1,t/0.28), c1=1.70158, c3=c1+1;
    var s=1+c3*Math.pow(k-1,3)+c1*Math.pow(k-1,2);
    var a=t>0.72?Math.max(0,1-(t-0.72)/0.28):1;
    ctx.save();
    ctx.globalAlpha=a; ctx.translate(W/2,H*0.42); ctx.scale(Math.max(0.01,s),Math.max(0.01,s));
    ctx.font='900 32px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.lineWidth=7; ctx.strokeStyle='rgba(0,0,0,0.55)';
    ctx.strokeText(b.text,0,0);
    ctx.fillStyle=b.color; ctx.fillText(b.text,0,0);
    ctx.restore();
  }
}
function drawFlash(){
  if(flashA<=0) return;
  ctx.fillStyle='rgba(255,205,80,'+flashA.toFixed(3)+')';
  ctx.fillRect(0,0,W,H);
}

function dim(){ ctx.fillStyle='rgba(12,12,22,0.93)'; ctx.fillRect(0,0,W,H); }
function button(r,label){
  var g=ctx.createLinearGradient(0,r.y,0,r.y+r.h);
  g.addColorStop(0,'#ffe082'); g.addColorStop(1,'#ffb300');
  ctx.fillStyle=g; rr(r.x,r.y,r.w,r.h,r.h/2); ctx.fill();
  txt(spaced(label),r.x+r.w/2,r.y+r.h/2+1,21,'#1a1a1a','center',900);
}

function drawStart(){
  dim();
  var g=ctx.createLinearGradient(0,H*0.14,0,H*0.30);
  g.addColorStop(0,'#ffe082'); g.addColorStop(1,'#ff6f00');
  ctx.font='900 54px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillStyle=g; ctx.fillText('怒砸KPI',W/2,H*0.20);
  txt(spaced('三消宣泄版'),W/2,H*0.20+48,15,'#9fb0ff','center',700);
  var bw2=Math.min(350,W*0.86), bx2=(W-bw2)/2, by2=H*0.20+84;
  ctx.fillStyle='#1e1e32'; rr(bx2,by2,bw2,168,14); ctx.fill();
  ctx.strokeStyle='#34345a'; ctx.lineWidth=1; rr(bx2,by2,bw2,168,14); ctx.stroke();
  var lines=['8×8 棋盘，滑动交换相邻两只','凑 3 连消，爆!连锁分数翻倍','🔨 4连掉锤子：点爆 3×3','🌟 5连掉老板炸弹：清一色','30 步，无倒计时，慢慢刷分!'];
  for(var i=0;i<lines.length;i++) txt(lines[i],W/2,by2+26+i*28,14.5,'#d7dcff','center',600);
  button(startBtn,'开始宣泄');
  txt('历史最佳 '+store.get(),W/2,startBtn.y+startBtn.h+30,14,'#8a8aa8','center',600);
}

function drawEnd(){
  dim();
  var stars=score>=4000?3:score>=2500?2:score>=1200?1:0;
  txt('对局结束!',W/2,H*0.16,20,'#9fb0ff','center',800);
  ctx.font='44px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  for(var i=0;i<3;i++){ ctx.fillStyle=i<stars?'#ffd54a':'#3a3a52';
    ctx.fillText(i<stars?'★':'☆',W/2-52+i*52,H*0.16+52); }
  txt(String(score),W/2,H*0.16+122,62,'#ffd54a','center',900);
  var best=store.get();
  txt('历史最佳 '+Math.max(best,score),W/2,H*0.16+164,15,'#b9c0e8','center',600);
  var rec='';
  if(score>best&&best>0) rec='🎉 新纪录!';
  else if(best>0&&score<best&&best-score<=200) rec='就差 '+(best-score)+' 分破纪录!不服?';
  if(rec) txt(rec,W/2,H*0.16+190,15,'#69f0ae','center',800);
  var msg=stars>=3?'🏆 传奇打工人!':stars===2?'🔥 甲方已被你拿下!':stars===1?'💪 初露锋芒!':'😅 多练练，手感会来的!';
  txt(msg,W/2,H*0.16+216,18,'#ff8a80','center',800);
  button(againBtn,'再来一局');
}

function draw(now){
  drawBG();
  ctx.save();
  if(shakeT>0) ctx.translate((Math.random()-0.5)*10,(Math.random()-0.5)*10);
  if(state==='playing'){
    drawHUD(); drawBoard(); drawParts();
    drawRings(now); drawHammers(now); drawBigTexts(now); drawFlash();
  } else if(state==='start'){
    drawStart();
  } else {
    drawHUD(); drawBoard(); drawEnd();
  }
  ctx.restore();
}

/* ============ 主循环 ============ */
var last=Date.now();
function loop(){
  var now=Date.now(), dt=Math.min(0.05,(now-last)/1000); last=now;
  var r,c;
  var k=Math.min(1,dt*13);
  for(r=0;r<ROWS;r++) for(c=0;c<COLS;c++){
    var t=board[r]&&board[r][c];
    if(t&&!t.pop){ t.x+=(t.tx-t.x)*k; t.y+=(t.ty-t.y)*k; }
  }
  if(state==='playing'){
    if(phase==='swap'||phase==='back'){
      phaseT-=dt;
      if(phaseT<=0){ if(phase==='swap') afterSwap(); else phase='idle'; }
    } else if(phase==='pop'){
      phaseT-=dt;
      if(phaseT<=0){ collapse(); phase='fall'; }
    } else if(phase==='fall'){
      if(allSettled()){ snapTiles(); onSettled(); }
    }
    if(shakeT>0) shakeT-=dt;
    if(flashA>0) flashA=Math.max(0,flashA-dt*2.4);
  }
  draw(now);
  requestAnimationFrame(loop);
}

layout();
loadSprites();
try{
  wx.onWindowResize(function(){ try{ var s=wx.getWindowInfo(); W=s.windowWidth; H=s.windowHeight; DPR=s.pixelRatio||2; }catch(e){} layout(); });
}catch(e){}
requestAnimationFrame(loop);

})();
