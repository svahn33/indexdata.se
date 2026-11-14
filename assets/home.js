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
let commodities={power_intervals:{}};
let fuel={};
let fuelModel={};
let powerLive={};

function paintMarket(){
  set('homePolicy',quoteText(market,'SECBREPOEFF',2,' %'));
  set('homeTenYear',quoteText(market,'SEGVB10YC',2,' %'));
  set('homeUSD',quoteText(market,'SEKUSDPMI',2));
  set('homeEUR',quoteText(market,'SEKEURPMI',2));
  set('homeKPIF',quoteText(market,'KPIF_YOY',1,' %'));
  set('homeKPI',quoteText(market,'KPI_YOY',1,' %'));
  set('homeRateDate',`Riksbanken · ${fmtShortDate(latest(market,'SEGVB10YC')?.date)}`);
  set('homeCurrencyDate',`Riksbanken · ${fmtShortDate(latest(market,'SEKEURPMI')?.date)}`);
  const kpif=latest(market,'KPIF_YOY');
  set('homeInflationDate',kpif?.date?`SCB · ${new Date(kpif.date+'T12:00:00Z').toLocaleDateString('sv-SE',{month:'long',year:'numeric',timeZone:'Europe/Stockholm'})}`:'SCB · inväntar statistik');
  if(market.generated_at){
    const t=new Date(market.generated_at);
    set('homeUpdated',Number.isFinite(t.getTime())?t.toLocaleString('sv-SE',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Stockholm'}):'—');
  }
  paintFuel();
}
function paintFuel(){
  // Den här rutan visar bensin som ett MODELLVÄRDE, aldrig som rapporterat pumppris.
  const modelOk=fuelModel?.status==='ok'&&fuelModel?.kind==='scenario_model_not_observed_pump_price'&&
    isNum(fuelModel.estimate_sek_per_l)&&fuelModel.estimate_sek_per_l>=7&&fuelModel.estimate_sek_per_l<=45&&
    Number.isFinite(Date.parse(fuelModel.generated_at||''))&&
    Date.now()-Date.parse(fuelModel.generated_at)<=7*86400000&&
    Date.now()>=Date.parse(fuelModel.generated_at)-3600000;
  set('homePetrol',modelOk?fmt(fuelModel.estimate_sek_per_l):'—');
  const eur=latest(market,'SEKEURPMI');
  const d=fuel?.diesel;
  const dieselDay=/^\d{4}-\d{2}-\d{2}$/.test(d?.date||'')?Date.parse(d.date+'T12:00:00Z'):NaN;
  const dieselOk=d&&isNum(d.value_eur_per_l)&&d.value_eur_per_l>.25&&d.value_eur_per_l<5&&
    eur&&isNum(eur.value)&&Number.isFinite(dieselDay)&&Date.now()-dieselDay<=28*86400000;
  set('homeDiesel',dieselOk?fmt(d.value_eur_per_l*eur.value):'—');
  if(modelOk){
    const range=isNum(fuelModel.indicative_band_sek_per_l)?` ±${fmt(fuelModel.indicative_band_sek_per_l)} kr` : '';
    set('homeFuelNote',`Bensin: modell${range} · Brent + USD/SEK · Diesel: EU ${dieselOk?fmtShortDate(d.date):'saknas'} · inkl. skatter`);
  }else{
    set('homeFuelNote',`Bensinmodellen inväntar historik · Diesel: ${dieselOk?'EU:s veckosnitt '+fmtShortDate(d.date):'data saknas'}`);
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
function powerInclVat(p){
  if(!p)return null;
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
    set(id,interval?fmt(powerInclVat(interval),1):'—');
    if(interval)seen.push(interval);
  });
  const q=seen[0];
  set('homePowerNote',q?`${fmtTime(q.start)}–${fmtTime(q.end)} · inkl. 25 % moms, exkl. elnät/skatt/påslag`:'Dagens kvartpriser saknas · inkl. moms visas när tillgängligt');
}
async function json(url){
  const response=await fetch(url,{cache:'no-store'});
  if(!response.ok)throw new Error(`HTTP ${response.status}: ${url}`);
  return response.json();
}
async function readStatic(){
  const prefix='./data/';
  const [m,c,f,model]=await Promise.allSettled([
    json(prefix+'market.json?t='+Date.now()),
    json(prefix+'commodities.json?t='+Date.now()),
    json(prefix+'fuel.json?t='+Date.now()),
    json(prefix+'fuel_model.json?t='+Date.now())
  ]);
  if(m.status==='fulfilled')market=m.value;
  if(c.status==='fulfilled')commodities=c.value;
  if(f.status==='fulfilled')fuel=f.value;
  if(model.status==='fulfilled')fuelModel=model.value;
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
  addWidget('homeOmxWidget','https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js',{
    symbol:'OMXSTO:OMXS30',width:'100%',height:'100%',locale:'sv',dateRange:'1D',colorTheme:'light',
    isTransparent:true,autosize:true,noTimeScale:true,
    trendLineColor:'rgba(252,89,31,1)',underLineColor:'rgba(252,89,31,.14)',underLineBottomColor:'rgba(252,89,31,0)'
  });
  addWidget('homeCompactTicker','https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js',{
    symbols:[
      {proName:'OMXSTO:OMXS30',title:'OMXS30'},
      {proName:'FOREXCOM:SPXUSD',title:'S&P 500*'},
      {proName:'FOREXCOM:NSXUSD',title:'Nasdaq 100*'},
      {proName:'TVC:UKOIL',title:'Brent'},
      {proName:'TVC:GOLD',title:'Guld'},
      {proName:'FX_IDC:USDSEK',title:'USD/SEK'}],
    colorTheme:'light',locale:'sv',isTransparent:true,displayMode:'adaptive',showSymbolLogo:false
  });
}
refreshTime();setInterval(refreshTime,30000);
paintMarket();paintPower();
readStatic();
loadPowerLive();
setInterval(paintPower,60000);
setInterval(loadPowerLive,15*60000);
setInterval(readStatic,60*60000);
requestAnimationFrame(marketWidgets);
})();
