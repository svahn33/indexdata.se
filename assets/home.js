(()=>{
'use strict';
const $=id=>document.getElementById(id);
const set=(id,value)=>{const el=$(id);if(el)el.textContent=value;};
const fmt=(v,d=2)=>typeof v==='number'&&Number.isFinite(v)?new Intl.NumberFormat('sv-SE',{minimumFractionDigits:d,maximumFractionDigits:d}).format(v):'—';
const localDate=()=>{
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Europe/Stockholm'}).formatToParts(new Date()).map(x=>[x.type,x.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const fmtShortDate=(iso)=>/^\d{4}-\d{2}-\d{2}$/.test(iso||'')?new Date(iso+'T12:00:00Z').toLocaleDateString('sv-SE',{day:'numeric',month:'short',timeZone:'Europe/Stockholm'}):'—';
const fmtFullDate=(iso)=>/^\d{4}-\d{2}-\d{2}$/.test(iso||'')?new Date(iso+'T12:00:00Z').toLocaleDateString('sv-SE',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Stockholm'}):'—';
const fmtTime=(iso)=>{const d=new Date(iso);return Number.isFinite(d.getTime())?d.toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Stockholm'}):'—';};
const isNum=n=>typeof n==='number'&&Number.isFinite(n);
const latest=(d,id)=>{const item=d?.indicators?.[id];return item&&isNum(item.value)?item:null;};
const quoteText=(d,id,places,unit='')=>{const q=latest(d,id);return q?`${fmt(q.value,places)}${unit}`:'—';};
let market={indicators:{},generated_at:null};
let omxVerified=null;
let commodities={power_intervals:{}};
let fuel={};
let fuelModel={};
let powerLive={};
const VAT_STORAGE_KEY='indexdata-power-vat';
let vatMode='incl';
try{if(localStorage.getItem(VAT_STORAGE_KEY)==='excl')vatMode='excl';}catch(_e){}
function applyVatButtons(){
  document.querySelectorAll('.vat-toggle button[data-vat]').forEach(b=>{
    b.setAttribute('aria-pressed',String(b.dataset.vat===vatMode));
  });
}
function setupVatToggle(){
  document.querySelectorAll('.vat-toggle button[data-vat]').forEach(b=>b.addEventListener('click',()=>{
    vatMode=b.dataset.vat==='excl'?'excl':'incl';
    try{localStorage.setItem(VAT_STORAGE_KEY,vatMode);}catch(_e){}
    applyVatButtons();paintPower();
  }));
  applyVatButtons();
}

function paintTrend(id, pct, context){
  const el=$(id);
  if(!el)return;
  const ok=isNum(pct)&&Math.abs(pct)<=50;
  el.dataset.trend=ok?(pct>0.004?'up':pct<-.004?'down':'flat'):'unknown';
  el.textContent=ok?`${pct>0.004?'+':pct<-.004?'−':''}${fmt(Math.abs(pct),2)} %`:'—';
  el.title=ok?`${context} · ${el.textContent}`:`${context} · underlag saknas`;
  el.setAttribute('aria-label',el.title);
}
// Reservvärden visas bara om den externa live-widgeten inte laddar.
// De är uttryckligen daterade och får inte presenteras som samma tick som banderollen.
function quoteIsRecent(iso,maxAgeDays=14){
  const time=Date.parse(iso||'');
  return Number.isFinite(time)&&time<=Date.now()+3600000&&Date.now()-time<=maxAgeDays*86400000;
}
function fallbackFxChange(id,date,value){
  if(!isNum(value)||!date)return null;
  const rows=Array.isArray(market?.history?.[id])?market.history[id]:[];
  const prev=rows.filter(p=>p&&typeof p.date==='string'&&p.date<date&&isNum(p.value)).sort((a,b)=>b.date.localeCompare(a.date))[0];
  if(!prev||prev.value===0)return null;
  return (value/prev.value-1)*100;
}
function paintQuoteFallbacks(){
  const candidates=[market?.omxs30,omxVerified].filter(q=>
    q&&isNum(q.price)&&q.price>500&&q.price<20000&&
    quoteIsRecent(q.price_time)&&['OMXS30','^OMX','^OMXS30'].includes(q.symbol));
  candidates.sort((a,b)=>Date.parse(b.price_time)-Date.parse(a.price_time));
  const omx=candidates[0];
  const freshOmx=Boolean(omx);
  set('homeOmxFallbackPrice',freshOmx?fmt(omx.price,2):'—');
  paintTrend('homeOmxFallbackChange',freshOmx?omx.change_percent:null,'OMXS30 · senaste daterade slut-/dagsnotering');
  set('homeOmxFallbackDate',freshOmx?`Senaste notering ${fmtFullDate(omx.price_time.slice(0,10))}`:'Kursdata saknas');
  for(const [indicator,priceId,changeId,dateId] of [
    ['SEKUSDPMI','homeUSDFallbackPrice','homeUSDFallbackChange','homeUSDFallbackDate'],
    ['SEKEURPMI','homeEURFallbackPrice','homeEURFallbackChange','homeEURFallbackDate']
  ]){
    const q=latest(market,indicator);
    const recent=Boolean(q&&quoteIsRecent(q.date+'T12:00:00Z'));
    set(priceId,recent?fmt(q.value,2):'—');
    paintTrend(changeId,recent?fallbackFxChange(indicator,q.date,q.value):null,'Förändring sedan föregående publicerade dagskurs');
    set(dateId,recent?`Dagskurs ${fmtFullDate(q.date)}`:'Dagskurs saknas');
  }
}
function paintMarket(){
  set('homePolicy',quoteText(market,'SECBREPOEFF',2,' %'));
  set('homeTenYear',quoteText(market,'SEGVB10YC',2,' %'));
  set('homeKPIF',quoteText(market,'KPIF_YOY',1,' %'));
  set('homeKPI',quoteText(market,'KPI_YOY',1,' %'));
  set('homeRateDate',`Riksbanken · ${fmtShortDate(latest(market,'SEGVB10YC')?.date)}`);
  const kpif=latest(market,'KPIF_YOY');
  set('homeInflationDate',kpif?.date?`SCB · ${new Date(kpif.date+'T12:00:00Z').toLocaleDateString('sv-SE',{month:'long',year:'numeric',timeZone:'Europe/Stockholm'})}`:'SCB · inväntar statistik');
  if(market.generated_at){
    const t=new Date(market.generated_at);
    set('homeUpdated',Number.isFinite(t.getTime())?t.toLocaleString('sv-SE',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Stockholm'}):'—');
  }
  paintFuel();
  paintQuoteFallbacks();
}
function paintFuel(){
  // Den här rutan visar bensin som ett MODELLVÄRDE, aldrig som rapporterat pumppris.
  const modelOk=fuelModel?.status==='ok'&&fuelModel?.kind==='scenario_model_not_observed_pump_price'&&
    isNum(fuelModel.estimate_sek_per_l)&&fuelModel.estimate_sek_per_l>=7&&fuelModel.estimate_sek_per_l<=45&&
    Number.isFinite(Date.parse(fuelModel.generated_at||''))&&
    Date.now()-Date.parse(fuelModel.generated_at)<=7*86400000&&
    Date.now()>=Date.parse(fuelModel.generated_at)-3600000;
  set('homePetrol',modelOk?fmt(fuelModel.estimate_sek_per_l):'—');
  const diesel=fuelModel?.diesel_model;
  const dieselModelOk=diesel?.status==='ok'&&diesel?.kind==='scenario_model_not_observed_pump_price'&&
    diesel?.fuel==='diesel'&&isNum(diesel.estimate_sek_per_l)&&
    diesel.estimate_sek_per_l>=7&&diesel.estimate_sek_per_l<=45&&modelOk;
  set('homeDiesel',dieselModelOk?fmt(diesel.estimate_sek_per_l):'—');
  paintTrend('homePetrolChange',modelOk?fuelModel.change_percent:null,'Bensinmodell sedan föregående marknadsnotering');
  paintTrend('homeDieselChange',dieselModelOk?diesel.change_percent:null,'Dieselmodell sedan föregående marknadsnotering');
  if(modelOk&&dieselModelOk){
    const oil=fmtShortDate(fuelModel.brent_latest_date),fx=fmtShortDate(fuelModel.usdsek_latest_date);
    set('homeFuelNote',`Modellestimat · olja ${oil} · valuta ${fx} · ej pumppriser`);
  }else if(modelOk){
    set('homeFuelNote','Bensin: estimat · Diesel: inväntar modellunderlag · ej faktiska pumppriser');
  }else{
    set('homeFuelNote','Inväntar bensin- och dieselestimat från automatiska beräkningen');
  }
}

function refreshTime(){
  const now=new Date();
  set('sverigeDate',now.toLocaleDateString('sv-SE',{weekday:'long',day:'numeric',month:'long',timeZone:'Europe/Stockholm'}));
  set('clock',now.toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Stockholm'}));
  set('copyrightYear',now.getFullYear());
}
function validPowerDay(d){return d&&d.date===localDate()&&Array.isArray(d.intervals)&&d.intervals.length>0;}
function activePrice(d){
  if(!validPowerDay(d))return null;
  const now=Date.now();
  const active=d.intervals.find(p=>{
    const a=Date.parse(p.start),b=Date.parse(p.end);
    return Number.isFinite(a)&&Number.isFinite(b)&&a<=now&&now<b&&isNum(p.value);
  });
  return active||null;
}
function selectedPowerPrice(p){
  if(!p)return null;
  if(vatMode==='excl')return isNum(p.value)?p.value:null;
  if(isNum(p.value_vat))return p.value_vat;
  if(isNum(p.value))return Math.round(p.value*125)/100;
  return null;
}
function paintPower(){
  const map={'SE1':'homePowerSE1','SE2':'homePowerSE2','SE3':'homePowerSE3','SE4':'homePowerSE4'};
  const seen=[];
  Object.entries(map).forEach(([zone,id])=>{
    const key='power_'+zone.toLowerCase();
    const day=powerLive[key]||commodities?.power_intervals?.[key];
    const interval=activePrice(day);
    set(id,interval?fmt(selectedPowerPrice(interval),1):'—');
    if(interval)seen.push(interval);
  });
  const q=seen[0];
  set('homePowerNote',q?`${fmtTime(q.start)}–${fmtTime(q.end)} · ${vatMode==='incl'?'inkl. 25 % moms':'exkl. moms'} · exkl. elnät/energiskatt/påslag`:`Dagens kvartpriser saknas · ${vatMode==='incl'?'inkl.':'exkl.'} moms`);
}
async function json(url){
  const response=await fetch(url,{cache:'no-store'});
  if(!response.ok)throw new Error(`HTTP ${response.status}: ${url}`);
  return response.json();
}
async function readStatic(){
  const prefix='./data/';
  const [m,c,f,model,omxLast]=await Promise.allSettled([
    json(prefix+'market.json?t='+Date.now()),
    json(prefix+'commodities.json?t='+Date.now()),
    json(prefix+'fuel.json?t='+Date.now()),
    json(prefix+'fuel_model.json?t='+Date.now()),
    json('./assets/omxs30-last-verified.json?t='+Date.now())
  ]);
  if(m.status==='fulfilled')market=m.value;
  if(c.status==='fulfilled')commodities=c.value;
  if(f.status==='fulfilled')fuel=f.value;
  if(model.status==='fulfilled')fuelModel=model.value;
  if(omxLast.status==='fulfilled'&&omxLast.value?.symbol==='OMXS30')omxVerified=omxLast.value;
  paintMarket();paintPower();
}
async function loadPowerLive(){
  const result=await Promise.allSettled(['SE1','SE2','SE3','SE4'].map(async z=>{
    const obj=await json(`https://spotwatts.com/api/v1/${z}/today.json?t=${Date.now()}`);
    if(obj.zone!==z||obj.date!==localDate()||obj.currency!=='SEK'||obj.unit!=='SEK/kWh'||!Array.isArray(obj.intervals))throw new Error('Unexpected power format');
    const intervals=obj.intervals.filter(p=>typeof p.price==='number'&&Number.isFinite(p.price)&&Number.isFinite(Date.parse(p.start))&&Number.isFinite(Date.parse(p.end))).map(p=>({start:p.start,end:p.end,value:Math.round(p.price*100000)/1000,value_vat:Math.round((typeof p.price_vat==='number'?p.price_vat:p.price*1.25)*100000)/1000}));
    if(!intervals.length)throw new Error('No valid intervals');
    return {key:'power_'+z.toLowerCase(),day:{date:obj.date,intervals}};
  }));
  for(const r of result)if(r.status==='fulfilled')powerLive[r.value.key]=r.value.day;
  paintPower();
}
function addWidget(targetId,src,config){
  const host=$(targetId);if(!host)return;
  const wrap=document.createElement('div');wrap.className='tradingview-widget-container';
  const inner=document.createElement('div');inner.className='tradingview-widget-container__widget';
  inner.style.width='100%';inner.style.height='100%';
  const script=document.createElement('script');script.async=true;script.type='text/javascript';script.src=src;
  script.textContent=JSON.stringify(config);
  script.addEventListener('error',()=>{host.innerHTML='<span class="loading-value">Marknadsdata är tillfälligt otillgänglig</span>';});
  wrap.append(inner,script);host.replaceChildren(wrap);
}
function marketWidgets(){
  addWidget('homeCompactTicker','https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js',{
    symbols:[
      {proName:'OMXSTO:OMXS30',title:'OMXS30'},
      {proName:'FOREXCOM:SPXUSD',title:'S&P 500*'},
      {proName:'FOREXCOM:NSXUSD',title:'Nasdaq 100*'},
      {proName:'TVC:UKOIL',title:'Brent'},
      {proName:'TVC:GOLD',title:'Guld'},
      {proName:'FX_IDC:USDSEK',title:'USD/SEK'},
      {proName:'FX_IDC:EURSEK',title:'EUR/SEK'}],
    colorTheme:'light',locale:'sv',isTransparent:true,displayMode:'adaptive',showSymbolLogo:false
  });
}
setupVatToggle();
refreshTime();setInterval(refreshTime,30000);
paintMarket();paintPower();
readStatic();
loadPowerLive();
setInterval(paintPower,60000);
setInterval(loadPowerLive,15*60000);
setInterval(readStatic,60*60000);
requestAnimationFrame(marketWidgets);
})();
