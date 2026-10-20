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

var ROWS=8, COLS=8, NTYPES=5, MOVES=30, CLASSIC_TARGET=6000;
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
var curLevel=null, levelIdx=0, collected=0, endWin=false, finalDone=false;
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
var hudY=20, safeTop=20, safeBot=0;
function layout(){
  canvas.width=Math.round(W*DPR); canvas.height=Math.round(H*DPR);
  ctx.setTransform(DPR,0,0,DPR,0,0);
  /* 安全区：避开微信右上角胶囊与底部手势条 */
  safeTop=(sys.statusBarHeight||20)+8; safeBot=0;
  try{ var mb=wx.getMenuButtonBoundingClientRect&&wx.getMenuButtonBoundingClientRect(); if(mb&&mb.bottom) safeTop=mb.bottom+8; }catch(e){}
  try{ if(sys.safeArea&&sys.safeArea.bottom) safeBot=Math.max(0,H-sys.safeArea.bottom); }catch(e){}
  var hudBlock=46+10+24+18, dockH=84, gap=30;
  var avail=H-safeTop-safeBot-12;
  cell=Math.min((W-40)/COLS,(avail-hudBlock-dockH-gap-20)/ROWS);
  var bw=cell*COLS;
  var block=hudBlock+bw+gap+dockH;
  hudY=safeTop+Math.max(0,(avail-block)*0.3);
  hudH=hudY+hudBlock;
  bx=(W-bw)/2; by=hudH+4;
  makeBG(); tileDirty=true;
  /* 尺寸变化后重算棋子坐标 */
  for(var r0=0;r0<ROWS;r0++) for(var c0=0;c0<COLS;c0++){
    var t0=board[r0]&&board[r0][c0];
    if(t0){ var q=cellXY(r0,c0); t0.tx=q.x; t0.ty=q.y; t0.x=q.x; t0.y=q.y; }
  }
  var btw=Math.min(260,W*0.66), bth=60, sy=H*0.5;
  startBtn={x:(W-btw)/2,y:sy,w:btw,h:bth};
  var hw=(btw-12)/2;
  modeBtn={x:(W-btw)/2,y:sy+bth+18,w:hw,h:50};
  levelsBtn={x:(W-btw)/2+hw+12,y:sy+bth+18,w:hw,h:50};
  againBtn={x:(W-btw)/2,y:H*0.2+250,w:btw,h:bth};
  shareBtn={x:(W-btw)/2,y:H*0.2+250+bth+16,w:btw,h:50};
  backBtn={x:(W-150)/2,y:H-safeBot-96,w:150,h:48};
  var R=36, tcy=by+bw+gap+dockH/2-2, gp=Math.min(96,(W-60)/3);
  toolHBtn={x:W/2-gp-R,y:tcy-R,w:R*2,h:R*2};
  toolBBtn={x:W/2-R,y:tcy-R,w:R*2,h:R*2};
  hintBtn={x:W/2+gp-R,y:tcy-R,w:R*2,h:R*2};
  pauseBtn={x:W-14-44,y:hudY+1,w:44,h:44};
  skipBtn={x:14,y:hudY+4,w:88,h:38};
  var pw2=Math.min(300,W*0.8), px2=(W-pw2)/2, py2=H*0.22;
  pauseCard={x:px2,y:py2,w:pw2,h:384};
  pResume={x:px2+28,y:py2+42,w:pw2-56,h:54};
  pHelp={x:px2+28,y:py2+110,w:pw2-56,h:46};
  pSound={x:px2+28,y:py2+170,w:pw2-56,h:42};
  pVib={x:px2+28,y:py2+218,w:pw2-56,h:42};
  pMotion={x:px2+28,y:py2+266,w:pw2-56,h:42};
  pHome={x:px2+28,y:py2+320,w:pw2-56,h:46};
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
/* 立绘白底抠图：从边缘泛洪去掉近白色背景，失败则用原图 */
var SPRK={};
function keyWhite(img){
  try{
    var N=192, cv=wx.createCanvas(); cv.width=N; cv.height=N;
    var c2=cv.getContext('2d'); c2.drawImage(img,0,0,N,N);
    var id=c2.getImageData(0,0,N,N), d=id.data, seen=new Uint8Array(N*N), st=[], i, x, y;
    function white(p){ var o=p*4; return d[o]>222&&d[o+1]>222&&d[o+2]>222; }
    for(i=0;i<N;i++){ st.push(i, (N-1)*N+i, i*N, i*N+N-1); }
    while(st.length){ var p=st.pop(); if(seen[p]||!white(p)) continue; seen[p]=1; d[p*4+3]=0;
      x=p%N; y=(p/N)|0;
      if(x>0) st.push(p-1); if(x<N-1) st.push(p+1); if(y>0) st.push(p-N); if(y<N-1) st.push(p+N); }
    /* 边缘柔化 */
    for(p=0;p<N*N;p++){ if(seen[p]) continue; x=p%N; y=(p/N)|0;
      if((x>0&&seen[p-1])||(x<N-1&&seen[p+1])||(y>0&&seen[p-N])||(y<N-1&&seen[p+N])){ var o=p*4, m=Math.min(d[o],d[o+1],d[o+2]); if(m>180) d[o+3]=Math.round(255*(255-m)/75); } }
    c2.putImageData(id,0,0);
    return cv;
  }catch(e){ return null; }
}
function loadSprites(){
  ['kpi','zhoubao','jiafang','fangdai','kafei','laoban','hammer_item'].forEach(function(k){
    try{
      var img=mkImg();
      img.onload=function(){ SPR[k]=img; var kk=keyWhite(img); if(kk) SPRK[k]=kk; tileDirty=true; };
      img.onerror=function(){};
      img.src='assets/'+k+'.png';
    }catch(e){}
  });
  try{
    var bgi=mkImg();
    bgi.onload=function(){ SPR['bg']=bgi; makeBG(); };
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
  var x0=(W-(cols*s+(cols-1)*gap))/2, y0=Math.max(110,safeTop+70);
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
  state='playing'; score=0; cascade=0; collected=0; endWin=false; finalDone=false;
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
  if(mode==='level'&&targetMet()){ levelEnd(true); return; }
  /* 收官：步数用尽时自动引爆剩余特殊棋子，结算奖励分 */
  if(moves<=0&&!finalDone){
    finalDone=true;
    if(finalBlast()) return;
  }
  if(mode==='level'){
    if(targetMet()){ levelEnd(true); return; }
    if(moves<=0){ levelEnd(false); return; }
  } else if(moves<=0){ endGame(); return; }
  if(moves===1) bigTexts.push({text:'最后一步!',color:'#ff5a5a',t0:Date.now()});
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
function finalBlast(){
  var now=Date.now(), list=[], i, j;
  for(i=0;i<ROWS;i++) for(j=0;j<COLS;j++){ var t=board[i][j]; if(t&&!t.pop&&isSpecial(t)) list.push([i,j]); }
  if(!list.length) return false;
  var bonus=list.length*200;
  for(i=0;i<list.length;i++) detonate(list[i][0],list[i][1],now);
  score+=bonus; cascade=0; lastFocus=null;
  bigTexts.push({text:'收官引爆! +'+bonus,color:'#ffd54a',t0:now});
  flashA=0.3; shakeT=0.25; sSmash(); vibrate();
  pendingFree=true; phase='pop'; phaseT=0.5;
  return true;
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
/* —— 视觉主题：暖色办公室 + 靛紫品牌色 —— */
var PAL={ink:'#2b2f5e',sub:'#7a80b4',b1:'#9b8cff',b2:'#5f7cff',w1:'#ffd45a',w2:'#ff8a3d',cream:'#f6f3ff'};
/* 每类棋子底板：[顶色, 底色, 厚边色] */
var TILEC=[['#e6f0ff','#9fc3ff','#6b95e3'],['#f3f0ff','#cbc2f6','#9a8fd6'],['#e3fbe7','#9fe2ae','#63b97a'],['#ffe9de','#ffb08c','#df7c55'],['#fff7da','#ffd98a','#dca84b']];
var TCACHE={}, TC_S=0, tileDirty=true, boardCv=null;
var lastState='', transT=0, endT=0;
function shadowOn(c,b,oy){ ctx.shadowColor=c; ctx.shadowBlur=b; ctx.shadowOffsetX=0; ctx.shadowOffsetY=oy||0; }
function shadowOff(){ ctx.shadowColor='rgba(0,0,0,0)'; ctx.shadowBlur=0; ctx.shadowOffsetY=0; }
function lg(x0,y0,x1,y1,st){ var g=ctx.createLinearGradient(x0,y0,x1,y1); for(var i=0;i<st.length;i++) g.addColorStop(st.length>1?i/(st.length-1):0,st[i]); return g; }
function withCtx(c2,fn){ var o=ctx; ctx=c2; try{ fn(); }catch(e){} ctx=o; }
function circle(x,y,r){ ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); }
function oval(x,y,rx,ry,rot){ ctx.save(); ctx.translate(x,y); if(rot) ctx.rotate(rot); ctx.scale(rx,ry); ctx.beginPath(); ctx.arc(0,0,1,0,Math.PI*2); ctx.restore(); }
function starPath(cx,cy,R,r,n){ n=n||5; ctx.beginPath(); for(var i=0;i<n*2;i++){ var a=-Math.PI/2+i*Math.PI/n, q=i%2?r:R; if(i) ctx.lineTo(cx+Math.cos(a)*q,cy+Math.sin(a)*q); else ctx.moveTo(cx+Math.cos(a)*q,cy+Math.sin(a)*q); } ctx.closePath(); }
/* 描边大字（数字/短反馈） */
function bigTxt(s,x,y,size,fillSt,outline,lw){
  ctx.font='900 '+size+'px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.lineJoin='round'; ctx.lineWidth=lw||Math.max(4,size*0.22); ctx.strokeStyle=outline||'#3b2a8a'; ctx.strokeText(s,x,y);
  ctx.fillStyle=fillSt; ctx.fillText(s,x,y);
}
function sprK(k){ return SPRK[k]||SPR[k]; }


/* —— 矢量小图标（不依赖 emoji 字体） —— */
function drawIcon(k,x,y,sz,col){
  var u=sz/20; ctx.save(); ctx.translate(x,y); ctx.scale(u,u);
  ctx.fillStyle=col; ctx.strokeStyle=col; ctx.lineWidth=2.4; ctx.lineCap='round'; ctx.lineJoin='round';
  if(k==='cal'){ rr(-9,-7,18,16,3); ctx.stroke(); ctx.fillRect(-9,-7,18,5); ctx.fillRect(-5,-10,2.5,5); ctx.fillRect(2.5,-10,2.5,5); ctx.fillRect(-4,1,3,3); ctx.fillRect(1,1,3,3); }
  else if(k==='book'){ ctx.beginPath(); ctx.moveTo(0,-6); ctx.quadraticCurveTo(-5,-9,-10,-7); ctx.lineTo(-10,8); ctx.quadraticCurveTo(-5,6,0,9); ctx.quadraticCurveTo(5,6,10,8); ctx.lineTo(10,-7); ctx.quadraticCurveTo(5,-9,0,-6); ctx.lineTo(0,9); ctx.stroke(); }
  else if(k==='trophy'){ ctx.beginPath(); ctx.moveTo(-7,-9); ctx.lineTo(7,-9); ctx.lineTo(6,0); ctx.quadraticCurveTo(0,6,-6,0); ctx.closePath(); ctx.fill(); ctx.fillRect(-1.5,3,3,4); rr(-6,7,12,3,1.5); ctx.fill();
    ctx.beginPath(); ctx.arc(-8,-5,3.5,Math.PI*0.5,Math.PI*1.5); ctx.stroke(); ctx.beginPath(); ctx.arc(8,-5,3.5,-Math.PI*0.5,Math.PI*0.5); ctx.stroke(); }
  else if(k==='share'){ ctx.beginPath(); ctx.moveTo(0,4); ctx.lineTo(0,-9); ctx.moveTo(-5,-4); ctx.lineTo(0,-9); ctx.lineTo(5,-4); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-7,0); ctx.lineTo(-9,0); ctx.lineTo(-9,9); ctx.lineTo(9,9); ctx.lineTo(9,0); ctx.lineTo(7,0); ctx.stroke(); }
  else if(k==='home'){ ctx.beginPath(); ctx.moveTo(-10,0); ctx.lineTo(0,-9); ctx.lineTo(10,0); ctx.moveTo(-7,-2); ctx.lineTo(-7,9); ctx.lineTo(7,9); ctx.lineTo(7,-2); ctx.stroke(); ctx.fillRect(-2.5,3,5,6); }
  else if(k==='help'){ ctx.beginPath(); ctx.arc(0,0,10,0,Math.PI*2); ctx.stroke(); ctx.beginPath(); ctx.arc(0,-3,3.5,Math.PI*1.1,Math.PI*0.4); ctx.lineTo(0,3); ctx.stroke(); ctx.beginPath(); ctx.arc(0,6.5,1.4,0,7); ctx.fill(); }
  else if(k==='back'){ ctx.beginPath(); ctx.moveTo(9,0); ctx.lineTo(-8,0); ctx.moveTo(-2,-7); ctx.lineTo(-9,0); ctx.lineTo(-2,7); ctx.stroke(); }
  else if(k==='party'){ ctx.beginPath(); ctx.moveTo(-9,9); ctx.lineTo(-3,-7); ctx.lineTo(7,3); ctx.closePath(); ctx.fill(); ctx.fillRect(4,-9,3,3); ctx.fillRect(8,-3,3,3); ctx.fillRect(-1,-11,2.5,2.5); }
  ctx.restore();
}
/* 引导手指 */
function drawPointer(x,y){
  ctx.save(); ctx.translate(x,y); ctx.rotate(-0.35);
  shadowOn('rgba(0,0,0,0.3)',6,3);
  ctx.fillStyle='#ffffff'; ctx.strokeStyle='#3b2a8a'; ctx.lineWidth=2.5;
  ctx.beginPath(); ctx.moveTo(-4,0); ctx.lineTo(-4,-14); ctx.arc(0,-14,4,Math.PI,0); ctx.lineTo(4,-2);
  ctx.lineTo(12,0); ctx.quadraticCurveTo(16,2,15,8); ctx.lineTo(13,18); ctx.quadraticCurveTo(12,22,6,22); ctx.lineTo(-4,22); ctx.quadraticCurveTo(-10,20,-12,12); ctx.lineTo(-14,4); ctx.quadraticCurveTo(-14,0,-10,1); ctx.lineTo(-4,6); ctx.closePath();
  ctx.fill(); shadowOff(); ctx.stroke();
  ctx.restore();
}

/* —— 棋子底板（离屏缓存） —— */
function paintTile(k,s){
  var h=s/2, r=s*0.27, col;
  if(k==='H') col=['#ffe2b8','#ff9d45','#d9651c'];
  else if(k==='B') col=['#fff3b0','#ffc53a','#c98a00'];
  else col=TILEC[k];
  ctx.fillStyle=col[2]; rr(-h,-h+3,s,s-2,r); ctx.fill();
  ctx.fillStyle=lg(0,-h,0,h,[col[0],col[1]]); rr(-h,-h,s,s-3,r); ctx.fill();
  ctx.save(); rr(-h,-h,s,s-3,r); ctx.clip();
  ctx.fillStyle=lg(0,-h,0,-h+s*0.45,['rgba(255,255,255,0.75)','rgba(255,255,255,0)']);
  rr(-h+3,-h+2,s-6,s*0.42,r*0.8); ctx.fill();
  ctx.restore();
  ctx.strokeStyle='rgba(255,255,255,0.8)'; ctx.lineWidth=1.2; rr(-h+1,-h+1,s-2,s-5,r-1); ctx.stroke();
  var key=k==='H'?'hammer_item':k==='B'?'laoban':SPRKEY[k];
  var im=sprK(key), z=s*(k==='H'||k==='B'?0.92:0.9);
  if(im&&im.width) ctx.drawImage(im,-z/2,-z/2-1.5,z,z);
  else { ctx.font=(s*0.55)+'px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle='#333';
    ctx.fillText(k==='H'?'🔨':k==='B'?'🌟':EMOJI[k],0,0); }
}
function buildTileCache(){
  tileDirty=false; TCACHE={};
  var s=Math.round(cell*0.92), pad=4; TC_S=s;
  [0,1,2,3,4,'H','B'].forEach(function(k){
    try{
      var cv=wx.createCanvas(), px=Math.ceil((s+pad*2)*DPR);
      cv.width=px; cv.height=px;
      var c2=cv.getContext('2d'); c2.setTransform(DPR,0,0,DPR,0,0);
      withCtx(c2,function(){ ctx.translate(pad+s/2,pad+s/2); paintTile(k,s); });
      TCACHE[k]=cv;
    }catch(e){}
  });
  buildBoardPanel();
}
/* —— 棋盘面板（离屏缓存：外框渐变 + 内凹阴影 + 棋格） —— */
function buildBoardPanel(){
  try{
    if(!boardCv) boardCv=wx.createCanvas();
    boardCv.width=Math.round(W*DPR); boardCv.height=Math.round(H*DPR);
    var c2=boardCv.getContext('2d'); c2.setTransform(DPR,0,0,DPR,0,0); c2.clearRect(0,0,W,H);
    withCtx(c2,paintBoardPanel);
  }catch(e){ boardCv=null; }
}
function paintBoardPanel(){
  var bw=cell*COLS, f=10, r, c;
  shadowOn('rgba(60,40,150,0.35)',22,10);
  ctx.fillStyle=lg(0,by-f,0,by+bw+f,[PAL.b1,PAL.b2]); rr(bx-f,by-f,bw+f*2,bw+f*2,24); ctx.fill();
  shadowOff();
  ctx.strokeStyle='rgba(255,255,255,0.55)'; ctx.lineWidth=2; rr(bx-f+1.5,by-f+1.5,bw+f*2-3,bw+f*2-3,22.5); ctx.stroke();
  ctx.fillStyle=PAL.cream; rr(bx-3,by-3,bw+6,bw+6,16); ctx.fill();
  ctx.save(); rr(bx-3,by-3,bw+6,bw+6,16); ctx.clip();
  for(r=0;r<ROWS;r++) for(c=0;c<COLS;c++) if((r+c)%2){ ctx.fillStyle='rgba(120,105,230,0.08)'; ctx.fillRect(bx+c*cell,by+r*cell,cell,cell); }
  shadowOn('rgba(50,35,140,0.45)',12,4);
  ctx.strokeStyle='rgba(50,35,140,0.5)'; ctx.lineWidth=8; rr(bx-7,by-7,bw+14,bw+14,20); ctx.stroke();
  shadowOff(); ctx.restore();
}

/* —— 背景：办公室场景 + 暗角 —— */
function makeBG(){
  try{
    if(!bg) bg=wx.createCanvas();
    bg.width=Math.round(W*DPR); bg.height=Math.round(H*DPR);
    var b=bg.getContext('2d'); b.setTransform(DPR,0,0,DPR,0,0);
    withCtx(b,function(){
      ctx.fillStyle=lg(0,0,0,H,['#bfe3ff','#fde9d2']); ctx.fillRect(0,0,W,H);
      var bgi=SPR['bg'];
      if(bgi&&bgi.width){
        var sc=Math.max(W/bgi.width,H/bgi.height), dw=bgi.width*sc, dh=bgi.height*sc;
        ctx.drawImage(bgi,(W-dw)/2,(H-dh)/2,dw,dh);
      }
      ctx.fillStyle=lg(0,0,0,H*0.35,['rgba(120,110,255,0.22)','rgba(120,110,255,0)']); ctx.fillRect(0,0,W,H*0.35);
      var v=ctx.createRadialGradient(W/2,H*0.45,Math.min(W,H)*0.35,W/2,H*0.45,Math.max(W,H)*0.75);
      v.addColorStop(0,'rgba(40,30,90,0)'); v.addColorStop(1,'rgba(40,30,90,0.32)');
      ctx.fillStyle=v; ctx.fillRect(0,0,W,H);
    });
  }catch(e){ bg=null; }
}
function drawBG(){
  if(bg){ try{ ctx.drawImage(bg,0,0,W,H); }catch(e){ ctx.fillStyle='#cfe3ff'; ctx.fillRect(0,0,W,H); } }
  else { ctx.fillStyle='#cfe3ff'; ctx.fillRect(0,0,W,H); }
  if(mode==='level'&&curLevel&&levelPressureMax>0&&state!=='start'&&state!=='levels'){
    ctx.fillStyle='rgba(255,70,90,'+(0.10*(levelPressure/levelPressureMax)).toFixed(3)+')'; ctx.fillRect(0,0,W,H);
  }
}

/* —— HUD 胶囊 —— */
function capsule(x,y,w,h){
  shadowOn('rgba(40,40,130,0.22)',12,4);
  ctx.fillStyle='rgba(255,255,255,0.95)'; rr(x,y,w,h,h/2); ctx.fill(); shadowOff();
  ctx.strokeStyle='rgba(155,140,255,0.45)'; ctx.lineWidth=1.5; rr(x+0.75,y+0.75,w-1.5,h-1.5,h/2); ctx.stroke();
}
function iconDisc(cx,cy,r,c0,c1){
  ctx.fillStyle=lg(cx,cy-r,cx,cy+r,[c0,c1]); circle(cx,cy,r); ctx.fill();
  ctx.fillStyle='rgba(255,255,255,0.35)'; oval(cx,cy-r*0.45,r*0.62,r*0.32); ctx.fill();
}
function iconSteps(cx,cy,s){ ctx.fillStyle='#fff'; oval(cx-s*0.22,cy+s*0.08,s*0.16,s*0.26,-0.25); ctx.fill(); oval(cx+s*0.2,cy-s*0.12,s*0.16,s*0.26,0.25); ctx.fill(); }
function iconPause(cx,cy){ ctx.fillStyle=PAL.ink; rr(cx-7,cy-8,5,16,2); ctx.fill(); rr(cx+2,cy-8,5,16,2); ctx.fill(); }
function drawHUD(){
  var now=Date.now(), y=hudY, h=46;
  if(mode!=='tutorial'){
    /* 步数 */
    var urgent=moves<=5&&state==='playing';
    capsule(14,y,108,h);
    iconDisc(14+h/2,y+h/2,17,urgent?'#ff8a8a':'#ffb35c',urgent?'#ff3d5a':'#ff7a1a');
    iconSteps(14+h/2,y+h/2,24);
    var sc=1; if(urgent&&!reduceMotion) sc=1+0.08*Math.max(0,Math.sin(now/130));
    ctx.save(); ctx.translate(14+h+30,y+h/2+1); ctx.scale(sc,sc);
    txt(String(moves),0,0,26,urgent?'#ff3d5a':PAL.ink,'center',900); ctx.restore();
    /* 分数 */
    var sw=136, sx=pauseBtn.x-10-sw;
    capsule(sx,y,sw,h);
    iconDisc(sx+h/2,y+h/2,17,'#fff08a','#ffb300');
    ctx.fillStyle='#fff'; starPath(sx+h/2,y+h/2+1,10,4.4); ctx.fill();
    txt(String(score),sx+h+(sw-h-12)/2,y+h/2+1,24,PAL.ink,'center',900);
  }
  /* 暂停 */
  var pc={x:pauseBtn.x+pauseBtn.w/2,y:pauseBtn.y+pauseBtn.h/2};
  shadowOn('rgba(40,40,130,0.22)',12,4); ctx.fillStyle='#fff'; circle(pc.x,pc.y,22); ctx.fill(); shadowOff();
  ctx.strokeStyle='rgba(155,140,255,0.45)'; ctx.lineWidth=1.5; circle(pc.x,pc.y,21); ctx.stroke();
  iconPause(pc.x,pc.y);
  /* 第二行：目标/压力进度条 */
  var bw2=Math.min(260,W-80), bx2=(W-bw2)/2, by2=y+h+10, bh=16, pr=-1, cols=null, ic=null;
  if(mode==='classic'){ pr=Math.min(1,score/CLASSIC_TARGET); cols=pr>=1?['#7cf0a8','#1fbf6a']:['#ffd45a','#ff8a3d']; ic='flag'; }
  else if(mode==='level'&&curLevel){ pr=levelPressureMax>0?levelPressure/levelPressureMax:0; cols=pr>0.5?['#ff9a9a','#ff3d5a']:pr>0.25?['#ffd45a','#ff8a3d']:['#7cf0a8','#1fbf6a']; ic='stress'; }
  if(pr>=0){
    capsule(bx2-4,by2-4,bw2+8,bh+8);
    ctx.fillStyle='rgba(120,105,230,0.15)'; rr(bx2+18,by2,bw2-22,bh,bh/2); ctx.fill();
    if(pr>0){ var fw=Math.max(bh,(bw2-22)*pr); ctx.fillStyle=lg(0,by2,0,by2+bh,cols); rr(bx2+18,by2,fw,bh,bh/2); ctx.fill();
      ctx.fillStyle='rgba(255,255,255,0.45)'; rr(bx2+22,by2+2,Math.max(0,fw-8),bh*0.35,bh*0.2); ctx.fill(); }
    var ix=bx2+6, iy=by2+bh/2;
    if(ic==='flag'){ iconDisc(ix,iy,13,'#b9a8ff','#6a5cff'); ctx.fillStyle='#fff'; ctx.fillRect(ix-4,iy-7,2,14); ctx.beginPath(); ctx.moveTo(ix-2,iy-7); ctx.lineTo(ix+7,iy-3.5); ctx.lineTo(ix-2,iy); ctx.closePath(); ctx.fill(); }
    else { iconDisc(ix,iy,13,'#ff9a9a','#ff3d5a'); ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(ix-5,iy-4); ctx.lineTo(ix-1,iy); ctx.moveTo(ix+5,iy-4); ctx.lineTo(ix+1,iy); ctx.moveTo(ix-4,iy+5); ctx.quadraticCurveTo(ix,iy+1,ix+4,iy+5); ctx.stroke(); }
    if(ic==='flag'){ var tx=bx2+bw2-4; ctx.fillStyle=pr>=1?'#1fbf6a':'#c9c2f2'; starPath(tx,iy,7,3); ctx.fill(); }
  }
}

function drawBoard(){
  if(tileDirty||!TC_S) buildTileCache();
  if(boardCv){ try{ ctx.drawImage(boardCv,0,0,W,H); }catch(e){ withCtx(ctx,paintBoardPanel); } }
  else paintBoardPanel();
  for(var r=0;r<ROWS;r++) for(var c=0;c<COLS;c++){ var t=board[r][c]; if(t&&!t.pop) drawTile(t); }
  for(r=0;r<ROWS;r++) for(c=0;c<COLS;c++){ var u=board[r][c]; if(u&&u.pop) drawTile(u); }
}

function drawTile(t){
  var now=Date.now(), s=TC_S||cell*0.92;
  var scX=1, scY=1, alpha=1, flash=0;
  var sel=selTile&&board[selTile.r]&&board[selTile.r][selTile.c]===t;
  if(t.pop){
    var pt=(now-t.pop)/(reduceMotion?160:360);
    if(pt>=1) return;
    var env=pt<0.30?1:1-Math.pow((pt-0.30)/0.70,2);
    var wob=reduceMotion?0:Math.sin(pt*Math.PI*2.6)*(1-pt)*0.30;
    scX=Math.max(0.01,env*(1+wob)); scY=Math.max(0.01,env*(1-wob));
    alpha=pt<0.55?1:1-(pt-0.55)/0.45; flash=Math.max(0,1-pt*2.2);
  } else if(sel){ var b=reduceMotion?0:Math.sin(now/120)*0.03; scX=1.08+b; scY=1.08-b; }
  ctx.save();
  ctx.globalAlpha=Math.max(0,alpha);
  ctx.translate(t.x,t.y);
  if(shakeTiles&&(shakeTiles[0]===t||shakeTiles[1]===t)&&!reduceMotion){
    var st=(now-shakeT0)/300; if(st<1) ctx.translate(Math.sin(st*Math.PI*3)*5*(1-st),0);
  }
  ctx.scale(scX,scY);
  if(isSpecial(t)&&!t.pop&&!reduceMotion){
    var ga=0.35+0.25*Math.sin(now/220);
    shadowOn(t.t==='B'?'rgba(255,200,0,'+ga+')':'rgba(255,130,30,'+ga+')',16,0);
    ctx.fillStyle='rgba(255,255,255,0.01)'; rr(-s/2,-s/2,s,s,s*0.27); ctx.fill(); shadowOff();
  }
  var cv=TCACHE[t.t];
  if(cv) ctx.drawImage(cv,-s/2-4,-s/2-4,s+8,s+8); else paintTile(t.t,s);
  if(isSpecial(t)&&!t.pop&&!reduceMotion){
    ctx.save(); rr(-s/2,-s/2,s,s-3,s*0.27); ctx.clip();
    var sx=((now/6)%(s*3))-s*1.5;
    ctx.fillStyle='rgba(255,255,255,0.45)'; ctx.beginPath();
    ctx.moveTo(sx-6,-s/2); ctx.lineTo(sx+6,-s/2); ctx.lineTo(sx-s*0.3+6,s/2); ctx.lineTo(sx-s*0.3-6,s/2); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  if(sel){ shadowOn('rgba(255,190,20,1)',14,0); ctx.strokeStyle='#ffd23a'; ctx.lineWidth=4; rr(-s/2-2,-s/2-2,s+4,s+1,s*0.3); ctx.stroke(); shadowOff();
    ctx.strokeStyle='#fff'; ctx.lineWidth=1.5; rr(-s/2+1,-s/2+1,s-2,s-5,s*0.26); ctx.stroke(); }
  if(flash>0){ ctx.fillStyle='rgba(255,255,255,'+(flash*0.85).toFixed(3)+')'; rr(-s/2,-s/2,s,s-3,s*0.27); ctx.fill(); }
  if(t.ice){
    ctx.save(); rr(-s/2,-s/2,s,s-3,s*0.27); ctx.clip();
    ctx.fillStyle=lg(0,-s/2,0,s/2,['rgba(200,240,255,0.75)','rgba(120,200,255,0.55)']); ctx.fillRect(-s/2,-s/2,s,s);
    ctx.strokeStyle='rgba(255,255,255,0.9)'; ctx.lineWidth=1.6; ctx.beginPath();
    ctx.moveTo(-s*0.30,-s*0.28); ctx.lineTo(-s*0.04,-s*0.02); ctx.lineTo(-s*0.18,s*0.26);
    ctx.moveTo(s*0.28,-s*0.24); ctx.lineTo(s*0.02,s*0.08); ctx.lineTo(s*0.24,s*0.30); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle='rgba(255,255,255,0.95)'; ctx.lineWidth=2; rr(-s/2+1,-s/2+1,s-2,s-5,s*0.26); ctx.stroke();
  }
  ctx.restore();
}

function drawParts(){
  var i;
  for(i=parts.length-1;i>=0;i--){ var p=parts[i];
    p.x+=p.vx; p.y+=p.vy; p.vy+=0.22; p.life-=0.035;
    if(p.life<=0){ parts.splice(i,1); continue; }
    ctx.globalAlpha=Math.max(0,p.life); ctx.fillStyle=p.c;
    var rad=p.r*p.life+0.6;
    if(i%3===0){ starPath(p.x,p.y,rad*2.1,rad*0.7,4); ctx.fill(); }
    else { circle(p.x,p.y,rad); ctx.fill(); }
    ctx.globalAlpha=1; }
  for(i=popups.length-1;i>=0;i--){ var t=popups[i];
    t.y-=1.2; t.life-=0.028;
    if(t.life<=0){ popups.splice(i,1); continue; }
    var k=Math.min(1,(1-t.life)/0.15), sc=0.6+0.4*k+0.15*Math.sin(k*Math.PI);
    ctx.save(); ctx.globalAlpha=Math.max(0,Math.min(1,t.life*1.6)); ctx.translate(t.x,t.y); ctx.scale(sc,sc);
    bigTxt(t.text,0,0,t.size+2,lg(0,-t.size/2,0,t.size/2,['#ffffff',t.color]),'#3b2a8a',5);
    ctx.restore(); }
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
  ctx.fillStyle=lg(-7,0,7,0,['#8a5a2b','#d09a55','#8a5a2b']); rr(-7,5,14,L-10,7); ctx.fill();
  ctx.fillStyle='#5e3a1a'; rr(-7,-4,14,11,5); ctx.fill();
  ctx.fillStyle=lg(0,L-13,0,L+13,['#e3e9f2','#8d97a8']); rr(-26,L-13,52,26,8); ctx.fill();
  ctx.fillStyle='rgba(255,255,255,0.6)'; rr(-22,L-11,44,6,3); ctx.fill();
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
    var t=(now-r.t0)/420;
    if(t>=1){ rings.splice(i,1); continue; }
    var rad=(r.big?100:58)*(1-Math.pow(1-t,2.2));
    ctx.save();
    ctx.globalAlpha=(1-t)*0.9;
    ctx.strokeStyle=r.color; ctx.lineWidth=(r.big?8:4)*(1-t)+1;
    circle(r.x,r.y,Math.max(1,rad)); ctx.stroke();
    ctx.globalAlpha=(1-t)*0.25; ctx.fillStyle=r.color; circle(r.x,r.y,Math.max(1,rad*0.8)); ctx.fill();
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
    ctx.globalAlpha=a; ctx.translate(W/2,by+cell*COLS*0.45-t*14); ctx.rotate(-0.05); ctx.scale(Math.max(0.01,s),Math.max(0.01,s));
    ctx.font='900 34px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.lineJoin='round';
    ctx.lineWidth=12; ctx.strokeStyle='#3b2a8a'; ctx.strokeText(b.text,0,0);
    ctx.lineWidth=5; ctx.strokeStyle='#ffffff'; ctx.strokeText(b.text,0,0);
    ctx.fillStyle=lg(0,-17,0,17,['#fff7b0',b.color]); ctx.fillText(b.text,0,0);
    ctx.restore();
  }
}
function drawFlash(){
  if(reduceMotion||flashA<=0) return;
  ctx.fillStyle='rgba(255,225,130,'+flashA.toFixed(3)+')';
  ctx.fillRect(0,0,W,H);
}

/* —— 按钮 —— */
function button(r,label){
  var d=4;
  shadowOn('rgba(200,90,20,0.35)',12,5);
  ctx.fillStyle='#e0661c'; rr(r.x,r.y+d,r.w,r.h,r.h/2); ctx.fill(); shadowOff();
  ctx.fillStyle=lg(0,r.y,0,r.y+r.h,['#ffd76a','#ff8a3d']); rr(r.x,r.y,r.w,r.h,r.h/2); ctx.fill();
  ctx.fillStyle='rgba(255,255,255,0.4)'; rr(r.x+10,r.y+4,r.w-20,r.h*0.36,r.h*0.18); ctx.fill();
  bigTxt(label,r.x+r.w/2,r.y+r.h/2+1,Math.min(22,r.h*0.4),'#ffffff','#b9500f',5);
}
function button2(r,label,icon){
  var d=3;
  shadowOn('rgba(50,40,140,0.25)',10,4);
  ctx.fillStyle='#c9c0f5'; rr(r.x,r.y+d,r.w,r.h,r.h/2); ctx.fill(); shadowOff();
  ctx.fillStyle=lg(0,r.y,0,r.y+r.h,['#ffffff','#efecff']); rr(r.x,r.y,r.w,r.h,r.h/2); ctx.fill();
  ctx.strokeStyle='rgba(155,140,255,0.6)'; ctx.lineWidth=1.5; rr(r.x+0.75,r.y+0.75,r.w-1.5,r.h-1.5,r.h/2); ctx.stroke();
  var fz=Math.min(16,r.h*0.36);
  if(icon){ ctx.font='800 '+fz+'px sans-serif'; var tw=ctx.measureText(label).width, tx0=r.x+r.w/2-(tw+fz+6)/2;
    drawIcon(icon,tx0+fz/2,r.y+r.h/2+1,fz*1.1,'#4a3fb0'); txt(label,tx0+fz+6,r.y+r.h/2+1,fz,'#4a3fb0','left',800); }
  else txt(label,r.x+r.w/2,r.y+r.h/2+1,fz,'#4a3fb0','center',800);
}
/* 圆形道具按钮 + 角标 */
function toolBtn(r,kind,n,armed){
  var now=Date.now(), cx=r.x+r.w/2, cy=r.y+r.h/2, R=r.w/2-4;
  if(armed&&!reduceMotion) cy-=3+2*Math.sin(now/150);
  var cs=kind==='H'?['#ffd88a','#ff8a3d','#d9651c']:kind==='B'?['#d3c8ff','#7b6cff','#4f3fd0']:['#b5f7cf','#2fbf71','#1c8f50'];
  ctx.save(); if(n<=0&&kind!=='hint') ctx.globalAlpha=0.45;
  if(armed){ var ga=0.6+0.4*Math.sin(now/180); shadowOn('rgba(255,210,60,'+ga.toFixed(2)+')',24,0); ctx.fillStyle='rgba(255,230,120,0.9)'; circle(cx,cy,R+6); ctx.fill(); shadowOff(); }
  shadowOn('rgba(40,30,120,0.3)',12,5); ctx.fillStyle=cs[2]; circle(cx,cy+3,R); ctx.fill(); shadowOff();
  ctx.fillStyle=lg(0,cy-R,0,cy+R,[cs[0],cs[1]]); circle(cx,cy,R); ctx.fill();
  ctx.fillStyle='rgba(255,255,255,0.92)'; circle(cx,cy,R-6); ctx.fill();
  ctx.fillStyle='rgba(255,255,255,0.5)'; oval(cx,cy-R*0.55,R*0.55,R*0.2); ctx.fill();
  if(kind==='hint'){
    /* 灯泡 */
    var gy=cy-3;
    ctx.fillStyle=lg(0,gy-12,0,gy+8,['#fff3a0','#ffc52e']); circle(cx,gy,11); ctx.fill();
    ctx.fillStyle='#9aa3b5'; rr(cx-6,gy+9,12,7,2); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,0.8)'; circle(cx-4,gy-4,3); ctx.fill();
    if(!reduceMotion){ ctx.strokeStyle='rgba(255,190,40,0.8)'; ctx.lineWidth=2; for(var i=0;i<5;i++){ var a=-Math.PI*0.9+i*Math.PI*0.2; ctx.beginPath(); ctx.moveTo(cx+Math.cos(a)*14,gy+Math.sin(a)*14); ctx.lineTo(cx+Math.cos(a)*18,gy+Math.sin(a)*18); ctx.stroke(); } }
  } else {
    var im=sprK(kind==='H'?'hammer_item':'laoban'), z=(R-6)*1.6;
    if(im&&im.width) ctx.drawImage(im,cx-z/2,cy-z/2,z,z);
    else txt(kind==='H'?'🔨':'🌟',cx,cy,22,'#333','center',700);
  }
  ctx.restore();
  if(kind!=='hint'){
    var bxq=cx+R*0.72, byq=cy-R*0.72;
    shadowOn('rgba(0,0,0,0.25)',4,2); ctx.fillStyle=n>0?lg(0,byq-11,0,byq+11,['#ff7a8a','#ff2d55']):'#b9b6d3'; circle(bxq,byq,11); ctx.fill(); shadowOff();
    ctx.strokeStyle='#fff'; ctx.lineWidth=2; circle(bxq,byq,11); ctx.stroke();
    txt(String(n),bxq,byq+1,13,'#fff','center',900);
  }
}
function drawTools(){
  var dw=Math.min(W-40,300), dx=(W-dw)/2, dy=toolHBtn.y-12, dh=toolHBtn.h+24;
  shadowOn('rgba(40,30,120,0.25)',18,6);
  ctx.fillStyle='rgba(255,255,255,0.72)'; rr(dx,dy,dw,dh,dh/2); ctx.fill(); shadowOff();
  ctx.strokeStyle='rgba(255,255,255,0.9)'; ctx.lineWidth=2; rr(dx+1,dy+1,dw-2,dh-2,dh/2-1); ctx.stroke();
  toolBtn(toolHBtn,'H',tools.H,armedTool==='H');
  toolBtn(toolBBtn,'B',tools.B,armedTool==='B');
  toolBtn(hintBtn,'hint',1,false);
}
/* —— 手指引导（无文字） —— */
function drawHand(x,y,now,dx,dy){
  var k=reduceMotion?0.5:(now%1200)/1200, e=k<0.6?k/0.6:1;
  var hx=x+(dx||0)*e, hy=y+(dy||0)*e+(dx||dy?0:Math.sin(now/180)*6);
  ctx.save(); ctx.globalAlpha=k<0.85?1:1-(k-0.85)/0.15;
  drawPointer(hx+8,hy+8);
  ctx.restore();
}
function drawHint(now){
  var tut=mode==='tutorial';
  if(tut&&tutStep===2&&!hintCells){
    if(!armedTool) drawHand(toolHBtn.x+toolHBtn.w/2,toolHBtn.y+toolHBtn.h*0.55,now);
    else drawHand(W/2,by+cell*COLS/2,now);
    return;
  }
  if(!hintCells||(now-hintT>3000&&hintT<=now+1)) return;
  var p1=cellXY(hintCells.a.r,hintCells.a.c), p2=cellXY(hintCells.b.r,hintCells.b.c);
  var pulse=reduceMotion?0.6:0.5+0.5*Math.sin(now/160);
  ctx.save();
  [p1,p2].forEach(function(p){
    shadowOn('rgba(60,230,150,'+(0.5+0.5*pulse).toFixed(2)+')',18,0);
    ctx.strokeStyle='#2fe08a'; ctx.lineWidth=4; rr(p.x-cell/2+1,p.y-cell/2+1,cell-2,cell-2,cell*0.28); ctx.stroke();
    shadowOff();
    ctx.strokeStyle='#ffffff'; ctx.lineWidth=1.5; rr(p.x-cell/2+3,p.y-cell/2+3,cell-6,cell-6,cell*0.26); ctx.stroke();
    ctx.fillStyle='rgba(90,240,160,'+(0.18+0.22*pulse).toFixed(3)+')'; rr(p.x-cell/2+2,p.y-cell/2+2,cell-4,cell-4,cell*0.28); ctx.fill();
  });
  if(p1.x!==p2.x||p1.y!==p2.y){
    var mx=(p1.x+p2.x)/2, my=(p1.y+p2.y)/2, ang=Math.atan2(p2.y-p1.y,p2.x-p1.x), off=reduceMotion?0:Math.sin(now/140)*3;
    ctx.translate(mx,my); ctx.rotate(ang); ctx.translate(off,0);
    shadowOn('rgba(0,80,40,0.4)',6,2);
    ctx.fillStyle='#ffffff'; ctx.beginPath(); ctx.moveTo(13,0); ctx.lineTo(-5,-11); ctx.lineTo(-5,11); ctx.closePath(); ctx.fill(); shadowOff();
    ctx.fillStyle='#1fbf6a'; ctx.beginPath(); ctx.moveTo(9,0); ctx.lineTo(-2,-7); ctx.lineTo(-2,7); ctx.closePath(); ctx.fill();
  } else if(!reduceMotion){
    var t2=(now%900)/900;
    ctx.strokeStyle='rgba(60,230,150,'+(1-t2).toFixed(2)+')'; ctx.lineWidth=3; circle(p1.x,p1.y,cell*(0.45+0.4*t2)); ctx.stroke();
  }
  ctx.restore();
  if(tut){
    if(p1.x!==p2.x||p1.y!==p2.y) drawHand(p1.x,p1.y,now,p2.x-p1.x,p2.y-p1.y);
    else drawHand(p1.x,p1.y,now);
  }
}
function dim(a){ ctx.fillStyle='rgba(28,24,72,'+(a==null?0.55:a)+')'; ctx.fillRect(0,0,W,H); }
function card(x,y,w,h,head){
  shadowOn('rgba(30,20,100,0.4)',26,12);
  ctx.fillStyle='#ffffff'; rr(x,y,w,h,26); ctx.fill(); shadowOff();
  ctx.fillStyle=lg(0,y,0,y+h,['#ffffff','#f3f0ff']); rr(x,y,w,h,26); ctx.fill();
  ctx.strokeStyle='rgba(155,140,255,0.5)'; ctx.lineWidth=2; rr(x+1,y+1,w-2,h-2,25); ctx.stroke();
  if(head){
    var hw=Math.min(w-40,220), hx=x+(w-hw)/2, hy=y-22;
    shadowOn('rgba(60,40,150,0.35)',10,4);
    ctx.fillStyle=lg(0,hy,0,hy+46,[PAL.b1,PAL.b2]); rr(hx,hy,hw,46,23); ctx.fill(); shadowOff();
    ctx.fillStyle='rgba(255,255,255,0.3)'; rr(hx+10,hy+4,hw-20,14,7); ctx.fill();
    bigTxt(head,x+w/2,hy+24,22,'#ffffff','#3b2a8a',5);
  }
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
  ctx.fillStyle='rgba(240,238,255,0.95)'; rr(r.x,r.y,r.w,r.h,r.h/2); ctx.fill();
  txt(label,r.x+18,r.y+r.h/2+1,15,PAL.ink,'left',800);
  var sw=46, sh=26, sx=r.x+r.w-sw-10, sy=r.y+(r.h-sh)/2;
  ctx.fillStyle=on?lg(0,sy,0,sy+sh,['#7cf0a8','#1fbf6a']):'#cfcde3'; rr(sx,sy,sw,sh,sh/2); ctx.fill();
  shadowOn('rgba(0,0,0,0.25)',4,2); ctx.fillStyle='#fff'; circle(on?sx+sw-sh/2:sx+sh/2,sy+sh/2,sh/2-3); ctx.fill(); shadowOff();
}
function drawPause(){
  dim();
  if(pauseTab==='help'){ drawHelp(); return; }
  var c=pauseCard;
  card(c.x,c.y,c.w,c.h,'暂停');
  button(pResume,'继续');
  button2(pHelp,'玩法','help');
  toggleRow(pSound,'声音',soundOn);
  toggleRow(pVib,'震动',vibOn);
  toggleRow(pMotion,'减少动效',reduceMotion);
  if(pauseConfirmHome) button(pHome,'确认返回?');
  else button2(pHome,'首页','home');
}
function drawHelp(){
  var bw2=Math.min(340,W*0.9), bx2=(W-bw2)/2, by2=Math.max(60,backBtn.y-470), bh2=440;
  card(bx2,by2,bw2,bh2,'玩法');
  var y=by2+56, i;
  /* 压力排序：棋子 + 压力点 */
  for(i=0;i<NTYPES;i++){
    var cv=TCACHE[i], s=40;
    if(cv) ctx.drawImage(cv,bx2+24-4,y-s/2-4,s+8,s+8);
    txt(PNAME[i],bx2+80,y,15,PAL.ink,'left',800);
    for(var k=0;k<5;k++){ ctx.fillStyle=k<PRESSURE[i]?'#ff5a6e':'rgba(120,105,230,0.15)'; circle(bx2+bw2-110+k*18,y,6); ctx.fill(); }
    y+=50;
  }
  y+=6;
  var rows=[['H','4 连 → 锤爆 3×3'],['B','5 连 → 清一色'],['ice','冰块：先碎冰']];
  for(i=0;i<rows.length;i++){
    if(rows[i][0]==='ice'){ ctx.fillStyle=lg(0,y-18,0,y+18,['#d8f3ff','#8fd0ff']); rr(bx2+24,y-18,36,36,10); ctx.fill(); ctx.strokeStyle='#fff'; ctx.lineWidth=2; rr(bx2+25,y-17,34,34,9); ctx.stroke(); }
    else { var cv2=TCACHE[rows[i][0]]; if(cv2) ctx.drawImage(cv2,bx2+24-4,y-18-4,44,44); }
    txt(rows[i][1],bx2+80,y,14,'#4a4f80','left',700);
    y+=46;
  }
  button2(backBtn,'返回','back');
}
function drawPreview(){
  if(!previewCell||!armedTool||phase!=='idle'||paused) return;
  var now=Date.now(), a=0.35+0.15*Math.sin(now/120), r, c, p;
  ctx.save();
  if(armedTool==='H'){
    for(r=previewCell.r-1;r<=previewCell.r+1;r++) for(c=previewCell.c-1;c<=previewCell.c+1;c++){
      if(r<0||r>=ROWS||c<0||c>=COLS) continue; p=cellXY(r,c);
      ctx.fillStyle='rgba(255,140,40,'+a.toFixed(3)+')'; rr(p.x-cell/2+1,p.y-cell/2+1,cell-2,cell-2,cell*0.25); ctx.fill();
    }
    p=cellXY(previewCell.r,previewCell.c);
    shadowOn('rgba(255,140,40,0.9)',14,0); ctx.strokeStyle='#fff'; ctx.lineWidth=3; rr(p.x-cell*1.5,p.y-cell*1.5,cell*3,cell*3,cell*0.35); ctx.stroke(); shadowOff();
  } else {
    var t0=tileAt(previewCell.r,previewCell.c), tp=(t0&&!isSpecial(t0))?t0.t:mostCommonType();
    for(r=0;r<ROWS;r++) for(c=0;c<COLS;c++){ var u=board[r][c]; if(u&&!u.pop&&!isSpecial(u)&&u.t===tp){ p=cellXY(r,c);
      shadowOn('rgba(140,110,255,0.9)',12,0); ctx.strokeStyle='#fff'; ctx.lineWidth=2.5; rr(p.x-cell/2+2,p.y-cell/2+2,cell-4,cell-4,cell*0.28); ctx.stroke(); shadowOff();
      ctx.fillStyle='rgba(140,110,255,'+a.toFixed(3)+')'; rr(p.x-cell/2+2,p.y-cell/2+2,cell-4,cell-4,cell*0.28); ctx.fill(); } }
  }
  ctx.restore();
}
function drawLogo(cx,cy,now){
  var bob=reduceMotion?0:Math.sin(now/600)*3;
  ctx.save(); ctx.translate(cx,cy+bob); ctx.rotate(-0.04);
  ctx.font='900 60px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.lineJoin='round';
  ctx.lineWidth=16; ctx.strokeStyle='#3b2a8a'; ctx.strokeText('怒砸KPI',0,4);
  ctx.lineWidth=16; ctx.strokeStyle='#5b46d6'; ctx.strokeText('怒砸KPI',0,0);
  ctx.lineWidth=6; ctx.strokeStyle='#ffffff'; ctx.strokeText('怒砸KPI',0,0);
  ctx.fillStyle=lg(0,-30,0,30,['#fff3a0','#ffb52e','#ff7a2e']); ctx.fillText('怒砸KPI',0,0);
  /* 副标签 */
  var tw=150, ty=46;
  ctx.fillStyle=lg(0,ty-14,0,ty+14,['#ff7a8a','#ff2d55']); rr(-tw/2,ty-14,tw,28,14); ctx.fill();
  txt('三 消 宣 泄 版',0,ty+1,14,'#fff','center',900);
  ctx.restore();
}
function drawMascots(cy,now){
  var n=5, s=Math.min(58,(W-60)/n), gap=6, x0=W/2-(n*s+(n-1)*gap)/2+s/2;
  if(tileDirty||!TC_S) buildTileCache();
  for(var i=0;i<n;i++){
    var cv=TCACHE[[3,0,2,1,4][i]]; if(!cv) continue;
    var j=reduceMotion?0:Math.max(0,Math.sin(now/260-i*0.7))*10;
    var sq=reduceMotion?1:1+0.05*Math.sin(now/260-i*0.7);
    ctx.save(); ctx.translate(x0+i*(s+gap),cy-j); ctx.scale(sq,2-sq);
    ctx.fillStyle='rgba(40,30,100,0.18)'; oval(0,s/2+j+4,s*0.36,5); ctx.fill();
    ctx.drawImage(cv,-s/2-4,-s/2-4,s+8,s+8); ctx.restore();
  }
}
function drawStart(){
  var now=Date.now();
  ctx.fillStyle='rgba(255,255,255,0.12)'; ctx.fillRect(0,0,W,H);
  drawLogo(W/2,H*0.17,now);
  drawMascots(H*0.34,now);
  var cw=Math.min(330,W*0.86), cx=(W-cw)/2, cy=startBtn.y-28, ch=levelsBtn.y+levelsBtn.h+66-cy;
  card(cx,cy,cw,ch,null);
  button(startBtn,'开始游戏');
  button2(modeBtn,'每日','cal');
  button2(levelsBtn,'关卡','book');
  var best=store.get(), chipW=120, chY=levelsBtn.y+levelsBtn.h+20;
  ctx.fillStyle='rgba(255,213,74,0.25)'; rr(W/2-chipW/2,chY,chipW,28,14); ctx.fill();
  drawIcon('trophy',W/2-28,chY+14,15,'#d08a00'); txt(String(best),W/2-14,chY+15,15,'#b36a00','left',900);
}
function drawLevels(){
  var now=Date.now();
  ctx.fillStyle='rgba(255,255,255,0.12)'; ctx.fillRect(0,0,W,H);
  var r0=levelRect(0), r9=levelRect(LEVELS.length-1);
  var cw=Math.min(W-28,360), cx=(W-cw)/2, cy=r0.y-36, ch=r9.y+r9.h+30-cy;
  card(cx,cy,cw,ch,'关卡');
  var prog=loadProg(), un=prog.unlocked||1, stars=prog.stars||{};
  for(var i=0;i<LEVELS.length;i++){
    var r=levelRect(i), locked=i>=un, cur=i===un-1&&!locked;
    var ly=r.y+(cur&&!reduceMotion?Math.sin(now/250)*2:0);
    shadowOn('rgba(40,30,120,0.25)',8,4);
    ctx.fillStyle=locked?'#b9b6d3':'#d9651c'; rr(r.x,ly+3,r.w,r.h,16); ctx.fill(); shadowOff();
    ctx.fillStyle=locked?lg(0,ly,0,ly+r.h,['#ecebf7','#cfcde3']):lg(0,ly,0,ly+r.h,['#ffe08a','#ff9d45']); rr(r.x,ly,r.w,r.h,16); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,0.45)'; rr(r.x+6,ly+4,r.w-12,r.h*0.3,10); ctx.fill();
    if(locked){ ctx.fillStyle='#8f8cb0'; rr(r.x+r.w/2-9,ly+r.h/2-4,18,14,3); ctx.fill(); ctx.strokeStyle='#8f8cb0'; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(r.x+r.w/2,ly+r.h/2-5,6,Math.PI,0); ctx.stroke(); }
    else bigTxt(String(i+1),r.x+r.w/2,ly+r.h/2-4,24,'#ffffff','#b9500f',5);
    var st=stars[i]||0;
    for(var k=0;k<3;k++){ ctx.fillStyle=k<st?'#ffd54a':'rgba(120,105,230,0.25)'; starPath(r.x+r.w/2-15+k*15,ly+r.h+12,6.5,2.8); ctx.fill(); }
  }
  button2(backBtn,'返回','back');
}
function drawStars(cx,cy,n,now){
  for(var i=0;i<3;i++){
    var t=Math.max(0,Math.min(1,(now-endT-250-i*220)/320)), on=i<n;
    var s=on?(t<1?(reduceMotion?1:1.5-0.5*t):1):1;
    var x=cx+(i-1)*64, y=cy+(i===1?-12:0), R=i===1?30:24;
    ctx.save(); ctx.translate(x,y); ctx.scale(s,s);
    ctx.fillStyle='rgba(120,105,230,0.18)'; starPath(0,0,R,R*0.48); ctx.fill();
    if(on&&t>0){ ctx.globalAlpha=t; shadowOn('rgba(255,180,0,0.8)',14,0);
      ctx.fillStyle=lg(0,-R,0,R,['#fff3a0','#ffb300']); starPath(0,0,R,R*0.48); ctx.fill(); shadowOff();
      ctx.strokeStyle='#e08a00'; ctx.lineWidth=2.5; ctx.lineJoin='round'; starPath(0,0,R,R*0.48); ctx.stroke(); }
    ctx.restore();
  }
}
function endCard(head,stars,mascot){
  var now=Date.now(), cw=Math.min(330,W*0.86), cx=(W-cw)/2, cy=H*0.2, ch=againBtn.y+shareBtn.h+shareBtn.y-againBtn.y+28-cy;
  card(cx,cy,cw,ch,head);
  var ms=sprK(mascot);
  if(ms&&ms.width){ var bob=reduceMotion?0:Math.sin(now/300)*3; ctx.drawImage(ms,cx+cw-86,cy-58+bob,96,96); }
  drawStars(W/2,cy+76,stars,now);
  var k=Math.min(1,(now-endT)/800), e=1-Math.pow(1-k,3);
  bigTxt(String(Math.round(score*e)),W/2,cy+160,54,lg(0,cy+135,0,cy+185,['#ffe07a','#ff8a3d']),'#3b2a8a',8);
  return {x:cx,y:cy,w:cw,h:ch};
}
function drawLevelEnd(){
  if(endWin){
    endCard('过关!',starCount(),'kafei');
    button(againBtn, levelIdx<LEVELS.length-1?'下一关':'再来');
    button2(shareBtn,'分享','share');
  } else {
    var c=endCard('没扛住',0,'laoban');
    var pr=levelPressureMax>0?levelPressure/levelPressureMax:0, bw=c.w-80, bx2=c.x+40, yy=c.y+206;
    ctx.fillStyle='rgba(120,105,230,0.15)'; rr(bx2,yy,bw,14,7); ctx.fill();
    ctx.fillStyle=lg(0,yy,0,yy+14,['#ff9a9a','#ff3d5a']); rr(bx2,yy,Math.max(14,bw*pr),14,7); ctx.fill();
    button(againBtn,'再试');
    button2(shareBtn,'选关','book');
  }
}
function drawEnd(){
  dim(0.5);
  if(mode==='level'){ drawLevelEnd(); return; }
  var classicFail=mode==='classic'&&score<CLASSIC_TARGET;
  var stars=mode==='classic'?(score>=12000?3:score>=9000?2:score>=CLASSIC_TARGET?1:0)
                            :(score>=10000?3:score>=6500?2:score>=3000?1:0);
  var c=endCard(classicFail?'被优化了':mode==='daily'?'今日完成':'达标下班!',stars,classicFail?'laoban':'kafei');
  var best=mode==='daily'?store.getDaily():store.get();
  var isRec=score>=best&&score>0;
  var chipW=130, chY=c.y+200;
  ctx.fillStyle=isRec?lg(0,chY,0,chY+28,['#ff7a8a','#ff2d55']):'rgba(255,213,74,0.28)'; rr(W/2-chipW/2,chY,chipW,28,14); ctx.fill();
  drawIcon(isRec?'party':'trophy',W/2-30,chY+14,15,isRec?'#fff':'#d08a00'); txt(String(Math.max(best,score)),W/2-16,chY+15,15,isRec?'#fff':'#b36a00','left',900);
  button(againBtn,'再来一局');
  button2(shareBtn,'分享','share');
}

function draw(now){
  if(state!==lastState){ transT=now; if(state==='end') endT=now; lastState=state; }
  drawBG();
  ctx.save();
  if(shakeT>0&&!reduceMotion) ctx.translate((Math.random()-0.5)*10,(Math.random()-0.5)*10);
  if(state==='playing'){
    drawHUD(); drawBoard(); drawHint(now); drawPreview(); drawTools(); drawParts();
    drawRings(now); drawHammers(now); drawBigTexts(now); drawFlash();
    if(mode==='tutorial') button2(skipBtn,'跳过');
    if(paused) drawPause();
  } else if(state==='start'){
    drawStart();
  } else if(state==='levels'){
    drawLevels();
  } else {
    drawHUD(); drawBoard(); drawTools(); drawParts(); drawEnd();
  }
  ctx.restore();
  var ta=(now-transT)/260;
  if(ta<1&&!reduceMotion){ ctx.fillStyle='rgba(246,243,255,'+(1-ta).toFixed(3)+')'; ctx.fillRect(0,0,W,H); }
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
