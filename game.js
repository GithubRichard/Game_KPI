/* =====================================================
 * 怒砸KPI · 微信小游戏版
 * 单文件 game.js：入口 + 全部逻辑，无 DOM 依赖
 * 用法：微信开发者工具 → 导入项目 → 选择本目录
 * ===================================================== */
(function(){
'use strict';

/* ================= 基础 ================= */
var canvas = wx.createCanvas();
var ctx = canvas.getContext('2d');
var sys = {};
try { sys = wx.getWindowInfo(); } catch(e){ try { sys = wx.getSystemInfoSync(); } catch(_){} }
var DPR = sys.pixelRatio || 2;
var W = sys.windowWidth || 390, H = sys.windowHeight || 844;

var ROUND = 60;
var TYPES = [
  {e:'📊', label:'KPI怪',  score:10, w:30, dur:1.00, spr:'kpi'},
  {e:'📝', label:'周报怪', score:10, w:25, dur:1.00, spr:'zhoubao'},
  {e:'👔', label:'甲方怪', score:20, w:20, dur:0.72, spr:'jiafang'},
  {e:'🏠', label:'房贷怪', score:30, w:12, dur:0.88, spr:'fangdai'},
  {e:'☕', label:'咖啡',   score:0,  w:8,  dur:0.85, coffee:true, spr:'kafei'},
  {e:'🌟', label:'老板',   score:50, w:5,  dur:0.55, boss:true, spr:'laoban'}
];

/* ================= 立绘资源 ================= */
var SPR = {};
function loadSprites(){
  ['kpi','zhoubao','jiafang','fangdai','laoban','kafei'].forEach(function(k){
    try{
      var img = canvas.createImage();
      img.onload = function(){ SPR[k] = img; };
      img.onerror = function(){};
      img.src = 'assets/'+k+'.png';
    }catch(e){}
  });
}

var state='start', score=0, combo=0, maxCombo=0, timeLeft=ROUND, elapsed=0, spawnT=0;
var cells=[], monsters=[], parts=[], popups=[];
var cell=0, gx=0, gy=0, hudH=78;
var bannerT=0, shakeT=0;
var hammers=[], rings=[], bigTexts=[], flashA=0, freezeT=0, lastTickSec=-1;
var bg=null;
var startBtn={x:0,y:0,w:0,h:0}, againBtn={x:0,y:0,w:0,h:0};

var store = {
  _m:0,
  get:function(){ try{ var v=wx.getStorageSync('nkpi_best'); return parseInt(v||'0',10)||0; }catch(e){ return this._m; } },
  set:function(v){ this._m=v; try{ wx.setStorageSync('nkpi_best', String(v)); }catch(e){} }
};

/* ================= 音频（WebAudio 合成，无资源） ================= */
var actx=null;
function ensureAudio(){
  if(actx) return actx;
  try{ if(wx.createWebAudioContext){ actx = wx.createWebAudioContext().context; } }catch(e){}
  try{ if(actx && actx.resume) actx.resume(); }catch(e){}
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
function sPop(c){ var f=340+Math.min(c,24)*28; tone(f, f*0.45, 0.13, 'sine', 0.22); }
function sThud(){ tone(140, 70, 0.15, 'sawtooth', 0.10); }
function sCoffee(){ tone(520, 880, 0.18, 'triangle', 0.18); }
function sBoss(){ tone(220, 660, 0.25, 'square', 0.10); tone(330, 990, 0.25, 'square', 0.08, 0.08); }
function sFanfare(){ var ns=[523,659,784,1046], i; for(i=0;i<ns.length;i++) tone(ns[i], ns[i], 0.28, 'triangle', 0.18, i*0.12); }

/* ================= 布局 ================= */
function layout(){
  canvas.width = Math.round(W*DPR); canvas.height = Math.round(H*DPR);
  ctx.setTransform(DPR,0,0,DPR,0,0);
  var pad=14, gap=10;
  var areaH = H - hudH - 24;
  cell = Math.min((W-pad*2-gap*2)/3, (areaH-gap*2)/3);
  gx = (W-cell*3-gap*2)/2; gy = hudH + (areaH-cell*3-gap*2)/2;
  cells=[];
  for(var i=0;i<9;i++){ var cx=i%3, cy=(i/3)|0;
    cells.push({x:gx+cx*(cell+gap), y:gy+cy*(cell+gap), m:null}); }
  makeBG();
  var bw=Math.min(240,W*0.62), bh=58;
  startBtn={x:(W-bw)/2, y:H*0.66, w:bw, h:bh};
  againBtn={x:(W-bw)/2, y:H*0.68, w:bw, h:bh};
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

/* ================= 绘制 helpers ================= */
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

/* ================= 游戏逻辑 ================= */
function pickType(){
  var tot=0,i; for(i=0;i<TYPES.length;i++) tot+=TYPES[i].w;
  var r=Math.random()*tot;
  for(i=0;i<TYPES.length;i++){ r-=TYPES[i].w; if(r<=0) return TYPES[i]; }
  return TYPES[0];
}
function spawn(){
  var free=[],i; for(i=0;i<9;i++) if(!cells[i].m) free.push(i);
  if(!free.length||monsters.length>=4) return;
  var ci=free[(Math.random()*free.length)|0], t=pickType();
  var ramp=Math.max(0.62, 1-(elapsed/ROUND)*0.38);
  var m={cell:ci, type:t, born:Date.now(), dur:Math.round(1500*ramp*t.dur), dying:0};
  cells[ci].m=m; monsters.push(m);
  if(t.boss) bannerT=1.2;
}
function mult(){ return Math.min(1+((combo/5)|0), 5); }

function addPopup(x,y,text,color,size){ popups.push({x:x,y:y,text:text,color:color,size:size||18,life:1}); }
function burst(x,y,big){
  var n=big?22:10, cols=big?['#ffd54a','#ff9100','#ffffff']:['#ff8a80','#ffd54a','#ffffff'];
  for(var i=0;i<n;i++){ var a=Math.random()*Math.PI*2, s=(big?3.5:2)+Math.random()*3;
    parts.push({x:x,y:y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-1.5,life:1,
      c:cols[(Math.random()*cols.length)|0], r:2+Math.random()*3}); }
}
function hitAt(px,py){
  for(var i=0;i<9;i++){ var c=cells[i];
    if(px>=c.x&&px<=c.x+cell&&py>=c.y&&py<=c.y+cell){
      var m=c.m, nowT=Date.now();
      hammers.push({x:px,y:py,t0:nowT});
      if(m&&!m.dying){
        m.dying=nowT;
        combo++; if(combo>maxCombo) maxCombo=combo;
        if(m.type.coffee){
          timeLeft=Math.min(timeLeft+3,99);
          addPopup(c.x+cell/2, c.y+8, '+3s', '#69f0ae', 24); sCoffee();
          rings.push({x:px,y:py,t0:nowT,big:false,color:'#69f0ae'});
        } else {
          var gain=m.type.score*mult();
          score+=gain;
          addPopup(c.x+cell/2, c.y+8, '+'+gain, '#ffd54a', 20+Math.min(mult()*2,10));
          rings.push({x:px,y:py,t0:nowT,big:!!m.type.boss,color:m.type.boss?'#ff9100':'#ffd54a'});
          if(m.type.boss){
            sBoss(); shakeT=0.28; flashA=0.32; freezeT=Math.max(freezeT,0.09);
            bigTexts.push({text:'💥 BOSS 击破!',color:'#ffd54a',t0:nowT});
          } else { sPop(combo); freezeT=Math.max(freezeT,0.03); }
          if(combo>0&&combo%10===0) bigTexts.push({text:'🔥 连击 x'+combo+'!',color:'#ff6b6b',t0:nowT});
          if(combo>=15){ for(var fi=0;fi<4;fi++)
            parts.push({x:c.x+cell/2+(Math.random()-0.5)*36, y:c.y+cell/2+10,
              vx:(Math.random()-0.5)*2.4, vy:-2-Math.random()*2.4, life:1,
              c:Math.random()<0.5?'#ff9f1c':'#ff4d6d', r:2+Math.random()*2.5}); }
        }
        burst(c.x+cell/2, c.y+cell/2, !!m.type.boss);
      } else {
        rings.push({x:px,y:py,t0:nowT,big:false,color:'#5a5a78'});
        if(combo>=5) addPopup(px,py,'连击断了!','#ff8a80',16);
        combo=0; sThud();
      }
      return;
    }
  }
}

function startGame(){
  ensureAudio();
  state='playing'; score=0; combo=0; maxCombo=0; timeLeft=ROUND; elapsed=0;
  monsters=[]; parts=[]; popups=[]; spawnT=0.3; bannerT=0; shakeT=0;
  hammers=[]; rings=[]; bigTexts=[]; flashA=0; freezeT=0; lastTickSec=-1;
  for(var i=0;i<9;i++) cells[i].m=null;
}
function endGame(){
  state='end'; sFanfare();
  try{ if(score>store.get()) store.set(score); }catch(e){}
}

/* ================= 绘制 ================= */
function drawBG(){
  if(bg){ try{ ctx.drawImage(bg,0,0,W,H); return; }catch(e){} }
  ctx.fillStyle='#14141f'; ctx.fillRect(0,0,W,H);
}
function drawHUD(){
  txt(String(score), 16, 36, 28, '#ffd54a', 'left', 900);
  var bx=96, bw=W-96-96, bh=14, by=29;
  ctx.fillStyle='#2c2c44'; rr(bx,by,bw,bh,7); ctx.fill();
  var tw=Math.max(0,Math.min(1,timeLeft/ROUND));
  if(tw>0){ var g=ctx.createLinearGradient(bx,0,bx+bw,0);
    g.addColorStop(0,'#ff4d6d'); g.addColorStop(1,'#ff9f1c');
    ctx.fillStyle=g; rr(bx,by,Math.max(8,bw*tw),bh,7); ctx.fill(); }
  if(timeLeft<=10&&timeLeft>0){
    ctx.fillStyle='rgba(255,45,70,'+(0.30+0.30*Math.sin(Date.now()/130)).toFixed(3)+')';
    rr(bx,by,bw,bh,7); ctx.fill();
  }
  if(combo>=2) txt('🔥x'+combo, W-14, 36, 20, '#ff6b6b', 'right', 800);
}
function drawGrid(now){
  var i;
  for(i=0;i<9;i++){ var c=cells[i];
    ctx.fillStyle='rgba(255,255,255,0.055)'; rr(c.x,c.y,cell,cell,16); ctx.fill();
    ctx.strokeStyle='rgba(140,150,220,0.16)'; ctx.lineWidth=1.5;
    rr(c.x,c.y,cell,cell,16); ctx.stroke();
  }
  for(i=monsters.length-1;i>=0;i--){ var m=monsters[i], cc=cells[m.cell];
    var age=now-m.born;
    if(m.dying){
      var da=(now-m.dying)/220;
      if(da>=1){ monsters.splice(i,1); cc.m=null; continue; }
      drawMonster(m,cc,1+da*0.9,1-da); continue;
    }
    if(age>m.dur){
      if(m.type.boss||m.type.score>=20){
        if(combo>=5) addPopup(cc.x+cell/2, cc.y+14, '跑掉了!', '#ff8a80', 15);
        combo=0;
      }
      monsters.splice(i,1); cc.m=null; continue;
    }
    var s=Math.min(1,age/160), a=1;
    if(age>m.dur-300) a=0.55+0.45*Math.abs(Math.sin(age/60));
    drawMonster(m,cc,s,a);
  }
}
function drawMonster(m,c,s,alpha){
  var cx=c.x+cell/2, cy=c.y+cell/2;
  ctx.save(); ctx.globalAlpha=alpha; ctx.translate(cx,cy); ctx.scale(s,s);
  var sp = m.type.spr && SPR[m.type.spr];
  var sz=cell*0.74, topY=-cell/2+4;
  if(sp){
    if(m.type.boss){ /* 金色光晕底 */
      ctx.save(); ctx.shadowColor='#ffd54a'; ctx.shadowBlur=24;
      ctx.fillStyle='#ffd54a'; rr(-sz/2,topY,sz,sz,14); ctx.fill(); ctx.restore();
    }
    ctx.save(); rr(-sz/2,topY,sz,sz,14); ctx.clip();
    ctx.drawImage(sp,-sz/2,topY,sz,sz); ctx.restore();
    ctx.strokeStyle=m.type.boss?'rgba(255,213,74,0.9)':'rgba(140,150,220,0.35)';
    ctx.lineWidth=m.type.boss?2.5:1.2;
    rr(-sz/2,topY,sz,sz,14); ctx.stroke();
  } else {
    var fs=cell*0.44;
    ctx.font=fs+'px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(m.type.e,0,-6);
  }
  /* 名称小牌 */
  ctx.font='700 '+Math.max(11,cell*0.12)+'px sans-serif';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  var tw=ctx.measureText(m.type.label).width+18;
  var ly=topY+sz-4;
  ctx.fillStyle='rgba(8,8,18,0.78)';
  rr(-tw/2,ly-11,tw,22,11); ctx.fill();
  ctx.fillStyle=m.type.boss?'#ffd54a':'#dfe5ff';
  ctx.fillText(m.type.label,0,ly+1);
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
function drawBanner(){
  if(bannerT<=0) return;
  var s='⚠ 老板出现了!快砸!';
  ctx.font='900 17px sans-serif';
  var w=ctx.measureText(s).width+44;
  var x=(W-w)/2, y=hudH+6;
  ctx.save(); ctx.shadowColor='rgba(255,23,68,.7)'; ctx.shadowBlur=22;
  var g=ctx.createLinearGradient(x,0,x+w,0);
  g.addColorStop(0,'#ff1744'); g.addColorStop(1,'#ff9100');
  ctx.fillStyle=g; rr(x,y,w,38,19); ctx.fill(); ctx.restore();
  txt(s, W/2, y+19, 17, '#fff', 'center', 900);
}
/* ================= 特效：锤子 / 冲击波 / 大字 / 闪屏 ================= */
function drawHammer(h,now){
  /* 轴心在握把；整体再顺时针转90度：落点右侧为轴，锤头从右上砸下 */
  var t=(now-h.t0)/340, ang, alpha=1;
  if(t<0.30){ var k=t/0.30; ang=1.15-1.30*k*k*k; }   /* 左上高举→加速砸下 */
  else { var k2=(t-0.30)/0.70; ang=-0.15+0.15*k2; alpha=1-k2*k2; } /* 回弹+淡出 */
  ang+=Math.PI/2;
  var L=96; /* 握把到锤头中心的距离 */
  ctx.save();
  ctx.globalAlpha=Math.max(0,alpha);
  ctx.translate(h.x+L, h.y);
  ctx.rotate(ang);
  /* 手柄：从握把(0,0)伸向锤头(0,L) */
  var hg=ctx.createLinearGradient(-9,0,9,0);
  hg.addColorStop(0,'#8a5a2b'); hg.addColorStop(0.5,'#d09a55'); hg.addColorStop(1,'#8a5a2b');
  ctx.fillStyle=hg; rr(-9,6,18,L-14,9); ctx.fill();
  ctx.fillStyle='#5e3a1a'; rr(-9,-5,18,14,7); ctx.fill(); /* 握把帽 */
  /* 锤头：中心在(0,L)，砸下时正中落点 */
  ctx.fillStyle='#98a2b3'; rr(-36,L-17,72,34,10); ctx.fill();
  ctx.fillStyle='#c3ccd9'; rr(-36,L-17,72,13,10); ctx.fill();
  ctx.fillStyle='#6e7887'; rr(-28,L-8,12,16,5); ctx.fill(); rr(16,L-8,12,16,5); ctx.fill();
  ctx.fillStyle='rgba(255,255,255,0.35)'; rr(-30,L-14,60,5,2.5); ctx.fill();
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
    ctx.globalAlpha=(1-t)*0.4; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.arc(r.x,r.y,Math.max(1,rad*0.68),0,7); ctx.stroke();
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
    ctx.font='900 34px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
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
  ctx.save(); ctx.shadowColor='rgba(255,179,0,.4)'; ctx.shadowBlur=18;
  var g=ctx.createLinearGradient(0,r.y,0,r.y+r.h);
  g.addColorStop(0,'#ffe082'); g.addColorStop(1,'#ffb300');
  ctx.fillStyle=g; rr(r.x,r.y,r.w,r.h,r.h/2); ctx.fill(); ctx.restore();
  ctx.fillStyle='#b27a00'; rr(r.x,r.y+5,r.w,r.h,r.h/2); ctx.fill();
  ctx.fillStyle='#1a1a1a'; rr(r.x,r.y,r.w,r.h,r.h/2); ctx.fill();
  var g2=ctx.createLinearGradient(0,r.y,0,r.y+r.h);
  g2.addColorStop(0,'#ffe082'); g2.addColorStop(1,'#ffb300');
  ctx.fillStyle=g2; rr(r.x,r.y,r.w,r.h,r.h/2); ctx.fill();
  txt(spaced(label), r.x+r.w/2, r.y+r.h/2+1, 21, '#1a1a1a', 'center', 900);
}
function drawStart(){
  dim();
  var g=ctx.createLinearGradient(0,H*0.14,0,H*0.30);
  g.addColorStop(0,'#ffe082'); g.addColorStop(1,'#ff6f00');
  ctx.font='900 54px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillStyle=g; ctx.fillText('怒砸KPI', W/2, H*0.20);
  txt(spaced('打工人的60秒宣泄场'), W/2, H*0.20+48, 15, '#9fb0ff', 'center', 700);
  var bw2=Math.min(340,W*0.84), bx=(W-bw2)/2, by=H*0.20+84;
  ctx.fillStyle='#1e1e32'; rr(bx,by,bw2,132,14); ctx.fill();
  ctx.strokeStyle='#34345a'; ctx.lineWidth=1; rr(bx,by,bw2,132,14); ctx.stroke();
  var lines=['📊📝👔🏠 全都冒出来了,点它们发泄!','🔥 连击不断,分数翻倍','☕ 咖啡 +3秒    🌟 老板 50分','⚠ 点空会断连击'];
  for(var i=0;i<lines.length;i++) txt(lines[i], W/2, by+24+i*28, 14.5, '#d7dcff', 'center', 600);
  button(startBtn,'开始发泄');
  txt('历史最佳 '+store.get(), W/2, startBtn.y+startBtn.h+30, 14, '#8a8aa8', 'center', 600);
}
function drawEnd(){
  dim();
  txt('⏰ 时间到!', W/2, H*0.20, 20, '#9fb0ff', 'center', 800);
  txt(String(score), W/2, H*0.20+62, 64, '#ffd54a', 'center', 900);
  txt('最高连击 '+maxCombo+'   历史最佳 '+Math.max(store.get(),score), W/2, H*0.20+116, 15, '#b9c0e8', 'center', 600);
  var best=store.get(), msg='', rec='';
  if(score>best&&best>0){ rec='🎉 新纪录!'; }
  else if(best>0&&score<best&&best-score<=150){ rec='就差 '+(best-score)+' 分破纪录!不服?'; }
  if(score>=1500) msg='🏆 KPI杀手!老板见你都绕道!';
  else if(score>=800) msg='🔥 打工战神!甲方已被你拿下!';
  else if(score>=300) msg='💪 有血性!继续发泄!';
  else msg='😅 还在被KPI毒打…再来一局!';
  if(rec) txt(rec, W/2, H*0.20+146, 15, '#69f0ae', 'center', 800);
  txt(msg, W/2, H*0.20+172, 19, '#ff8a80', 'center', 800);
  button(againBtn,'再来一局');
}
function draw(now){
  drawBG();
  ctx.save();
  if(shakeT>0){ ctx.translate((Math.random()-0.5)*10,(Math.random()-0.5)*10); }
  if(state==='playing'){
    drawHUD(); drawGrid(now); drawParts(); drawBanner();
    drawRings(now); drawHammers(now); drawBigTexts(now); drawFlash();
  } else if(state==='start'){
    drawGrid(now); drawStart();
  } else {
    drawGrid(now); drawEnd();
  }
  ctx.restore();
}

/* ================= 输入 ================= */
function onTap(x,y){
  ensureAudio();
  if(state==='start'){ if(inRect(x,y,startBtn)) startGame(); return; }
  if(state==='end'){ if(inRect(x,y,againBtn)) startGame(); return; }
  hitAt(x,y);
}
try{
  wx.onTouchStart(function(e){ var t=e.touches&&e.touches[0]; if(t) onTap(t.clientX,t.clientY); });
}catch(e){}

/* ================= 主循环 ================= */
var last=Date.now();
function loop(){
  var now=Date.now(), dt=Math.min(0.05,(now-last)/1000); last=now;
  if(state==='playing'){
    if(freezeT>0){ freezeT-=dt; }
    else {
      elapsed+=dt; timeLeft-=dt;
      if(timeLeft<=0){ timeLeft=0; endGame(); }
      spawnT-=dt;
      if(spawnT<=0){ spawn(); spawnT=0.95-(0.95-0.48)*Math.min(1,elapsed/ROUND); }
    }
    if(bannerT>0) bannerT-=dt;
    if(shakeT>0) shakeT-=dt;
    if(flashA>0) flashA=Math.max(0,flashA-dt*2.4);
    var sec=Math.ceil(timeLeft);
    if(timeLeft<=10&&timeLeft>0&&sec!==lastTickSec){ lastTickSec=sec; tone(880,880,0.07,'square',0.07); }
  } else {
    /* 待机画面也让格子有点生气：偶尔冒个怪 */
    spawnT-=dt;
    if(spawnT<=0){ if(state==='start'&&monsters.length<2) spawn(); spawnT=1.2; }
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
