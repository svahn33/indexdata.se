(()=>{
'use strict';
const $=id=>document.getElementById(id);
const set=(id,text)=>{const e=$(id);if(e)e.textContent=text;};
const fmt=(num,decimals=2)=>Number.isFinite(num)?num.toLocaleString('sv-SE',{minimumFractionDigits:decimals,maximumFractionDigits:decimals}):'—';
const date=(value)=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?new Date(value+'T12:00:00Z').toLocaleDateString('sv-SE',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Stockholm'}):'—';
const valid=n=>typeof n==='number'&&Number.isFinite(n);
let model=null;
const brent=$('scenarioBrent'),usd=$('scenarioUsd');
function scenario(){
  if(!model)return;
  const b=Number(brent.value),u=Number(usd.value);
  set('scenarioBrentValue',`${fmt(b,0)} USD/fat`);
  set('scenarioUsdValue',`${fmt(u)} kr`);
  const price=model.estimate_sek_per_l+
    model.crude_pass_through_multiplier/model.litres_per_barrel*
    (b*u-model.reference_brent_usd_per_barrel*model.reference_usdsek);
  set('scenarioPrice',fmt(price));
}
function lineChart(data){
  const target=$('fuelChart');
  if(!target||!Array.isArray(data)||data.length<5)return;
  const clean=data.filter(p=>/^\d{4}-\d{2}-\d{2}$/.test(p.date)&&valid(p.value)&&p.value>0);
  if(clean.length<5)return;
  const width=740,height=250,left=44,top=22,right=20,bottom=39;
  const values=clean.map(x=>x.value),lo=Math.floor((Math.min(...values)-0.4)*2)/2,hi=Math.ceil((Math.max(...values)+0.4)*2)/2;
  const span=Math.max(1,hi-lo);const w=width-left-right,h=height-top-bottom;
  const x=i=>left+i*w/Math.max(1,clean.length-1),y=v=>top+(hi-v)*h/span;
  const ns='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('preserveAspectRatio','xMidYMid meet');
  svg.setAttribute('aria-hidden','true');
  const line=(name,attrs,text)=>{const el=document.createElementNS(ns,name);Object.entries(attrs).forEach(([key,val])=>el.setAttribute(key,String(val)));if(text!==undefined)el.textContent=text;svg.appendChild(el);return el;};
  for(let i=0;i<=4;i++){
    const v=lo+i*span/4,Y=y(v);
    line('line',{x1:left,x2:width-right,y1:Y,y2:Y,stroke:'#e5dccd','stroke-width':1});
    line('text',{x:2,y:Y+4,fill:'#7a817a','font-size':12},fmt(v,1));
  }
  const poly=clean.map((d,i)=>`${x(i)},${y(d.value)}`).join(' ');
  const fill=clean.map((d,i)=>`${x(i)},${y(d.value)}`).join(' ')+` ${x(clean.length-1)},${height-bottom} ${left},${height-bottom}`;
  line('polygon',{points:fill,fill:'rgba(42,107,92,0.09)'});
  line('polyline',{points:poly,fill:'none',stroke:'#2A6B5C','stroke-width':3.2,'stroke-linecap':'round','stroke-linejoin':'round'});
  for(const i of [...new Set([0,Math.floor((clean.length-1)/2),clean.length-1])]){
    line('text',{x:x(i),y:height-12,fill:'#788078','font-size':12,'text-anchor':i===0?'start':i===clean.length-1?'end':'middle'},date(clean[i].date).replace(/ \d{4}$/,''));
  }
  const last=clean.at(-1);
  line('circle',{cx:x(clean.length-1),cy:y(last.value),r:5,fill:'#C49A45',stroke:'#fff', 'stroke-width':2});
  target.replaceChildren(svg);
  target.setAttribute('aria-label',`Modellens senaste ${clean.length} börsdagar, från ${fmt(clean[0].value)} till ${fmt(last.value)} kronor per liter`);
}
async function load(){
  try{
    const r=await fetch('./data/fuel_model.json?t='+Date.now(),{cache:'no-store'});
    if(!r.ok)throw new Error('Datafilen saknas');
    const d=await r.json();
    if(d.status!=='ok'||d.kind!=='scenario_model_not_observed_pump_price'||!valid(d.estimate_sek_per_l)||!valid(d.reference_brent_usd_per_barrel)||!valid(d.reference_usdsek)||!valid(d.crude_pass_through_multiplier)||!valid(d.litres_per_barrel)){
      throw new Error(d.reason||'Inväntar tillräckligt många observationer');
    }
    const age=Date.now()-Date.parse(d.generated_at||'');
    if(!Number.isFinite(age)||age< -3600000||age>7*86400000)throw new Error('Modellen är inte nyligen uppdaterad');
    model=d;
    set('modelPrice',fmt(d.estimate_sek_per_l));
    if(valid(d.indicative_lower_sek_per_l)&&valid(d.indicative_upper_sek_per_l)){
      set('modelBand',`Indikativt spann ${fmt(d.indicative_lower_sek_per_l)}–${fmt(d.indicative_upper_sek_per_l)} kr/l · historiskt medelfel ${fmt(d.rolling_backtest_mae_sek_per_l)} kr`);
    }else set('modelBand','Osäkerhetsdata saknas');
    set('modelBrent',fmt(d.reference_brent_usd_per_barrel,1));
    set('modelBrentDate',`USD/fat · ${date(d.brent_latest_date)}`);
    set('modelUsdsek',fmt(d.reference_usdsek));
    set('modelUsdDate',date(d.usdsek_latest_date));
    set('modelWeekly',fmt(d.latest_official_sek_per_l_approx));
    set('modelWeeklyDate',date(d.last_official_observation));
    set('modelStatus',`Kalibrerad mot ${d.calibration_weeks} EU-veckor · ${d.backtest_weeks} veckor i efterhandskontroll. Modellberäkning, ej faktiskt pumppris.`);
    brent.value=String(Math.min(Number(brent.max),Math.max(Number(brent.min),d.reference_brent_usd_per_barrel)));
    usd.value=String(Math.min(Number(usd.max),Math.max(Number(usd.min),d.reference_usdsek)));
    brent.disabled=false;usd.disabled=false;$('scenarioReset').disabled=false;
    brent.addEventListener('input',scenario);usd.addEventListener('input',scenario);
    $('scenarioReset').addEventListener('click',()=>{brent.value=String(d.reference_brent_usd_per_barrel);usd.value=String(d.reference_usdsek);scenario();});
    scenario();lineChart(d.recent_history);
  }catch(error){
    set('modelPrice','—');set('modelBand','Inget tillförlitligt estimat just nu');
    set('modelStatus',`Modellen visas först när historiken för Brent, valuta och EU-priser räcker. ${error.message}`);
  }
}
function clock(){const n=new Date();set('clock',n.toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Stockholm'}));set('copyrightYear',n.getFullYear());}
clock();setInterval(clock,30000);load();
})();
