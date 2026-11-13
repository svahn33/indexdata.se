(()=>{
'use strict';

// Identifierare i den officiella datafil som uppdateras av GitHub Actions.
const info = {
  SEGVB2YC:{name:'Sverige 2 år', unit:'%', digits:2, description:'Statsobligation, 2 år'},
  SEGVB5YC:{name:'Sverige 5 år', unit:'%', digits:2, description:'Statsobligation, 5 år'},
  SEGVB10YC:{name:'Sverige 10 år', unit:'%', digits:2, description:'Statsobligation, 10 år'},
  SECBREPOEFF:{name:'Styrräntan', unit:'%', digits:2, description:'Riksbanken'},
  DEGVB10Y:{name:'Tyskland 10 år', unit:'%', digits:2, description:'Statsobligation, 10 år'},
  USGVB10Y:{name:'USA 10 år', unit:'%', digits:2, description:'Statsobligation, 10 år'},
  SEMB5YCACOMB:{name:'Bostadsobligation 5 år', unit:'%', digits:2, description:'Säkerställd obligation'},
  SEKUSDPMI:{name:'USD/SEK', unit:'SEK', digits:4, description:'Amerikansk dollar'},
  SEKEURPMI:{name:'EUR/SEK', unit:'SEK', digits:4, description:'Euro'},
  SEKNOKPMI:{name:'NOK/SEK', unit:'SEK', digits:4, description:'Norsk krona'},
  SEKDKKPMI:{name:'DKK/SEK', unit:'SEK', digits:4, description:'Dansk krona'},
  SEKGBPPMI:{name:'GBP/SEK', unit:'SEK', digits:4, description:'Brittiskt pund'},
  SEKCHFPMI:{name:'CHF/SEK', unit:'SEK', digits:4, description:'Schweizisk franc'},
  SEKKIX92:{name:'KIX-index', unit:'index', digits:2, description:'Konkurrensvägd kronkurs'},
  KPIF_YOY:{name:'KPIF', unit:'%', digits:1, description:'Årsförändring'},
  KPI_YOY:{name:'KPI', unit:'%', digits:1, description:'Årsförändring'}
};
const $=id=>document.getElementById(id);
const setText=(id,value)=>{const el=$(id);if(el)el.textContent=value;};
const setHTML=(id,html)=>{const el=$(id);if(el)el.innerHTML=html;};
const values={indicators:{},history:{},sources:{}};
let range='3m';

const number=(value,digits=2)=>Number.isFinite(Number(value))&&value!==null&&value!==undefined
  ?new Intl.NumberFormat('sv-SE',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(Number(value)):'—';
const quote=id=>values.indicators?.[id]||null;
const valid=id=>typeof quote(id)?.value==='number'&&Number.isFinite(quote(id).value);
const num=id=>valid(id)?number(quote(id).value,info[id]?.digits??2):'—';
function date(iso){
  if(!iso||!/^\d{4}-\d{2}-\d{2}/.test(iso))return '–';
  return new Date(iso.slice(0,10)+'T12:00:00Z').toLocaleDateString('sv-SE',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Stockholm'});
}
function month(iso){
  if(!iso||!/^\d{4}-\d{2}-\d{2}/.test(iso))return '–';
  return new Date(iso.slice(0,10)+'T12:00:00Z').toLocaleDateString('sv-SE',{month:'long',year:'numeric',timeZone:'Europe/Stockholm'});
}
const dateFor=id=>date(quote(id)?.date);
function readHistory(id){
  const pts=values.history?.[id]||[];
  return pts.filter(p=>/^\d{4}-\d{2}-\d{2}$/.test(p.date||'')&&Number.isFinite(Number(p.value)))
    .map(p=>({date:p.date,value:Number(p.value)})).sort((a,b)=>a.date.localeCompare(b.date));
}
function sliceRange(points,r){
  if(!points.length)return [];
  const last=new Date(points[points.length-1].date+'T12:00:00Z');
  const days=r==='1m'?31:r==='3m'?94:370;
  const start=new Date(last.getTime()-days*86400000).toISOString().slice(0,10);
  return points.filter(p=>p.date>=start);
}
function chartSvg(points,{height=250,width=660,id='rate-gradient'}={}){
  if(points.length<2)return null;
  const left=44,right=15,top=15,bottom=33,innerW=width-left-right,innerH=height-top-bottom;
  const arr=points.map(p=>p.value);
  let lo=Math.min(...arr),hi=Math.max(...arr);
  const spread=Math.max(.06,hi-lo); lo-=spread*.18;hi+=spread*.18;
  const x=i=>left+i/(points.length-1)*innerW;
  const y=v=>top+(hi-v)/(hi-lo)*innerH;
  const p=points.map((v,i)=>`${i?'L':'M'}${x(i).toFixed(2)},${y(v.value).toFixed(2)}`).join(' ');
  const area=`${p} L${x(points.length-1).toFixed(2)},${top+innerH} L${left},${top+innerH} Z`;
  const grid=[0,.25,.5,.75,1].map(i=>{
    const v=top+innerH*i;
    return `<line x1="${left}" x2="${width-right}" y1="${v}" y2="${v}" stroke="#ecece8" stroke-dasharray="3 5"/><text x="${left-10}" y="${v+4}" fill="#999" font-size="10" text-anchor="end">${number(hi-(hi-lo)*i,1)}</text>`;
  }).join('');
  const ticks=[0,Math.floor((points.length-1)/2),points.length-1].map(i=>`<text x="${x(i)}" y="${height-9}" text-anchor="${i===0?'start':i===points.length-1?'end':'middle'}" fill="#999" font-size="10">${date(points[i].date).replace(/ \d{4}$/,'')}</text>`).join('');
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Linjediagram med ${points.length} observationer"><defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fc591f" stop-opacity=".13"/><stop offset="1" stop-color="#fc591f" stop-opacity="0"/></linearGradient></defs>${grid}<path d="${area}" fill="url(#${id})"/><path d="${p}" fill="none" stroke="#fc591f" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/><circle cx="${x(points.length-1)}" cy="${y(points[points.length-1].value)}" r="4" fill="#fc591f" stroke="#fff" stroke-width="2.5"/>${ticks}</svg>`;
}
function drawGraph(target,points,gradient,periodTarget,height=260){
  const svg=chartSvg(points,{height,id:gradient});
  setHTML(target,svg||'<div class="chart-empty">Ingen historik tillgänglig.</div>');
  setText(periodTarget,points.length?`${date(points[0].date)} – ${date(points[points.length-1].date)}`:'Ingen historik');
}
function renderOverview(){
  const cards=[
    ['SECBREPOEFF','Styrräntan','◎','Riksbanken'],
    ['SEGVB10YC','Sverige 10 år','↗','Statsobligation'],
    ['KPIF_YOY','Inflation, KPIF','◉','12 månader'],
    ['SEKUSDPMI','USD/SEK','⇄','1 USD i kronor']
  ];
  setHTML('kpiGrid',cards.map(([id,name,icon,caption])=>`<article class="kpi-card ${valid(id)?'':'empty'}"><div class="kpi-label">${name}<span aria-hidden="true">${icon}</span></div><div class="kpi-value">${num(id)}${valid(id)?` <span class="unit">${info[id].unit}</span>`:''}</div><div class="kpi-bottom"><span>${caption}</span><time>${dateFor(id)}</time></div></article>`).join(''));
  drawGraph('overviewRateChart',sliceRange(readHistory('SEGVB10YC'),'3m'),'overview-rate-fill','overviewRatePeriod',250);
  for(const [id,prefix] of [['KPIF_YOY','overviewKpif'],['KPI_YOY','overviewKpi']]){
    setText(prefix,valid(id)?`${num(id)} %`:'—');setText(prefix+'Date',quote(id)?.date?month(quote(id).date):'–');
  }
}
function renderRates(){
  const ids=['SEGVB2YC','SEGVB5YC','SEGVB10YC','DEGVB10Y','USGVB10Y','SEMB5YCACOMB'];
  setHTML('ratesList',ids.map(id=>`<div class="rate-item"><div><div class="rate-name">${info[id].name}</div><div class="rate-sub">${info[id].description}</div></div><div class="rate-right"><div class="rate-value">${num(id)}${valid(id)?' %':''}</div><time class="rate-date">${dateFor(id)}</time></div></div>`).join(''));
  drawGraph('rateChart',sliceRange(readHistory('SEGVB10YC'),range),'rate-fill','chartPeriod',350);
}
function renderInflation(){
  for(const [id,prefix] of [['KPIF_YOY','kpif'],['KPI_YOY','kpi']]){
    setText(prefix+'Value',valid(id)?`${num(id)} %`:'—');
    setText(prefix+'Date',quote(id)?.date?`Referensmånad: ${month(quote(id).date)}`:'Ej tillgängligt');
  }
  drawGraph('inflationChart',readHistory('KPIF_YOY').slice(-36),'inflation-fill','inflationPeriod',350);
}
function renderCurrencies(){
  const ids=['SEKUSDPMI','SEKEURPMI','SEKNOKPMI','SEKDKKPMI','SEKGBPPMI','SEKCHFPMI'];
  const flags={SEKUSDPMI:'US',SEKEURPMI:'EU',SEKNOKPMI:'NO',SEKDKKPMI:'DK',SEKGBPPMI:'UK',SEKCHFPMI:'CH'};
  setHTML('fxList',ids.map(id=>`<div class="fx-row"><div class="fx-pair"><span class="fx-icon">${flags[id]}</span><div><div class="fx-label">${info[id].name}</div><div class="fx-desc">${info[id].description}</div></div></div><div class="fx-price">${num(id)}<small>${dateFor(id)}</small></div></div>`).join(''));
  setText('kixValue',num('SEKKIX92'));
  setText('kixDate',dateFor('SEKKIX92'));
}
function renderStatus(){
  const stamp=values.generated_at;
  setText('lastUpdate',stamp&&!Number.isNaN(new Date(stamp).getTime())?new Date(stamp).toLocaleString('sv-SE',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Stockholm'}):'Uppdatering saknas');
  const entries=Object.entries(values.sources||{});
  setText('healthStatus',entries.length?entries.map(([name,s])=>`${name==='riksbank'?'Riksbanken':name==='scb'?'SCB':name}: ${s.status==='ok'?'Uppdaterad':s.status==='initial'?'Väntar':s.status==='partial'?'Delvis tillgänglig':'Kontrollera källan'}`).join(' · '):'Ingen status tillgänglig');
  setText('copyrightYear',new Date().getFullYear());
}
function render(){renderOverview();renderRates();renderInflation();renderCurrencies();renderStatus();}

// Skapa widget först när dess flik syns. En TradingView-iframe kan annars få bredden 0.
function addTradingWidget(targetId,src,settings,height){
  const host=$(targetId);
  if(!host||host.dataset.initialized)return;
  host.dataset.initialized='true';
  const wrapper=document.createElement('div');wrapper.className='tradingview-widget-container';
  wrapper.style.width='100%';wrapper.style.height=height;
  const holder=document.createElement('div');holder.className='tradingview-widget-container__widget';
  holder.style.width='100%';holder.style.height='100%';
  const script=document.createElement('script');script.type='text/javascript';script.async=true;script.src=src;
  script.textContent=JSON.stringify(settings);
  script.addEventListener('error',()=>{
    host.dataset.initialized='error';
    host.innerHTML='<div class="widget-placeholder">Marknadsdata kan inte visas för tillfället. Kontrollera anslutningen eller försök igen senare.</div>';
  });
  wrapper.append(holder,script);host.replaceChildren(wrapper);
}
// Samma instrument i båda tickerbanden och marknadstabellen.
// SPXUSD och NSXUSD är indikativa CFD-noteringar, inte officiella indexvärden.
const marketSymbols = [
  {proName:'OMXSTO:OMXS30',title:'OMXS30'},
  {proName:'FOREXCOM:SPXUSD',title:'S&P 500*'},
  {proName:'FOREXCOM:NSXUSD',title:'Nasdaq 100*'},
  {proName:'INDEX:DEU40',title:'DAX'},
  {proName:'TVC:UKOIL',title:'Brentolja'},
  {proName:'TVC:GOLD',title:'Guld'},
  {proName:'FX_IDC:USDSEK',title:'USD/SEK'}
];
function initTicker(target='homeTicker'){
  addTradingWidget(target,'https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js',{
    symbols:marketSymbols,colorTheme:'light',locale:'sv',isTransparent:true,
    displayMode:'adaptive',showSymbolLogo:false
  },'88px');
}
function initMiniChart(target,symbol){
  addTradingWidget(target,'https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js',{
    symbol,width:'100%',height:'100%',locale:'sv',dateRange:'1D',colorTheme:'light',
    isTransparent:true,autosize:true,noTimeScale:false,
    trendLineColor:'rgba(252,89,31,1)',underLineColor:'rgba(252,89,31,0.16)',
    underLineBottomColor:'rgba(252,89,31,0)',
  },'238px');
}
function initMarketQuotes(){
  addTradingWidget('marketQuotesWidget','https://s3.tradingview.com/external-embedding/embed-widget-market-quotes.js',{
    title:'',width:'100%',height:'100%',locale:'sv',colorTheme:'light',
    isTransparent:false,showSymbolLogo:false,
    symbolsGroups:[
      {name:'Börsindex',symbols:[
        {name:'OMXSTO:OMXS30',displayName:'OMXS30'},
        {name:'FOREXCOM:SPXUSD',displayName:'S&P 500 (CFD)'},
        {name:'FOREXCOM:NSXUSD',displayName:'Nasdaq 100 (CFD)'},
        {name:'INDEX:DEU40',displayName:'DAX'},
        {name:'TVC:VIX',displayName:'VIX'}
      ]},
      {name:'Råvaror',symbols:[
        {name:'TVC:UKOIL',displayName:'Brentolja'},
        {name:'TVC:USOIL',displayName:'WTI-olja'},
        {name:'TVC:GOLD',displayName:'Guld'},
        {name:'COMEX:HG1!',displayName:'Koppar'}
      ]},
      {name:'Valutor',symbols:[
        {name:'FX_IDC:USDSEK',displayName:'USD/SEK'},
        {name:'FX_IDC:EURSEK',displayName:'EUR/SEK'},
        {name:'FX:EURUSD',displayName:'EUR/USD'}
      ]}
    ]
  },'920px');
}


// Råvaror visas på en egen sida för att undvika att blanda index och råvarudata.
// TVC-serierna är indikativa CFD-kurser; terminer kan ha fördröjning eller sakna fri visning.
const commoditySymbols = [
  {proName:'TVC:UKOIL',title:'Brentolja'},
  {proName:'TVC:USOIL',title:'WTI-olja'},
  {proName:'TVC:GOLD',title:'Guld'},
  {proName:'TVC:SILVER',title:'Silver'},
  {proName:'COMEX:HG1!',title:'Koppar'},
  {proName:'NYMEX:NG1!',title:'Naturgas'}
];
function initCommodityTicker(){
  addTradingWidget('commodityTicker','https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js',{
    symbols:commoditySymbols,colorTheme:'light',locale:'sv',isTransparent:true,
    displayMode:'adaptive',showSymbolLogo:false
  },'88px');
}
function initCommodityQuotes(){
  addTradingWidget('commodityQuotesWidget','https://s3.tradingview.com/external-embedding/embed-widget-market-quotes.js',{
    title:'',width:'100%',height:'100%',locale:'sv',colorTheme:'light',
    isTransparent:false,showSymbolLogo:false,
    symbolsGroups:[
      {name:'Energi',symbols:[
        {name:'TVC:UKOIL',displayName:'Brentolja (CFD)'},
        {name:'TVC:USOIL',displayName:'WTI-olja (CFD)'},
        {name:'NYMEX:NG1!',displayName:'Naturgas (termin)'}
      ]},
      {name:'Ädelmetaller',symbols:[
        {name:'TVC:GOLD',displayName:'Guld (CFD)'},
        {name:'TVC:SILVER',displayName:'Silver (CFD)'}
      ]},
      {name:'Industrimetaller',symbols:[
        {name:'COMEX:HG1!',displayName:'Koppar (termin)'}
      ]},
      {name:'Jordbruk',symbols:[
        {name:'CBOT:ZW1!',displayName:'Vete (termin)'}
      ]}
    ]
  },'900px');
}

function clockTick(){setText('clock',new Date().toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Stockholm'}));}
async function load(){
  try{
    const res=await fetch('./data/market.json?v='+Date.now(),{cache:'no-store'});
    if(!res.ok)throw new Error('HTTP '+res.status);
    const payload=await res.json();
    values.indicators=payload.indicators||{};
    values.history=payload.history||{};
    values.sources=payload.sources||{};
    values.generated_at=payload.generated_at;
    render();
  }catch(err){
    console.warn('Datafilen kunde inte läsas',err);
    render();setText('healthStatus','Datafilen kunde inte läsas');
  }
}
document.querySelectorAll('[data-range]').forEach(btn=>btn.addEventListener('click',()=>{
  range=btn.dataset.range;
  document.querySelectorAll('[data-range]').forEach(other=>other.classList.toggle('active',other===btn));
  renderRates();
}));
clockTick();setInterval(clockTick,30000);
render();
if($('homeTicker'))requestAnimationFrame(()=>initTicker('homeTicker'));
if($('marketTicker'))requestAnimationFrame(()=>initTicker('marketTicker'));
if($('sp500Widget'))requestAnimationFrame(()=>initMiniChart('sp500Widget','FOREXCOM:SPXUSD'));
if($('nasdaqWidget'))requestAnimationFrame(()=>initMiniChart('nasdaqWidget','FOREXCOM:NSXUSD'));
if($('marketQuotesWidget'))requestAnimationFrame(initMarketQuotes);
if($('commodityTicker'))requestAnimationFrame(initCommodityTicker);
if($('brentWidget'))requestAnimationFrame(()=>initMiniChart('brentWidget','TVC:UKOIL'));
if($('wtiWidget'))requestAnimationFrame(()=>initMiniChart('wtiWidget','TVC:USOIL'));
if($('goldWidget'))requestAnimationFrame(()=>initMiniChart('goldWidget','TVC:GOLD'));
if($('copperWidget'))requestAnimationFrame(()=>initMiniChart('copperWidget','COMEX:HG1!'));
if($('commodityQuotesWidget'))requestAnimationFrame(initCommodityQuotes);
load();
})();
