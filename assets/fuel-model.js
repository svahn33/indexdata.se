(()=>{
'use strict';
const $=id=>document.getElementById(id);
const set=(id,text)=>{const e=$(id);if(e)e.textContent=text;};
const fmt=(num,decimals=2)=>Number.isFinite(num)?num.toLocaleString('sv-SE',{minimumFractionDigits:decimals,maximumFractionDigits:decimals}):'—';
const date=(value)=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?new Date(value+'T12:00:00Z').toLocaleDateString('sv-SE',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Stockholm'}):'—';
const valid=n=>typeof n==='number'&&Number.isFinite(n);
let model=null;
let fileData=null;
let selectedFuel='petrol';
const fuelName=()=>selectedFuel==='petrol'?'bensin 95':'diesel';
const brent=$('scenarioBrent'),usd=$('scenarioUsd');
function scenario(){
  if(!model)return;
  const b=Number(brent.value),u=Number(usd.value);
  set('scenarioBrentValue',`${fmt(b,0)} USD/fat`);
  set('scenarioUsdValue',`${fmt(u)} kr`);
  const smooth=valid(model.reference_smoothed_brent_usd_per_barrel)?
    model.reference_smoothed_brent_usd_per_barrel:model.reference_brent_usd_per_barrel;
  const candidateOil=smooth+(valid(model.reference_smoothed_brent_usd_per_barrel)?0.75:1)*
    (b-model.reference_brent_usd_per_barrel);
  const price=model.estimate_sek_per_l+
    model.crude_pass_through_multiplier/model.litres_per_barrel*
    (candidateOil*u-smooth*model.reference_usdsek);
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
  target.setAttribute('aria-label',`Modellens senaste ${clean.length} marknadsnoteringar, från ${fmt(clean[0].value)} till ${fmt(last.value)} kronor per liter`);
}
function isModelData(d){
  return d?.status==='ok'&&d?.kind==='scenario_model_not_observed_pump_price'&&
    valid(d.estimate_sek_per_l)&&d.estimate_sek_per_l>=7&&d.estimate_sek_per_l<=45&&
    valid(d.reference_brent_usd_per_barrel)&&valid(d.reference_usdsek)&&
    valid(d.crude_pass_through_multiplier)&&valid(d.litres_per_barrel);
}
function renderFuel(){
  const name=fuelName();
  document.querySelectorAll('.fuel-type-tabs button[data-fuel]').forEach(b=>{
    b.setAttribute('aria-pressed',String(b.dataset.fuel===selectedFuel));
  });
  set('modelFuelTitle',`UPPSKATTAT PUMPPRIS · ${name.toLocaleUpperCase('sv-SE')}`);
  set('scenarioFuelLabel',`Scenario: uppskattat ${selectedFuel==='petrol'?'bensinpris':'dieselpris'}`);
  model=selectedFuel==='petrol'?fileData:fileData?.diesel_model;
  if(!isModelData(model)){
    const explanation=model?.reason||'Inväntar tillräckligt med EU-veckor och marknadsdata';
    model=null;
    for(const id of ['modelPrice','modelBrent','modelUsdsek','modelWeekly','scenarioPrice'])set(id,'—');
    set('modelBand','Inget tillförlitligt estimat just nu');
    set('modelValidation','Historisk kontroll saknas just nu.');
    set('modelMethodChoice','Metodval saknas');set('modelMethodCompare','När officiell statistik finns kan metoderna jämföras.');
    set('modelStatus',`${name}: ${explanation}.`);
    set('modelBrentDate','USD/fat');set('modelUsdDate','Riksbanken/ECB');set('modelWeeklyDate','Senaste observation');
    for(const id of ['scenarioBrentValue','scenarioUsdValue'])set(id,'—');
    brent.disabled=true;usd.disabled=true;$('scenarioReset').disabled=true;
    $('fuelChart').textContent='Diagram visas när tillräckligt med data finns.';
    return;
  }
  const d=model;
  set('modelPrice',fmt(d.estimate_sek_per_l));
  if(valid(d.indicative_lower_sek_per_l)&&valid(d.indicative_upper_sek_per_l)){
    set('modelBand',`Indikativt spann ${fmt(d.indicative_lower_sek_per_l)}–${fmt(d.indicative_upper_sek_per_l)} kr/l · historiskt medelfel ${fmt(d.rolling_backtest_mae_sek_per_l)} kr`);
  }else set('modelBand','Osäkerhetsdata saknas');
  if(d.model_version>=2&&valid(d.rolling_backtest_mae_baseline_sek_per_l)&&valid(d.rolling_backtest_mae_refined_sek_per_l)){
    const chosen=d.model_selection==='anchored'?'Förfinad, veckoförankrad modell':'Tidigare, enklare modell';
    set('modelValidation',`Historisk kontroll: ${d.backtest_weeks||'—'} veckor · vald metod ${chosen.toLocaleLowerCase('sv-SE')}.`);
    set('modelMethodChoice',`Aktiv metod: ${chosen}`);
    set('modelMethodCompare',`Genomsnittligt absolut fel vid test mot senare EU-veckor: förfinad modell ${fmt(d.rolling_backtest_mae_refined_sek_per_l)} kr/l · tidigare modell ${fmt(d.rolling_backtest_mae_baseline_sek_per_l)} kr/l. Båda använder då endast tidigare veckor. Utvärderingen omfattar ${d.backtest_weeks||'—'} testveckor och är ingen garanti för framtida pumppriser.`);
  } else {
    set('modelValidation','Kalibrerad mot officiella EU-veckopriser · tidigare modellversion.');
    set('modelMethodChoice','Tidigare modell är aktiv');
    set('modelMethodCompare','Uppdatera modellskriptet på GitHub för att jämföra en förfinad modell mot den tidigare på historiska EU-veckor.');
  }
  set('modelBrent',fmt(d.reference_brent_usd_per_barrel,1));
  set('modelBrentDate',`USD/fat · ${date(d.brent_latest_date)}`);
  set('modelUsdsek',fmt(d.reference_usdsek));
  set('modelUsdDate',`${date(d.usdsek_latest_date)} · ${String(d.fx_source||'Riksbanken/ECB').includes('centralbanken')?'ECB':'Riksbanken'}`);
  set('modelWeekly',fmt(d.latest_official_sek_per_l_approx));
  set('modelWeeklyDate',date(d.last_official_observation));
  set('modelStatus',`${name.charAt(0).toUpperCase()+name.slice(1)}: ${Number.isFinite(d.change_percent)?(d.change_percent>=0?'+':'')+fmt(d.change_percent,2)+' % sedan föregående marknadsnotering · ':''}olja ${date(d.brent_latest_date)} · valuta ${date(d.usdsek_latest_date)} · ${d.calibration_weeks} EU-veckor. Modellberäkning, inte faktiskt pumppris.`);
  brent.value=String(Math.min(Number(brent.max),Math.max(Number(brent.min),d.reference_brent_usd_per_barrel)));
  usd.value=String(Math.min(Number(usd.max),Math.max(Number(usd.min),d.reference_usdsek)));
  brent.disabled=false;usd.disabled=false;$('scenarioReset').disabled=false;
  scenario();
  $('fuelChart').textContent='Dagens modellhistorik saknas.';
  lineChart(d.recent_history);
}
async function load(){
  try{
    const r=await fetch('./data/fuel_model.json?t='+Date.now(),{cache:'no-store'});
    if(!r.ok)throw new Error('Datafilen saknas');
    const d=await r.json();
    const age=Date.now()-Date.parse(d.generated_at||'');
    if(!Number.isFinite(age)||age< -3600000||age>7*86400000)throw new Error('Modellen är inte nyligen uppdaterad');
    fileData=d;
    renderFuel();
  }catch(error){
    fileData=null;renderFuel();
    set('modelStatus',`Kan inte läsa aktuella modellvärden: ${error.message}`);
  }
}
for(const b of document.querySelectorAll('.fuel-type-tabs button[data-fuel]')){
  b.addEventListener('click',()=>{selectedFuel=b.dataset.fuel==='diesel'?'diesel':'petrol';renderFuel();});
}
brent.addEventListener('input',scenario);usd.addEventListener('input',scenario);
$('scenarioReset').addEventListener('click',()=>{
  if(!model)return;
  brent.value=String(model.reference_brent_usd_per_barrel);
  usd.value=String(model.reference_usdsek);
  scenario();
});
function clock(){const n=new Date();set('clock',n.toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Stockholm'}));set('copyrightYear',n.getFullYear());}
clock();setInterval(clock,30000);load();
})();
