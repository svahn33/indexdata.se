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
  const diesel=fuelModel?.diesel_model;
  const dieselModelOk=diesel?.status==='ok'&&diesel?.kind==='scenario_model_not_observed_pump_price'&&
    diesel?.fuel==='diesel'&&isNum(diesel.estimate_sek_per_l)&&
    diesel.estimate_sek_per_l>=7&&diesel.estimate_sek_per_l<=45&&modelOk;
  set('homeDiesel',dieselModelOk?fmt(diesel.estimate_sek_per_l):'—');
  if(modelOk&&dieselModelOk){
    set('homeFuelNote',`Bensin & diesel: modellestimat · Brent + USD/SEK · EU-kalibrering · inkl. skatter`);
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
// Schemalagda handelsdagar för aktier, enligt Nasdaq Stockholm (2026–2027).
// Statusen är kalenderbaserad; oförutsedda handelsstopp kan inte avläsas här.
const OMX_CLOSED={
  2026:new Set(['01-01','01-06','04-03','04-06','05-01','05-14','06-19','12-24','12-25','12-31']),
  2027:new Set(['01-01','01-06','03-26','03-29','05-06','06-25','12-24','12-31'])
};
const OMX_HALF_DAYS={
  2026:new Set(['01-05','04-02','04-30','05-13','10-30']),
  2027:new Set(['01-05','03-25','04-30','05-05','11-05'])
};
const OMX_RANGES={
  '1D':'1D','1W':'1W','1M':'1M','3M':'3M','YTD':'YTD','12M':'12M','60M':'60M'
};
let currentOmxRange='1D';
function stockParts(date){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
    year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',
    hourCycle:'h23',timeZone:'Europe/Stockholm'
  }).formatToParts(date).map(x=>[x.type,x.value]));
  return {year:Number(parts.year),month:Number(parts.month),day:Number(parts.day),
    time:Number(parts.hour)*60+Number(parts.minute)};
}
function omxSchedule(date){
  const p=stockParts(date);
  const dayOfWeek=new Date(Date.UTC(p.year,p.month-1,p.day)).getUTCDay();
  const key=String(p.month).padStart(2,'0')+'-'+String(p.day).padStart(2,'0');
  const closed=dayOfWeek===0||dayOfWeek===6||Boolean(OMX_CLOSED[p.year]?.has(key));
  const halfDay=Boolean(OMX_HALF_DAYS[p.year]?.has(key));
  const end=halfDay?13*60:17*60+30;
  const open=!closed&&p.time>=9*60&&p.time<end;
  return {open,closed,halfDay,end,parts:p,calendarVerified:!!OMX_CLOSED[p.year]};
}
function omxNextOpen(date){
  // Datumräkning i UTC mitt på dagen undviker övergången sommartid/vintertid.
  const p=stockParts(date);
  for(let i=0;i<15;i++){
    const probe=new Date(Date.UTC(p.year,p.month-1,p.day+i,12));
    const s=omxSchedule(probe);
    if(!s.closed&&(i>0||p.time<s.end)){
      if(i===0&&p.time<9*60)return 'Öppnar 09.00';
      if(i===0)return 'Handel till '+(s.halfDay?'13.00':'17.30');
      const day=probe.toLocaleDateString('sv-SE',{weekday:'long',timeZone:'Europe/Stockholm'});
      return 'Öppnar '+day+' 09.00';
    }
  }
  return 'Handel normalt 09.00–17.30';
}
function updateOmxStatus(now=new Date()){
  const el=$('omxMarketStatus'); if(!el)return;
  const status=omxSchedule(now);
  el.dataset.state=status.open?'open':'closed';
  set('omxMarketStatusText',status.open?'Öppen':'Stängd');
  const detail=status.open?(status.halfDay?'Halvdag · stänger 13.00':'Stänger 17.30'):omxNextOpen(now);
  set('omxMarketDetail',detail+' · Nasdaq Stockholm');
  el.title='Schemalagd handelsstatus enligt Nasdaq Stockholm. Inte en livekontroll av handelsstopp.';
  return status;
}
function omxWidgetConfig(range){
  // Pris och procentuell förändring färgsätts av TradingView: grönt upp, rött ned.
  return {
    symbols:[['OMXS30','OMXSTO:OMXS30|'+OMX_RANGES[range]]],
    chartOnly:false,width:'100%',height:'100%',autosize:true,locale:'sv',
    colorTheme:'light',isTransparent:true,backgroundColor:'#fffdf9',
    widgetFontColor:'#123F36',fontColor:'#6d756f',gridLineColor:'rgba(18,63,54,0.055)',
    chartType:'area',lineType:0,lineWidth:2,lineColor:'#2A6B5C',
    topColor:'rgba(42,107,92,0.20)',bottomColor:'rgba(42,107,92,0.015)',
    upColor:'#238553',downColor:'#BF3B49',borderUpColor:'#238553',borderDownColor:'#BF3B49',
    hideDateRanges:true,hideMarketStatus:true,hideSymbolLogo:true,noTimeScale:true,
    showVolume:false,showMA:false,valuesTracking:'1',changeMode:'price-and-percent',
    scalePosition:'right',fontSize:'10',headerFontSize:'small'
  };
}
function renderOmxWidget(range){
  if(!Object.prototype.hasOwnProperty.call(OMX_RANGES,range))return;
  currentOmxRange=range;
  document.querySelectorAll('button[data-omx-period]').forEach(btn=>{
    btn.setAttribute('aria-pressed',String(btn.dataset.omxPeriod===range));
  });
  addWidget('homeOmxWidget','https://s3.tradingview.com/external-embedding/embed-widget-symbol-overview.js',omxWidgetConfig(range));
}
function initOmxWidget(){
  document.querySelectorAll('button[data-omx-period]').forEach(btn=>{
    btn.addEventListener('click',()=>renderOmxWidget(btn.dataset.omxPeriod));
  });
  updateOmxStatus();
  setInterval(updateOmxStatus,30000);
  renderOmxWidget(currentOmxRange);
}
function marketWidgets(){
  initOmxWidget();
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
