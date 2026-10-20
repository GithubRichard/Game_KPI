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
/* 压力值：房贷5 > KPI3 > 甲方2 > 周报1 = 咖啡1 */
var PRESSURE=[3,1,2,5,1];
var PNAME=['KPI','周报','甲方','房贷','咖啡'];
/* 关卡：压力清零获胜（pressure），分数评星；stressType 指定压力源（消除额外减压） */
var LEVELS=[
  {name:'初入职场', moves:25, pressure:60,  stars:[1500,3000,5000]},
  {name:'四连锤子', moves:25, pressure:70,  stars:[2000,4000,6500]},
  {name:'周报减压', moves:26, pressure:80,  stressType:1, stars:[2500,4500,7000]},
  {name:'清色时机', moves:28, pressure:80,  stars:[3000,5500,8500]},
  {name:'步数规划', moves:22, pressure:90,  stars:[3500,6000,9500]},
  {name:'冰封工位', moves:28, pressure:90,  frozen:6, stars:[3500,6500,10000]},
  {name:'房贷压顶', moves:26, pressure:100, stressType:3, weights:[2,2,2,5,2], stars:[4000,7000,11000]},
  {name:'咖啡续命', moves:24, pressure:90,  coffeePlus:true, stars:[4000,7000,11000]},
  {name:'连锁风暴', moves:26, pressure:100, cascadeDouble:true, stars:[4500,8000,13000]},
  {name:'终极述职', moves:30, pressure:120, stressType:3, frozen:6, weights:[2,2,2,5,2], stars:[6000,10000,16000]}
];
var curLevel=null, levelIdx=0, collected=0, endWin=false;
function relieve(n){ if(mode==='level'&&curLevel){ levelPressure=Math.max(0,levelPressure-n); } }
function stressBonus(t){ return (curLevel&&curLevel.stressType===t)?1:0; }

var state='start', score=0, moves=MOVES, cascade=0, mode='classic';
var board=[], phase='idle', phaseT=0, pend=null, lastFocus=null, selTile=null, lastSwapStart=null;
var parts=[], popups=[], hammers=[], rings=[], bigTexts=[];
var flashA=0, shakeT=0;
var bx=0, by=0, cell=40, hudH=96;
var bg=null;
var tools={H:1,B:1}, armedTool=null, pendingFree=false;
var hintCells=null, hintT=0;
var RND=Math.random;
var tutDone=false;
var paused=false, pendingPause=false, pauseTab='menu', pauseConfirmHome=false;
var soundOn=true, vibOn=true, reduceMotion=false;
try{
  soundOn=wx.getStorageSync('nkpi_sound')!=='0';
  vibOn=wx.getStorageSync('nkpi_vib')!=='0';
  reduceMotion=wx.getStorageSync('nkpi_rm')==='1';
  tutDone=!!wx.getStorageSync('nkpi_tutdone');
}catch(e){}
var pauseBtn={x:0,y:0,w:0,h:0}, skipBtn={x:0,y:0,w:0,h:0};
var pauseCard={x:0,y:0,w:0,h:0};
var pResume={x:0,y:0,w:0,h:0}, pHelp={x:0,y:0,w:0,h:0}, pSound={x:0,y:0,w:0,h:0};
var pVib={x:0,y:0,w:0,h:0}, pMotion={x:0,y:0,w:0,h:0}, pHome={x:0,y:0,w:0,h:0};
var shakeTiles=null, shakeT0=0, previewCell=null;
var levelPressure=0, levelPressureMax=100;
var dailyPractice=false;
var tutStep=-1, tutText='', tutHammerUsed=false, tutToolUsed=false;
var startBtn={x:0,y:0,w:0,h:0}, againBtn={x:0,y:0,w:0,h:0};
var modeBtn={x:0,y:0,w:0,h:0}, shareBtn={x:0,y:0,w:0,h:0};
var levelsBtn={x:0,y:0,w:0,h:0}, backBtn={x:0,y:0,w:0,h:0};
var toolHBtn={x:0,y:0,w:0,h:0}, toolBBtn={x:0,y:0,w:0,h:0}, hintBtn={x:0,y:0,w:0,h:0};
var SPR={};

/* 存档读取做内存缓存，避免每帧同步读 storage */
var store={
  _m:null, _d:null, _dd:null,
  get:function(){
    if(this._m===null){ this._m=0; try{ this._m=parseInt(wx.getStorageSync('nkpi_best')||'0',10)||0; }catch(e){} }
    return this._m;
  },
  set:function(v){ this._m=v; try{ wx.setStorageSync('nkpi_best', String(v)); }catch(e){} },
  getDaily:function(){
    var seed=String(beijingSeed());
    if(this._dd!==seed){
      this._dd=seed; this._d=0;
      try{ if(String(wx.getStorageSync('nkpi_daily_date'))===seed) this._d=parseInt(wx.getStorageSync('nkpi_daily_best')||'0',10)||0; }catch(e){}
    }
    return this._d;
  },
  setDaily:function(v){ this._dd=String(beijingSeed()); this._d=v; try{ wx.setStorageSync('nkpi_daily_date',this._dd); wx.setStorageSync('nkpi_daily_best',String(v)); }catch(e){} }
};

/* ============ 音频（WebAudio 合成，无资源） ============ */
var actx=null;
function ensureAudio(){
  if(actx) return actx;
  try{ if(wx.createWebAudioContext){ var _w=wx.createWebAudioContext(); actx=(_w&&_w.createOscillator)?_w:(_w&&_w.context)||null;
 } }catch(e){}
  try{ if(actx&&actx.resume) actx.resume(); }catch(e){}
  return actx;
}
function tone(f0,f1,dur,type,vol,delay){
  if(!soundOn) return;
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
function vibrate(){ if(!vibOn) return; try{ wx.vibrateShort&&wx.vibrateShort(); }catch(e){} }
function setPref(k,v){ try{ wx.setStorageSync(k,v); }catch(e){} }
function sPop(c,p){ var f=430-Math.min(p||1,5)*32+Math.min(c,10)*40; tone(f,f*0.5,0.14,'sine',0.22); }
function sSwap(){ tone(300,540,0.09,'triangle',0.12); }
function sDeny(){ tone(190,120,0.13,'sawtooth',0.09); }
function sSelect(){ tone(660,660,0.05,'sine',0.07); }
function sSmash(){ tone(220,660,0.22,'square',0.10); tone(140,70,0.2,'sawtooth',0.12,0.02); noiseBurst(0.28,0.28,800); }
function noiseBurst(dur,vol,fc){
  if(!soundOn) return;
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
  /* 尺寸变化后重算棋子坐标 */
  for(var r0=0;r0<ROWS;r0++) for(var c0=0;c0<COLS;c0++){
    var t0=board[r0]&&board[r0][c0];
    if(t0){ var q=cellXY(r0,c0); t0.tx=q.x; t0.ty=q.y; t0.x=q.x; t0.y=q.y; }
  }

  var btw=Math.min(240,W*0.62), bth=58;
  startBtn={x:(W-btw)/2,y:H*0.58,w:btw,h:bth};
  modeBtn={x:(W-btw)/2,y:H*0.58+bth+8,w:btw,h:48};
  againBtn={x:(W-btw)/2,y:H*0.64,w:btw,h:bth};
  shareBtn={x:(W-btw)/2,y:H*0.64+bth+8,w:btw,h:48};
  levelsBtn={x:(W-btw)/2,y:H*0.58+bth+8+56,w:btw,h:48};
  backBtn={x:(W-160)/2,y:H-110,w:160,h:44};
  var tw=90, tx0=(W-(tw*3+20))/2, ty2=H-60;
  toolHBtn={x:tx0,y:ty2,w:tw,h:44};
  toolBBtn={x:tx0+tw+10,y:ty2,w:tw,h:44};
  hintBtn={x:tx0+tw*2+20,y:ty2,w:tw,h:44};
  pauseBtn={x:W-54,y:10,w:44,h:44};
  skipBtn={x:W-116,y:60,w:104,h:34};
  var pw2=Math.min(300,W*0.8), px2=(W-pw2)/2, py2=H*0.24;
  pauseCard={x:px2,y:py2,w:pw2,h:392};
  pResume={x:px2+28,y:py2+64,w:pw2-56,h:44};
  pHelp={x:px2+28,y:py2+114,w:pw2-56,h:44};
  pSound={x:px2+28,y:py2+164,w:pw2-56,h:38};
  pVib={x:px2+28,y:py2+208,w:pw2-56,h:38};
  pMotion={x:px2+28,y:py2+252,w:pw2-56,h:38};
  pHome={x:px2+28,y:py2+300,w:pw2-56,h:44};
}
function makeBG(){
  try{
    if(!bg) bg=wx.createCanvas();
    bg.width=Math.round(W*DPR); bg.height=Math.round(H*DPR);

    var b=bg.getContext('2d'); b.setTransform(DPR,0,0,DPR,0,0);
    var g=b.createRadialGradient(W/2,0,10,W/2,0,H*0.75);
    g.addColorStop(0,'#e6efff'); g.addColorStop(1,'#fdf6e8');
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
function mkImg(){ if(typeof wx.createImage==='function') return wx.createImage(); return canvas.createImage(); }
function loadSprites(){
  ['kpi','zhoubao','jiafang','fangdai','kafei','laoban','hammer_item'].forEach(function(k){
    try{
      var img=mkImg();
      img.onload=function(){ SPR[k]=img; };
      img.onerror=function(){};
      img.src='assets/'+k+'.png';
    }catch(e){}
  });
  try{
    var bgi=mkImg();

    bgi.onload=function(){ SPR['bg']=bgi; };
    bgi.onerror=function(){};
    bgi.src='assets/bg.jpg';
  }catch(e){}
}

/* ============ 棋盘模型 ============ */
function mkTile(t){ return {t:t,x:0,y:0,tx:0,ty:0,pop:0,ice:0}; }
var _prog=null;
function loadProg(){
  if(!_prog){ try{ var p=JSON.parse(wx.getStorageSync('nkpi_prog')||'{}'); _prog=(p&&typeof p==='object')?p:{}; }catch(e){ _prog={}; } }
  return _prog;
}
function saveProg(p){ _prog=p; try{ wx.setStorageSync('nkpi_prog',JSON.stringify(p)); }catch(e){} }
function levelRect(i){
  var cols=4, s=64, gap=14;
  var x0=(W-(cols*s+(cols-1)*gap))/2, y0=120;
  return {x:x0+(i%cols)*(s+gap), y:y0+((i/cols)|0)*(s+gap+16), w:s, h:s};
}
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; var t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function beijingSeed(){ var d=new Date(Date.now()+8*3600*1000); return d.getUTCFullYear()*10000+(d.getUTCMonth()+1)*100+d.getUTCDate(); }
function randType(){
  var w=(curLevel&&curLevel.weights)?curLevel.weights:null;
  if(!w) return (RND()*NTYPES)|0;
  var sum=0, i;
  for(i=0;i<NTYPES;i++) sum+=w[i];
  var x=RND()*sum;
  for(i=0;i<NTYPES;i++){ x-=w[i]; if(x<0) return i; }
  return NTYPES-1;
}
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

function findHint(){
  var dirs=[[0,1],[1,0]];
  for(var r=0;r<ROWS;r++) for(var c=0;c<COLS;c++){
    var t=board[r][c]; if(!t||isSpecial(t)||t.ice) continue;
    for(var d=0;d<2;d++){
      var r2=r+dirs[d][0], c2=c+dirs[d][1];
      var t2=tileAt(r2,c2); if(!t2||isSpecial(t2)||t2.ice) continue;
      board[r][c]=t2; board[r2][c2]=t;
      var hit=findMatches().cells.length>0;
      board[r][c]=t; board[r2][c2]=t2;
      if(hit) return {a:{r:r,c:c},b:{r:r2,c:c2}};
    }
  }
  /* 无普通交换时：任何特殊棋子都可点击引爆 */
  for(var r3=0;r3<ROWS;r3++) for(var c3=0;c3<COLS;c3++){
    var s3=board[r3][c3];
    if(s3&&!s3.pop&&isSpecial(s3)) return {a:{r:r3,c:c3},b:{r:r3,c:c3}};
  }
  return null;
}
function hasValidMove(){ return !!findHint(); }
function mostCommonType(){
  var cnt=[0,0,0,0,0];
  for(var r=0;r<ROWS;r++) for(var c=0;c<COLS;c++){
    var u=board[r][c]; if(u&&!u.pop&&!isSpecial(u)) cnt[u.t]++;
  }
  var mt=0;
  for(var i=1;i<NTYPES;i++) if(cnt[i]>cnt[mt]) mt=i;
  return mt;
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
  for(r=0;r<ROWS;r++) for(c=0;c<COLS;c++){ var t=board[r][c]; if(t&&!isSpecial(t)&&!t.ice) pool.push(t.t); }
  var guard=0, ok=false;
  while(!ok&&guard<200){
    guard++;
    for(var i=pool.length-1;i>0;i--){ var j=(RND()*(i+1))|0, tmp=pool[i]; pool[i]=pool[j]; pool[j]=tmp; }
    var k=0;
    for(r=0;r<ROWS;r++) for(c=0;c<COLS;c++){ var t2=board[r][c]; if(t2&&!isSpecial(t2)&&!t2.ice) t2.t=pool[k++]; }
    ok=findMatches().cells.length===0&&hasValidMove();
  }
  if(!ok){
    /* 兜底：重开棋盘，并恢复关卡冰冻格数量 */
    var nIce=0;
    for(r=0;r<ROWS;r++) for(c=0;c<COLS;c++) if(board[r][c]&&board[r][c].ice) nIce++;
    newBoard();
    var g2=0;
    while(nIce>0&&g2<300){ g2++; var ir=(RND()*ROWS)|0, ic=(RND()*COLS)|0; if(!board[ir][ic].ice){ board[ir][ic].ice=1; nIce--; } }
  }
}
/* 洗牌后若仍有现成三连，进入下落结算自动消除（不额外扣步） */
function reshuffle(){
  shuffleBoard();
  bigTexts.push({text:'无路可走，洗牌!',color:'#9fb0ff',t0:Date.now()});
  if(findMatches().cells.length){ pendingFree=true; phase='fall'; return true; }
  return false;
}

/* ============ 特效 ============ */
function burst(x,y,big,pv){
  pv=pv||1;
  var n=(big?22:8)+pv*3;
  var cols=big?['#ffd54a','#ff9100','#ffffff']:['#ff8a80','#ffd54a','#ffffff'];
  if(pv>=5) cols=['#ff5a5a','#ffd54a','#ffffff'];
  for(var i=0;i<n;i++){ var a=Math.random()*Math.PI*2, s=(big?3:1.5)+Math.random()*(2+pv*0.7);
    parts.push({x:x,y:y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-1.5,life:1,
      c:cols[(Math.random()*cols.length)|0],r:1.5+Math.random()*(1.5+pv*0.6)}); }
}
function addPopup(x,y,text,color,size){ popups.push({x:x,y:y,text:text,color:color,size:size||18,life:1}); }

/* ============ 流程 ============ */
/* 三步新手引导（文档§2）：独立棋盘，不影响纪录 */
function startTutorial(){
  ensureAudio();
  mode='tutorial'; tutStep=0; tutHammerUsed=false; tutToolUsed=false;
  RND=Math.random;
  state='playing'; score=0; moves=99; cascade=0;
  parts=[]; popups=[]; hammers=[]; rings=[]; bigTexts=[];
  flashA=0; shakeT=0; selTile=null; pend=null; lastFocus=null;
  tools={H:0,B:0}; armedTool=null; pendingFree=false; hintCells=null;
  phase='idle'; phaseT=0;
  setupTutBoard(0);
  tutText='👆 拖动或点两格，交换发光的格子！';
}
function setupTutBoard(step){
  var guard=0, r, c;
  do{
    for(r=0;r<ROWS;r++){ board[r]=[];
      for(c=0;c<COLS;c++){ var t=mkTile(randType()), p=cellXY(r,c);
        t.x=p.x; t.y=p.y; t.tx=p.x; t.ty=p.y; board[r][c]=t; } }
    if(step===0){
      /* 横向：row3=[0,0,1,0]，交换 c2/c3 → 三连 */
      board[3][0].t=0; board[3][1].t=0; board[3][2].t=1; board[3][3].t=0;
      hintCells={a:{r:3,c:2},b:{r:3,c:3}}; hintT=Date.now()+1e9;
    } else {
      /* 纵向借位：row4=[2,2,3,2] 且 (3,2)=2，把 (4,2) 往上滑 → row4 四连；
         c4 固定≠2，保证恰好四连不变成五连 */
      board[4][0].t=2; board[4][1].t=2; board[4][2].t=3; board[4][3].t=2;
      board[4][4].t=3; board[3][2].t=2;
      hintCells={a:{r:4,c:2},b:{r:3,c:2}}; hintT=Date.now()+1e9;
    }
    guard++;
  }while(findMatches().cells.length>0&&guard<300);
  selTile=null; phase='idle';
}
function tutAdvance(){
  phase='idle'; selTile=null;
  if(tutStep===0){
    tutStep=1; setupTutBoard(1);
    tutText='四连会掉锤子🔨！把发光的格子往上滑';
  } else if(tutStep===1){
    if(tutHammerUsed){
      tutStep=2; tools={H:1,B:1}; hintCells=null;
      tutText='点 🔨 道具，再点棋盘任意处！';
    } else {
      var found=false;
      for(var r=0;r<ROWS;r++) for(var c=0;c<COLS;c++){
        var t=board[r][c];
        if(t&&isSpecial(t)&&!t.pop){ found=true; hintCells={a:{r:r,c:c},b:{r:r,c:c}}; hintT=Date.now()+1e9; }
      }
      if(found) tutText='点一下发光的特殊棋子，试试爆破！';
      else { setupTutBoard(1); tutText='没凑出四连，再试一次：把发光的格子往上滑'; }

    }
  } else if(tutStep===2){
    if(tutToolUsed) finishTutorial();
    else tutText='点 🔨 道具，再点棋盘任意处！';
  }
}
function finishTutorial(){
  try{ wx.setStorageSync('nkpi_tutdone','1'); }catch(e){}
  tutDone=true; tutStep=-1; tutText=''; hintCells=null;
  startGame('classic');
}
function startGame(m,li){
  ensureAudio();
  mode=m||'classic';
  levelIdx=li||0;
  curLevel=mode==='level'?LEVELS[levelIdx]:null;
  RND=Math.random;
  dailyPractice=false;
  if(m==='daily'){
    var _seed=beijingSeed(), _done='';
    try{ _done=wx.getStorageSync('nkpi_daily_done')||''; }catch(e){}
    dailyPractice=String(_done)===String(_seed);
    if(!dailyPractice){
      RND=mulberry32(_seed);
      /* 开局即标记已玩，防止中途退出刷同一种子 */
      try{ wx.setStorageSync('nkpi_daily_done',String(_seed)); }catch(e){}
    }
  }
  state='playing'; score=0; cascade=0; collected=0; endWin=false;
  moves=curLevel?curLevel.moves:MOVES;
  if(curLevel){ levelPressure=curLevel.pressure; levelPressureMax=curLevel.pressure; }
  parts=[]; popups=[]; hammers=[]; rings=[]; bigTexts=[];
  flashA=0; shakeT=0; selTile=null; pend=null; lastFocus=null;
  tools={H:1,B:1}; armedTool=null; pendingFree=false;
  hintCells=null;
  phase='idle'; phaseT=0;
  newBoard();
  if(curLevel&&curLevel.frozen){
    var placed=0, guard=0;
    while(placed<curLevel.frozen&&guard<300){ guard++;
      var fr=(RND()*ROWS)|0, fc=(RND()*COLS)|0, ft=board[fr][fc];
      if(ft&&!ft.ice){ ft.ice=1; placed++; }
    }
  }
}

function trySwap(r1,c1,r2,c2){
  if(phase!=='idle'||state!=='playing') return;
  var a=board[r1][c1], b=board[r2][c2];
  if(!a||!b) return;
  if(a.ice||b.ice){ sDeny(); return; }
  /* 清色棋子：与相邻普通棋子交换 → 清除该类（文档§3），耗1步 */
  var bomb=null, other=null, combo=false;
  if(a.t==='B'&&!isSpecial(b)){ bomb=a; other=b; }
  else if(b.t==='B'&&!isSpecial(a)){ bomb=b; other=a; }
  else if(isSpecial(a)&&isSpecial(b)) combo=true;
  else if(isSpecial(a)||isSpecial(b)){ sDeny(); return; }
  board[r1][c1]=b; board[r2][c2]=a;
  var p1=cellXY(r1,c1), p2=cellXY(r2,c2);
  a.tx=p2.x; a.ty=p2.y; b.tx=p1.x; b.ty=p1.y;
  pend={a:a,b:b,r1:r1,c1:c1,r2:r2,c2:c2,clearSwap:bomb?{bomb:bomb,other:other}:null,combo:combo};
  lastFocus={r:r2,c:c2}; lastSwapStart={r:r1,c:c1};
  cascade=0;
  phase='swap'; phaseT=0.16; sSwap();
}

function afterSwap(){
  var p=pend; pend=null;
  if(p.combo){ vibrate(); comboSwap(p.a,p.b,p.r2,p.c2); return; }
  if(p.clearSwap){
    var cs=p.clearSwap;
    cs.bomb.pop=Date.now();
    vibrate();
    clearType(cs.other.t);

    return;
  }
  var m=findMatches();
  if(!m.cells.length){
    board[p.r1][p.c1]=p.a; board[p.r2][p.c2]=p.b;
    var q1=cellXY(p.r1,p.c1), q2=cellXY(p.r2,p.c2);
    p.a.tx=q1.x; p.a.ty=q1.y; p.b.tx=q2.x; p.b.ty=q2.y;
    phase='back'; phaseT=0.16; sDeny();
    shakeTiles=[p.a,p.b]; shakeT0=Date.now();
  } else {
    doPop(m,lastFocus);
  }
}

function doPop(m,focus){
  cascade++;
  var now=Date.now(), i, j;
  var best=null;
  for(i=0;i<m.groups.length;i++) if(!best||m.groups[i].len>best.len) best=m.groups[i];
  /* 文档规则：直线五连→清色，四连→锤子；T/L形按普通交叉结算，不产道具 */
  var power=null, genBonus=0;
  if(best&&best.len>=5) power='B';
  else if(best&&best.len===4) power='H';
  var pcell=null;
  if(power){
    /* 生成位置：交换目标格优先，其次交换起点（文档A02） */
    var inM=false, inS=false;
    for(i=0;i<m.cells.length;i++){
      if(focus&&m.cells[i].r===focus.r&&m.cells[i].c===focus.c) inM=true;
      if(lastSwapStart&&m.cells[i].r===lastSwapStart.r&&m.cells[i].c===lastSwapStart.c) inS=true;
    }
    if(inM) pcell={r:focus.r,c:focus.c};
    else if(inS) pcell={r:lastSwapStart.r,c:lastSwapStart.c};
    else { var mc=best.cells[(best.cells.length/2)|0]; pcell={r:mc.r,c:mc.c}; }
    relieve(power==='B'?4:2);
    genBonus=power==='B'?40:20;
  }
  var cmult=cascade*((curLevel&&curLevel.cascadeDouble)?2:1);
  var gained=genBonus, maxP=0, nFangdai=0, nCoffee=0;
  for(i=0;i<m.cells.length;i++){
    var cc=m.cells[i], t=board[cc.r][cc.c];
    if(!t||t.pop) continue;
    var pp=cellXY(cc.r,cc.c);
    if(pcell&&cc.r===pcell.r&&cc.c===pcell.c){
      t.t=power; t.pop=0; t.ice=0;
      rings.push({x:pp.x,y:pp.y,t0:now,big:true,color:power==='B'?'#ffd54a':'#ff9f1c'});
      addPopup(pp.x,pp.y-8,power==='B'?'老板炸弹!':'锤子!',power==='B'?'#ffd54a':'#ff9f1c',16);
      burst(pp.x,pp.y,true,3);
    } else if(t.ice){
      t.ice--; gained+=5*cmult;
      rings.push({x:pp.x,y:pp.y,t0:now,big:false,color:'#9fd8ff'});
      burst(pp.x,pp.y,false,1);
    } else {
      var pv=PRESSURE[t.t];
      t.pop=now; gained+=pv*10*cmult;
      relieve(1+stressBonus(t.t));
      if(pv>maxP) maxP=pv;
      if(t.t===3) nFangdai++;
      if(t.t===4) nCoffee++;
      burst(pp.x,pp.y,false,pv);
    }
  }
  var fp=focus?cellXY(focus.r,focus.c):{x:W/2,y:H/2};
  if(maxP>=5){
    shakeT=Math.max(shakeT,0.16);
    rings.push({x:fp.x,y:fp.y,t0:now,big:true,color:'#ff5a5a'});
    flashA=Math.max(flashA,0.10);
    if(nFangdai>=2) bigTexts.push({text:'房贷爆了!!',color:'#ff5a5a',t0:now});
  } else if(maxP>=3){
    rings.push({x:fp.x,y:fp.y,t0:now,big:false,color:'#ffd54a'});
  }
  if(gained>0){
    score+=gained;
    addPopup(fp.x,fp.y-4,'+'+gained,'#ffd54a',19);
  }
  if(curLevel&&curLevel.coffeePlus&&nCoffee>0){
    moves+=nCoffee;
    addPopup(fp.x,fp.y+36,'+'+nCoffee+' 步 ☕续命','#69f0ae',17);
  }
  if(cascade>1){
    var praise=cascade>=4?'神之一手!':cascade===3?'无敌!':'漂亮!';
    bigTexts.push({text:praise+' ×'+cascade,color:'#69f0ae',t0:now});
  }
  sPop(Math.min(cascade,8),maxP); vibrate();
  phase='pop'; phaseT=0.36;
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
  if(pendingFree) pendingFree=false; else moves--;
  cascade=0; lastFocus=null; selTile=null;
  if(mode==='tutorial'){ tutAdvance(); return; }
  if(mode==='level'){
    if(targetMet()){ levelEnd(true); return; }
    if(moves<=0){ levelEnd(false); return; }
  } else if(moves<=0){ endGame(); return; }
  phase='idle';
  if(!hasValidMove()) reshuffle();
}

/* 消除单格普通棋子（返回是否消除） */
function popCell(r,c,now,big){
  var t=tileAt(r,c);
  if(!t||t.pop||isSpecial(t)) return false;
  var q0=cellXY(r,c);
  if(t.ice){ t.ice--; score+=5; rings.push({x:q0.x,y:q0.y,t0:now,big:false,color:'#9fd8ff'}); burst(q0.x,q0.y,false,1); return false; }
  t.pop=now;
 score+=PRESSURE[t.t]*10; relieve(1+stressBonus(t.t));
  var q=cellXY(r,c); burst(q.x,q.y,!!big,big?3:2);
  return true;
}
/* 范围爆破：rad=1 即 3×3；范围内的特殊棋子连锁引爆 */
function blastArea(r,c,rad,now){
  for(var dr=-rad;dr<=rad;dr++) for(var dc=-rad;dc<=rad;dc++){
    var rr2=r+dr, cc2=c+dc, t2=tileAt(rr2,cc2);
    if(!t2||t2.pop) continue;
    if(isSpecial(t2)) detonate(rr2,cc2,now);
    else popCell(rr2,cc2,now,true);
  }
}
/* 引爆一个特殊棋子（连锁用） */
function detonate(r,c,now){
  var t=tileAt(r,c); if(!t||t.pop||!isSpecial(t)) return;
  t.pop=now;
  var p=cellXY(r,c);
  if(t.t==='H'){ hammers.push({x:p.x,y:p.y,t0:now}); rings.push({x:p.x,y:p.y,t0:now,big:true,color:'#ff9f1c'}); blastArea(r,c,1,now); }
  else { clearTypeCells(mostCommonType(),now); rings.push({x:p.x,y:p.y,t0:now,big:true,color:'#ffd54a'}); }
}
function smashAt(r,c,rad){
  rad=rad||1;
  var now=Date.now(), p=cellXY(r,c);
  if(mode==='tutorial') tutHammerUsed=true;
  lastFocus={r:r,c:c}; cascade=0;
  var tc=tileAt(r,c);
  if(tc&&isSpecial(tc)&&!tc.pop) tc.pop=now;
  blastArea(r,c,rad,now);
  hammers.push({x:p.x,y:p.y,t0:now});
  rings.push({x:p.x,y:p.y,t0:now,big:true,color:'#ff9f1c'});
  shakeT=0.22; sSmash(); vibrate();
  var sz=rad*2+1;
  addPopup(p.x,p.y-cell,'锤爆 '+sz+'×'+sz+'!','#ff9f1c',20);
  phase='pop'; phaseT=0.36;
}
/* 特殊+特殊 组合 */
function comboSwap(a,b,r,c){
  var now=Date.now(), p=cellXY(r,c), i, j;
  a.pop=now; b.pop=now; lastFocus={r:r,c:c}; cascade=0;
  if(a.t==='H'&&b.t==='H'){
    smashAt(r,c,2);
    bigTexts.push({text:'双锤 5×5!',color:'#ff9f1c',t0:now});
    return;
  }
  if(a.t==='B'&&b.t==='B'){
    for(i=0;i<ROWS;i++) for(j=0;j<COLS;j++){ var v=board[i][j]; if(v&&!v.pop){ if(isSpecial(v)) v.pop=now; else popCell(i,j,now,false); } }
    flashA=0.4; shakeT=0.3; sSmash(); vibrate();
    bigTexts.push({text:'老板×老板 全屏清场!',color:'#ffd54a',t0:now});
    phase='pop'; phaseT=0.36; return;
  }
  /* 锤子+清色：最多的一类全变锤子并引爆 */
  var tp=mostCommonType(), hs=[];
  for(i=0;i<ROWS;i++) for(j=0;j<COLS;j++){ var u=board[i][j]; if(u&&!u.pop&&!isSpecial(u)&&!u.ice&&u.t===tp){ u.t='H'; hs.push([i,j]); } }
  for(i=0;i<hs.length;i++) detonate(hs[i][0],hs[i][1],now);
  flashA=0.35; shakeT=0.3; sSmash(); vibrate();
  bigTexts.push({text:PNAME[tp]+'全变锤子! ×'+hs.length,color:'#ff9f1c',t0:now});
  phase='pop'; phaseT=0.36;
}
function clearTypeCells(tp,now){
  var n=0;
  for(var r=0;r<ROWS;r++) for(var c=0;c<COLS;c++){
    var v=board[r][c];
    if(v&&!v.pop&&!isSpecial(v)&&v.t===tp&&popCell(r,c,now,false)) n++;
  }
  return n;
}
function clearType(tp,label){
  var now=Date.now();
  lastFocus=null; cascade=0;
  var n=clearTypeCells(tp,now);
  flashA=0.30; shakeT=0.25;
  bigTexts.push({text:(label||PNAME[tp]+'清场!')+' ×'+n,color:'#ffd54a',t0:now});
  sSmash(); tone(880,1320,0.3,'triangle',0.15,0.05);
  phase='pop'; phaseT=0.36;
}
function useTool(kind,r,c){
  if(tools[kind]<=0||phase!=='idle'||state!=='playing') return;
  tools[kind]--; armedTool=null; hintCells=null;
  if(mode==='tutorial') tutToolUsed=true;
  pendingFree=true;
  if(kind==='H') smashAt(r,c);
  else { var t=tileAt(r,c); clearType((t&&!isSpecial(t))?t.t:mostCommonType()); }
}
function toggleTool(k){
  if(phase!=='idle'||state!=='playing') return;
  if(tools[k]<=0){ sDeny(); return; }
  armedTool=armedTool===k?null:k;
  sSelect();
}
function showHint(){
  if(phase!=='idle'||state!=='playing') return;
  var h=findHint();
  if(h){ hintCells=h; hintT=Date.now(); sSelect(); }
  else reshuffle();

}
function activateSpecial(r,c){
  if(phase!=='idle'||state!=='playing') return;
  var t=board[r][c];
  if(!t||!isSpecial(t)) return;
  if(mode==='tutorial') tutHammerUsed=true;
  if(t.t==='H') smashAt(r,c);
  else { t.pop=Date.now(); clearType(mostCommonType()); }

}
function shareTitle(){
  if(state!=='end') return '《怒砸KPI》三消宣泄版：把KPI和房贷统统锤爆！';
  var m=mode==='daily'?(dailyPractice?'每日练习':'今日挑战'):mode==='level'&&curLevel?('第'+(levelIdx+1)+'关·'+curLevel.name):'经典模式';
  return '我在《怒砸KPI》'+m+'里爆了'+score+'分，房贷都被我锤爆了！来战！';
}
function shareScore(){
  try{ if(typeof wx.shareAppMessage==='function') wx.shareAppMessage({title:shareTitle()}); }catch(e){}
}
try{
  if(typeof wx.showShareMenu==='function') wx.showShareMenu({withShareTicket:true});
  if(typeof wx.onShareAppMessage==='function') wx.onShareAppMessage(function(){ return {title:shareTitle()}; });
}catch(e){}


function endGame(){
  state='end'; sFanfare();
  try{
    if(mode==='daily'){
      if(!dailyPractice){
        if(score>store.getDaily()) store.setDaily(score);
      }

    }
    else if(score>store.get()) store.set(score);
  }catch(e){}
}
function targetMet(){
  return !!(curLevel&&levelPressure<=0);
}
function starCount(){
  var s=curLevel.stars;
  var n=score>=s[2]?3:score>=s[1]?2:score>=s[0]?1:0;
  return Math.max(1,n);
}
function levelEnd(win){
  endWin=win; state='end';
  if(win){
    sFanfare();
    var st=starCount(), prog=loadProg();
    prog.stars=prog.stars||{};
    if(st>(prog.stars[levelIdx]||0)) prog.stars[levelIdx]=st;
    prog.unlocked=Math.max(prog.unlocked||1, Math.min(LEVELS.length, levelIdx+2));
    saveProg(prog);
  } else {
    tone(300,140,0.45,'sawtooth',0.12);
  }
}

/* ============ 输入 ============ */
function handleTap(x,y){
  if(phase!=='idle'||state!=='playing') return;
  if(armedTool){
    var cc0=cellFromXY(x,y);
    if(cc0) useTool(armedTool,cc0.r,cc0.c); else armedTool=null;
    return;
  }
  var cc=cellFromXY(x,y);
  if(!cc) { selTile=null; return; }
  var t=board[cc.r][cc.c];
  if(!t){ selTile=null; return; }
  if(t.ice){ selTile=null; sDeny(); return; }
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
    if(t){ tS={x:t.clientX,y:t.clientY}; ensureAudio();
      if(armedTool&&state==='playing'&&!paused) previewCell=cellFromXY(t.clientX,t.clientY); }
  });
  wx.onTouchEnd(function(e){
    var t=e.changedTouches&&e.changedTouches[0], s0=tS; tS=null; previewCell=null;
    if(!t||!s0) return;
    if(paused){ handlePauseTap(t.clientX,t.clientY); return; }
    if(state==='start'){
      if(inRect(t.clientX,t.clientY,startBtn)){ if(!tutDone) startTutorial(); else startGame('classic'); }
      else if(inRect(t.clientX,t.clientY,modeBtn)) startGame('daily');
      else if(inRect(t.clientX,t.clientY,levelsBtn)) state='levels';
      return;
    }
    if(state==='levels'){
      if(inRect(t.clientX,t.clientY,backBtn)){ state='start'; return; }
      var prog=loadProg(), un=prog.unlocked||1;
      for(var li=0;li<LEVELS.length;li++){
        if(inRect(t.clientX,t.clientY,levelRect(li))){
          if(li<un) startGame('level',li); else sDeny();
          return;
        }
      }
      return;
    }
    if(state==='end'){
      if(inRect(t.clientX,t.clientY,againBtn)){
        if(mode==='level'){
          if(endWin&&levelIdx<LEVELS.length-1) startGame('level',levelIdx+1);
          else startGame('level',levelIdx);
        } else startGame(mode);
      }
      else if(inRect(t.clientX,t.clientY,shareBtn)){
        if(mode==='level'&&!endWin) state='levels';
        else shareScore();
      }
      return;
    }
    if(mode==='tutorial'&&inRect(t.clientX,t.clientY,skipBtn)){ finishTutorial(); return; }
    if(inRect(t.clientX,t.clientY,pauseBtn)){ pendingPause=true; return; }
    if(phase!=='idle') return;
    if(inRect(t.clientX,t.clientY,toolHBtn)){ toggleTool('H'); return; }
    if(inRect(t.clientX,t.clientY,toolBBtn)){ toggleTool('B'); return; }
    if(inRect(t.clientX,t.clientY,hintBtn)){ showHint(); return; }
    var dx=t.clientX-s0.x, dy=t.clientY-s0.y;
    if(Math.abs(dx)>24||Math.abs(dy)>24){
      if(armedTool){
        var ec=cellFromXY(t.clientX,t.clientY);
        if(ec) useTool(armedTool,ec.r,ec.c); else armedTool=null;
        return;
      }
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
    ctx.save(); ctx.globalAlpha=0.8;
    ctx.drawImage(bgi,(W-dw)/2,(H-dh)/2,dw,dh);
    ctx.restore();
    var veil=0.08;
    if(mode==='level'&&curLevel&&levelPressureMax>0) veil=0.04+0.22*(levelPressure/levelPressureMax);
    ctx.fillStyle='rgba(255,255,255,'+veil.toFixed(2)+')'; ctx.fillRect(0,0,W,H);
  }
}

function drawHUD(){
  var urgent=moves<=5&&state==='playing';
  txt('步数',20,20,13,'#7a7ab8','left',700);
  var mc=urgent?'#ff4a4a':'#ff8f00';
  if(urgent&&!reduceMotion){ ctx.save(); ctx.globalAlpha=0.55+0.45*Math.sin(Date.now()/150); }
  txt(String(moves),20,50,36,mc,'left',900);
  if(urgent&&!reduceMotion) ctx.restore();
  txt('分数',W-66,20,13,'#7a7ab8','right',700);
  txt(String(score),W-66,50,30,'#2b2b3d','right',900);
  var best=mode==='daily'?store.getDaily():store.get();
  if(best>0) txt((mode==='daily'?'今日':'历史')+'最佳 '+Math.max(best,score),W-66,76,12,'#9a9ab8','right',600);
  ctx.fillStyle='rgba(255,255,255,0.92)'; rr(pauseBtn.x,pauseBtn.y,pauseBtn.w,pauseBtn.h,12); ctx.fill();
  ctx.strokeStyle='rgba(110,130,210,0.5)'; ctx.lineWidth=1.5; rr(pauseBtn.x,pauseBtn.y,pauseBtn.w,pauseBtn.h,12); ctx.stroke();
  txt('⏸',pauseBtn.x+pauseBtn.w/2,pauseBtn.y+pauseBtn.h/2+1,17,'#3a4a8a','center',700);
  if(mode==='daily') txt(dailyPractice?'· 练习 ·':'📅 今日挑战',W/2,20,13,'#5a6ab8','center',700);
  if(mode==='level'&&curLevel){
    var pw=120, px=W/2-pw/2+8;
    txt('😮‍💨',px-16,32,15,'#7a7ab8','center',700);
    ctx.fillStyle='rgba(120,130,180,0.25)'; rr(px,26,pw,10,5); ctx.fill();
    var pr=levelPressureMax>0?levelPressure/levelPressureMax:0;
    if(pr>0){ ctx.fillStyle=pr>0.5?'#ff5a5a':pr>0.25?'#ff9f1c':'#35c26e'; rr(px,26,Math.max(10,pw*pr),10,5); ctx.fill(); }
    txt(String(levelPressure),px+pw+8,32,13,'#2b2b3d','left',800);
    txt('第'+(levelIdx+1)+'关 · '+curLevel.name,W/2,50,11.5,'#8a8ab8','center',600);
  }
  if(mode==='tutorial'&&tutText){
    var tw2=Math.min(W-40, tutText.length*15+40);
    ctx.fillStyle='rgba(255,255,255,0.95)'; rr(W/2-tw2/2,52,tw2,34,17); ctx.fill();
    ctx.strokeStyle='rgba(255,160,0,0.55)'; ctx.lineWidth=1.5; rr(W/2-tw2/2,52,tw2,34,17); ctx.stroke();
    txt(tutText,W/2,70,13.5,'#b36a00','center',800);
  }
}

function drawBoard(){
  var bw=cell*COLS;
  ctx.fillStyle='rgba(255,255,255,0.55)';
  rr(bx-6,by-6,bw+12,bw+12,18); ctx.fill();
  ctx.strokeStyle='rgba(110,130,210,0.35)'; ctx.lineWidth=1.5;
  rr(bx-6,by-6,bw+12,bw+12,18); ctx.stroke();
  var r,c;
  for(r=0;r<ROWS;r++) for(c=0;c<COLS;c++){
    var t=board[r][c]; if(t) drawTile(t);
  }
  txt('滑动交换凑3连消 · 关卡里先清压力',W/2,by+bw+30,12.5,'#9a9ab8','center',600);
}

function drawTile(t){
  var now=Date.now(), s=cell*0.90;
  var scX=1, scY=1, alpha=1;
  if(t.pop){
    var pt=(now-t.pop)/(reduceMotion?160:360);
    if(pt>=1) return;
    /* Q弹果冻：先压扁蓄力 → 回弹震荡 → 缩小消失 */
    var env=pt<0.30?1:1-Math.pow((pt-0.30)/0.70,2);
    var wob=reduceMotion?0:Math.sin(pt*Math.PI*2.6)*(1-pt)*0.30;
    scX=Math.max(0.01,env*(1+wob)); scY=Math.max(0.01,env*(1-wob));
    alpha=pt<0.55?1:1-(pt-0.55)/0.45;
  } else if(selTile&&board[selTile.r]&&board[selTile.r][selTile.c]===t){
    scX=1.05; scY=1.05;
  }
  ctx.save();
  ctx.globalAlpha=Math.max(0,alpha);
  ctx.translate(t.x,t.y);
  if(shakeTiles&&(shakeTiles[0]===t||shakeTiles[1]===t)&&!reduceMotion){
    var st=(now-shakeT0)/300;
    if(st<1) ctx.translate(Math.sin(st*Math.PI*3)*5*(1-st),0);
  }
  ctx.scale(scX,scY);
  /* 立体感：底部投影 */
  ctx.fillStyle='rgba(0,0,0,0.32)';
  rr(-s/2,-s/2+3,s,s,12); ctx.fill();
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
           ctx.fillText(EMOJI[t.t],0,-s*0.06); }
    /* 主题名小标签 */
    var fs=Math.max(8,Math.round(s*0.2));
    ctx.fillStyle='rgba(30,30,60,0.55)'; ctx.fillRect(-s/2,s/2-fs-4,s,fs+4);
    ctx.font='800 '+fs+'px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillStyle='#ffffff'; ctx.fillText(PNAME[t.t],0,s/2-fs/2-2);
    ctx.restore();

  }
  /* 立体感：顶部高光泽面 + 描边提亮 */
  ctx.save(); rr(-s/2,-s/2,s,s,12); ctx.clip();
  var gl=ctx.createLinearGradient(0,-s/2,0,s/2);
  gl.addColorStop(0,'rgba(255,255,255,0.26)');
  gl.addColorStop(0.45,'rgba(255,255,255,0.03)');
  gl.addColorStop(1,'rgba(0,0,0,0.15)');
  ctx.fillStyle=gl; ctx.fillRect(-s/2,-s/2,s,s);
  ctx.restore();
  ctx.strokeStyle='rgba(255,255,255,0.22)'; ctx.lineWidth=1;
  rr(-s/2+0.5,-s/2+0.5,s-1,s-1,11); ctx.stroke();
  if(t.ice){
    ctx.save(); rr(-s/2,-s/2,s,s,12); ctx.clip();
    ctx.fillStyle='rgba(150,215,255,0.50)'; ctx.fillRect(-s/2,-s/2,s,s);
    ctx.strokeStyle='rgba(255,255,255,0.8)'; ctx.lineWidth=1.5;
    ctx.beginPath();
    ctx.moveTo(-s*0.30,-s*0.28); ctx.lineTo(-s*0.04,-s*0.02); ctx.lineTo(-s*0.18,s*0.26);
    ctx.moveTo(s*0.28,-s*0.24); ctx.lineTo(s*0.02,s*0.08); ctx.lineTo(s*0.24,s*0.30);
    ctx.stroke();
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
    ctx.font='900 '+t.size+'px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.lineWidth=4; ctx.strokeStyle='rgba(255,255,255,0.9)';
    ctx.strokeText(t.text,t.x,t.y);
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
  if(reduceMotion||flashA<=0) return;
  ctx.fillStyle='rgba(255,205,80,'+flashA.toFixed(3)+')';
  ctx.fillRect(0,0,W,H);
}

function button2(r,label){
  ctx.fillStyle='rgba(255,255,255,0.95)'; rr(r.x,r.y,r.w,r.h,r.h/2); ctx.fill();
  ctx.strokeStyle='#7a8fd0'; ctx.lineWidth=1.5; rr(r.x,r.y,r.w,r.h,r.h/2); ctx.stroke();
  txt(label,r.x+r.w/2,r.y+r.h/2+1,16,'#3a4a8a','center',800);
}
function toolBtn(r,icon,n,armed){
  ctx.fillStyle=armed?'#ffe9c2':'rgba(255,255,255,0.92)'; rr(r.x,r.y,r.w,r.h,12); ctx.fill();
  ctx.strokeStyle=armed?'#ff9f1c':'rgba(110,130,210,0.5)'; ctx.lineWidth=armed?2.5:1.5;
  rr(r.x,r.y,r.w,r.h,12); ctx.stroke();
  txt(icon+' ×'+n,r.x+r.w/2,r.y+r.h/2+1,16,n>0?'#3a3a5a':'#a0a0b8','center',800);
}
function drawTools(){
  toolBtn(toolHBtn,'🔨',tools.H,armedTool==='H');
  toolBtn(toolBBtn,'🌟',tools.B,armedTool==='B');
  ctx.fillStyle='rgba(255,255,255,0.92)'; rr(hintBtn.x,hintBtn.y,hintBtn.w,hintBtn.h,12); ctx.fill();
  ctx.strokeStyle='rgba(110,130,210,0.5)'; ctx.lineWidth=1.5; rr(hintBtn.x,hintBtn.y,hintBtn.w,hintBtn.h,12); ctx.stroke();
  txt('💡提示',hintBtn.x+hintBtn.w/2,hintBtn.y+hintBtn.h/2+1,14,'#3a3a5a','center',700);
  if(armedTool){
    var a2=0.6+0.4*Math.sin(Date.now()/300);
    ctx.save(); ctx.globalAlpha=a2;
    txt(armedTool==='H'?'点棋盘任意位置：锤爆 3×3':'点一只怪：清掉全场同类',W/2,hintBtn.y-16,13,'#d97c00','center',800);
    ctx.restore();
  }
}
function drawHint(now){
  if(!hintCells||(now-hintT>2200&&hintT<=now+1)) return;

  var p1=cellXY(hintCells.a.r,hintCells.a.c), p2=cellXY(hintCells.b.r,hintCells.b.c);
  ctx.save();
  ctx.globalAlpha=0.45+0.45*Math.sin(now/180);
  ctx.strokeStyle='#69f0ae'; ctx.lineWidth=3.5;
  [p1,p2].forEach(function(p){ ctx.beginPath(); ctx.arc(p.x,p.y,cell*0.44,0,7); ctx.stroke(); });
  ctx.restore();
}
function dim(){ ctx.fillStyle='rgba(244,247,255,0.88)'; ctx.fillRect(0,0,W,H); }
function button(r,label){
  var g=ctx.createLinearGradient(0,r.y,0,r.y+r.h);
  g.addColorStop(0,'#ffe082'); g.addColorStop(1,'#ffb300');
  ctx.fillStyle=g; rr(r.x,r.y,r.w,r.h,r.h/2); ctx.fill();
  txt(spaced(label),r.x+r.w/2,r.y+r.h/2+1,21,'#1a1a1a','center',900);
}

function handlePauseTap(x,y){
  if(pauseTab==='help'){ if(inRect(x,y,backBtn)) pauseTab='menu'; return; }
  if(inRect(x,y,pHome)){
    if(pauseConfirmHome){ paused=false; pauseTab='menu'; pauseConfirmHome=false; state='start'; }
    else pauseConfirmHome=true;
    return;
  }
  pauseConfirmHome=false;
  if(inRect(x,y,pResume)) paused=false;
  else if(inRect(x,y,pHelp)) pauseTab='help';
  else if(inRect(x,y,pSound)){ soundOn=!soundOn; setPref('nkpi_sound',soundOn?'1':'0'); }
  else if(inRect(x,y,pVib)){ vibOn=!vibOn; setPref('nkpi_vib',vibOn?'1':'0'); }
  else if(inRect(x,y,pMotion)){ reduceMotion=!reduceMotion; setPref('nkpi_rm',reduceMotion?'1':'0'); }
}
function toggleRow(r,label,on){
  ctx.fillStyle='rgba(240,243,255,0.9)'; rr(r.x,r.y,r.w,r.h,10); ctx.fill();
  txt(label,r.x+14,r.y+r.h/2+1,15,'#3a3a5a','left',700);
  txt(on?'开':'关',r.x+r.w-14,r.y+r.h/2+1,15,on?'#35c26e':'#9a9ab8','right',800);
}
function drawPause(){
  dim();
  if(pauseTab==='help'){ drawHelp(); return; }
  var c=pauseCard;
  ctx.fillStyle='rgba(255,255,255,0.97)'; rr(c.x,c.y,c.w,c.h,18); ctx.fill();
  ctx.strokeStyle='rgba(110,130,210,0.4)'; ctx.lineWidth=1.5; rr(c.x,c.y,c.w,c.h,18); ctx.stroke();
  txt('暂停',W/2,c.y+34,22,'#2b2b3d','center',900);
  button(pResume,'继续');
  button2(pHelp,'玩法说明');
  toggleRow(pSound,'声音',soundOn);
  toggleRow(pVib,'震动',vibOn);
  toggleRow(pMotion,'减少动效',reduceMotion);
  if(pauseConfirmHome) button(pHome,'确认返回？');
  else button2(pHome,'返回首页');
}
function drawHelp(){
  var bw2=Math.min(340,W*0.9), bx2=(W-bw2)/2, by2=92, bh2=530;
  ctx.fillStyle='rgba(255,255,255,0.97)'; rr(bx2,by2,bw2,bh2,16); ctx.fill();
  ctx.strokeStyle='rgba(110,130,210,0.4)'; ctx.lineWidth=1.5; rr(bx2,by2,bw2,bh2,16); ctx.stroke();
  txt('玩法说明',W/2,by2+30,20,'#2b2b3d','center',900);
  var y=by2+68;
  for(var i=0;i<NTYPES;i++){
    var im=SPR[SPRKEY[i]];
    ctx.save(); rr(bx2+22,y-19,38,38,10); ctx.clip();
    if(im) ctx.drawImage(im,bx2+22,y-19,38,38);
    else { ctx.font='24px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(EMOJI[i],bx2+41,y); }
    ctx.restore();
    txt(PNAME[i]+' · 压力值 '+PRESSURE[i],bx2+72,y,14,'#3a3a5a','left',700);
    y+=48;
  }
  var lines=['🔨 锤子：直线四连掉落，点击爆破 3×3','🌟 清色：直线五连掉落，与相邻棋子交换清一色','❄ 冰冻：冻住不能移动，凑三连先碎冰','↩ 无效交换会退回，不扣步数'];
  for(var k=0;k<lines.length;k++){ txt(lines[k],bx2+22,y,13,'#3a3a5a','left',600); y+=28; }
  button2(backBtn,'← 返回');
}
function drawPreview(){
  if(!previewCell||!armedTool||phase!=='idle'||paused) return;
  var p=cellXY(previewCell.r,previewCell.c);
  ctx.save();
  if(ctx.setLineDash) ctx.setLineDash([7,5]);
  ctx.strokeStyle='#ff9f1c'; ctx.lineWidth=2.5;
  if(armedTool==='H'){ var s2=cell*3; rr(p.x-s2/2,p.y-s2/2,s2,s2,10); ctx.stroke(); }
  else { ctx.beginPath(); ctx.arc(p.x,p.y,cell*0.46,0,7); ctx.stroke(); }
  ctx.restore();
}
function drawStart(){
  dim();
  var g=ctx.createLinearGradient(0,H*0.15,0,H*0.30);
  g.addColorStop(0,'#ffe082'); g.addColorStop(1,'#ff6f00');
  ctx.font='900 54px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillStyle=g; ctx.fillText('怒砸KPI',W/2,H*0.15);
  txt(spaced('三消宣泄版'),W/2,H*0.15+44,15,'#5a6ab8','center',700);
  var bw2=Math.min(350,W*0.86), bx2=(W-bw2)/2, by2=H*0.15+78;
  ctx.fillStyle='rgba(255,255,255,0.93)'; rr(bx2,by2,bw2,196,14); ctx.fill();
  ctx.strokeStyle='rgba(110,130,210,0.4)'; ctx.lineWidth=1; rr(bx2,by2,bw2,196,14); ctx.stroke();
  var lines=['8×8 棋盘，滑动交换相邻两只','凑 3 连消，爆!连锁分数翻倍','🔨 4连掉锤子：点爆 3×3','🌟 5连掉老板炸弹：清一色','💥 压力值：房贷>KPI>甲方>周报·咖啡','30 步，无倒计时，慢慢刷分!'];
  for(var i=0;i<lines.length;i++) txt(lines[i],W/2,by2+26+i*27,14,'#4a4a6a','center',600);
  button(startBtn,'经典模式');
  button2(modeBtn,'📅 每日挑战');
  button2(levelsBtn,'📖 关卡模式');
  txt('经典最佳 '+store.get()+' · 今日最佳 '+store.getDaily(),W/2,levelsBtn.y+levelsBtn.h+26,13,'#9a9ab8','center',600);
}

function drawLevels(){
  dim();
  txt('关卡选择',W/2,64,26,'#2b2b3d','center',900);
  txt('减压为王：把压力条清零就过关！',W/2,94,12.5,'#5a6ab8','center',600);
  var prog=loadProg(), un=prog.unlocked||1, stars=prog.stars||{};
  for(var i=0;i<LEVELS.length;i++){
    var r=levelRect(i), locked=i>=un;
    ctx.fillStyle=locked?'rgba(228,230,244,0.9)':'rgba(255,255,255,0.95)'; rr(r.x,r.y,r.w,r.h,14); ctx.fill();
    ctx.strokeStyle=locked?'rgba(160,165,200,0.5)':'#7a8fd0'; ctx.lineWidth=1.5; rr(r.x,r.y,r.w,r.h,14); ctx.stroke();
    txt(locked?'🔒':String(i+1),r.x+r.w/2,r.y+22,locked?19:23,locked?'#a0a0b8':'#2b2b3d','center',900);
    var st=stars[i]||0, ss='';
    for(var k=0;k<st;k++) ss+='★';
    if(ss) txt(ss,r.x+r.w/2,r.y+46,11,'#ffd54a','center',700);
    txt(LEVELS[i].name,r.x+r.w/2,r.y+r.h+11,10,'#8a8aa8','center',600);
  }
  button2(backBtn,'← 返回');
}
function drawLevelEnd(){
  if(endWin){
    var st=starCount();
    txt('过关!',W/2,H*0.14,26,'#69f0ae','center',900);
    ctx.font='44px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    for(var i=0;i<3;i++){ ctx.fillStyle=i<st?'#ffd54a':'#3a3a52'; ctx.fillText(i<st?'★':'☆',W/2-52+i*52,H*0.14+52); }
    txt(String(score),W/2,H*0.14+122,58,'#f0a000','center',900);
    txt('第'+(levelIdx+1)+'关 · '+curLevel.name,W/2,H*0.14+162,15,'#8a8ab0','center',600);
    button(againBtn, levelIdx<LEVELS.length-1?'下一关':'重玩本关');
    button2(shareBtn,'📤 分享战绩');
  } else {
    txt('就差一点!',W/2,H*0.14,26,'#ff8a80','center',900);
    var pg='剩余压力 '+levelPressure+' / 本局 '+score+' 分';
    txt(pg,W/2,H*0.14+56,17,'#d7dcff','center',700);
    txt('第'+(levelIdx+1)+'关 · '+curLevel.name,W/2,H*0.14+88,14,'#8a8aa8','center',600);
    button(againBtn,'再试一次');
    button2(shareBtn,'回选关');
  }
}
function drawEnd(){
  dim();
  if(mode==='level'){ drawLevelEnd(); return; }
  var stars=score>=10000?3:score>=6500?2:score>=3000?1:0;
  txt(mode==='daily'?'今日挑战结束!':'对局结束!',W/2,H*0.14,20,'#5a6ab8','center',800);
  ctx.font='44px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  for(var i=0;i<3;i++){ ctx.fillStyle=i<stars?'#ffd54a':'#3a3a52';
    ctx.fillText(i<stars?'★':'☆',W/2-52+i*52,H*0.14+52); }
  txt(String(score),W/2,H*0.14+122,62,'#f0a000','center',900);
  var best=mode==='daily'?store.getDaily():store.get();
  txt((mode==='daily'?'今日':'历史')+'最佳 '+Math.max(best,score),W/2,H*0.14+164,15,'#8a8ab0','center',600);
  var rec='';
  if(score>best&&best>0) rec='🎉 新纪录!';
  else if(best>0&&score<best&&best-score<=500) rec='就差 '+(best-score)+' 分破纪录!不服?';
  if(rec) txt(rec,W/2,H*0.14+190,15,'#69f0ae','center',800);
  var msg=stars>=3?'🏆 传奇打工人!':stars===2?'🔥 甲方已被你拿下!':stars===1?'💪 初露锋芒!':'😅 多练练，手感会来的!';
  txt(msg,W/2,H*0.14+216,18,'#ff8a80','center',800);
  button(againBtn,'再来一局');
  button2(shareBtn,'📤 分享战绩');
}

function draw(now){
  drawBG();
  ctx.save();
  if(shakeT>0) ctx.translate((Math.random()-0.5)*10,(Math.random()-0.5)*10);
  if(state==='playing'){
    drawHUD(); drawBoard(); drawTools(); drawHint(now); drawPreview(); drawParts();
    drawRings(now); drawHammers(now); drawBigTexts(now); drawFlash();
    if(mode==='tutorial') button2(skipBtn,'跳过引导');
    if(paused) drawPause();
  } else if(state==='start'){
    drawStart();
  } else if(state==='levels'){
    drawLevels();
  } else {
    drawHUD(); drawBoard(); drawEnd();
  }
  ctx.restore();
}

/* ============ 主循环 ============ */
var last=Date.now();
function loop(){
  var now=Date.now(), dt=Math.min(0.05,(now-last)/1000); last=now;
  if(pendingPause&&phase==='idle'&&state==='playing'&&!paused){
    paused=true; pendingPause=false; pauseTab='menu'; pauseConfirmHome=false;
  }
  if(paused){ draw(now); requestAnimationFrame(loop); return; }
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
